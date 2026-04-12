const path = require('path');

const normalizeText = function (value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
};

const normalizeDigits = function (value) {
  return String(value || '').replace(/\D/g, '');
};

const getDocumentExtension = function (filePath) {
  return path.extname(String(filePath || '')).toLowerCase();
};

const isPdfFile = function (filePath, mimeType) {
  return String(mimeType || '').toLowerCase() === 'application/pdf' || getDocumentExtension(filePath) === '.pdf';
};

const tokenizeText = function (value) {
  return normalizeText(value).split(' ').filter(Boolean);
};

const getTokenOverlapScore = function (a, b) {
  const leftTokens = new Set(tokenizeText(a));
  const rightTokens = new Set(tokenizeText(b));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let matches = 0;
  leftTokens.forEach(function (token) {
    if (rightTokens.has(token)) {
      matches += 1;
    }
  });

  return matches / Math.max(leftTokens.size, rightTokens.size);
};

const includesNormalized = function (haystack, needle) {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(needle);

  if (!normalizedHaystack || !normalizedNeedle) {
    return false;
  }

  return normalizedHaystack.includes(normalizedNeedle);
};

module.exports = {
  normalizeText,
  normalizeDigits,
  getDocumentExtension,
  isPdfFile,
  tokenizeText,
  getTokenOverlapScore,
  includesNormalized
};