const fs = require('fs');
const sharp = require('sharp');
const { isPdfFile } = require('./shared');

const MIN_WIDTH = 700;
const MIN_HEIGHT = 450;
const MIN_FILE_BYTES = 12 * 1024;
const MIN_BLUR_SIGNAL = 0.25;

const clampScore = function (value) {
  return Math.max(0, Math.min(100, Math.round(value)));
};

const computeBlurSignal = function (pixels, width, height) {
  let totalDifference = 0;
  let comparisons = 0;

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width - 1; column += 1) {
      const currentPixel = pixels[(row * width) + column];
      const nextPixel = pixels[(row * width) + column + 1];
      totalDifference += Math.abs(currentPixel - nextPixel);
      comparisons += 1;
    }
  }

  if (!comparisons) {
    return 0;
  }

  return totalDifference / comparisons;
};

const assessPdfQuality = async function (documentPath) {
  const stats = fs.statSync(documentPath);
  const isTooSmall = stats.size < MIN_FILE_BYTES;
  const score = clampScore(isTooSmall ? 30 : 82);

  return {
    metadata: {
      width: null,
      height: null,
      channels: null,
      extension: '.pdf'
    },
    assessment: {
      isBlurry: false,
      isCropped: false,
      isTooDark: false,
      isTooBright: false,
      isLegible: !isTooSmall,
      score,
      notes: isTooSmall
        ? 'El PDF es demasiado liviano o parece vacío para una validación confiable.'
        : 'PDF aceptado para OCR y validación textual.'
    },
    hardReject: isTooSmall,
    rejectionReasons: isTooSmall ? ['El archivo PDF parece vacío o demasiado pequeño.'] : [],
    preprocessedImageBuffer: null
  };
};

const assessImageQuality = async function (documentPath) {
  const pipeline = sharp(documentPath, { failOn: 'none' });
  const metadata = await pipeline.metadata();
  const normalizedImage = pipeline
    .rotate()
    .greyscale()
    .normalize()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  const stats = await normalizedImage.stats();
  const buffer = await normalizedImage.raw().toBuffer({ resolveWithObject: true });
  const blurSignal = computeBlurSignal(buffer.data, buffer.info.width, buffer.info.height);
  const brightness = stats.channels[0].mean;
  const contrastSpread = stats.channels[0].stdev;

  const isTooSmall = !metadata.width || !metadata.height || metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT;
  const isBlurry = blurSignal < MIN_BLUR_SIGNAL;
  const isTooDark = brightness < 35;
  const isTooBright = brightness > 245 && contrastSpread < 18;
  const isLowContrast = contrastSpread < 12;
  const isCropped = !!metadata.width && !!metadata.height && (metadata.width / metadata.height > 2.6 || metadata.height / metadata.width > 2.6);

  let score = 100;
  if (isTooSmall) {
    score -= 28;
  }
  if (isBlurry) {
    score -= 22;
  }
  if (isTooDark || isTooBright) {
    score -= 20;
  }
  if (isLowContrast) {
    score -= 14;
  }
  if (isCropped) {
    score -= 24;
  }

  const rejectionReasons = [];
  if (isTooSmall) {
    rejectionReasons.push('La imagen es demasiado pequeña para validar el documento.');
  }
  if (isBlurry) {
    rejectionReasons.push('La imagen se ve borrosa o con poco detalle.');
  }
  if (isTooDark) {
    rejectionReasons.push('La imagen está demasiado oscura.');
  }
  if (isTooBright) {
    rejectionReasons.push('La imagen está demasiado iluminada o quemada.');
  }
  if (isCropped) {
    rejectionReasons.push('La imagen parece recortada o con proporción anómala.');
  }

  return {
    metadata: {
      width: metadata.width || null,
      height: metadata.height || null,
      channels: metadata.channels || null,
      extension: metadata.format || null,
      blurSignal: Number(blurSignal.toFixed(2)),
      brightness: Number(brightness.toFixed(2)),
      contrastSpread: Number(contrastSpread.toFixed(2))
    },
    assessment: {
      isBlurry,
      isCropped,
      isTooDark,
      isTooBright,
      isLegible: !(isTooSmall || isCropped || (isBlurry && isLowContrast) || isTooDark || isTooBright),
      score: clampScore(score),
      notes: [
        'Blur signal: ' + Number(blurSignal.toFixed(2)),
        'Brightness: ' + Number(brightness.toFixed(2)),
        'Contrast spread: ' + Number(contrastSpread.toFixed(2))
      ].join(' | ')
    },
    hardReject: Boolean(isTooSmall || isCropped || (isBlurry && isLowContrast) || isTooDark || isTooBright),
    rejectionReasons,
    preprocessedImageBuffer: await sharp(buffer.data, {
      raw: {
        width: buffer.info.width,
        height: buffer.info.height,
        channels: buffer.info.channels
      }
    }).png().toBuffer()
  };
};

const assessDocumentQuality = async function (documentPath, mimeType) {
  if (isPdfFile(documentPath, mimeType)) {
    return assessPdfQuality(documentPath);
  }

  return assessImageQuality(documentPath);
};

module.exports = {
  assessDocumentQuality
};