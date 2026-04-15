require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Client = require('./models/Client');
const { BusinessProfile, VERIFICATION_STATUSES, BUSINESS_PROFILE_CITIES, normalizeIdentityDocumentNumber, normalizeTaxIdentifier } = require('./models/BusinessProfile');
const { IdentityDocumentOwnership, IDENTIFIER_OWNERSHIP_TYPES } = require('./models/IdentityDocumentOwnership');
const { ProfileDocument, DOCUMENT_ROLES, DOCUMENT_VERIFICATION_STATUSES } = require('./models/ProfileDocument');
const { VerificationCase } = require('./models/VerificationCase');
const { runAutomaticDocumentVerification } = require('./services/documentVerification/runDocumentVerification');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const MONGO_CONNECT_TIMEOUT_MS = 10000;
const UPLOADS_ROOT = path.join(__dirname, 'uploads');
const PROFILE_DOCUMENT_UPLOADS_ROOT = path.join(UPLOADS_ROOT, 'profile-documents');
const MAX_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BODY_SIZE = '12mb';
const DEFAULT_CATEGORY_LIMIT = 2;
const MAX_BUSINESS_PROFILES_PER_ACCOUNT = 5;
const DEFAULT_BUSINESS_CITY = BUSINESS_PROFILE_CITIES[0] || 'Barranquilla';
const PROFILE_IDENTIFIER_TYPE_BY_PROFILE = {
  NATURAL: IDENTIFIER_OWNERSHIP_TYPES.includes('NATURAL_DOCUMENT') ? 'NATURAL_DOCUMENT' : 'NATURAL_DOCUMENT',
  LEGAL: IDENTIFIER_OWNERSHIP_TYPES.includes('LEGAL_TAX_ID') ? 'LEGAL_TAX_ID' : 'LEGAL_TAX_ID'
};
let mongoConnectionPromise = null;
let mongoInitializationPromise = null;
let defaultClientsSyncPromise = null;
let lastMongoDiagnostic = {
  timestamp: null,
  stage: 'startup',
  code: 'NOT_ATTEMPTED',
  message: 'Sin diagnostico aún.'
};

const DEFAULT_CLIENTS = [
  {
    fullName: 'Live Premium+',
    firstName: 'Live',
    lastName: 'Premium+',
    email: 'cliente@live.local',
    phone: '+57 300 000 0001',
    password: 'Cliente123!',
    role: 'CLIENTE',
    plan: 'PREMIUM_PLUS'
  },
  {
    fullName: 'Live Gratuito',
    firstName: 'Live',
    lastName: 'Gratuito',
    email: 'clienteg@live.local',
    phone: '+57 300 000 0002',
    password: 'Cliente123!',
    role: 'CLIENTE',
    plan: 'GRATUITO'
  },
  {
    fullName: 'Live Premium',
    firstName: 'Live',
    lastName: 'Premium',
    email: 'clientep@live.local',
    phone: '+57 300 000 0003',
    password: 'Cliente123!',
    role: 'CLIENTE',
    plan: 'PREMIUM'
  }
];

const ensureUploadDirectories = function () {
  fs.mkdirSync(PROFILE_DOCUMENT_UPLOADS_ROOT, { recursive: true });
};

ensureUploadDirectories();

const uploadProfileDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES },
  fileFilter: function (req, file, cb) {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

    if (!allowedMimeTypes.includes(file.mimetype)) {
      cb(new Error('Solo se permiten archivos JPG, PNG, WEBP o PDF.'));
      return;
    }

    cb(null, true);
  }
});

const serializeAuthenticatedClient = function (client) {
  if (!client) {
    return null;
  }

  return {
    id: client._id ? String(client._id) : null,
    fullName: String(client.fullName || [client.firstName, client.lastName].filter(Boolean).join(' ')).trim(),
    email: client.email,
    phone: client.phone,
    role: client.role,
    plan: client.plan
  };
};

const compareStoredPassword = async function (storedPassword, candidatePassword) {
  if (!storedPassword || !candidatePassword) {
    return false;
  }

  if (String(storedPassword).startsWith('$2')) {
    return bcrypt.compare(candidatePassword, storedPassword);
  }

  return storedPassword === candidatePassword;
};

const formatMongoUriForLogs = function (uri) {
  if (!uri) {
    return 'MONGODB_URI vacía';
  }

  return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^@]+)@/i, '$1***:***@');
};

const getMongoConnectionStateLabel = function () {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  return states[mongoose.connection.readyState] || 'unknown';
};

const setLastMongoDiagnostic = function (stage, code, message) {
  lastMongoDiagnostic = {
    timestamp: new Date().toISOString(),
    stage,
    code,
    message
  };
};

const classifyMongoError = function (error) {
  const message = String(error && error.message ? error.message : error || 'Unknown error');

  if (!MONGODB_URI) {
    return {
      code: 'MONGODB_URI_MISSING',
      message: 'La variable MONGODB_URI no está configurada.'
    };
  }

  if (/auth|authentication failed|bad auth/i.test(message)) {
    return {
      code: 'MONGO_AUTH_FAILED',
      message: 'Las credenciales del usuario Mongo son inválidas o no tienen acceso.'
    };
  }

  if (/ENOTFOUND|getaddrinfo|querySrv/i.test(message)) {
    return {
      code: 'MONGO_DNS_ERROR',
      message: 'La URI de MongoDB no resuelve correctamente el host o SRV.'
    };
  }

  if (/ECONNREFUSED|timed out|Server selection timed out|ReplicaSetNoPrimary|connection <monitor> to/i.test(message)) {
    return {
      code: 'MONGO_NETWORK_ERROR',
      message: 'MongoDB Atlas no es alcanzable desde el backend o el cluster no está respondiendo.'
    };
  }

  if (/buffering timed out/i.test(message)) {
    return {
      code: 'MONGO_NOT_READY',
      message: 'La aplicación intentó escribir antes de completar la conexión con MongoDB.'
    };
  }

  if (error && error.name === 'ValidationError') {
    return {
      code: 'MODEL_VALIDATION_ERROR',
      message: error.message || 'Los datos no pasan la validación del modelo.'
    };
  }

  if (error && error.code === 11000) {
    return {
      code: 'DUPLICATE_KEY',
      message: 'Ya existe un documento con un valor único repetido.'
    };
  }

  return {
    code: 'UNKNOWN_BACKEND_ERROR',
    message
  };
};

const connectToMongo = async function () {
  if (!MONGODB_URI) {
    console.warn('[mongo] MONGODB_URI no configurada.');
    setLastMongoDiagnostic('connect', 'MONGODB_URI_MISSING', 'La variable MONGODB_URI no está configurada.');
    return null;
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!mongoConnectionPromise) {
    console.log('[mongo] Intentando conectar a Atlas con URI:', formatMongoUriForLogs(MONGODB_URI));
    mongoConnectionPromise = mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: MONGO_CONNECT_TIMEOUT_MS
    }).then(function () {
      console.log('[mongo] Conexion establecida correctamente.');
      setLastMongoDiagnostic('connect', 'MONGO_CONNECTED', 'Conexión a MongoDB Atlas establecida correctamente.');
      return mongoose.connection;
    }).catch(function (error) {
      mongoConnectionPromise = null;
      const diagnostic = classifyMongoError(error);
      setLastMongoDiagnostic('connect', diagnostic.code, diagnostic.message);
      console.error('[mongo] Error de conexion:', error && error.message ? error.message : error);
      throw error;
    });
  }

  return mongoConnectionPromise;
};

const ensureModelReady = async function (Model) {
  const collectionName = Model.collection.collectionName;
  const existingCollections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray();

  if (!existingCollections.length) {
    await Model.createCollection();
  }

  await Model.syncIndexes();
};

const backfillNormalizedProfileIdentifiers = async function () {
  const profiles = await BusinessProfile.find({
    $or: [
      {
        profileType: 'NATURAL',
        'naturalPerson.documentNumber': { $exists: true, $ne: null }
      },
      {
        profileType: 'LEGAL',
        'legalEntity.taxId': { $exists: true, $ne: null }
      }
    ]
  }).select('_id profileType naturalPerson legalEntity');
  const operations = [];

  profiles.forEach(function (profile) {
    if (profile.profileType === 'NATURAL') {
      const normalizedDocumentNumber = normalizeIdentityDocumentNumber(profile.naturalPerson && profile.naturalPerson.documentNumber);

      if (normalizedDocumentNumber !== String(profile.naturalPerson && profile.naturalPerson.documentNumberNormalized || '')) {
        operations.push({
          updateOne: {
            filter: { _id: profile._id },
            update: {
              $set: {
                'naturalPerson.documentNumberNormalized': normalizedDocumentNumber
              }
            }
          }
        });
      }

      return;
    }

    const normalizedTaxId = normalizeTaxIdentifier(profile.legalEntity && profile.legalEntity.taxId);
    const normalizedVerificationDigit = String(profile.legalEntity && profile.legalEntity.verificationDigit || '').replace(/\D/g, '').slice(0, 1);
    const formattedTaxId = normalizedTaxId && normalizedVerificationDigit
      ? normalizedTaxId + '-' + normalizedVerificationDigit
      : normalizedTaxId || '';

    if (
      normalizedTaxId !== String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '')
      || normalizedTaxId !== String(profile.legalEntity && profile.legalEntity.taxId || '')
      || normalizedVerificationDigit !== String(profile.legalEntity && profile.legalEntity.verificationDigit || '')
      || formattedTaxId !== String(profile.legalEntity && profile.legalEntity.taxIdFormatted || '')
    ) {
      operations.push({
        updateOne: {
          filter: { _id: profile._id },
          update: {
            $set: {
              'legalEntity.taxId': normalizedTaxId,
              'legalEntity.taxIdNormalized': normalizedTaxId,
              'legalEntity.verificationDigit': normalizedVerificationDigit,
              'legalEntity.taxIdFormatted': formattedTaxId
            }
          }
        }
      });
    }
  });

  if (operations.length) {
    await BusinessProfile.bulkWrite(operations, { ordered: false });
  }
};

const backfillIdentifierOwnershipRecords = async function () {
  const ownershipRecords = await IdentityDocumentOwnership.find({}).select('_id identifierType normalizedValue normalizedDocumentNumber ownerClientId');
  const operations = [];

  ownershipRecords.forEach(function (record) {
    const normalizedValue = String(record.normalizedValue || record.normalizedDocumentNumber || '').trim();
    const identifierType = String(record.identifierType || 'NATURAL_DOCUMENT').trim().toUpperCase() || 'NATURAL_DOCUMENT';

    if (normalizedValue !== String(record.normalizedValue || '') || identifierType !== String(record.identifierType || '').trim().toUpperCase()) {
      operations.push({
        updateOne: {
          filter: { _id: record._id },
          update: {
            $set: {
              identifierType,
              normalizedValue,
              normalizedDocumentNumber: identifierType === 'NATURAL_DOCUMENT' ? normalizedValue : undefined
            }
          }
        }
      });
    }
  });

  if (operations.length) {
    await IdentityDocumentOwnership.bulkWrite(operations, { ordered: false });
  }
};

const syncDefaultClientToMongo = async function (seedClient) {
  const hashedPassword = await bcrypt.hash(seedClient.password, 10);

  return Client.findOneAndUpdate(
    { email: String(seedClient.email).toLowerCase() },
    Object.assign({}, seedClient, { password: hashedPassword }),
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
};

const ensureDefaultClientsSynced = async function () {
  if (!MONGODB_URI) {
    return [];
  }

  await connectToMongo();

  if (!defaultClientsSyncPromise) {
    defaultClientsSyncPromise = (async function () {
      const syncedClients = [];

      for (const seedClient of DEFAULT_CLIENTS) {
        const syncedClient = await syncDefaultClientToMongo(seedClient);
        syncedClients.push(syncedClient);
      }

      return syncedClients;
    })().catch(function (error) {
      defaultClientsSyncPromise = null;
      throw error;
    });
  }

  return defaultClientsSyncPromise;
};

const ensureAppCollectionsReady = async function () {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI no configurada');
  }

  await connectToMongo();

  if (!mongoInitializationPromise) {
    mongoInitializationPromise = (async function () {
      await ensureModelReady(Client);
      await ensureModelReady(BusinessProfile);
      await ensureModelReady(IdentityDocumentOwnership);
      await backfillNormalizedProfileIdentifiers();
      await backfillIdentifierOwnershipRecords();
      await BusinessProfile.syncIndexes();
      await IdentityDocumentOwnership.syncIndexes();
      await ensureModelReady(ProfileDocument);
      await ensureModelReady(VerificationCase);
      await ensureDefaultClientsSynced();
      setLastMongoDiagnostic('collection', 'APP_COLLECTIONS_READY', 'Las colecciones e índices principales quedaron listos.');
    })().catch(function (error) {
      mongoInitializationPromise = null;
      const diagnostic = classifyMongoError(error);
      setLastMongoDiagnostic('collection', diagnostic.code, diagnostic.message);
      console.error('[mongo] Error preparando colecciones:', error && error.message ? error.message : error);
      throw error;
    });
  }

  return mongoInitializationPromise;
};

const normalizeCategories = function (value) {
  let categories = [];

  if (Array.isArray(value)) {
    categories = value;
  } else if (typeof value === 'string') {
    categories = value.split(',');
  }

  return Array.from(new Set(categories.map(function (category) {
    return String(category || '').trim();
  }).filter(Boolean))).slice(0, DEFAULT_CATEGORY_LIMIT);
};

const normalizeProfileType = function (value) {
  const normalizedValue = String(value || '').trim().toUpperCase();

  if (normalizedValue === 'NATURAL' || normalizedValue === 'PERSONA_NATURAL') {
    return 'NATURAL';
  }

  if (normalizedValue === 'LEGAL' || normalizedValue === 'JURIDICA' || normalizedValue === 'PERSONA_JURIDICA') {
    return 'LEGAL';
  }

  return null;
};

const normalizeTaxId = function (value) {
  return normalizeTaxIdentifier(value);
};

const normalizeVerificationDigit = function (value) {
  return String(value || '').replace(/\D/g, '').slice(0, 1);
};

const normalizeBusinessCity = function (value) {
  if (typeof value === 'undefined' || value === null) {
    return undefined;
  }

  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return undefined;
  }

  return normalizedValue.toLowerCase() === 'barranquilla' ? DEFAULT_BUSINESS_CITY : null;
};

const formatTaxId = function (taxId, verificationDigit) {
  const normalizedTaxId = normalizeTaxId(taxId);
  const normalizedVerificationDigit = normalizeVerificationDigit(verificationDigit);

  if (!normalizedTaxId) {
    return '';
  }

  return normalizedVerificationDigit ? normalizedTaxId + '-' + normalizedVerificationDigit : normalizedTaxId;
};

const createBusinessRuleError = function (statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const countBusinessProfilesByOwner = async function (ownerClientId) {
  return BusinessProfile.countDocuments({ ownerClientId });
};

const ensureBusinessProfileCreationLimit = async function (ownerClientId) {
  const currentProfiles = await countBusinessProfilesByOwner(ownerClientId);

  if (currentProfiles >= MAX_BUSINESS_PROFILES_PER_ACCOUNT) {
    throw createBusinessRuleError(
      409,
      'BUSINESS_PROFILE_LIMIT_REACHED',
      'Tu cuenta ya alcanzó el máximo de 5 perfiles en total. No puedes crear más perfiles en esta cuenta.'
    );
  }
};

const getProfileIdentifierDetails = function (profileType, normalizedIdentifier) {
  const normalizedProfileType = String(profileType || '').trim().toUpperCase();

  if (normalizedProfileType === 'LEGAL') {
    return {
      identifierType: PROFILE_IDENTIFIER_TYPE_BY_PROFILE.LEGAL,
      profileField: 'legalEntity.taxIdNormalized',
      conflictCode: 'LEGAL_TAX_ID_ASSOCIATED_WITH_ANOTHER_ACCOUNT',
      conflictMessage: 'Este NIT ya está asociado a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.',
      normalizedValue: normalizeTaxIdentifier(normalizedIdentifier)
    };
  }

  return {
    identifierType: PROFILE_IDENTIFIER_TYPE_BY_PROFILE.NATURAL,
    profileField: 'naturalPerson.documentNumberNormalized',
    conflictCode: 'NATURAL_DOCUMENT_ASSOCIATED_WITH_ANOTHER_ACCOUNT',
    conflictMessage: 'Esta cédula ya está asociada a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.',
    normalizedValue: normalizeIdentityDocumentNumber(normalizedIdentifier)
  };
};

const findConflictingProfileIdentifier = async function (ownerClientId, profileType, normalizedIdentifier, excludedProfileId) {
  const identifierDetails = getProfileIdentifierDetails(profileType, normalizedIdentifier);

  if (!identifierDetails.normalizedValue) {
    return null;
  }

  const query = {
    profileType: String(profileType || '').trim().toUpperCase(),
    ownerClientId: { $ne: ownerClientId },
    [identifierDetails.profileField]: identifierDetails.normalizedValue
  };

  if (excludedProfileId) {
    query._id = { $ne: excludedProfileId };
  }

  return BusinessProfile.findOne(query).select('_id ownerClientId');
};

const reserveProfileIdentifierOwnership = async function (ownerClientId, profileType, normalizedIdentifier) {
  const identifierDetails = getProfileIdentifierDetails(profileType, normalizedIdentifier);

  if (!identifierDetails.normalizedValue) {
    return null;
  }

  const conflictingProfile = await findConflictingProfileIdentifier(ownerClientId, profileType, identifierDetails.normalizedValue);

  if (conflictingProfile) {
    throw createBusinessRuleError(
      409,
      identifierDetails.conflictCode,
      identifierDetails.conflictMessage
    );
  }

  try {
    return await IdentityDocumentOwnership.findOneAndUpdate(
      {
        identifierType: identifierDetails.identifierType,
        normalizedValue: identifierDetails.normalizedValue,
        ownerClientId
      },
      {
        $setOnInsert: {
          identifierType: identifierDetails.identifierType,
          normalizedValue: identifierDetails.normalizedValue,
          normalizedDocumentNumber: identifierDetails.identifierType === 'NATURAL_DOCUMENT' ? identifierDetails.normalizedValue : undefined,
          ownerClientId
        }
      },
      {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true
      }
    );
  } catch (error) {
    if (error && error.code === 11000) {
      const existingOwnership = await IdentityDocumentOwnership.findOne({
        identifierType: identifierDetails.identifierType,
        normalizedValue: identifierDetails.normalizedValue
      }).select('ownerClientId');

      if (existingOwnership && String(existingOwnership.ownerClientId) !== String(ownerClientId)) {
        throw createBusinessRuleError(
          409,
          identifierDetails.conflictCode,
          identifierDetails.conflictMessage
        );
      }

      return existingOwnership;
    }

    throw error;
  }
};

const releaseProfileIdentifierOwnershipIfUnused = async function (ownerClientId, profileType, normalizedIdentifier, excludedProfileId) {
  const identifierDetails = getProfileIdentifierDetails(profileType, normalizedIdentifier);

  if (!identifierDetails.normalizedValue) {
    return;
  }

  const query = {
    profileType: String(profileType || '').trim().toUpperCase(),
    ownerClientId,
    [identifierDetails.profileField]: identifierDetails.normalizedValue
  };

  if (excludedProfileId) {
    query._id = { $ne: excludedProfileId };
  }

  const stillUsed = await BusinessProfile.exists(query);

  if (!stillUsed) {
    await IdentityDocumentOwnership.deleteOne({
      identifierType: identifierDetails.identifierType,
      normalizedValue: identifierDetails.normalizedValue,
      ownerClientId
    });
  }
};

const getRequiredDocumentRoles = function (profileType) {
  if (profileType === 'LEGAL') {
    return ['RUT'];
  }

  return ['CEDULA_FRONT', 'CEDULA_BACK'];
};

const getExpectedDocumentType = function (documentRole) {
  if (documentRole === 'RUT') {
    return 'CO_RUT';
  }

  return 'CO_CEDULA_CIUDADANIA';
};

const getVerificationSummaryMessage = function (state, missingDocumentRoles, rejectionReasons) {
  if (state === 'APPROVED') {
    return 'El perfil cuenta con toda la documentación requerida aprobada.';
  }

  if (state === 'REJECTED') {
    return rejectionReasons.length
      ? 'Se requiere volver a cargar documentos rechazados: ' + rejectionReasons.join(', ') + '.'
      : 'La verificación fue rechazada. Se requiere volver a cargar documentos.';
  }

  if (state === 'MANUAL_REVIEW') {
    return 'La documentación requiere revisión manual.';
  }

  if (state === 'PROCESSING') {
    return 'La documentación ya está completa y quedó lista para verificación.';
  }

  if (missingDocumentRoles.length) {
    return 'Faltan documentos requeridos: ' + missingDocumentRoles.join(', ') + '.';
  }

  return 'El perfil fue creado y está pendiente de documentación.';
};

const getReusableVerificationPriority = function (status) {
  const normalizedStatus = String(status || '').trim().toUpperCase();

  if (normalizedStatus === 'APPROVED') {
    return 5;
  }

  if (normalizedStatus === 'MANUAL_REVIEW') {
    return 4;
  }

  if (normalizedStatus === 'PROCESSING') {
    return 3;
  }

  if (normalizedStatus === 'PENDING') {
    return 2;
  }

  return 1;
};

const hasApprovedDocumentsForReuse = function (profile) {
  const requiredDocumentRoles = getRequiredDocumentRoles(profile.profileType);
  const latestDocumentByRole = getProfileLatestDocumentsByRole(profile);

  return requiredDocumentRoles.every(function (documentRole) {
    const document = latestDocumentByRole[documentRole];
    const documentStatus = String(document && document.verificationStatus ? document.verificationStatus : '').trim().toUpperCase();

    return Boolean(document) && documentStatus === 'APPROVED';
  });
};

const getReusableProfileDateKey = function (value) {
  if (!value) {
    return '';
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return String(value || '').trim();
  }

  return parsedDate.toISOString().slice(0, 10);
};

const getProfileLatestDocumentsByRole = function (profile) {
  const latestDocumentByRole = {};
  const documents = Array.isArray(profile && profile.documents) ? profile.documents : [];

  documents.forEach(function (document) {
    const documentRole = String(document && document.documentRole ? document.documentRole : '').trim().toUpperCase();

    if (!documentRole || latestDocumentByRole[documentRole]) {
      return;
    }

    latestDocumentByRole[documentRole] = document;
  });

  return latestDocumentByRole;
};

const isProfileEligibleForReuse = function (profile) {
  if (!profile) {
    return false;
  }

  const normalizedVerificationStatus = String(profile.verificationStatus || '').trim().toUpperCase();
  if (normalizedVerificationStatus !== 'APPROVED') {
    return false;
  }

  if (profile.businessSetupCompleted !== true) {
    return false;
  }

  return hasApprovedDocumentsForReuse(profile);
};

const getReusableProfileBaseKey = function (profile) {
  const normalizedProfileType = String(profile && profile.profileType ? profile.profileType : '').trim().toUpperCase();

  if (normalizedProfileType === 'LEGAL') {
    const legalEntity = profile && profile.legalEntity ? profile.legalEntity : {};

    return JSON.stringify([
      'LEGAL',
      String(legalEntity.companyName || '').trim().toLowerCase(),
      normalizeTaxIdentifier(legalEntity.taxIdNormalized || legalEntity.taxId || ''),
      String(legalEntity.verificationDigit || '').trim(),
      String(legalEntity.legalRepresentative || '').trim().toLowerCase()
    ]);
  }

  const naturalPerson = profile && profile.naturalPerson ? profile.naturalPerson : {};

  return JSON.stringify([
    'NATURAL',
    String(naturalPerson.fullName || '').trim().toLowerCase(),
    String(naturalPerson.documentTypeExpected || '').trim().toUpperCase(),
    normalizeIdentityDocumentNumber(naturalPerson.documentNumberNormalized || naturalPerson.documentNumber || ''),
    getReusableProfileDateKey(naturalPerson.expeditionDate)
  ]);
};

const createReusableProfileBaseOption = function (profile, duplicateCount) {
  const normalizedProfileType = String(profile && profile.profileType ? profile.profileType : '').trim().toUpperCase();
  const latestDocumentByRole = getProfileLatestDocumentsByRole(profile);
  const requiredDocumentRoles = getRequiredDocumentRoles(normalizedProfileType);
  const sourceDocumentIds = requiredDocumentRoles.map(function (documentRole) {
    const document = latestDocumentByRole[documentRole];
    return document ? String(document.id || document._id || '') : '';
  }).filter(Boolean);

  if (normalizedProfileType === 'LEGAL') {
    const legalEntity = profile && profile.legalEntity ? profile.legalEntity : {};

    return {
      key: getReusableProfileBaseKey(profile),
      sourceProfileId: String(profile.id || profile._id || ''),
      profileType: 'LEGAL',
      title: 'Persona Jurídica',
      subtitle: legalEntity.companyName || 'Razón social no registrada',
      identifierLabel: 'NIT',
      identifierValue: legalEntity.taxId || legalEntity.taxIdNormalized || 'No registrado',
      verificationDigit: legalEntity.verificationDigit || '',
      legalRepresentative: legalEntity.legalRepresentative || '',
      duplicateCount: duplicateCount || 1,
      verificationStatus: String(profile.verificationStatus || 'PENDING').trim().toUpperCase(),
      requiredDocumentRoles,
      sourceDocumentIds,
      data: {
        companyName: legalEntity.companyName || '',
        taxId: legalEntity.taxId || legalEntity.taxIdNormalized || '',
        taxIdNormalized: legalEntity.taxIdNormalized || legalEntity.taxId || '',
        verificationDigit: legalEntity.verificationDigit || '',
        taxIdFormatted: legalEntity.taxIdFormatted || formatTaxId(legalEntity.taxId || legalEntity.taxIdNormalized || '', legalEntity.verificationDigit || ''),
        legalRepresentative: legalEntity.legalRepresentative || ''
      }
    };
  }

  const naturalPerson = profile && profile.naturalPerson ? profile.naturalPerson : {};

  return {
    key: getReusableProfileBaseKey(profile),
    sourceProfileId: String(profile.id || profile._id || ''),
    profileType: 'NATURAL',
    title: 'Persona Natural',
    subtitle: naturalPerson.fullName || 'Nombre no registrado',
    identifierLabel: 'Documento',
    identifierValue: naturalPerson.documentNumber || naturalPerson.documentNumberNormalized || 'No registrado',
    documentTypeExpected: naturalPerson.documentTypeExpected || 'CO_CEDULA_CIUDADANIA',
    duplicateCount: duplicateCount || 1,
    verificationStatus: String(profile.verificationStatus || 'PENDING').trim().toUpperCase(),
    requiredDocumentRoles,
    sourceDocumentIds,
    data: {
      fullName: naturalPerson.fullName || '',
      documentTypeExpected: naturalPerson.documentTypeExpected || 'CO_CEDULA_CIUDADANIA',
      documentNumber: naturalPerson.documentNumber || naturalPerson.documentNumberNormalized || '',
      documentNumberNormalized: naturalPerson.documentNumberNormalized || naturalPerson.documentNumber || '',
      expeditionDate: naturalPerson.expeditionDate || null
    }
  };
};

const buildReusableProfileBases = function (profiles) {
  const groupedProfiles = new Map();

  (profiles || []).forEach(function (profile) {
    if (!isProfileEligibleForReuse(profile)) {
      return;
    }

    const groupKey = getReusableProfileBaseKey(profile);
    const existingEntry = groupedProfiles.get(groupKey);

    if (!existingEntry) {
      groupedProfiles.set(groupKey, {
        sourceProfile: profile,
        duplicateCount: 1
      });
      return;
    }

    existingEntry.duplicateCount += 1;

    const currentPriority = getReusableVerificationPriority(profile.verificationStatus);
    const existingPriority = getReusableVerificationPriority(existingEntry.sourceProfile.verificationStatus);
    const profileCreatedAt = new Date(profile.createdAt || 0).getTime();
    const existingCreatedAt = new Date(existingEntry.sourceProfile.createdAt || 0).getTime();

    if (currentPriority > existingPriority || (currentPriority === existingPriority && profileCreatedAt > existingCreatedAt)) {
      existingEntry.sourceProfile = profile;
    }
  });

  return Array.from(groupedProfiles.values()).map(function (entry) {
    return createReusableProfileBaseOption(entry.sourceProfile, entry.duplicateCount);
  }).sort(function (leftOption, rightOption) {
    const leftPriority = getReusableVerificationPriority(leftOption.verificationStatus);
    const rightPriority = getReusableVerificationPriority(rightOption.verificationStatus);

    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    if (leftOption.profileType !== rightOption.profileType) {
      return leftOption.profileType === 'NATURAL' ? -1 : 1;
    }

    return String(leftOption.subtitle || '').localeCompare(String(rightOption.subtitle || ''), 'es', { sensitivity: 'base' });
  });
};

const getReusableSourceDocuments = async function (sourceProfile) {
  const requiredDocumentRoles = getRequiredDocumentRoles(sourceProfile.profileType);
  const activeDocuments = await ProfileDocument.find({
    businessProfileId: sourceProfile._id,
    activeVersion: true
  }).sort({ createdAt: -1 });
  const latestDocumentByRole = {};

  activeDocuments.forEach(function (document) {
    if (!latestDocumentByRole[document.documentRole]) {
      latestDocumentByRole[document.documentRole] = document;
    }
  });

  const reusableDocuments = requiredDocumentRoles.map(function (documentRole) {
    return latestDocumentByRole[documentRole] || null;
  });

  if (reusableDocuments.some(function (document) {
    return !document || String(document.verificationStatus || '').trim().toUpperCase() !== 'APPROVED';
  })) {
    throw createBusinessRuleError(
      409,
      'REUSABLE_PROFILE_DATA_NOT_AVAILABLE',
      'Los datos reutilizables seleccionados ya no tienen un expediente activo para crear un nuevo perfil.'
    );
  }

  return reusableDocuments;
};

const deleteBusinessProfileCascade = async function (businessProfile, ownerClientId) {
  if (!businessProfile) {
    return;
  }

  const reservedProfileIdentifier = businessProfile.profileType === 'LEGAL'
    ? normalizeTaxId(businessProfile.legalEntity && businessProfile.legalEntity.taxIdNormalized
      ? businessProfile.legalEntity.taxIdNormalized
      : businessProfile.legalEntity && businessProfile.legalEntity.taxId)
    : businessProfile.profileType === 'NATURAL'
      ? normalizeIdentityDocumentNumber(businessProfile.naturalPerson && businessProfile.naturalPerson.documentNumberNormalized
        ? businessProfile.naturalPerson.documentNumberNormalized
        : businessProfile.naturalPerson && businessProfile.naturalPerson.documentNumber)
      : '';
  const profileDocuments = await ProfileDocument.find({ businessProfileId: businessProfile._id });
  const storageKeys = await getStorageKeysSafeToDelete(profileDocuments);

  storageKeys.forEach(deleteStoredFileIfExists);

  await ProfileDocument.deleteMany({ businessProfileId: businessProfile._id });
  await VerificationCase.deleteMany({ businessProfileId: businessProfile._id });
  await BusinessProfile.deleteOne({ _id: businessProfile._id });

  if (ownerClientId && reservedProfileIdentifier) {
    await releaseProfileIdentifierOwnershipIfUnused(ownerClientId, businessProfile.profileType, reservedProfileIdentifier);
  }
};

const cloneSourceDocumentsToBusinessProfile = async function (sourceDocuments, targetProfile, ownerClientId) {
  const createdDocuments = [];

  for (const sourceDocument of sourceDocuments) {
    const clonedDocument = await ProfileDocument.create({
      businessProfileId: targetProfile._id,
      ownerClientId,
      documentRole: sourceDocument.documentRole,
      storageKey: sourceDocument.storageKey,
      publicUrl: sourceDocument.publicUrl,
      originalFileName: sourceDocument.originalFileName,
      mimeType: sourceDocument.mimeType,
      sizeBytes: sourceDocument.sizeBytes,
      checksum: sourceDocument.checksum,
      uploadStatus: sourceDocument.uploadStatus,
      verificationStatus: sourceDocument.verificationStatus,
      qualityAssessment: sourceDocument.qualityAssessment ? sourceDocument.qualityAssessment.toObject() : {},
      classificationAssessment: sourceDocument.classificationAssessment ? sourceDocument.classificationAssessment.toObject() : {},
      ocrResult: sourceDocument.ocrResult ? sourceDocument.ocrResult.toObject() : {},
      validationResult: sourceDocument.validationResult ? sourceDocument.validationResult.toObject() : {},
      rejectionReasons: Array.isArray(sourceDocument.rejectionReasons) ? sourceDocument.rejectionReasons.slice() : [],
      activeVersion: true
    });

    createdDocuments.push(clonedDocument);
  }

  return createdDocuments;
};

const getStorageKeysSafeToDelete = async function (profileDocuments) {
  const documentIds = (profileDocuments || []).map(function (document) {
    return document._id;
  });
  const storageKeys = Array.from(new Set((profileDocuments || []).map(function (document) {
    return String(document.storageKey || '').trim();
  }).filter(Boolean)));

  if (!storageKeys.length) {
    return [];
  }

  const documentsUsingStorageElsewhere = await ProfileDocument.aggregate([
    {
      $match: {
        storageKey: { $in: storageKeys },
        _id: { $nin: documentIds }
      }
    },
    {
      $group: {
        _id: '$storageKey'
      }
    }
  ]);
  const sharedStorageKeys = new Set(documentsUsingStorageElsewhere.map(function (entry) {
    return String(entry._id || '').trim();
  }).filter(Boolean));

  return storageKeys.filter(function (storageKey) {
    return !sharedStorageKeys.has(storageKey);
  });
};

const getNormalizedMissingDocumentRoles = function (profile) {
  return profile && profile.verificationSummary && Array.isArray(profile.verificationSummary.missingDocumentRoles)
    ? profile.verificationSummary.missingDocumentRoles.filter(Boolean)
    : [];
};

const hasCompletedBusinessSetup = function (profile) {
  if (!profile) {
    return false;
  }

  if (profile.businessSetupCompleted === true) {
    return true;
  }

  return Boolean(
    String(profile.businessName || '').trim()
    || String(profile.businessUsername || '').trim()
    || String(profile.profileImageUrl || '').trim()
    || String(profile.businessCity || '').trim()
    || (Array.isArray(profile.categories) && profile.categories.length)
  );
};

const getBusinessProfileFlowState = function (profile) {
  const missingDocumentRoles = getNormalizedMissingDocumentRoles(profile);
  const verificationStatus = String(profile && profile.verificationStatus ? profile.verificationStatus : 'PENDING').trim().toUpperCase();

  if (!hasCompletedBusinessSetup(profile)) {
    return 'BUSINESS_SETUP';
  }

  if (verificationStatus === 'APPROVED') {
    return 'APPROVED';
  }

  if (verificationStatus === 'REJECTED' || missingDocumentRoles.length) {
    return 'NEEDS_CORRECTION';
  }

  return 'PENDING_REVIEW';
};

const shouldShowDocumentCorrection = function (profile) {
  return getBusinessProfileFlowState(profile) === 'NEEDS_CORRECTION';
};

const getNormalizedProfileVerificationStatus = function (profile) {
  return String(profile && profile.verificationStatus ? profile.verificationStatus : 'PENDING').trim().toUpperCase();
};

const canEditPersistedRejectedProfile = function (profile) {
  return hasCompletedBusinessSetup(profile) && getNormalizedProfileVerificationStatus(profile) === 'REJECTED';
};

const canEditPersistedBusinessProfileInfo = function (profile) {
  if (!hasCompletedBusinessSetup(profile)) {
    return false;
  }

  const verificationStatus = getNormalizedProfileVerificationStatus(profile);
  return verificationStatus === 'APPROVED' || verificationStatus === 'REJECTED';
};

const canUploadProfileDocumentsForCorrection = function (profile) {
  return !hasCompletedBusinessSetup(profile) || canEditPersistedRejectedProfile(profile);
};

const buildBusinessProfileResponse = function (profile, verificationCase, documents) {
  const businessSetupCompleted = hasCompletedBusinessSetup(profile);
  const flowState = getBusinessProfileFlowState(profile);

  return {
    id: String(profile._id),
    ownerClientId: String(profile.ownerClientId),
    profileType: profile.profileType,
    status: profile.status,
    verificationStatus: profile.verificationStatus,
    businessSetupCompleted,
    flowState,
    shouldShowDocumentCorrection: shouldShowDocumentCorrection(profile),
    canPublishEvents: profile.canPublishEvents,
    displayName: profile.displayName,
    businessName: profile.businessName,
    businessUsername: profile.businessUsername,
    profileImageUrl: profile.profileImageUrl || '',
    businessCity: profile.businessCity,
    categories: profile.categories || [],
    naturalPerson: profile.naturalPerson || null,
    legalEntity: profile.legalEntity || null,
    verificationSummary: profile.verificationSummary || null,
    documents: (documents || []).map(function (document) {
      return {
        id: String(document._id),
        documentRole: document.documentRole,
        uploadStatus: document.uploadStatus,
        verificationStatus: document.verificationStatus,
        originalFileName: document.originalFileName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        checksum: document.checksum,
        publicUrl: document.publicUrl,
        rejectionReasons: document.rejectionReasons || [],
        createdAt: document.createdAt,
        updatedAt: document.updatedAt
      };
    }),
    verificationCase: verificationCase ? {
      id: String(verificationCase._id),
      state: verificationCase.state,
      requiredDocuments: verificationCase.requiredDocuments,
      decisionReasons: verificationCase.decisionReasons,
      summary: verificationCase.summary,
      completedAt: verificationCase.completedAt,
      updatedAt: verificationCase.updatedAt
    } : null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  };
};

const ALLOWED_MANUAL_REVIEW_STATUSES = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];

const normalizeManualReviewStatus = function (value) {
  const normalizedValue = String(value || '').trim().toUpperCase();

  if (!ALLOWED_MANUAL_REVIEW_STATUSES.includes(normalizedValue)) {
    return null;
  }

  return normalizedValue;
};

const resolveClientEmailFromRequest = function (req) {
  const requestBody = req.body || {};
  const requestQuery = req.query || {};
  const requestHeaders = req.headers || {};

  return String(
    requestBody.clientEmail
    || requestBody.ownerEmail
    || requestQuery.clientEmail
    || requestQuery.ownerEmail
    || requestHeaders['x-client-email']
    || ''
  ).trim().toLowerCase();
};

const resolveClientFromRequest = async function (req) {
  const clientEmail = resolveClientEmailFromRequest(req);

  if (!clientEmail) {
    const error = new Error('Debes enviar clientEmail para identificar al cliente.');
    error.statusCode = 400;
    throw error;
  }

  let client = null;

  if (MONGODB_URI) {
    await ensureAppCollectionsReady();
    client = await Client.findOne({ email: clientEmail });
  }

  if (!client) {
    const localClient = DEFAULT_CLIENTS.find(function (candidate) {
      return String(candidate.email).toLowerCase() === clientEmail;
    });

    if (localClient) {
      if (MONGODB_URI) {
        client = await syncDefaultClientToMongo(localClient);
      } else {
        client = localClient;
      }
    }

    if (client) {
      return client;
    }

    const error = new Error('No se encontró un cliente con ese correo.');
    error.statusCode = 404;
    throw error;
  }

  return client;
};

const findOwnedBusinessProfile = async function (profileId, ownerClientId) {
  const businessProfile = await BusinessProfile.findOne({
    _id: profileId,
    ownerClientId
  });

  if (!businessProfile) {
    const error = new Error('No se encontró el perfil solicitado para este cliente.');
    error.statusCode = 404;
    throw error;
  }

  return businessProfile;
};

const computeFileChecksum = function (filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
};

const persistUploadedDocumentFile = function (file) {
  ensureUploadDirectories();

  const safeExtension = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
  const uniqueName = Date.now() + '-' + crypto.randomBytes(8).toString('hex') + safeExtension;
  const absoluteFilePath = path.join(PROFILE_DOCUMENT_UPLOADS_ROOT, uniqueName);

  fs.writeFileSync(absoluteFilePath, file.buffer);

  return {
    absoluteFilePath,
    relativeStorageKey: path.relative(__dirname, absoluteFilePath).replace(/\\/g, '/'),
    publicUrl: '/uploads/' + path.relative(UPLOADS_ROOT, absoluteFilePath).replace(/\\/g, '/')
  };
};

const resolveStoredFilePath = function (storageKey) {
  if (/^[A-Za-z]:\\/.test(storageKey)) {
    return storageKey;
  }

  return path.join(__dirname, String(storageKey || ''));
};

const deleteStoredFileIfExists = function (storageKey) {
  const normalizedStorageKey = String(storageKey || '').trim();

  if (!normalizedStorageKey) {
    return;
  }

  const absolutePath = resolveStoredFilePath(normalizedStorageKey);

  try {
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    console.warn('[storage] No se pudo eliminar el archivo asociado al perfil:', absolutePath, error && error.message ? error.message : error);
  }
};

const applyAutomaticVerificationWithFallback = async function (profileDocument, businessProfile) {
  try {
    return await runAutomaticDocumentVerification(profileDocument, businessProfile);
  } catch (error) {
    console.error('[verification] Error en validacion automatica:', error && error.stack ? error.stack : error);
    profileDocument.uploadStatus = 'STORED';
    profileDocument.verificationStatus = 'MANUAL_REVIEW';
    profileDocument.rejectionReasons = [];
    profileDocument.validationResult = Object.assign({}, profileDocument.validationResult ? profileDocument.validationResult.toObject ? profileDocument.validationResult.toObject() : profileDocument.validationResult : {}, {
      declaredDataMatches: null,
      formatChecksPassed: null,
      consistencyChecksPassed: null,
      recommendedDecision: 'REVIEW',
      notes: 'La validación automática no pudo completarse. El documento quedó disponible para revisión manual de respaldo.'
    });
    await profileDocument.save();

    return {
      profileDocument,
      decision: {
        verificationStatus: 'MANUAL_REVIEW',
        decisionReasons: ['La validación automática no pudo completarse y se activó el flujo de respaldo manual.'],
        rejectionReasons: [],
        summary: 'Documento enviado a revisión manual por una falla del pipeline automático.',
        decisionScore: null
      }
    };
  }
};

const synchronizeVerificationState = async function (businessProfile) {
  const activeDocuments = await ProfileDocument.find({
    businessProfileId: businessProfile._id,
    activeVersion: true
  }).sort({ createdAt: -1 });

  const requiredDocumentRoles = getRequiredDocumentRoles(businessProfile.profileType);
  const uploadedDocumentRoles = Array.from(new Set(activeDocuments.map(function (document) {
    return document.documentRole;
  })));
  const missingDocumentRoles = requiredDocumentRoles.filter(function (documentRole) {
    return !uploadedDocumentRoles.includes(documentRole);
  });
  const rejectedDocuments = activeDocuments.filter(function (document) {
    return document.verificationStatus === 'REJECTED';
  });
  const reviewDocuments = activeDocuments.filter(function (document) {
    return document.verificationStatus === 'MANUAL_REVIEW';
  });
  const approvedDocumentRoles = Array.from(new Set(activeDocuments.filter(function (document) {
    return document.verificationStatus === 'APPROVED';
  }).map(function (document) {
    return document.documentRole;
  })));
  const allRequiredApproved = requiredDocumentRoles.every(function (documentRole) {
    return approvedDocumentRoles.includes(documentRole);
  });
  const allRequiredUploaded = !missingDocumentRoles.length;

  let nextVerificationStatus = 'PENDING';

  if (allRequiredApproved) {
    nextVerificationStatus = 'APPROVED';
  } else if (rejectedDocuments.length) {
    nextVerificationStatus = 'REJECTED';
  } else if (reviewDocuments.length) {
    nextVerificationStatus = 'MANUAL_REVIEW';
  } else if (allRequiredUploaded) {
    nextVerificationStatus = 'PROCESSING';
  }

  const decisionReasons = rejectedDocuments.flatMap(function (document) {
    return (document.rejectionReasons || []).length
      ? document.rejectionReasons
      : ['Documento ' + document.documentRole + ' rechazado.'];
  });
  const summary = getVerificationSummaryMessage(nextVerificationStatus, missingDocumentRoles, decisionReasons);

  const verificationCase = await VerificationCase.findOneAndUpdate(
    { businessProfileId: businessProfile._id },
    {
      ownerClientId: businessProfile.ownerClientId,
      profileType: businessProfile.profileType,
      requiredDocuments: requiredDocumentRoles,
      processedDocuments: activeDocuments.map(function (document) { return document._id; }),
      state: nextVerificationStatus,
      decisionReasons,
      summary,
      completedAt: nextVerificationStatus === 'APPROVED' ? new Date() : null
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      runValidators: true
    }
  );

  const updatedNaturalPerson = Object.assign({}, businessProfile.naturalPerson ? businessProfile.naturalPerson.toObject() : {});
  const updatedLegalEntity = Object.assign({}, businessProfile.legalEntity ? businessProfile.legalEntity.toObject() : {});
  const latestDocumentByRole = {};

  activeDocuments.forEach(function (document) {
    if (!latestDocumentByRole[document.documentRole]) {
      latestDocumentByRole[document.documentRole] = document;
    }
  });

  if (businessProfile.profileType === 'NATURAL') {
    updatedNaturalPerson.frontDocumentId = latestDocumentByRole.CEDULA_FRONT ? latestDocumentByRole.CEDULA_FRONT._id : undefined;
    updatedNaturalPerson.backDocumentId = latestDocumentByRole.CEDULA_BACK ? latestDocumentByRole.CEDULA_BACK._id : undefined;
  }

  if (businessProfile.profileType === 'LEGAL') {
    updatedLegalEntity.rutDocumentId = latestDocumentByRole.RUT ? latestDocumentByRole.RUT._id : undefined;
  }

  businessProfile.documents = activeDocuments.map(function (document) {
    return document._id;
  });
  businessProfile.verificationStatus = nextVerificationStatus;
  businessProfile.canPublishEvents = nextVerificationStatus === 'APPROVED';
  businessProfile.verificationSummary = {
    requiredDocumentRoles,
    uploadedDocumentRoles,
    missingDocumentRoles,
    rejectionReasons: decisionReasons,
    lastCaseId: verificationCase._id,
    lastUpdatedAt: new Date()
  };

  if (businessProfile.profileType === 'NATURAL') {
    businessProfile.naturalPerson = updatedNaturalPerson;
  }

  if (businessProfile.profileType === 'LEGAL') {
    businessProfile.legalEntity = updatedLegalEntity;
  }

  await businessProfile.save();

  return {
    profile: businessProfile,
    verificationCase,
    documents: activeDocuments
  };
};

const removeUploadedFileSilently = function (filePath) {
  if (!filePath) {
    return;
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn('[files] No se pudo eliminar archivo temporal:', filePath, error.message);
  }
};

const setProfileVerificationState = async function (businessProfile, nextStatus, options) {
  const settings = Object.assign({
    summary: '',
    decisionReasons: [],
    updatedDocumentIds: null,
    requiredDocuments: getRequiredDocumentRoles(businessProfile.profileType)
  }, options || {});

  const normalizedStatus = normalizeManualReviewStatus(nextStatus);

  if (!normalizedStatus) {
    const error = new Error('verificationStatus debe ser APPROVED, REJECTED o MANUAL_REVIEW.');
    error.statusCode = 400;
    throw error;
  }

  const caseSummary = settings.summary || getVerificationSummaryMessage(normalizedStatus, [], settings.decisionReasons);
  const verificationCase = await VerificationCase.findOneAndUpdate(
    { businessProfileId: businessProfile._id },
    {
      ownerClientId: businessProfile.ownerClientId,
      profileType: businessProfile.profileType,
      requiredDocuments: settings.requiredDocuments,
      processedDocuments: Array.isArray(settings.updatedDocumentIds) ? settings.updatedDocumentIds : businessProfile.documents,
      state: normalizedStatus,
      decisionReasons: settings.decisionReasons,
      summary: caseSummary,
      completedAt: normalizedStatus === 'APPROVED' ? new Date() : null
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      runValidators: true
    }
  );

  businessProfile.verificationStatus = normalizedStatus;
  businessProfile.canPublishEvents = normalizedStatus === 'APPROVED';
  businessProfile.verificationSummary = {
    requiredDocumentRoles: settings.requiredDocuments,
    uploadedDocumentRoles: settings.requiredDocuments,
    missingDocumentRoles: normalizedStatus === 'APPROVED' ? [] : businessProfile.verificationSummary && businessProfile.verificationSummary.missingDocumentRoles ? businessProfile.verificationSummary.missingDocumentRoles : [],
    rejectionReasons: settings.decisionReasons,
    lastCaseId: verificationCase._id,
    lastUpdatedAt: new Date()
  };
  await businessProfile.save();

  return verificationCase;
};

if (MONGODB_URI) {
  mongoose.connection.on('connected', function () {
    console.log('[mongo] Evento connected. Estado actual:', getMongoConnectionStateLabel());
  });

  mongoose.connection.on('error', function (error) {
    console.error('[mongo] Evento error:', error && error.message ? error.message : error);
  });

  mongoose.connection.on('disconnected', function () {
    console.warn('[mongo] Evento disconnected. Estado actual:', getMongoConnectionStateLabel());
  });

  connectToMongo().catch(function () {
    return null;
  });
} else {
  console.warn('MONGODB_URI no configurada. Se usaran clientes locales por defecto.');
}

app.use(express.json({ limit: MAX_JSON_BODY_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_JSON_BODY_SIZE }));
app.use('/uploads', express.static(UPLOADS_ROOT));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/debug/mongo-status', function (req, res) {
  res.json({
    hasMongoUri: Boolean(MONGODB_URI),
    mongoReadyState: mongoose.connection.readyState,
    mongoReadyStateLabel: getMongoConnectionStateLabel(),
    lastMongoDiagnostic
  });
});

app.post('/api/login', async function (req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!email || !password) {
    return res.status(400).json({ message: 'Correo y contraseña requeridos.' });
  }

  let user = null;
  try {
    if (MONGODB_URI) {
      await ensureAppCollectionsReady();
    }

    user = await Client.findOne({ email });
  } catch (error) {
    console.warn('[login] MongoDB no disponible, usando cliente local:', error.message);
  }

  if (!user) {
    const localDefaultClient = DEFAULT_CLIENTS.find(function (client) {
      return String(client.email).toLowerCase() === email;
    }) || null;

    if (localDefaultClient && MONGODB_URI && mongoose.connection.readyState === 1) {
      try {
        user = await syncDefaultClientToMongo(localDefaultClient);
      } catch (error) {
        console.warn('[login] No se pudo sincronizar cliente local en MongoDB:', error.message);
        user = localDefaultClient;
      }
    } else {
      user = localDefaultClient;
    }
  }

  const isValidPassword = await compareStoredPassword(user && user.password, password);

  if (!user || !isValidPassword) {
    return res.status(401).json({ message: 'Credenciales inválidas.' });
  }

  return res.json({
    success: true,
    redirect: '/dashboard.html',
    user: serializeAuthenticatedClient(user)
  });
});

app.post('/api/register', async function (req, res) {
  const requestId = 'register-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const fullName = String(req.body.fullName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');

  if (!fullName || !email || !phone || !password) {
    return res.status(400).json({ message: 'Nombre, correo, teléfono y contraseña son requeridos.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
  }

  if (!MONGODB_URI) {
    return res.status(503).json({ message: 'El registro no está disponible porque MongoDB no está configurado.' });
  }

  try {
    await ensureAppCollectionsReady();

    const existingClient = await Client.findOne({ email }).select('_id');
    if (existingClient) {
      return res.status(409).json({ message: 'Ya existe una cuenta registrada con ese correo.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const createdClient = await Client.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      role: 'CLIENTE',
      plan: 'GRATUITO'
    });

    setLastMongoDiagnostic('register', 'REGISTER_SUCCESS', 'El cliente fue creado correctamente en la colección clients.');

    return res.status(201).json({
      success: true,
      message: 'Cuenta creada correctamente.',
      redirect: '/dashboard.html',
      user: serializeAuthenticatedClient(createdClient)
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: 'Ya existe una cuenta registrada con ese correo.' });
    }

    if (error && error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Los datos enviados no son válidos.', diagnosticCode: 'MODEL_VALIDATION_ERROR' });
    }

    const diagnostic = classifyMongoError(error);
    setLastMongoDiagnostic('register', diagnostic.code, diagnostic.message);
    console.error('[register][' + requestId + '] Error creando cliente:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      message: 'No se pudo crear la cuenta en este momento.',
      diagnosticCode: diagnostic.code,
      diagnosticMessage: diagnostic.message
    });
  }
});

app.post('/api/business-profiles', async function (req, res) {
  let resolvedClientId = null;
  let reservedProfileIdentifier = '';
  let reservedProfileIdentifierType = '';
  let createdBusinessProfileId = null;

  try {
    const client = await resolveClientFromRequest(req);
    resolvedClientId = client && client._id ? client._id : null;
    const requestedProfileType = normalizeProfileType(req.body.profileType);
    const reuseSourceProfileId = String(req.body.reuseSourceProfileId || '').trim();
    let reusableSourceProfile = null;
    let reusableSourceDocuments = [];
    let profileType = requestedProfileType;

    if (reuseSourceProfileId) {
      reusableSourceProfile = await findOwnedBusinessProfile(reuseSourceProfileId, client._id);
      profileType = normalizeProfileType(reusableSourceProfile.profileType);

      if (String(reusableSourceProfile.verificationStatus || '').trim().toUpperCase() !== 'APPROVED' || reusableSourceProfile.businessSetupCompleted !== true) {
        return res.status(409).json({ message: 'Solo puedes reutilizar perfiles activos con documentos aprobados.' });
      }

      reusableSourceDocuments = await getReusableSourceDocuments(reusableSourceProfile);

      if (requestedProfileType && requestedProfileType !== profileType) {
        return res.status(400).json({ message: 'El tipo de perfil no coincide con los datos reutilizables seleccionados.' });
      }
    }

    if (!profileType) {
      return res.status(400).json({ message: 'profileType debe ser NATURAL o LEGAL.' });
    }

    const categories = normalizeCategories(req.body.categories || req.body.selectedCategories);
    const businessName = String(req.body.businessName || req.body.displayName || '').trim();
    const businessUsername = String(req.body.businessUsername || '').trim();
    const profileImageUrl = String(req.body.profileImageUrl || '').trim();
    const businessCity = normalizeBusinessCity(req.body.businessCity);

    if (req.body.businessCity && !businessCity) {
      return res.status(400).json({ message: 'Por ahora solo se admite la ciudad Barranquilla.' });
    }

    const naturalPerson = profileType === 'NATURAL'
      ? {
          fullName: String(reusableSourceProfile && reusableSourceProfile.naturalPerson ? reusableSourceProfile.naturalPerson.fullName : req.body.fullName || (req.body.naturalPerson && req.body.naturalPerson.fullName) || '').trim(),
          documentTypeExpected: String(reusableSourceProfile && reusableSourceProfile.naturalPerson ? reusableSourceProfile.naturalPerson.documentTypeExpected : req.body.documentTypeExpected || req.body.documentType || (req.body.naturalPerson && req.body.naturalPerson.documentTypeExpected) || 'CO_CEDULA_CIUDADANIA').trim(),
          documentNumber: String(reusableSourceProfile && reusableSourceProfile.naturalPerson ? reusableSourceProfile.naturalPerson.documentNumber : req.body.documentNumber || (req.body.naturalPerson && req.body.naturalPerson.documentNumber) || '').trim(),
          documentNumberNormalized: normalizeIdentityDocumentNumber(reusableSourceProfile && reusableSourceProfile.naturalPerson ? reusableSourceProfile.naturalPerson.documentNumberNormalized || reusableSourceProfile.naturalPerson.documentNumber : req.body.documentNumber || (req.body.naturalPerson && req.body.naturalPerson.documentNumber) || ''),
          expeditionDate: reusableSourceProfile && reusableSourceProfile.naturalPerson ? reusableSourceProfile.naturalPerson.expeditionDate || null : req.body.expeditionDate || (req.body.naturalPerson && req.body.naturalPerson.expeditionDate) || null
        }
      : undefined;
    const legalEntity = profileType === 'LEGAL'
      ? {
          companyName: String(reusableSourceProfile && reusableSourceProfile.legalEntity ? reusableSourceProfile.legalEntity.companyName : req.body.companyName || (req.body.legalEntity && req.body.legalEntity.companyName) || '').trim(),
          taxId: normalizeTaxId(reusableSourceProfile && reusableSourceProfile.legalEntity ? reusableSourceProfile.legalEntity.taxId || reusableSourceProfile.legalEntity.taxIdNormalized : req.body.taxId || (req.body.legalEntity && req.body.legalEntity.taxId) || ''),
          taxIdNormalized: normalizeTaxId(reusableSourceProfile && reusableSourceProfile.legalEntity ? reusableSourceProfile.legalEntity.taxIdNormalized || reusableSourceProfile.legalEntity.taxId : req.body.taxId || (req.body.legalEntity && req.body.legalEntity.taxId) || ''),
          verificationDigit: normalizeVerificationDigit(reusableSourceProfile && reusableSourceProfile.legalEntity ? reusableSourceProfile.legalEntity.verificationDigit : req.body.verificationDigit || (req.body.legalEntity && req.body.legalEntity.verificationDigit) || ''),
          taxIdFormatted: formatTaxId(reusableSourceProfile && reusableSourceProfile.legalEntity ? reusableSourceProfile.legalEntity.taxId || reusableSourceProfile.legalEntity.taxIdNormalized : req.body.taxId || (req.body.legalEntity && req.body.legalEntity.taxId) || '', reusableSourceProfile && reusableSourceProfile.legalEntity ? reusableSourceProfile.legalEntity.verificationDigit : req.body.verificationDigit || (req.body.legalEntity && req.body.legalEntity.verificationDigit) || ''),
          legalRepresentative: String(reusableSourceProfile && reusableSourceProfile.legalEntity ? reusableSourceProfile.legalEntity.legalRepresentative : req.body.legalRepresentative || (req.body.legalEntity && req.body.legalEntity.legalRepresentative) || '').trim()
        }
      : undefined;

    await ensureBusinessProfileCreationLimit(client._id);

    if (profileType === 'NATURAL' || profileType === 'LEGAL') {
      reservedProfileIdentifierType = profileType;
      reservedProfileIdentifier = profileType === 'LEGAL'
        ? String(legalEntity && legalEntity.taxIdNormalized ? legalEntity.taxIdNormalized : '')
        : String(naturalPerson && naturalPerson.documentNumberNormalized ? naturalPerson.documentNumberNormalized : '');
      await reserveProfileIdentifierOwnership(client._id, profileType, reservedProfileIdentifier);
    }

    const businessProfile = await BusinessProfile.create({
      ownerClientId: client._id,
      profileType,
      businessSetupCompleted: false,
      businessName,
      businessUsername,
      profileImageUrl,
      businessCity,
      categories,
      naturalPerson,
      legalEntity,
      verificationStatus: 'PENDING',
      canPublishEvents: false,
      verificationSummary: {
        requiredDocumentRoles: getRequiredDocumentRoles(profileType),
        uploadedDocumentRoles: [],
        missingDocumentRoles: getRequiredDocumentRoles(profileType),
        rejectionReasons: [],
        lastUpdatedAt: new Date()
      }
    });
    createdBusinessProfileId = businessProfile._id;

    if (reusableSourceProfile && reusableSourceDocuments.length) {
      await cloneSourceDocumentsToBusinessProfile(reusableSourceDocuments, businessProfile, client._id);
    }

    const syncedProfile = await synchronizeVerificationState(businessProfile);

    return res.status(201).json({
      success: true,
      message: reusableSourceProfile
        ? 'Perfil creado correctamente reutilizando los datos legales y documentales seleccionados.'
        : 'Perfil creado correctamente y pendiente de verificación documental.',
      profile: buildBusinessProfileResponse(syncedProfile.profile, syncedProfile.verificationCase, syncedProfile.documents)
    });
  } catch (error) {
    if (createdBusinessProfileId) {
      try {
        await ProfileDocument.deleteMany({ businessProfileId: createdBusinessProfileId });
        await VerificationCase.deleteMany({ businessProfileId: createdBusinessProfileId });
        await BusinessProfile.deleteOne({ _id: createdBusinessProfileId });
      } catch (cleanupError) {
        console.error('[business-profile-create] No se pudo revertir el perfil fallido:', cleanupError && cleanupError.message ? cleanupError.message : cleanupError);
      }
    }

    if (resolvedClientId && reservedProfileIdentifier && reservedProfileIdentifierType) {
      try {
        await releaseProfileIdentifierOwnershipIfUnused(resolvedClientId, reservedProfileIdentifierType, reservedProfileIdentifier);
      } catch (releaseError) {
        console.error('[business-profile-create] No se pudo liberar la reserva temporal del documento:', releaseError && releaseError.message ? releaseError.message : releaseError);
      }
    }

    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      message: error.message || 'No se pudo crear el perfil.',
      code: error.code || undefined
    });
  }
});

app.patch('/api/business-profiles/:profileId', async function (req, res) {
  let resolvedClientId = null;
  let previousProfileIdentifier = '';
  let reservedProfileIdentifier = '';
  let profileIdentifierType = '';
  let persistedProfileIdentifierChange = false;

  try {
    const client = await resolveClientFromRequest(req);
    resolvedClientId = client && client._id ? client._id : null;
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);
    const isInitialBusinessSetup = businessProfile.businessSetupCompleted !== true;
    const canEditBusinessProfile = canEditPersistedBusinessProfileInfo(businessProfile);
    const canEditRejectedProfile = canEditPersistedRejectedProfile(businessProfile);
    const requestedProfileType = normalizeProfileType(req.body && req.body.profileType);
    profileIdentifierType = String(businessProfile.profileType || '').trim().toUpperCase();
    const requestBody = req.body || {};
    const hasBusinessFieldUpdate = ['businessName', 'businessUsername', 'profileImageUrl', 'businessCity', 'categories', 'selectedCategories'].some(function (fieldName) {
      return Object.prototype.hasOwnProperty.call(requestBody, fieldName);
    });
    const hasNaturalLegalFieldUpdate = ['fullName', 'documentTypeExpected', 'documentType', 'documentNumber', 'expeditionDate', 'naturalPerson'].some(function (fieldName) {
      return Object.prototype.hasOwnProperty.call(requestBody, fieldName);
    });
    const hasLegalEntityFieldUpdate = ['companyName', 'taxId', 'verificationDigit', 'legalRepresentative', 'legalEntity'].some(function (fieldName) {
      return Object.prototype.hasOwnProperty.call(requestBody, fieldName);
    });
    const hasLegalFieldUpdate = hasNaturalLegalFieldUpdate || hasLegalEntityFieldUpdate;

    if (!isInitialBusinessSetup && hasBusinessFieldUpdate && !canEditBusinessProfile) {
      return res.status(409).json({ message: 'Solo puedes editar el perfil de negocio cuando el perfil esté activo o rechazado.' });
    }

    if (!isInitialBusinessSetup && hasLegalFieldUpdate && !canEditRejectedProfile) {
      return res.status(409).json({ message: 'Solo puedes editar la información legal cuando el perfil esté rechazado.' });
    }

    if (requestedProfileType && requestedProfileType !== profileIdentifierType) {
      return res.status(400).json({ message: 'No puedes cambiar el tipo de perfil de este registro. Debes eliminarlo y crear uno nuevo.' });
    }

    previousProfileIdentifier = businessProfile.profileType === 'LEGAL'
      ? normalizeTaxId(businessProfile.legalEntity && businessProfile.legalEntity.taxIdNormalized
        ? businessProfile.legalEntity.taxIdNormalized
        : businessProfile.legalEntity && businessProfile.legalEntity.taxId)
      : businessProfile.profileType === 'NATURAL'
        ? normalizeIdentityDocumentNumber(businessProfile.naturalPerson && businessProfile.naturalPerson.documentNumberNormalized
          ? businessProfile.naturalPerson.documentNumberNormalized
          : businessProfile.naturalPerson && businessProfile.naturalPerson.documentNumber)
        : '';
    const categories = normalizeCategories(requestBody.categories || requestBody.selectedCategories || businessProfile.categories);
    const businessName = String(requestBody.businessName || businessProfile.businessName || '').trim();
    const businessUsername = String(requestBody.businessUsername || businessProfile.businessUsername || '').trim();
    const profileImageUrl = String(
      typeof requestBody.profileImageUrl === 'string'
        ? requestBody.profileImageUrl
        : businessProfile.profileImageUrl || ''
    ).trim();
    const hasBusinessCity = Object.prototype.hasOwnProperty.call(requestBody, 'businessCity');
    const shouldApplyBusinessFields = isInitialBusinessSetup || hasBusinessFieldUpdate;
    const normalizedBusinessCity = shouldApplyBusinessFields
      ? (hasBusinessCity ? normalizeBusinessCity(requestBody.businessCity) : businessProfile.businessCity)
      : businessProfile.businessCity;

    if (shouldApplyBusinessFields && hasBusinessCity && !normalizedBusinessCity) {
      return res.status(400).json({ message: 'Por ahora solo se admite la ciudad Barranquilla.' });
    }

    if (shouldApplyBusinessFields) {
      businessProfile.businessName = businessName;
      businessProfile.businessUsername = businessUsername;
      businessProfile.profileImageUrl = profileImageUrl;
      businessProfile.businessCity = normalizedBusinessCity;
      businessProfile.categories = categories;
    }

    businessProfile.businessSetupCompleted = true;

    if ((isInitialBusinessSetup || (hasLegalFieldUpdate && canEditRejectedProfile)) && businessProfile.profileType === 'NATURAL') {
      businessProfile.naturalPerson = Object.assign({}, businessProfile.naturalPerson ? businessProfile.naturalPerson.toObject() : {}, {
        fullName: String(requestBody.fullName || (requestBody.naturalPerson && requestBody.naturalPerson.fullName) || (businessProfile.naturalPerson && businessProfile.naturalPerson.fullName) || '').trim(),
        documentTypeExpected: String(requestBody.documentTypeExpected || requestBody.documentType || (requestBody.naturalPerson && requestBody.naturalPerson.documentTypeExpected) || (businessProfile.naturalPerson && businessProfile.naturalPerson.documentTypeExpected) || 'CO_CEDULA_CIUDADANIA').trim(),
        documentNumber: String(requestBody.documentNumber || (requestBody.naturalPerson && requestBody.naturalPerson.documentNumber) || (businessProfile.naturalPerson && businessProfile.naturalPerson.documentNumber) || '').trim(),
        documentNumberNormalized: normalizeIdentityDocumentNumber(requestBody.documentNumber || (requestBody.naturalPerson && requestBody.naturalPerson.documentNumber) || (businessProfile.naturalPerson && businessProfile.naturalPerson.documentNumberNormalized) || (businessProfile.naturalPerson && businessProfile.naturalPerson.documentNumber) || ''),
        expeditionDate: requestBody.expeditionDate || (requestBody.naturalPerson && requestBody.naturalPerson.expeditionDate) || (businessProfile.naturalPerson && businessProfile.naturalPerson.expeditionDate) || null
      });

      reservedProfileIdentifier = String(businessProfile.naturalPerson.documentNumberNormalized || '');
      await reserveProfileIdentifierOwnership(client._id, businessProfile.profileType, reservedProfileIdentifier);
    }

    if ((isInitialBusinessSetup || (hasLegalFieldUpdate && canEditRejectedProfile)) && businessProfile.profileType === 'LEGAL') {
      const taxIdValue = requestBody.taxId || (requestBody.legalEntity && requestBody.legalEntity.taxId) || (businessProfile.legalEntity && businessProfile.legalEntity.taxId) || '';
      const verificationDigitValue = requestBody.verificationDigit || (requestBody.legalEntity && requestBody.legalEntity.verificationDigit) || (businessProfile.legalEntity && businessProfile.legalEntity.verificationDigit) || '';

      businessProfile.legalEntity = Object.assign({}, businessProfile.legalEntity ? businessProfile.legalEntity.toObject() : {}, {
        companyName: String(requestBody.companyName || (requestBody.legalEntity && requestBody.legalEntity.companyName) || (businessProfile.legalEntity && businessProfile.legalEntity.companyName) || '').trim(),
        taxId: normalizeTaxId(taxIdValue),
        taxIdNormalized: normalizeTaxId(taxIdValue),
        verificationDigit: normalizeVerificationDigit(verificationDigitValue),
        taxIdFormatted: formatTaxId(taxIdValue, verificationDigitValue),
        legalRepresentative: String(requestBody.legalRepresentative || (requestBody.legalEntity && requestBody.legalEntity.legalRepresentative) || (businessProfile.legalEntity && businessProfile.legalEntity.legalRepresentative) || '').trim()
      });

      reservedProfileIdentifier = String(businessProfile.legalEntity.taxIdNormalized || '');
      await reserveProfileIdentifierOwnership(client._id, businessProfile.profileType, reservedProfileIdentifier);
    }

    await businessProfile.save();
    persistedProfileIdentifierChange = true;

    if (previousProfileIdentifier && previousProfileIdentifier !== reservedProfileIdentifier && profileIdentifierType) {
      await releaseProfileIdentifierOwnershipIfUnused(client._id, profileIdentifierType, previousProfileIdentifier, businessProfile._id);
    }

    const documents = await ProfileDocument.find({ businessProfileId: businessProfile._id, activeVersion: true }).sort({ createdAt: -1 });
    const verificationCase = await VerificationCase.findOne({ businessProfileId: businessProfile._id });

    return res.json({
      success: true,
      message: 'Perfil actualizado correctamente.',
      profile: buildBusinessProfileResponse(businessProfile, verificationCase, documents)
    });
  } catch (error) {
    if (!persistedProfileIdentifierChange && resolvedClientId && reservedProfileIdentifier && reservedProfileIdentifier !== previousProfileIdentifier && profileIdentifierType) {
      try {
        await releaseProfileIdentifierOwnershipIfUnused(resolvedClientId, profileIdentifierType, reservedProfileIdentifier, req.params.profileId);
      } catch (releaseError) {
        console.error('[business-profile-update] No se pudo liberar la reserva temporal del documento:', releaseError && releaseError.message ? releaseError.message : releaseError);
      }
    }

    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      message: error.message || 'No se pudo actualizar el perfil.',
      code: error.code || undefined
    });
  }
});

app.get('/api/business-profiles', async function (req, res) {
  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const profiles = await BusinessProfile.find({ ownerClientId: client._id, businessSetupCompleted: true }).sort({ createdAt: -1 });
    const profileIds = profiles.map(function (profile) { return profile._id; });
    const documents = await ProfileDocument.find({ businessProfileId: { $in: profileIds }, activeVersion: true }).sort({ createdAt: -1 });
    const verificationCases = await VerificationCase.find({ businessProfileId: { $in: profileIds } });
    const documentsByProfileId = new Map();
    const casesByProfileId = new Map();

    documents.forEach(function (document) {
      const key = String(document.businessProfileId);
      const existing = documentsByProfileId.get(key) || [];
      existing.push(document);
      documentsByProfileId.set(key, existing);
    });

    verificationCases.forEach(function (verificationCase) {
      casesByProfileId.set(String(verificationCase.businessProfileId), verificationCase);
    });

    const serializedProfiles = profiles.map(function (profile) {
      return buildBusinessProfileResponse(
        profile,
        casesByProfileId.get(String(profile._id)) || null,
        documentsByProfileId.get(String(profile._id)) || []
      );
    });

    return res.json({
      success: true,
      profiles: serializedProfiles,
      reusableProfileBases: buildReusableProfileBases(serializedProfiles)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudieron listar los perfiles.' });
  }
});

app.delete('/api/business-profiles/incomplete', async function (req, res) {
  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const incompleteProfiles = await BusinessProfile.find({
      ownerClientId: client._id,
      businessSetupCompleted: { $ne: true }
    }).sort({ createdAt: -1 });

    for (const businessProfile of incompleteProfiles) {
      await deleteBusinessProfileCascade(businessProfile, client._id);
    }

    return res.json({
      success: true,
      deletedProfiles: incompleteProfiles.length,
      message: incompleteProfiles.length
        ? 'Perfiles incompletos eliminados correctamente.'
        : 'No había perfiles incompletos por eliminar.'
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudieron eliminar los perfiles incompletos.' });
  }
});

app.get('/api/business-profiles/:profileId', async function (req, res) {
  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);
    const documents = await ProfileDocument.find({ businessProfileId: businessProfile._id, activeVersion: true }).sort({ createdAt: -1 });
    const verificationCase = await VerificationCase.findOne({ businessProfileId: businessProfile._id });

    return res.json({
      success: true,
      profile: buildBusinessProfileResponse(businessProfile, verificationCase, documents)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo obtener el perfil.' });
  }
});

app.delete('/api/business-profiles/:profileId', async function (req, res) {
  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);
    await deleteBusinessProfileCascade(businessProfile, client._id);

    return res.json({
      success: true,
      message: 'Perfil eliminado correctamente.'
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo eliminar el perfil.' });
  }
});

app.post('/api/business-profiles/:profileId/documents', uploadProfileDocument.single('document'), async function (req, res) {
  let createdDocument = null;
  let storedFilePath = null;

  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);

    if (!canUploadProfileDocumentsForCorrection(businessProfile)) {
      return res.status(409).json({ message: 'Solo puedes cargar o corregir documentos cuando el perfil esté rechazado.' });
    }

    const documentRole = String((req.body && req.body.documentRole) || '').trim().toUpperCase();

    if (!DOCUMENT_ROLES.includes(documentRole)) {
      return res.status(400).json({ message: 'documentRole no es válido.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Debes adjuntar un archivo en el campo document.' });
    }

    const requiredDocumentRoles = getRequiredDocumentRoles(businessProfile.profileType);
    if (!requiredDocumentRoles.includes(documentRole)) {
      return res.status(400).json({ message: 'Ese tipo de documento no corresponde al perfil seleccionado.' });
    }

    const existingActiveDocument = await ProfileDocument.findOne({
      businessProfileId: businessProfile._id,
      documentRole,
      activeVersion: true
    });

    if (existingActiveDocument) {
      existingActiveDocument.activeVersion = false;
      existingActiveDocument.uploadStatus = 'FAILED';
      await existingActiveDocument.save();
    }

    const storedFile = persistUploadedDocumentFile(req.file);
    storedFilePath = storedFile.absoluteFilePath;
    const checksum = computeFileChecksum(storedFile.absoluteFilePath);
    const profileDocument = await ProfileDocument.create({
      businessProfileId: businessProfile._id,
      ownerClientId: client._id,
      documentRole,
      storageKey: storedFile.relativeStorageKey,
      publicUrl: storedFile.publicUrl,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      checksum,
      uploadStatus: 'STORED',
      verificationStatus: 'PENDING',
      classificationAssessment: {
        expectedType: getExpectedDocumentType(documentRole)
      }
    });
    createdDocument = profileDocument;

    if (existingActiveDocument) {
      existingActiveDocument.replacedByDocumentId = profileDocument._id;
      await existingActiveDocument.save();
    }

    await applyAutomaticVerificationWithFallback(profileDocument, businessProfile);

    const syncedProfile = await synchronizeVerificationState(businessProfile);

    return res.status(201).json({
      success: true,
      message: 'Documento cargado correctamente.',
      document: buildBusinessProfileResponse(syncedProfile.profile, syncedProfile.verificationCase, syncedProfile.documents).documents.find(function (document) {
        return document.id === String(profileDocument._id);
      }),
      verificationStatus: syncedProfile.profile.verificationStatus,
      profile: buildBusinessProfileResponse(syncedProfile.profile, syncedProfile.verificationCase, syncedProfile.documents)
    });
  } catch (error) {
    if (!createdDocument) {
      removeUploadedFileSilently(storedFilePath);
    }
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo cargar el documento.' });
  }
});

app.post('/api/business-profiles/:profileId/documents/:documentId/reupload', uploadProfileDocument.single('document'), async function (req, res) {
  let replacementDocument = null;
  let storedFilePath = null;

  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);

    if (!canEditPersistedRejectedProfile(businessProfile)) {
      return res.status(409).json({ message: 'Solo puedes volver a cargar documentos cuando el perfil esté rechazado.' });
    }

    const originalDocument = await ProfileDocument.findOne({
      _id: req.params.documentId,
      businessProfileId: businessProfile._id,
      ownerClientId: client._id,
      activeVersion: true
    });

    if (!originalDocument) {
      return res.status(404).json({ message: 'No se encontró el documento a reemplazar.' });
    }

    if (!['REJECTED', 'MANUAL_REVIEW'].includes(originalDocument.verificationStatus)) {
      return res.status(409).json({ message: 'Solo se pueden volver a subir documentos rechazados o en revisión manual.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Debes adjuntar un archivo en el campo document.' });
    }

    originalDocument.activeVersion = false;
    await originalDocument.save();

    const storedFile = persistUploadedDocumentFile(req.file);
    storedFilePath = storedFile.absoluteFilePath;
    const checksum = computeFileChecksum(storedFile.absoluteFilePath);
    replacementDocument = await ProfileDocument.create({
      businessProfileId: businessProfile._id,
      ownerClientId: client._id,
      documentRole: originalDocument.documentRole,
      storageKey: storedFile.relativeStorageKey,
      publicUrl: storedFile.publicUrl,
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      checksum,
      uploadStatus: 'STORED',
      verificationStatus: 'PENDING',
      classificationAssessment: {
        expectedType: getExpectedDocumentType(originalDocument.documentRole)
      }
    });

    originalDocument.replacedByDocumentId = replacementDocument._id;
    await originalDocument.save();

    await applyAutomaticVerificationWithFallback(replacementDocument, businessProfile);

    const syncedProfile = await synchronizeVerificationState(businessProfile);

    return res.status(201).json({
      success: true,
      message: 'Documento reemplazado correctamente.',
      profile: buildBusinessProfileResponse(syncedProfile.profile, syncedProfile.verificationCase, syncedProfile.documents)
    });
  } catch (error) {
    if (!replacementDocument) {
      removeUploadedFileSilently(storedFilePath);
    }
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo reemplazar el documento.' });
  }
});

app.get('/api/business-profiles/:profileId/verification-status', async function (req, res) {
  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);
    const documents = await ProfileDocument.find({ businessProfileId: businessProfile._id, activeVersion: true }).sort({ createdAt: -1 });
    const verificationCase = await VerificationCase.findOne({ businessProfileId: businessProfile._id });

    return res.json({
      success: true,
      verificationStatus: businessProfile.verificationStatus,
      canPublishEvents: businessProfile.canPublishEvents,
      summary: businessProfile.verificationSummary,
      verificationCase: verificationCase ? {
        id: String(verificationCase._id),
        state: verificationCase.state,
        requiredDocuments: verificationCase.requiredDocuments,
        decisionReasons: verificationCase.decisionReasons,
        summary: verificationCase.summary,
        completedAt: verificationCase.completedAt,
        updatedAt: verificationCase.updatedAt
      } : null,
      documents: documents.map(function (document) {
        return {
          id: String(document._id),
          documentRole: document.documentRole,
          verificationStatus: document.verificationStatus,
          rejectionReasons: document.rejectionReasons || [],
          originalFileName: document.originalFileName,
          publicUrl: document.publicUrl,
          updatedAt: document.updatedAt
        };
      })
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo consultar el estado de verificación.' });
  }
});

app.patch('/api/internal/documents/:documentId/status', async function (req, res) {
  try {
    await ensureAppCollectionsReady();

    const verificationStatus = normalizeManualReviewStatus(req.body.verificationStatus || req.body.status);
    if (!verificationStatus) {
      return res.status(400).json({ message: 'verificationStatus debe ser APPROVED, REJECTED o MANUAL_REVIEW.' });
    }

    const profileDocument = await ProfileDocument.findById(req.params.documentId);
    if (!profileDocument) {
      return res.status(404).json({ message: 'No se encontró el documento.' });
    }

    const rejectionReasons = Array.isArray(req.body.rejectionReasons)
      ? req.body.rejectionReasons.map(function (reason) { return String(reason || '').trim(); }).filter(Boolean)
      : String(req.body.reason || '').trim() ? [String(req.body.reason).trim()] : [];

    profileDocument.verificationStatus = verificationStatus;
    profileDocument.rejectionReasons = verificationStatus === 'REJECTED' ? rejectionReasons : [];
    await profileDocument.save();

    const businessProfile = await BusinessProfile.findById(profileDocument.businessProfileId);
    const syncedProfile = await synchronizeVerificationState(businessProfile);

    return res.json({
      success: true,
      message: 'Estado del documento actualizado correctamente.',
      document: buildBusinessProfileResponse(syncedProfile.profile, syncedProfile.verificationCase, syncedProfile.documents).documents.find(function (document) {
        return document.id === String(profileDocument._id);
      }),
      profile: buildBusinessProfileResponse(syncedProfile.profile, syncedProfile.verificationCase, syncedProfile.documents)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo actualizar el estado del documento.' });
  }
});

app.patch('/api/internal/verification-cases/:caseId/status', async function (req, res) {
  try {
    await ensureAppCollectionsReady();

    const nextStatus = normalizeManualReviewStatus(req.body.state || req.body.verificationStatus || req.body.status);
    if (!nextStatus) {
      return res.status(400).json({ message: 'state debe ser APPROVED, REJECTED o MANUAL_REVIEW.' });
    }

    const verificationCase = await VerificationCase.findById(req.params.caseId);
    if (!verificationCase) {
      return res.status(404).json({ message: 'No se encontró el caso de verificación.' });
    }

    const businessProfile = await BusinessProfile.findById(verificationCase.businessProfileId);
    if (!businessProfile) {
      return res.status(404).json({ message: 'No se encontró el perfil asociado al caso.' });
    }

    const decisionReasons = Array.isArray(req.body.decisionReasons)
      ? req.body.decisionReasons.map(function (reason) { return String(reason || '').trim(); }).filter(Boolean)
      : String(req.body.reason || '').trim() ? [String(req.body.reason).trim()] : [];
    const activeDocuments = await ProfileDocument.find({ businessProfileId: businessProfile._id, activeVersion: true }).sort({ createdAt: -1 });
    const updatedCase = await setProfileVerificationState(businessProfile, nextStatus, {
      summary: String(req.body.summary || '').trim(),
      decisionReasons,
      updatedDocumentIds: activeDocuments.map(function (document) { return document._id; })
    });

    return res.json({
      success: true,
      message: 'Estado del caso actualizado correctamente.',
      verificationCase: {
        id: String(updatedCase._id),
        state: updatedCase.state,
        requiredDocuments: updatedCase.requiredDocuments,
        decisionReasons: updatedCase.decisionReasons,
        summary: updatedCase.summary,
        completedAt: updatedCase.completedAt,
        updatedAt: updatedCase.updatedAt
      },
      profile: buildBusinessProfileResponse(businessProfile, updatedCase, activeDocuments)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo actualizar el caso de verificación.' });
  }
});

app.patch('/api/internal/business-profiles/:profileId/status', async function (req, res) {
  try {
    await ensureAppCollectionsReady();

    const nextStatus = normalizeManualReviewStatus(req.body.verificationStatus || req.body.status);
    if (!nextStatus) {
      return res.status(400).json({ message: 'verificationStatus debe ser APPROVED, REJECTED o MANUAL_REVIEW.' });
    }

    const businessProfile = await BusinessProfile.findById(req.params.profileId);
    if (!businessProfile) {
      return res.status(404).json({ message: 'No se encontró el perfil.' });
    }

    const decisionReasons = Array.isArray(req.body.decisionReasons)
      ? req.body.decisionReasons.map(function (reason) { return String(reason || '').trim(); }).filter(Boolean)
      : String(req.body.reason || '').trim() ? [String(req.body.reason).trim()] : [];
    const activeDocuments = await ProfileDocument.find({ businessProfileId: businessProfile._id, activeVersion: true }).sort({ createdAt: -1 });
    const updatedCase = await setProfileVerificationState(businessProfile, nextStatus, {
      summary: String(req.body.summary || '').trim(),
      decisionReasons,
      updatedDocumentIds: activeDocuments.map(function (document) { return document._id; })
    });

    return res.json({
      success: true,
      message: 'Estado del perfil actualizado correctamente.',
      profile: buildBusinessProfileResponse(businessProfile, updatedCase, activeDocuments)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo actualizar el estado del perfil.' });
  }
});

app.post('/api/events', async function (req, res) {
  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const approvedProfile = await BusinessProfile.findOne({
      ownerClientId: client._id,
      verificationStatus: 'APPROVED',
      canPublishEvents: true
    }).select('_id displayName verificationStatus canPublishEvents');

    if (!approvedProfile) {
      return res.status(403).json({
        message: 'No puedes crear eventos hasta tener al menos un perfil activo.',
        requiredVerificationStatus: 'APPROVED'
      });
    }

    return res.status(501).json({
      message: 'La creación real de eventos aún no está implementada, pero la validación de perfiles ya quedó aplicada.',
      approvedProfile: {
        id: String(approvedProfile._id),
        displayName: approvedProfile.displayName,
        verificationStatus: approvedProfile.verificationStatus,
        canPublishEvents: approvedProfile.canPublishEvents
      }
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo evaluar la creación del evento.' });
  }
});

app.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(function (error, req, res, next) {
  if (error && (
    error.type === 'entity.too.large'
    || error.status === 413
    || error.statusCode === 413
    || error.name === 'PayloadTooLargeError'
  )) {
    return res.status(413).json({ message: 'El archivo es demasiado pesado. Sube una imagen o documento más liviano para continuar.' });
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'El archivo es demasiado pesado. Sube una imagen o documento más liviano para continuar.' });
    }

    return res.status(400).json({ message: error.message });
  }

  if (error && error.message) {
    return res.status(400).json({ message: error.message });
  }

  return next(error);
});

app.listen(PORT, function () {
  console.log('Server is running on port ' + PORT);
});