const { normalizeDigits, normalizeText, getTokenOverlapScore, includesNormalized } = require('./shared');

const extractCedulaFields = function (rawText) {
  const digitMatches = String(rawText || '').match(/\b\d{6,12}\b/g) || [];

  return {
    documentNumberCandidates: Array.from(new Set(digitMatches)).slice(0, 5)
  };
};

const extractRutFields = function (rawText) {
  const digitMatches = String(rawText || '').match(/\b\d{8,12}\b/g) || [];
  const dvMatch = String(rawText || '').match(/(?:DV|D\.V\.?)[^\d]{0,5}(\d)/i);

  return {
    taxIdCandidates: Array.from(new Set(digitMatches)).slice(0, 5),
    verificationDigitCandidate: dvMatch ? dvMatch[1] : ''
  };
};

const getDeclaredTokenCoverage = function (declaredValue, rawText) {
  const declaredTokens = normalizeText(declaredValue).split(' ').filter(Boolean);
  const normalizedRawText = normalizeText(rawText);

  if (!declaredTokens.length || !normalizedRawText) {
    return 0;
  }

  const matchedTokens = declaredTokens.filter(function (token) {
    return normalizedRawText.includes(token);
  });

  return matchedTokens.length / declaredTokens.length;
};

const validateNaturalProfile = function (businessProfile, rawText) {
  const normalizedRawText = normalizeText(rawText);
  const naturalPerson = businessProfile.naturalPerson || {};
  const extractedFields = extractCedulaFields(rawText);
  const declaredName = String(naturalPerson.fullName || '').trim();
  const declaredDocumentNumber = normalizeDigits(naturalPerson.documentNumber || '');
  const nameScore = declaredName ? getTokenOverlapScore(declaredName, normalizedRawText) : 0;
  const documentNumberMatch = declaredDocumentNumber && extractedFields.documentNumberCandidates.some(function (candidate) {
    return candidate === declaredDocumentNumber || candidate.endsWith(declaredDocumentNumber) || declaredDocumentNumber.endsWith(candidate);
  });

  const confidence = Math.round((nameScore * 45) + (documentNumberMatch ? 55 : 0));
  const matches = Boolean(documentNumberMatch || nameScore >= 0.55 || includesNormalized(normalizedRawText, declaredName));

  return {
    declaredDataMatches: matches,
    formatChecksPassed: extractedFields.documentNumberCandidates.length > 0,
    consistencyChecksPassed: Boolean(documentNumberMatch || nameScore >= 0.55),
    recommendedDecision: matches && confidence >= 75 ? 'APPROVE' : confidence >= 48 ? 'REVIEW' : 'REJECT',
    notes: [
      'Coincidencia nombre: ' + Number(nameScore.toFixed(2)),
      'Coincidencia documento: ' + (documentNumberMatch ? 'si' : 'no')
    ].join(' | '),
    confidence,
    extractedFields
  };
};

const validateLegalProfile = function (businessProfile, rawText) {
  const normalizedRawText = normalizeText(rawText);
  const legalEntity = businessProfile.legalEntity || {};
  const extractedFields = extractRutFields(rawText);
  const declaredCompanyName = String(legalEntity.companyName || '').trim();
  const declaredTaxId = normalizeDigits(legalEntity.taxId || '');
  const declaredDv = normalizeDigits(legalEntity.verificationDigit || '').slice(0, 1);
  const companyNameScore = declaredCompanyName
    ? Math.max(getTokenOverlapScore(declaredCompanyName, normalizedRawText), getDeclaredTokenCoverage(declaredCompanyName, rawText))
    : 0;
  const taxIdMatch = declaredTaxId && extractedFields.taxIdCandidates.some(function (candidate) {
    return candidate === declaredTaxId || candidate.endsWith(declaredTaxId) || declaredTaxId.endsWith(candidate);
  });
  const dvMatch = declaredDv ? extractedFields.verificationDigitCandidate === declaredDv : false;

  const confidence = Math.round((companyNameScore * 30) + (taxIdMatch ? 50 : 0) + (dvMatch ? 20 : 0));
  const matches = Boolean(taxIdMatch && (dvMatch || companyNameScore >= 0.45));

  return {
    declaredDataMatches: matches,
    formatChecksPassed: extractedFields.taxIdCandidates.length > 0,
    consistencyChecksPassed: Boolean(taxIdMatch && (dvMatch || companyNameScore >= 0.45)),
    recommendedDecision: matches && confidence >= 78 ? 'APPROVE' : confidence >= 52 ? 'REVIEW' : 'REJECT',
    notes: [
      'Coincidencia razón social: ' + Number(companyNameScore.toFixed(2)),
      'Coincidencia NIT: ' + (taxIdMatch ? 'si' : 'no'),
      'Coincidencia DV: ' + (dvMatch ? 'si' : 'no')
    ].join(' | '),
    confidence,
    extractedFields
  };
};

const validateConsistency = function (businessProfile, rawText) {
  if (businessProfile.profileType === 'LEGAL') {
    return validateLegalProfile(businessProfile, rawText);
  }

  return validateNaturalProfile(businessProfile, rawText);
};

module.exports = {
  validateConsistency
};