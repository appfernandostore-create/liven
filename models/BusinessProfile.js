const mongoose = require('mongoose');

const normalizeProfileIdentifier = function (value) {
  return String(value || '').trim().replace(/[\s.-]+/g, '');
};

const normalizeIdentityDocumentNumber = function (value) {
  return normalizeProfileIdentifier(value);
};

const normalizeTaxIdentifier = function (value) {
  return normalizeProfileIdentifier(value);
};

const BUSINESS_PROFILE_TYPES = ['NATURAL', 'LEGAL'];
const BUSINESS_PROFILE_STATUSES = ['ACTIVE', 'INACTIVE'];
const VERIFICATION_STATUSES = ['PENDING', 'PROCESSING', 'APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
const BUSINESS_PROFILE_CITIES = ['Barranquilla'];

const naturalPersonSchema = new mongoose.Schema({
  fullName: { type: String, trim: true },
  documentTypeExpected: { type: String, default: 'CO_CEDULA_CIUDADANIA', trim: true },
  documentNumber: { type: String, trim: true },
  documentNumberNormalized: { type: String, trim: true },
  expeditionDate: { type: Date },
  frontDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfileDocument' },
  backDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfileDocument' }
}, { _id: false });

const legalEntitySchema = new mongoose.Schema({
  companyName: { type: String, trim: true },
  taxId: { type: String, trim: true },
  taxIdNormalized: { type: String, trim: true },
  verificationDigit: { type: String, trim: true },
  taxIdFormatted: { type: String, trim: true },
  legalRepresentative: { type: String, trim: true },
  rutDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProfileDocument' }
}, { _id: false });

const verificationSummarySchema = new mongoose.Schema({
  requiredDocumentRoles: [{ type: String, trim: true }],
  uploadedDocumentRoles: [{ type: String, trim: true }],
  missingDocumentRoles: [{ type: String, trim: true }],
  rejectionReasons: [{ type: String, trim: true }],
  lastCaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'VerificationCase' },
  lastUpdatedAt: { type: Date }
}, { _id: false });

const businessProfileSchema = new mongoose.Schema({
  ownerClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
  profileType: { type: String, enum: BUSINESS_PROFILE_TYPES, required: true },
  status: { type: String, enum: BUSINESS_PROFILE_STATUSES, default: 'ACTIVE' },
  verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'PENDING', index: true },
  businessSetupCompleted: { type: Boolean, default: false },
  canPublishEvents: { type: Boolean, default: false },
  displayName: { type: String, trim: true },
  businessName: { type: String, trim: true },
  businessUsername: { type: String, trim: true },
  businessCity: { type: String, enum: BUSINESS_PROFILE_CITIES, trim: true },
  categories: {
    type: [{ type: String, trim: true }],
    default: [],
    validate: {
      validator: function (value) {
        return Array.isArray(value) && value.length <= 2;
      },
      message: 'Solo se permiten hasta 2 categorías por perfil.'
    }
  },
  profileImageUrl: { type: String, trim: true },
  naturalPerson: naturalPersonSchema,
  legalEntity: legalEntitySchema,
  documents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProfileDocument' }],
  verificationSummary: verificationSummarySchema
}, {
  collection: 'business_profiles',
  timestamps: true
});

businessProfileSchema.pre('validate', function () {
  if (this.naturalPerson) {
    this.naturalPerson.documentNumber = String(this.naturalPerson.documentNumber || '').trim();
    this.naturalPerson.documentNumberNormalized = normalizeIdentityDocumentNumber(this.naturalPerson.documentNumber);
  }

  if (this.legalEntity) {
    const normalizedTaxId = normalizeTaxIdentifier(this.legalEntity.taxId);
    const normalizedVerificationDigit = String(this.legalEntity.verificationDigit || '').replace(/\D/g, '').slice(0, 1);

    this.legalEntity.taxId = normalizedTaxId;
    this.legalEntity.taxIdNormalized = normalizedTaxId;
    this.legalEntity.verificationDigit = normalizedVerificationDigit;
    this.legalEntity.taxIdFormatted = normalizedTaxId && normalizedVerificationDigit
      ? normalizedTaxId + '-' + normalizedVerificationDigit
      : normalizedTaxId || '';
  }

  if (!this.displayName) {
    this.displayName = String(
      this.businessName
      || (this.profileType === 'LEGAL' && this.legalEntity && this.legalEntity.companyName)
      || (this.profileType === 'NATURAL' && this.naturalPerson && this.naturalPerson.fullName)
      || ''
    ).trim();
  }

  if (Array.isArray(this.categories)) {
    this.categories = Array.from(new Set(this.categories.map(function (category) {
      return String(category || '').trim();
    }).filter(Boolean))).slice(0, 2);
  }

  if (typeof this.businessCity === 'string') {
    const normalizedCity = String(this.businessCity || '').trim();

    this.businessCity = normalizedCity ? 'Barranquilla' : undefined;
  }
});

businessProfileSchema.index({ ownerClientId: 1, createdAt: -1 }, { name: 'business_profiles_owner_created_idx' });
businessProfileSchema.index({ ownerClientId: 1, verificationStatus: 1 }, { name: 'business_profiles_owner_verification_idx' });
businessProfileSchema.index({ businessCity: 1, verificationStatus: 1 }, { name: 'business_profiles_city_verification_idx' });
businessProfileSchema.index(
  { profileType: 1, ownerClientId: 1, 'naturalPerson.documentNumberNormalized': 1 },
  { name: 'business_profiles_owner_normalized_document_idx' }
);
businessProfileSchema.index(
  { profileType: 1, ownerClientId: 1, 'legalEntity.taxIdNormalized': 1 },
  { name: 'business_profiles_owner_normalized_tax_id_idx' }
);

module.exports = {
  BusinessProfile: mongoose.model('BusinessProfile', businessProfileSchema),
  BUSINESS_PROFILE_TYPES,
  BUSINESS_PROFILE_STATUSES,
  VERIFICATION_STATUSES,
  BUSINESS_PROFILE_CITIES,
  normalizeProfileIdentifier,
  normalizeIdentityDocumentNumber,
  normalizeTaxIdentifier
};