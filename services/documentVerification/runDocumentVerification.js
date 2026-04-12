const path = require('path');
const { assessDocumentQuality } = require('./imageQuality');
const { runOcr } = require('./ocrProvider');
const { detectDocumentType } = require('./documentClassifier');
const { validateConsistency } = require('./consistencyValidator');
const { decideVerificationOutcome } = require('./decisionEngine');

const buildHardRejectReasons = function (qualityResult, classificationResult, ocrResult) {
  const reasons = [];

  if (qualityResult.hardReject && qualityResult.rejectionReasons.length) {
    return qualityResult.rejectionReasons.slice();
  }

  if (!classificationResult.matchesExpected) {
    reasons.push('No parece un documento colombiano del tipo esperado.');
  }

  if (!ocrResult.rawText || ocrResult.rawText.length < 20) {
    reasons.push('El documento parece vacío o ilegible para OCR.');
  }

  return reasons;
};

const resolveAbsoluteDocumentPath = function (storageKey) {
  if (/^[A-Za-z]:\\/.test(storageKey)) {
    return storageKey;
  }

  return path.join(process.cwd(), storageKey);
};

const runAutomaticDocumentVerification = async function (profileDocument, businessProfile) {
  const documentPath = resolveAbsoluteDocumentPath(profileDocument.storageKey);
  const qualityResult = await assessDocumentQuality(documentPath, profileDocument.mimeType);
  const ocrResult = await runOcr(documentPath, profileDocument.mimeType, qualityResult.preprocessedImageBuffer);
  const classificationResult = detectDocumentType(profileDocument.documentRole, ocrResult.rawText);
  const validationResult = validateConsistency(businessProfile, ocrResult.rawText);
  validationResult.confidence = validationResult.confidence || 0;
  const hardRejectReasons = buildHardRejectReasons(qualityResult, classificationResult, ocrResult);
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
    fields: Object.assign({}, ocrResult.fields || {}, validationResult.extractedFields || {}),
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