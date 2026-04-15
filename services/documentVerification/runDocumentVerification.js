const path = require('path');
const sharp = require('sharp');
const { assessDocumentQuality } = require('./imageQuality');
const { decodePdf417 } = require('./pdf417Decoder');
const { runOcr } = require('./ocrProvider');
const { detectDocumentType } = require('./documentClassifier');
const { validateConsistency } = require('./consistencyValidator');
const { decideVerificationOutcome } = require('./decisionEngine');
const { isPdfFile } = require('./shared');

const OCR_ROTATION_CANDIDATES = [0, 90, 180, 270];

const buildHardRejectReasons = function (qualityResult) {
  if (qualityResult.hardReject && qualityResult.rejectionReasons.length) {
    return qualityResult.rejectionReasons.slice();
  }

  return [];
};

const scoreOcrCandidate = function (ocrResult, classificationResult, validationResult) {
  let score = Number(ocrResult.confidence || 0);

  score += Math.min(90, Math.round(String(ocrResult.rawText || '').length / 4));
  score += Number(classificationResult.confidence || 0) * 1.35;
  score += Number(validationResult.confidence || 0) * 0.85;

  if (classificationResult.matchesExpected) {
    score += 140;
  }

  if (validationResult.declaredDataMatches) {
    score += 55;
  }

  if (validationResult.consistencyChecksPassed) {
    score += 35;
  }

  if (validationResult.recommendedDecision === 'APPROVE') {
    score += 45;
  }

  if (validationResult.recommendedDecision === 'REVIEW') {
    score += 15;
  }

  return Math.round(score);
};

const buildRotationBuffer = async function (baseBuffer, rotation) {
  if (!rotation) {
    return baseBuffer;
  }

  return sharp(baseBuffer).rotate(rotation).png().toBuffer();
};

const resolveBestOcrAttempt = async function (profileDocument, businessProfile, documentPath, qualityResult) {
  if (isPdfFile(documentPath, profileDocument.mimeType) || !qualityResult.preprocessedImageBuffer) {
    const ocrResult = await runOcr(documentPath, profileDocument.mimeType, qualityResult.preprocessedImageBuffer);
    const classificationResult = detectDocumentType(profileDocument.documentRole, ocrResult.rawText);
    const validationResult = validateConsistency(businessProfile, ocrResult.rawText, profileDocument.documentRole);
    validationResult.confidence = validationResult.confidence || 0;

    return {
      rotationApplied: 0,
      rotationAttempts: [{
        rotation: 0,
        score: scoreOcrCandidate(ocrResult, classificationResult, validationResult),
        ocrConfidence: ocrResult.confidence,
        textLength: String(ocrResult.rawText || '').length,
        matchesExpected: classificationResult.matchesExpected,
        classificationConfidence: classificationResult.confidence,
        recommendedDecision: validationResult.recommendedDecision,
        validationConfidence: validationResult.confidence
      }],
      ocrResult,
      classificationResult,
      validationResult
    };
  }

  const attempts = [];

  for (const rotation of OCR_ROTATION_CANDIDATES) {
    const rotatedBuffer = await buildRotationBuffer(qualityResult.preprocessedImageBuffer, rotation);
    const ocrResult = await runOcr(documentPath, profileDocument.mimeType, rotatedBuffer);
    const classificationResult = detectDocumentType(profileDocument.documentRole, ocrResult.rawText);
    const validationResult = validateConsistency(businessProfile, ocrResult.rawText, profileDocument.documentRole);
    validationResult.confidence = validationResult.confidence || 0;
    attempts.push({
      rotation,
      score: scoreOcrCandidate(ocrResult, classificationResult, validationResult),
      ocrResult,
      classificationResult,
      validationResult
    });
  }

  attempts.sort(function (leftAttempt, rightAttempt) {
    return rightAttempt.score - leftAttempt.score;
  });

  const bestAttempt = attempts[0];

  return {
    rotationApplied: bestAttempt.rotation,
    rotationAttempts: attempts.map(function (attempt) {
      return {
        rotation: attempt.rotation,
        score: attempt.score,
        ocrConfidence: attempt.ocrResult.confidence,
        textLength: String(attempt.ocrResult.rawText || '').length,
        matchesExpected: attempt.classificationResult.matchesExpected,
        classificationConfidence: attempt.classificationResult.confidence,
        recommendedDecision: attempt.validationResult.recommendedDecision,
        validationConfidence: attempt.validationResult.confidence
      };
    }),
    ocrResult: bestAttempt.ocrResult,
    classificationResult: bestAttempt.classificationResult,
    validationResult: bestAttempt.validationResult
  };
};

const resolveBarcodeSignal = async function (profileDocument, documentPath) {
  if (String(profileDocument.documentRole || '').trim().toUpperCase() !== 'CEDULA_BACK') {
    return {
      success: false,
      rawText: '',
      extractedFields: {
        documentNumberCandidates: [],
        nameCandidates: []
      },
      attempt: null,
      attempts: []
    };
  }

  try {
    return await decodePdf417(documentPath);
  } catch (error) {
    return {
      success: false,
      rawText: '',
      extractedFields: {
        documentNumberCandidates: [],
        nameCandidates: []
      },
      attempt: null,
      attempts: [{
        crop: 'decoder-error',
        rotation: null,
        error: error && error.message ? error.message : String(error || 'PDF417 decoder failed')
      }]
    };
  }
};

const resolveAbsoluteDocumentPath = function (storageKey) {
  if (/^[A-Za-z]:\\/.test(storageKey)) {
    return storageKey;
  }

  return path.join(process.cwd(), storageKey);
};

const forceManualReviewDecisionForLegalProfile = function (profileDocument, qualityResult, classificationResult, ocrResult, validationResult) {
  profileDocument.qualityAssessment = qualityResult.assessment;
  profileDocument.classificationAssessment = {
    expectedType: profileDocument.classificationAssessment && profileDocument.classificationAssessment.expectedType
      ? profileDocument.classificationAssessment.expectedType
      : undefined,
    detectedType: classificationResult.detectedType,
    countryDetected: classificationResult.countryDetected,
    confidence: classificationResult.confidence,
    matchesExpected: classificationResult.matchesExpected
  };
  profileDocument.ocrResult = {
    provider: ocrResult.provider,
    rawText: ocrResult.rawText,
    fields: ocrResult.fields || {},
    confidence: ocrResult.confidence
  };
  profileDocument.validationResult = {
    declaredDataMatches: validationResult.declaredDataMatches,
    formatChecksPassed: validationResult.formatChecksPassed,
    consistencyChecksPassed: validationResult.consistencyChecksPassed,
    recommendedDecision: 'REVIEW',
    notes: 'El comprobante del NIT se registró correctamente y quedó enviado a revisión manual mientras se consolida una validación automática suficientemente confiable para perfiles jurídicos.'
  };
  profileDocument.verificationStatus = 'MANUAL_REVIEW';
  profileDocument.rejectionReasons = [];
  profileDocument.uploadStatus = 'STORED';

  return {
    verificationStatus: 'MANUAL_REVIEW',
    rejectionReasons: [],
    decisionReasons: [
      'El comprobante del NIT fue registrado correctamente.',
      'El perfil jurídico quedó enviado a revisión manual para validación tributaria.'
    ],
    summary: 'Comprobante del NIT enviado a revisión manual para validación tributaria.',
    decisionScore: validationResult.confidence || classificationResult.confidence || ocrResult.confidence || null
  };
};

const runAutomaticDocumentVerification = async function (profileDocument, businessProfile) {
  const documentPath = resolveAbsoluteDocumentPath(profileDocument.storageKey);
  const qualityResult = await assessDocumentQuality(documentPath, profileDocument.mimeType);
  const bestOcrAttempt = await resolveBestOcrAttempt(profileDocument, businessProfile, documentPath, qualityResult);
  const barcodeSignal = await resolveBarcodeSignal(profileDocument, documentPath);
  const combinedRawText = [bestOcrAttempt.ocrResult.rawText, barcodeSignal.rawText].filter(Boolean).join('\n').trim();
  const ocrResult = Object.assign({}, bestOcrAttempt.ocrResult, {
    rawText: combinedRawText || bestOcrAttempt.ocrResult.rawText,
    fields: Object.assign({}, bestOcrAttempt.ocrResult.fields || {}, {
      pdf417: {
        success: barcodeSignal.success,
        rawText: barcodeSignal.rawText,
        extractedFields: barcodeSignal.extractedFields,
        attempt: barcodeSignal.attempt,
        attempts: barcodeSignal.attempts
      }
    })
  });
  const classificationResult = detectDocumentType(profileDocument.documentRole, ocrResult.rawText);
  const validationResult = validateConsistency(businessProfile, ocrResult.rawText, profileDocument.documentRole);
  validationResult.confidence = validationResult.confidence || 0;
  const hardRejectReasons = buildHardRejectReasons(qualityResult);
  const isLegalProfileDocument = String(businessProfile && businessProfile.profileType || '').trim().toUpperCase() === 'LEGAL';

  if (isLegalProfileDocument) {
    const decision = forceManualReviewDecisionForLegalProfile(profileDocument, qualityResult, classificationResult, ocrResult, validationResult);
    await profileDocument.save();

    return {
      profileDocument,
      decision,
      qualityResult,
      classificationResult,
      ocrResult,
      validationResult
    };
  }

  const decision = decideVerificationOutcome({
    qualityAssessment: qualityResult.assessment,
    classificationAssessment: classificationResult,
    ocrResult,
    validationResult,
    hardRejectReasons
  });

  profileDocument.qualityAssessment = qualityResult.assessment;
  profileDocument.classificationAssessment = {
    expectedType: profileDocument.classificationAssessment && profileDocument.classificationAssessment.expectedType
      ? profileDocument.classificationAssessment.expectedType
      : undefined,
    detectedType: classificationResult.detectedType,
    countryDetected: classificationResult.countryDetected,
    confidence: classificationResult.confidence,
    matchesExpected: classificationResult.matchesExpected
  };
  profileDocument.ocrResult = {
    provider: ocrResult.provider,
    rawText: ocrResult.rawText,
    fields: Object.assign({}, ocrResult.fields || {}, validationResult.extractedFields || {}, {
      rotationApplied: bestOcrAttempt.rotationApplied,
      rotationAttempts: bestOcrAttempt.rotationAttempts,
      imageMetadata: qualityResult.metadata
    }),
    confidence: ocrResult.confidence
  };
  profileDocument.validationResult = {
    declaredDataMatches: validationResult.declaredDataMatches,
    formatChecksPassed: validationResult.formatChecksPassed,
    consistencyChecksPassed: validationResult.consistencyChecksPassed,
    recommendedDecision: validationResult.recommendedDecision,
    notes: validationResult.notes
  };
  profileDocument.verificationStatus = decision.verificationStatus;
  profileDocument.rejectionReasons = decision.verificationStatus === 'REJECTED' ? decision.rejectionReasons : [];
  profileDocument.uploadStatus = 'STORED';
  await profileDocument.save();

  return {
    profileDocument,
    decision,
    qualityResult,
    classificationResult,
    ocrResult,
    validationResult
  };
};

module.exports = {
  runAutomaticDocumentVerification
};