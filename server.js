require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const Client = require('./models/Client');
const { BusinessProfile, VERIFICATION_STATUSES, BUSINESS_PROFILE_CITIES } = require('./models/BusinessProfile');
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
const DEFAULT_CATEGORY_LIMIT = 2;
const DEFAULT_BUSINESS_CITY = BUSINESS_PROFILE_CITIES[0] || 'Barranquilla';
let mongoConnectionPromise = null;
let mongoInitializationPromise = null;
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

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, PROFILE_DOCUMENT_UPLOADS_ROOT);
  },
  filename: function (req, file, cb) {
    const safeExtension = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin';
    const uniqueName = Date.now() + '-' + crypto.randomBytes(8).toString('hex') + safeExtension;
    cb(null, uniqueName);
  }
});

const uploadProfileDocument = multer({
  storage,
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

const ensureAppCollectionsReady = async function () {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI no configurada');
  }

  await connectToMongo();

  if (!mongoInitializationPromise) {
    mongoInitializationPromise = (async function () {
      await ensureModelReady(Client);
      await ensureModelReady(BusinessProfile);
      await ensureModelReady(ProfileDocument);
      await ensureModelReady(VerificationCase);
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
  return String(value || '').replace(/\D/g, '');
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

const buildBusinessProfileResponse = function (profile, verificationCase, documents) {
  return {
    id: String(profile._id),
    ownerClientId: String(profile.ownerClientId),
    profileType: profile.profileType,
    status: profile.status,
    verificationStatus: profile.verificationStatus,
    canPublishEvents: profile.canPublishEvents,
    displayName: profile.displayName,
    businessName: profile.businessName,
    businessUsername: profile.businessUsername,
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
      const error = new Error('El cliente existe solo en modo local. Debe registrarse en MongoDB antes de crear perfiles.');
      error.statusCode = 409;
      throw error;
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
      await connectToMongo();
    }

    user = await Client.findOne({ email });
  } catch (error) {
    console.warn('[login] MongoDB no disponible, usando cliente local:', error.message);
  }

  if (!user) {
    user = DEFAULT_CLIENTS.find(function (client) {
      return String(client.email).toLowerCase() === email;
    }) || null;
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
  try {
    const client = await resolveClientFromRequest(req);
    const profileType = normalizeProfileType(req.body.profileType);

    if (!profileType) {
      return res.status(400).json({ message: 'profileType debe ser NATURAL o LEGAL.' });
    }

    const categories = normalizeCategories(req.body.categories || req.body.selectedCategories);
    const businessName = String(req.body.businessName || req.body.displayName || '').trim();
    const businessUsername = String(req.body.businessUsername || '').trim();
    const businessCity = normalizeBusinessCity(req.body.businessCity);

    if (req.body.businessCity && !businessCity) {
      return res.status(400).json({ message: 'Por ahora solo se admite la ciudad Barranquilla.' });
    }

    const naturalPerson = profileType === 'NATURAL'
      ? {
          fullName: String(req.body.fullName || (req.body.naturalPerson && req.body.naturalPerson.fullName) || '').trim(),
          documentTypeExpected: String(req.body.documentTypeExpected || req.body.documentType || (req.body.naturalPerson && req.body.naturalPerson.documentTypeExpected) || 'CO_CEDULA_CIUDADANIA').trim(),
          documentNumber: String(req.body.documentNumber || (req.body.naturalPerson && req.body.naturalPerson.documentNumber) || '').trim(),
          expeditionDate: req.body.expeditionDate || (req.body.naturalPerson && req.body.naturalPerson.expeditionDate) || null
        }
      : undefined;
    const legalEntity = profileType === 'LEGAL'
      ? {
          companyName: String(req.body.companyName || (req.body.legalEntity && req.body.legalEntity.companyName) || '').trim(),
          taxId: normalizeTaxId(req.body.taxId || (req.body.legalEntity && req.body.legalEntity.taxId) || ''),
          verificationDigit: normalizeVerificationDigit(req.body.verificationDigit || (req.body.legalEntity && req.body.legalEntity.verificationDigit) || ''),
          taxIdFormatted: formatTaxId(req.body.taxId || (req.body.legalEntity && req.body.legalEntity.taxId) || '', req.body.verificationDigit || (req.body.legalEntity && req.body.legalEntity.verificationDigit) || ''),
          legalRepresentative: String(req.body.legalRepresentative || (req.body.legalEntity && req.body.legalEntity.legalRepresentative) || '').trim()
        }
      : undefined;

    const businessProfile = await BusinessProfile.create({
      ownerClientId: client._id,
      profileType,
      businessName,
      businessUsername,
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

    const syncedProfile = await synchronizeVerificationState(businessProfile);

    return res.status(201).json({
      success: true,
      message: 'Perfil creado correctamente y pendiente de verificación documental.',
      profile: buildBusinessProfileResponse(syncedProfile.profile, syncedProfile.verificationCase, syncedProfile.documents)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo crear el perfil.' });
  }
});

app.patch('/api/business-profiles/:profileId', async function (req, res) {
  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);
    const categories = normalizeCategories(req.body.categories || req.body.selectedCategories || businessProfile.categories);
    const businessName = String(req.body.businessName || businessProfile.businessName || '').trim();
    const businessUsername = String(req.body.businessUsername || businessProfile.businessUsername || '').trim();
    const hasBusinessCity = Object.prototype.hasOwnProperty.call(req.body || {}, 'businessCity');
    const normalizedBusinessCity = hasBusinessCity ? normalizeBusinessCity(req.body.businessCity) : businessProfile.businessCity;

    if (hasBusinessCity && !normalizedBusinessCity) {
      return res.status(400).json({ message: 'Por ahora solo se admite la ciudad Barranquilla.' });
    }

    businessProfile.businessName = businessName;
    businessProfile.businessUsername = businessUsername;
    businessProfile.businessCity = normalizedBusinessCity;
    businessProfile.categories = categories;

    if (businessProfile.profileType === 'NATURAL') {
      businessProfile.naturalPerson = Object.assign({}, businessProfile.naturalPerson ? businessProfile.naturalPerson.toObject() : {}, {
        fullName: String(req.body.fullName || (req.body.naturalPerson && req.body.naturalPerson.fullName) || (businessProfile.naturalPerson && businessProfile.naturalPerson.fullName) || '').trim(),
        documentTypeExpected: String(req.body.documentTypeExpected || req.body.documentType || (req.body.naturalPerson && req.body.naturalPerson.documentTypeExpected) || (businessProfile.naturalPerson && businessProfile.naturalPerson.documentTypeExpected) || 'CO_CEDULA_CIUDADANIA').trim(),
        documentNumber: String(req.body.documentNumber || (req.body.naturalPerson && req.body.naturalPerson.documentNumber) || (businessProfile.naturalPerson && businessProfile.naturalPerson.documentNumber) || '').trim(),
        expeditionDate: req.body.expeditionDate || (req.body.naturalPerson && req.body.naturalPerson.expeditionDate) || (businessProfile.naturalPerson && businessProfile.naturalPerson.expeditionDate) || null
      });
    }

    if (businessProfile.profileType === 'LEGAL') {
      const taxIdValue = req.body.taxId || (req.body.legalEntity && req.body.legalEntity.taxId) || (businessProfile.legalEntity && businessProfile.legalEntity.taxId) || '';
      const verificationDigitValue = req.body.verificationDigit || (req.body.legalEntity && req.body.legalEntity.verificationDigit) || (businessProfile.legalEntity && businessProfile.legalEntity.verificationDigit) || '';

      businessProfile.legalEntity = Object.assign({}, businessProfile.legalEntity ? businessProfile.legalEntity.toObject() : {}, {
        companyName: String(req.body.companyName || (req.body.legalEntity && req.body.legalEntity.companyName) || (businessProfile.legalEntity && businessProfile.legalEntity.companyName) || '').trim(),
        taxId: normalizeTaxId(taxIdValue),
        verificationDigit: normalizeVerificationDigit(verificationDigitValue),
        taxIdFormatted: formatTaxId(taxIdValue, verificationDigitValue),
        legalRepresentative: String(req.body.legalRepresentative || (req.body.legalEntity && req.body.legalEntity.legalRepresentative) || (businessProfile.legalEntity && businessProfile.legalEntity.legalRepresentative) || '').trim()
      });
    }

    await businessProfile.save();
    const documents = await ProfileDocument.find({ businessProfileId: businessProfile._id, activeVersion: true }).sort({ createdAt: -1 });
    const verificationCase = await VerificationCase.findOne({ businessProfileId: businessProfile._id });

    return res.json({
      success: true,
      message: 'Perfil actualizado correctamente.',
      profile: buildBusinessProfileResponse(businessProfile, verificationCase, documents)
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo actualizar el perfil.' });
  }
});

app.get('/api/business-profiles', async function (req, res) {
  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const profiles = await BusinessProfile.find({ ownerClientId: client._id }).sort({ createdAt: -1 });
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

    return res.json({
      success: true,
      profiles: profiles.map(function (profile) {
        return buildBusinessProfileResponse(
          profile,
          casesByProfileId.get(String(profile._id)) || null,
          documentsByProfileId.get(String(profile._id)) || []
        );
      })
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudieron listar los perfiles.' });
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

app.post('/api/business-profiles/:profileId/documents', uploadProfileDocument.single('document'), async function (req, res) {
  let createdDocument = null;

  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);
    const documentRole = String(req.body.documentRole || '').trim().toUpperCase();

    if (!DOCUMENT_ROLES.includes(documentRole)) {
      removeUploadedFileSilently(req.file && req.file.path);
      return res.status(400).json({ message: 'documentRole no es válido.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Debes adjuntar un archivo en el campo document.' });
    }

    const requiredDocumentRoles = getRequiredDocumentRoles(businessProfile.profileType);
    if (!requiredDocumentRoles.includes(documentRole)) {
      removeUploadedFileSilently(req.file.path);
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

    const checksum = computeFileChecksum(req.file.path);
    const relativeStorageKey = path.relative(__dirname, req.file.path).replace(/\\/g, '/');
    const profileDocument = await ProfileDocument.create({
      businessProfileId: businessProfile._id,
      ownerClientId: client._id,
      documentRole,
      storageKey: relativeStorageKey,
      publicUrl: '/uploads/' + path.relative(UPLOADS_ROOT, req.file.path).replace(/\\/g, '/'),
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
      removeUploadedFileSilently(req.file && req.file.path);
    }
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({ message: error.message || 'No se pudo cargar el documento.' });
  }
});

app.post('/api/business-profiles/:profileId/documents/:documentId/reupload', uploadProfileDocument.single('document'), async function (req, res) {
  let replacementDocument = null;

  try {
    const client = await resolveClientFromRequest(req);
    await ensureAppCollectionsReady();

    const businessProfile = await findOwnedBusinessProfile(req.params.profileId, client._id);
    const originalDocument = await ProfileDocument.findOne({
      _id: req.params.documentId,
      businessProfileId: businessProfile._id,
      ownerClientId: client._id,
      activeVersion: true
    });

    if (!originalDocument) {
      removeUploadedFileSilently(req.file && req.file.path);
      return res.status(404).json({ message: 'No se encontró el documento a reemplazar.' });
    }

    if (!['REJECTED', 'MANUAL_REVIEW'].includes(originalDocument.verificationStatus)) {
      removeUploadedFileSilently(req.file && req.file.path);
      return res.status(409).json({ message: 'Solo se pueden volver a subir documentos rechazados o en revisión manual.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Debes adjuntar un archivo en el campo document.' });
    }

    originalDocument.activeVersion = false;
    await originalDocument.save();

    const checksum = computeFileChecksum(req.file.path);
    replacementDocument = await ProfileDocument.create({
      businessProfileId: businessProfile._id,
      ownerClientId: client._id,
      documentRole: originalDocument.documentRole,
      storageKey: path.relative(__dirname, req.file.path).replace(/\\/g, '/'),
      publicUrl: '/uploads/' + path.relative(UPLOADS_ROOT, req.file.path).replace(/\\/g, '/'),
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
      removeUploadedFileSilently(req.file && req.file.path);
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
        message: 'No puedes crear eventos hasta tener al menos un perfil aprobado.',
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
  if (error instanceof multer.MulterError) {
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