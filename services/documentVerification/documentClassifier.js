const { normalizeText, normalizeDigits } = require('./shared');

const KEYWORDS = {
  CEDULA_FRONT: [
    'REPUBLICA DE COLOMBIA',
    'IDENTIFICACION PERSONAL',
    'CEDULA DE CIUDADANIA',
    'APELLIDOS',
    'NOMBRES',
    'NUMERO'
  ],
  CEDULA_BACK: [
    'REPUBLICA DE COLOMBIA',
    'FECHA DE NACIMIENTO',
    'LUGAR DE NACIMIENTO',
    'ESTATURA',
    'FECHA Y LUGAR DE EXPEDICION',
    'SEXO'
  ],
  RUT: [
    'REGISTRO UNICO TRIBUTARIO',
    'RUT',
    'DIAN',
    'DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES',
    'NUMERO DE IDENTIFICACION TRIBUTARIA',
    'NIT',
    'DV'
  ]
};

const detectDocumentType = function (documentRole, rawText) {
  const normalizedText = normalizeText(rawText);
  const compactDigits = normalizeDigits(rawText);
  const expectedKeywords = KEYWORDS[documentRole] || [];
  let matchedKeywords = 0;

  expectedKeywords.forEach(function (keyword) {
    if (normalizedText.includes(keyword)) {
      matchedKeywords += 1;
    }
  });

  const keywordConfidence = expectedKeywords.length ? matchedKeywords / expectedKeywords.length : 0;
  let detectedType = 'UNKNOWN_DOCUMENT';
  let countryDetected = 'UNKNOWN';
  let confidence = keywordConfidence * 100;

  if (/REPUBLICA DE COLOMBIA|COLOMBIA|DIAN/.test(normalizedText)) {
    countryDetected = 'CO';
    confidence += 8;
  }

  if (documentRole === 'RUT' && /RUT|DIAN|TRIBUTARIO|NIT/.test(normalizedText)) {
    detectedType = 'CO_RUT';
    confidence += compactDigits.length >= 9 ? 12 : 0;
  }

  if ((documentRole === 'CEDULA_FRONT' || documentRole === 'CEDULA_BACK') && /CEDULA|CIUDADANIA|IDENTIFICACION PERSONAL|APELLIDOS|NOMBRES|LUGAR DE NACIMIENTO/.test(normalizedText)) {
    detectedType = 'CO_CEDULA_CIUDADANIA';
    confidence += compactDigits.length >= 6 ? 10 : 0;
  }

  return {
    detectedType,
    countryDetected,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    matchesExpected: (documentRole === 'RUT' && detectedType === 'CO_RUT') || ((documentRole === 'CEDULA_FRONT' || documentRole === 'CEDULA_BACK') && detectedType === 'CO_CEDULA_CIUDADANIA'),
    matchedKeywords,
    totalKeywords: expectedKeywords.length
  };
};

module.exports = {
  detectDocumentType
};