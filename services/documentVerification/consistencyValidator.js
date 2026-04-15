const { normalizeDigits, normalizeText, getTokenOverlapScore, includesNormalized } = require('./shared');

const extractNormalizedDigitCandidates = function (rawText, minimumLength, maximumLength) {
  const rawMatches = String(rawText || '').match(/(?:\d[\d\s.:-]{4,18}\d|\b\d{6,14}\b)/g) || [];

  return Array.from(new Set(rawMatches.map(function (match) {
    return normalizeDigits(match);
  }).filter(function (candidate) {
    return candidate.length >= minimumLength && candidate.length <= maximumLength;
  }))).slice(0, 8);
};

const extractCedulaFields = function (rawText) {
  return {
    documentNumberCandidates: extractNormalizedDigitCandidates(rawText, 6, 12)
  };
};

const extractRutFields = function (rawText) {
  const dvMatch = String(rawText || '').match(/(?:DV|D\.V\.?)[^\d]{0,5}(\d)/i);

  return {
    taxIdCandidates: extractNormalizedDigitCandidates(rawText, 8, 12),
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

const getNormalizedYear = function (value) {
  if (!value) {
    return '';
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  return String(parsedDate.getUTCFullYear());
};

const getDigitDistance = function (leftValue, rightValue) {
  const left = normalizeDigits(leftValue);
  const right = normalizeDigits(rightValue);

  if (!left || !right || left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      distance += 1;
    }
  }

  return distance;
};

const hasContradictoryCandidates = function (candidates, normalizedDeclaredValue) {
  if (!normalizedDeclaredValue || !Array.isArray(candidates) || !candidates.length) {
    return false;
  }

  return !candidates.some(function (candidate) {
    return candidate === normalizedDeclaredValue
      || candidate.endsWith(normalizedDeclaredValue)
      || normalizedDeclaredValue.endsWith(candidate);
  });
};

const validateNaturalFrontProfile = function (businessProfile, rawText) {
  const normalizedRawText = normalizeText(rawText);
  const naturalPerson = businessProfile.naturalPerson || {};
  const extractedFields = extractCedulaFields(rawText);
  const declaredName = String(naturalPerson.fullName || '').trim();
  const declaredDocumentNumber = normalizeDigits(naturalPerson.documentNumber || '');
  const nameScore = declaredName
    ? Math.max(getTokenOverlapScore(declaredName, normalizedRawText), getDeclaredTokenCoverage(declaredName, rawText))
    : 0;
  const documentNumberMatch = declaredDocumentNumber && extractedFields.documentNumberCandidates.some(function (candidate) {
    return candidate === declaredDocumentNumber || candidate.endsWith(declaredDocumentNumber) || declaredDocumentNumber.endsWith(candidate);
  });
  const approximateDocumentNumberMatch = !documentNumberMatch && declaredDocumentNumber && extractedFields.documentNumberCandidates.some(function (candidate) {
    return getDigitDistance(candidate, declaredDocumentNumber) === 1;
  });

  const contradictoryDocumentNumber = hasContradictoryCandidates(extractedFields.documentNumberCandidates, declaredDocumentNumber);
  const confidence = Math.round((nameScore * 40) + (documentNumberMatch ? 60 : approximateDocumentNumberMatch ? 38 : 0));
  const matches = Boolean(documentNumberMatch || approximateDocumentNumberMatch || nameScore >= 0.55 || includesNormalized(normalizedRawText, declaredName));

  return {
    declaredDataMatches: matches,
    formatChecksPassed: extractedFields.documentNumberCandidates.length > 0,
    consistencyChecksPassed: Boolean(documentNumberMatch || approximateDocumentNumberMatch || nameScore >= 0.55),
    recommendedDecision: matches && confidence >= 75
      ? 'APPROVE'
      : contradictoryDocumentNumber && nameScore < 0.2
        ? 'REJECT'
        : 'REVIEW',
    notes: [
      'Coincidencia nombre: ' + Number(nameScore.toFixed(2)),
      'Coincidencia documento: ' + (documentNumberMatch ? 'exacta' : approximateDocumentNumberMatch ? 'aproximada' : 'no')
    ].join(' | '),
    confidence,
    extractedFields
  };
};

const validateNaturalBackProfile = function (businessProfile, rawText) {
  const naturalPerson = businessProfile.naturalPerson || {};
  const extractedFields = extractCedulaFields(rawText);
  const declaredDocumentNumber = normalizeDigits(naturalPerson.documentNumber || '');
  const declaredExpeditionYear = getNormalizedYear(naturalPerson.expeditionDate);
  const normalizedRawText = normalizeText(rawText);
  const yearMatches = normalizedRawText.match(/\b(?:19|20)\d{2}\b/g) || [];
  const documentNumberMatch = declaredDocumentNumber && extractedFields.documentNumberCandidates.some(function (candidate) {
    return candidate === declaredDocumentNumber || candidate.endsWith(declaredDocumentNumber) || declaredDocumentNumber.endsWith(candidate);
  });
  const expeditionYearMatch = declaredExpeditionYear && yearMatches.includes(declaredExpeditionYear);
  const contradictoryDocumentNumber = hasContradictoryCandidates(extractedFields.documentNumberCandidates, declaredDocumentNumber);
  const confidence = Math.round((documentNumberMatch ? 78 : 0) + (expeditionYearMatch ? 22 : 0));
  const matches = Boolean(documentNumberMatch || expeditionYearMatch);

  return {
    declaredDataMatches: matches,
    formatChecksPassed: extractedFields.documentNumberCandidates.length > 0 || yearMatches.length > 0,
    consistencyChecksPassed: matches,
    recommendedDecision: documentNumberMatch
      ? (confidence >= 78 ? 'APPROVE' : 'REVIEW')
      : contradictoryDocumentNumber && !expeditionYearMatch
        ? 'REJECT'
        : 'REVIEW',
    notes: [
      'Coincidencia documento: ' + (documentNumberMatch ? 'si' : 'no'),
      'Coincidencia año expedición: ' + (expeditionYearMatch ? 'si' : 'no')
    ].join(' | '),
    confidence,
    extractedFields: Object.assign({}, extractedFields, {
      yearCandidates: yearMatches.slice(0, 6)
    })
  };
};

const validateLegalProfile = function (businessProfile, rawText) {
  const normalizedRawText = normalizeText(rawText);
  const legalEntity = businessProfile.legalEntity || {};
  const extractedFields = extractRutFields(rawText);
  const declaredCompanyName = String(legalEntity.companyName || '').trim();
  const declaredTaxId = normalizeDigits(legalEntity.taxIdNormalized || legalEntity.taxId || '');
  const declaredDv = normalizeDigits(legalEntity.verificationDigit || '').slice(0, 1);
  const companyNameScore = declaredCompanyName
    ? Math.max(getTokenOverlapScore(declaredCompanyName, normalizedRawText), getDeclaredTokenCoverage(declaredCompanyName, rawText))
    : 0;
  const taxIdMatch = declaredTaxId && extractedFields.taxIdCandidates.some(function (candidate) {
    return candidate === declaredTaxId || candidate.endsWith(declaredTaxId) || declaredTaxId.endsWith(candidate);
  });
  const dvMatch = declaredDv ? extractedFields.verificationDigitCandidate === declaredDv : false;
  const contradictoryTaxId = hasContradictoryCandidates(extractedFields.taxIdCandidates, declaredTaxId);

  const confidence = Math.round((companyNameScore * 30) + (taxIdMatch ? 50 : 0) + (dvMatch ? 20 : 0));
  const matches = Boolean(taxIdMatch && (dvMatch || companyNameScore >= 0.45));

  return {
    declaredDataMatches: matches,
    formatChecksPassed: extractedFields.taxIdCandidates.length > 0,
    consistencyChecksPassed: Boolean(taxIdMatch && (dvMatch || companyNameScore >= 0.45)),
    recommendedDecision: matches && confidence >= 78
      ? 'APPROVE'
      : contradictoryTaxId && companyNameScore < 0.2
        ? 'REJECT'
        : 'REVIEW',
    notes: [
      'Coincidencia razón social: ' + Number(companyNameScore.toFixed(2)),
      'Coincidencia NIT: ' + (taxIdMatch ? 'si' : 'no'),
      'Coincidencia DV: ' + (dvMatch ? 'si' : 'no')
    ].join(' | '),
    confidence,
    extractedFields
  };
};

const validateConsistency = function (businessProfile, rawText, documentRole) {
  if (businessProfile.profileType === 'LEGAL') {
    return validateLegalProfile(businessProfile, rawText);
  }

  if (String(documentRole || '').trim().toUpperCase() === 'CEDULA_BACK') {
    return validateNaturalBackProfile(businessProfile, rawText);
  }

  return validateNaturalFrontProfile(businessProfile, rawText);
};

module.exports = {
  validateConsistency
};