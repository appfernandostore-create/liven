const fs = require('fs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const { isPdfFile } = require('./shared');

const extractPdfText = async function (documentPath) {
  const pdfBuffer = fs.readFileSync(documentPath);
  const parsedPdf = await pdfParse(pdfBuffer);

  return {
    provider: 'pdf-parse',
    rawText: String(parsedPdf.text || '').trim(),
    confidence: parsedPdf.text && parsedPdf.text.trim() ? 88 : 20,
    fields: {
      pageCount: parsedPdf.numpages || null,
      info: parsedPdf.info || null
    }
  };
};

const extractImageText = async function (documentPath, preprocessedImageBuffer) {
  const worker = await Tesseract.createWorker('spa+eng');

  try {
    const ocrResult = await worker.recognize(preprocessedImageBuffer || documentPath);

    return {
      provider: 'tesseract.js',
      rawText: String(ocrResult.data && ocrResult.data.text ? ocrResult.data.text : '').trim(),
      confidence: Number(ocrResult.data && typeof ocrResult.data.confidence === 'number' ? ocrResult.data.confidence : 0),
      fields: {
        lines: Array.isArray(ocrResult.data && ocrResult.data.lines)
          ? ocrResult.data.lines.slice(0, 20).map(function (line) {
              return String(line.text || '').trim();
            }).filter(Boolean)
          : []
      }
    };
  } finally {
    await worker.terminate();
  }
};

const runOcr = async function (documentPath, mimeType, preprocessedImageBuffer) {
  if (isPdfFile(documentPath, mimeType)) {
    return extractPdfText(documentPath);
  }

  return extractImageText(documentPath, preprocessedImageBuffer);
};

module.exports = {
  runOcr
};