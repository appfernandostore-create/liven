const mongoose = require('mongoose');

const DOCUMENT_ROLES = ['CEDULA_FRONT', 'CEDULA_BACK', 'RUT'];
const DOCUMENT_UPLOAD_STATUSES = ['UPLOADED', 'STORED', 'FAILED'];
const DOCUMENT_VERIFICATION_STATUSES = ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW'];

const qualityAssessmentSchema = new mongoose.Schema({
  isBlurry: { type: Boolean, default: false },
  isCropped: { type: Boolean, default: false },
  isTooDark: { type: Boolean, default: false },
  isTooBright: { type: Boolean, default: false },
  isLegible: { type: Boolean, default: true },
  score: { type: Number, default: null },
  notes: { type: String, trim: true }
}, { _id: false });

const classificationAssessmentSchema = new mongoose.Schema({
  expectedType: { type: String, trim: true },
  detectedType: { type: String, trim: true },
  countryDetected: { type: String, trim: true },
  confidence: { type: Number, default: null },
  matchesExpected: { type: Boolean, default: null }
}, { _id: false });

const ocrResultSchema = new mongoose.Schema({
  provider: { type: String, trim: true },
  rawText: { type: String, trim: true },
  fields: { type: mongoose.Schema.Types.Mixed, default: null },
  confidence: { type: Number, default: null }
}, { _id: false });

const validationResultSchema = new mongoose.Schema({
  declaredDataMatches: { type: Boolean, default: null },
  formatChecksPassed: { type: Boolean, default: null },
  consistencyChecksPassed: { type: Boolean, default: null },
  recommendedDecision: { type: String, enum: ['APPROVE', 'REJECT', 'REVIEW'], default: null },
  notes: { type: String, trim: true }
}, { _id: false });

const profileDocumentSchema = new mongoose.Schema({
  businessProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessProfile', required: true, index: true },
  ownerClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  documentRole: { type: String, enum: DOCUMENT_ROLES, required: true },
  storageKey: { type: String, required: true, trim: true },
  publicUrl: { type: String, trim: true },
  originalFileName: { type: String, required: true, trim: true },
  mimeType: { type: String, required: true, trim: true },
  sizeBytes: { type: Number, required: true },
  checksum: { type: String, required: true, trim: true },
  uploadStatus: { type: String, enum: DOCUMENT_UPLOAD_STATUSES, default: 'STORED' },
  verificationStatus: { type: String, enum: DOCUMENT_VERIFICATION_STATUSES, default: 'PENDING', index: true },
  qualityAssessment: { type: qualityAssessmentSchema, default: () => ({}) },
  classificationAssessment: { type: classificationAssessmentSchema, default: () => ({}) },
  ocrResult: { type: ocrResultSchema, default: () => ({}) },
  validationResult: { type: validationResultSchema, default: () => ({}) },
  rejectionReasons: [{ type: String, trim: true }],
  replacedByDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfileDocument' },
  activeVersion: { type: Boolean, default: true }
}, {
  collection: 'profile_documents',
  timestamps: true
});

profileDocumentSchema.index({ businessProfileId: 1, documentRole: 1, activeVersion: 1 }, { name: 'profile_documents_profile_role_active_idx' });

module.exports = {
  ProfileDocument: mongoose.model('ProfileDocument', profileDocumentSchema),
  DOCUMENT_ROLES,
  DOCUMENT_UPLOAD_STATUSES,
  DOCUMENT_VERIFICATION_STATUSES
};