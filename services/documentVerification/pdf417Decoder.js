const sharp = require('sharp');
const {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  PDF417Reader,
  RGBLuminanceSource
} = require('@zxing/library');

const PDF417_ROTATIONS = [0, 90, 180, 270];

const buildDecodeHints = function () {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
};

const extractBarcodeCandidates = async function (baseImageBuffer) {
  const metadata = await sharp(baseImageBuffer).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);

  if (!width || !height) {
    return [];
  }

  const candidates = [
    { label: 'full', buffer: baseImageBuffer },
    {
      label: 'left-55',
      buffer: await sharp(baseImageBuffer).extract({ left: 0, top: 0, width: Math.max(1, Math.round(width * 0.55)), height }).toBuffer()
    },
    {
      label: 'left-70',
      buffer: await sharp(baseImageBuffer).extract({ left: 0, top: 0, width: Math.max(1, Math.round(width * 0.7)), height }).toBuffer()
    },
    {
      label: 'center-80',
      buffer: await sharp(baseImageBuffer).extract({
        left: Math.max(0, Math.round(width * 0.1)),
        top: 0,
        width: Math.max(1, Math.round(width * 0.8)),
        height
      }).toBuffer()
    }
  ];

  return candidates;
};

const decodePdf417FromBuffer = async function (imageBuffer) {
  const raster = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const source = new RGBLuminanceSource(
    Uint8ClampedArray.from(raster.data),
    raster.info.width,
    raster.info.height
  );
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new PDF417Reader();
  const result = reader.decode(bitmap, buildDecodeHints());

  return {
    rawText: String(result.getText ? result.getText() : result.text || '').trim(),
    format: result.getBarcodeFormat && result.getBarcodeFormat(),
    metadata: result.getResultMetadata ? result.getResultMetadata() : null,
    points: result.getResultPoints ? result.getResultPoints() : null,
    width: raster.info.width,
    height: raster.info.height
  };
};

const normalizePdf417Text = function (rawText) {
  return String(rawText || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const extractPdf417Fields = function (rawText) {
  const normalizedText = normalizePdf417Text(rawText);
  const digitCandidates = normalizedText.match(/\d{6,14}/g) || [];
  const uppercaseGroups = normalizedText.match(/[A-ZÁÉÍÓÚÑ]{3,}(?:\s+[A-ZÁÉÍÓÚÑ]{3,}){0,4}/g) || [];

  return {
    documentNumberCandidates: Array.from(new Set(digitCandidates)).slice(0, 8),
    nameCandidates: Array.from(new Set(uppercaseGroups)).slice(0, 6)
  };
};

const decodePdf417 = async function (documentPath) {
  const normalizedBaseImage = await sharp(documentPath, { failOn: 'none' })
    .rotate()
    .greyscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
  const imageCandidates = await extractBarcodeCandidates(normalizedBaseImage);
  const attempts = [];

  for (const imageCandidate of imageCandidates) {
    for (const rotation of PDF417_ROTATIONS) {
      try {
        const rotatedBuffer = rotation
          ? await sharp(imageCandidate.buffer).rotate(rotation).toBuffer()
          : imageCandidate.buffer;
        const decoded = await decodePdf417FromBuffer(rotatedBuffer);
        const normalizedText = normalizePdf417Text(decoded.rawText);
        const extractedFields = extractPdf417Fields(normalizedText);

        return {
          success: true,
          rawText: normalizedText,
          extractedFields,
          attempt: {
            crop: imageCandidate.label,
            rotation,
            width: decoded.width,
            height: decoded.height
          },
          attempts: attempts.slice()
        };
      } catch (error) {
        attempts.push({
          crop: imageCandidate.label,
          rotation,
          error: error && error.message ? error.message : String(error || 'Decode failed')
        });
      }
    }
  }

  return {
    success: false,
    rawText: '',
    extractedFields: {
      documentNumberCandidates: [],
      nameCandidates: []
    },
    attempt: null,
    attempts
  };
};

module.exports = {
  decodePdf417,
  normalizePdf417Text,
  extractPdf417Fields
};