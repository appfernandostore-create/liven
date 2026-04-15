const decideVerificationOutcome = function (pipelineState) {
  const qualityAssessment = pipelineState.qualityAssessment;
  const classificationAssessment = pipelineState.classificationAssessment;
  const ocrResult = pipelineState.ocrResult;
  const validationResult = pipelineState.validationResult;
  const reasons = [];
  const hasLowConfidenceOcr = !ocrResult.rawText || ocrResult.rawText.length < 20 || Number(ocrResult.confidence || 0) < 35;
  const hasClassificationMismatch = !classificationAssessment.matchesExpected;
  const hasStrongNonDocumentSignal = hasClassificationMismatch
    && qualityAssessment.isLegible
    && Number(ocrResult.confidence || 0) >= 60
    && String(ocrResult.rawText || '').trim().length >= 8
    && validationResult.declaredDataMatches === false
    && validationResult.formatChecksPassed === false
    && validationResult.consistencyChecksPassed === false;
  const hasStrongConsistencyReject = validationResult.recommendedDecision === 'REJECT'
    && classificationAssessment.matchesExpected
    && !hasLowConfidenceOcr
    && Number(ocrResult.confidence || 0) >= 55;

  if (pipelineState.hardRejectReasons.length) {
    return {
      verificationStatus: 'REJECTED',
      rejectionReasons: pipelineState.hardRejectReasons,
      decisionReasons: pipelineState.hardRejectReasons,
      summary: 'El documento fue rechazado automáticamente por calidad o clasificación.',
      decisionScore: 0
    };
  }

  if (hasStrongConsistencyReject) {
    return {
      verificationStatus: 'REJECTED',
      rejectionReasons: ['Los datos extraídos del documento contradicen el perfil declarado con suficiente confianza.'],
      decisionReasons: ['Los datos extraídos del documento contradicen el perfil declarado con suficiente confianza.'],
      summary: 'El documento fue rechazado automáticamente por contradicción fuerte con la información declarada.',
      decisionScore: Math.max(0, Math.round(((qualityAssessment.score || 0) + (classificationAssessment.confidence || 0) + (ocrResult.confidence || 0) + (validationResult.confidence || 0)) / 4) - 10)
    };
  }

  if (hasStrongNonDocumentSignal) {
    return {
      verificationStatus: 'REJECTED',
      rejectionReasons: ['La imagen cargada no parece corresponder al documento requerido.'],
      decisionReasons: [
        'La imagen es legible, pero no coincide con el tipo documental esperado.',
        'El OCR extrajo texto suficiente y aun asi no aparecieron campos ni coincidencias basicas del documento declarado.'
      ],
      summary: 'El documento fue rechazado automaticamente porque la imagen no parece corresponder al soporte requerido.',
      decisionScore: Math.max(0, Math.round(((qualityAssessment.score || 0) + (ocrResult.confidence || 0)) / 2) - 20)
    };
  }

  if (hasClassificationMismatch) {
    reasons.push('No fue posible confirmar automáticamente que el documento coincide con el tipo esperado.');
  }

  if (!qualityAssessment.isLegible) {
    reasons.push('La imagen no fue suficientemente legible para validación automática completa.');
  }

  if (hasLowConfidenceOcr) {
    reasons.push('El OCR no recuperó suficiente información confiable.');
  }

  if (validationResult.recommendedDecision === 'REVIEW') {
    reasons.push('La coincidencia de datos requiere una revisión manual adicional.');
  }

  if (reasons.length) {
    return {
      verificationStatus: 'MANUAL_REVIEW',
      rejectionReasons: [],
      decisionReasons: reasons,
      summary: 'El documento requiere revisión manual por confianza insuficiente o señales ambiguas.',
      decisionScore: Math.max(0, Math.round(((qualityAssessment.score || 0) + (classificationAssessment.confidence || 0) + (ocrResult.confidence || 0) + (validationResult.confidence || 0)) / 4) - 15)
    };
  }

  const aggregateScore = Math.round(((qualityAssessment.score || 0) * 0.25)
    + ((classificationAssessment.confidence || 0) * 0.25)
    + ((ocrResult.confidence || 0) * 0.2)
    + ((validationResult.confidence || 0) * 0.3));

  if (aggregateScore >= 78 && validationResult.recommendedDecision === 'APPROVE') {
    return {
      verificationStatus: 'APPROVED',
      rejectionReasons: [],
      decisionReasons: ['El documento pasó validación automática de calidad, clasificación, OCR y consistencia.'],
      summary: 'Documento activado automáticamente por validación documental.',
      decisionScore: aggregateScore
    };
  }

  return {
    verificationStatus: 'MANUAL_REVIEW',
    rejectionReasons: [],
    decisionReasons: [
      'El documento parece válido, pero la confianza total no alcanzó el umbral de aprobación automática.',
      'Score agregado: ' + aggregateScore
    ],
    summary: 'Documento enviado automáticamente a revisión manual por confianza intermedia.',
    decisionScore: aggregateScore
  };
};

module.exports = {
  decideVerificationOutcome
};