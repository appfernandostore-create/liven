const mongoose = require('mongoose');

const IDENTIFIER_OWNERSHIP_TYPES = ['NATURAL_DOCUMENT', 'LEGAL_TAX_ID'];

const identityDocumentOwnershipSchema = new mongoose.Schema({
  identifierType: { type: String, enum: IDENTIFIER_OWNERSHIP_TYPES, default: 'NATURAL_DOCUMENT', required: true },
  normalizedValue: { type: String, required: true, trim: true },
  normalizedDocumentNumber: { type: String, trim: true },
  ownerClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true }
}, {
  collection: 'identity_document_ownerships',
  timestamps: true
});

identityDocumentOwnershipSchema.pre('validate', function () {
  const normalizedValue = String(this.normalizedValue || this.normalizedDocumentNumber || '').trim();

  this.normalizedValue = normalizedValue;

  if (this.identifierType === 'NATURAL_DOCUMENT') {
    this.normalizedDocumentNumber = normalizedValue;
  }
});

identityDocumentOwnershipSchema.index(
  { identifierType: 1, normalizedValue: 1 },
  { unique: true, name: 'identity_document_ownerships_identifier_unique_idx' }
);

identityDocumentOwnershipSchema.index(
  { ownerClientId: 1, createdAt: -1 },
  { name: 'identity_document_ownerships_owner_created_idx' }
);

module.exports = {
  IdentityDocumentOwnership: mongoose.model('IdentityDocumentOwnership', identityDocumentOwnershipSchema),
  IDENTIFIER_OWNERSHIP_TYPES
};