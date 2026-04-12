const mongoose = require('mongoose');

const VERIFICATION_CASE_STATES = ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW'];

const verificationCaseSchema = new mongoose.Schema({
  businessProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessProfile', required: true, unique: true },
  ownerClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  profileType: { type: String, enum: ['NATURAL', 'LEGAL'], required: true },
  requiredDocuments: [{ type: String, trim: true }],
  processedDocuments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProfileDocument' }],
  state: { type: String, enum: VERIFICATION_CASE_STATES, default: 'PENDING', index: true },
  decisionReasons: [{ type: String, trim: true }],
  summary: { type: String, trim: true },
  completedAt: { type: Date, default: null }
}, {
  collection: 'verification_cases',
  timestamps: true
});

verificationCaseSchema.index({ ownerClientId: 1, createdAt: -1 }, { name: 'verification_cases_owner_created_idx' });

module.exports = {
  VerificationCase: mongoose.model('VerificationCase', verificationCaseSchema),
  VERIFICATION_CASE_STATES
};