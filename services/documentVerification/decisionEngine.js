const mapDecisionToStatus = function (decision) {
  if (decision === 'APPROVE') {
    return 'APPROVED';
  }

  if (decision === 'REVIEW') {
    return 'MANUAL_REVIEW';
  }

  return 'REJECTED';
};

const decideVerificationOutcome = function (pipelineState) {
  const qualityAssessment = pipelineState.qualityAssessment;
  const classificationAssessment = pipelineState.classificationAssessment;
  const ocrResult = pipelineState.ocrResult;
  const validationResult = pipelineState.validationResult;
  const reasons = [];

  if (pipelineState.hardRejectReasons.length) {
    return {
      verificationStatus: 'REJECTED',
      rejectionReasons: pipelineState.hardRejectReasons,
      decisionReasons: pipelineState.hardRejectReasons,
      summary: 'El documento fue rechazado automáticamente por calidad o clasificación.',
      decisionScore: 0
    };
  }

  if (!classificationAssessment.matchesExpected) {
    reasons.push('El documento no parece coincidir con el tipo colombiano esperado.');
  }

  if (!qualityAssessment.isLegible) {
    reasons.push('La imagen no fue suficientemente legible para validar el documento.');
  }

  if (!ocrResult.rawText || ocrResult.rawText.length < 20 || Number(ocrResult.confidence || 0) < 35) {
    reasons.push('El OCR no recuperó suficiente información confiable.');
  }

  if (validationResult.recommendedDecision === 'REJECT') {
    reasons.push('Los datos extraídos no coinciden razonablemente con el perfil declarado.');
  }

  if (reasons.length) {
    return {
      verificationStatus: 'REJECTED',
      rejectionReasons: reasons,
      decisionReasons: reasons,
      summary: 'El documento fue rechazado automáticamente por inconsistencias o falta de legibilidad.',
      decisionScore: Math.max(0, Math.round(((qualityAssessment.score || 0) + (classificationAssessment.confidence || 0) + (ocrResult.confidence || 0) + (validationResult.confidence || 0)) / 4) - 25)
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
      summary: 'Documento aprobado automáticamente por validación documental.',
      decisionScore: aggregateScore
    };
  }

  return {
    verificationStatus: mapDecisionToStatus(validationResult.recommendedDecision),
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