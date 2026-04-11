require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Client = require('./models/Client');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const MONGO_CONNECT_TIMEOUT_MS = 10000;
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
    fullName: 'Liven Premium+',
    firstName: 'Liven',
    lastName: 'Premium+',
    email: 'cliente@liven.com',
    phone: '+57 300 000 0001',
    password: 'Cliente123!',
    role: 'CLIENTE',
    plan: 'PREMIUM_PLUS'
  },
  {
    fullName: 'Liven Gratuito',
    firstName: 'Liven',
    lastName: 'Gratuito',
    email: 'clienteG@liven.com',
    phone: '+57 300 000 0002',
    password: 'Cliente123!',
    role: 'CLIENTE',
    plan: 'GRATUITO'
  },
  {
    fullName: 'Liven Premium',
    firstName: 'Liven',
    lastName: 'Premium',
    email: 'clienteP@liven.com',
    phone: '+57 300 000 0003',
    password: 'Cliente123!',
    role: 'CLIENTE',
    plan: 'PREMIUM'
  }
];

const serializeAuthenticatedClient = function (client) {
  if (!client) {
    return null;
  }

  return {
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
      message: 'Los datos no pasan la validación del modelo Client.'
    };
  }

  if (error && error.code === 11000) {
    return {
      code: 'DUPLICATE_EMAIL',
      message: 'Ya existe un documento con ese correo electrónico.'
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

const ensureClientCollectionReady = async function () {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI no configurada');
  }

  await connectToMongo();

  if (!mongoInitializationPromise) {
    mongoInitializationPromise = (async function () {
      const existingCollections = await mongoose.connection.db.listCollections({ name: 'clients' }).toArray();

      if (!existingCollections.length) {
        console.log('[mongo] La coleccion clients no existe. Creandola ahora.');
        await Client.createCollection();
        console.log('[mongo] Coleccion clients creada correctamente.');
        setLastMongoDiagnostic('collection', 'CLIENTS_COLLECTION_CREATED', 'La colección clients fue creada correctamente.');
      }

      await Client.syncIndexes();
      console.log('[mongo] Indices de clients verificados/sincronizados.');
      setLastMongoDiagnostic('collection', 'CLIENTS_INDEXES_READY', 'La colección clients e índices quedaron listos.');
    })().catch(function (error) {
      mongoInitializationPromise = null;
      const diagnostic = classifyMongoError(error);
      setLastMongoDiagnostic('collection', diagnostic.code, diagnostic.message);
      console.error('[mongo] Error preparando la coleccion clients:', error && error.message ? error.message : error);
      throw error;
    });
  }

  return mongoInitializationPromise;
};

// Connect to MongoDB
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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/debug/mongo-status', function (req, res) {
  res.json({
    hasMongoUri: Boolean(MONGODB_URI),
    mongoReadyState: mongoose.connection.readyState,
    mongoReadyStateLabel: getMongoConnectionStateLabel(),
    lastMongoDiagnostic
  });
});

// Login route
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Correo y contraseña requeridos.' });
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  let user = null;
  try {
    if (MONGODB_URI) {
      await connectToMongo();
    }

    user = await Client.findOne({ email: normalizedEmail });
  } catch (err) {
    console.warn('[login] MongoDB no disponible, usando cliente local:', err.message);
  }

  if (!user) {
    user = DEFAULT_CLIENTS.find(function (client) {
      return String(client.email).toLowerCase() === normalizedEmail;
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

app.post('/api/register', async (req, res) => {
  const requestId = 'register-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const fullName = String(req.body.fullName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');

  console.log('[register][' + requestId + '] Solicitud recibida para:', email || '(sin correo)');

  if (!fullName || !email || !phone || !password) {
    console.warn('[register][' + requestId + '] Validacion fallida: faltan campos requeridos.');
    return res.status(400).json({ message: 'Nombre, correo, teléfono y contraseña son requeridos.' });
  }

  if (password.length < 8) {
    console.warn('[register][' + requestId + '] Validacion fallida: contraseña demasiado corta.');
    return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
  }

  if (!MONGODB_URI) {
    console.error('[register][' + requestId + '] Registro bloqueado: MONGODB_URI no configurada.');
    return res.status(503).json({ message: 'El registro no está disponible porque MongoDB no está configurado.' });
  }

  try {
    await ensureClientCollectionReady();
    console.log('[register][' + requestId + '] Mongo listo. Estado:', getMongoConnectionStateLabel());

    const existingClient = await Client.findOne({ email }).select('_id');

    if (existingClient) {
      console.warn('[register][' + requestId + '] Correo duplicado detectado:', email);
      setLastMongoDiagnostic('register', 'DUPLICATE_EMAIL', 'Se detectó un correo duplicado durante el registro.');
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

    console.log('[register][' + requestId + '] Cliente creado correctamente con _id:', String(createdClient._id));
    setLastMongoDiagnostic('register', 'REGISTER_SUCCESS', 'El cliente fue creado correctamente en la colección clients.');

    return res.status(201).json({
      success: true,
      message: 'Cuenta creada correctamente.',
      redirect: '/dashboard.html',
      user: serializeAuthenticatedClient(createdClient)
    });
  } catch (error) {
    if (error && error.code === 11000) {
      console.warn('[register][' + requestId + '] Error de indice unico para correo:', email);
      setLastMongoDiagnostic('register', 'DUPLICATE_EMAIL', 'Se detectó un correo duplicado al intentar escribir en MongoDB.');
      return res.status(409).json({ message: 'Ya existe una cuenta registrada con ese correo.' });
    }

    if (error && error.name === 'ValidationError') {
      console.error('[register][' + requestId + '] Error de validacion:', error.message);
      setLastMongoDiagnostic('register', 'MODEL_VALIDATION_ERROR', error.message);
      return res.status(400).json({ message: 'Los datos enviados no son válidos.', diagnosticCode: 'MODEL_VALIDATION_ERROR' });
    }

    const diagnostic = classifyMongoError(error);
    setLastMongoDiagnostic('register', diagnostic.code, diagnostic.message);
    console.error('[register][' + requestId + '] Error creando cliente. Estado mongo:', getMongoConnectionStateLabel());
    console.error('[register][' + requestId + '] Detalle:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      message: 'No se pudo crear la cuenta en este momento.',
      diagnosticCode: diagnostic.code,
      diagnosticMessage: diagnostic.message
    });
  }
});

// Basic route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});