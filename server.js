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

const connectToMongo = async function () {
  if (!MONGODB_URI) {
    console.warn('[mongo] MONGODB_URI no configurada.');
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
      return mongoose.connection;
    }).catch(function (error) {
      mongoConnectionPromise = null;
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
      }

      await Client.syncIndexes();
      console.log('[mongo] Indices de clients verificados/sincronizados.');
    })().catch(function (error) {
      mongoInitializationPromise = null;
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

    return res.status(201).json({
      success: true,
      message: 'Cuenta creada correctamente.',
      redirect: '/dashboard.html',
      user: serializeAuthenticatedClient(createdClient)
    });
  } catch (error) {
    if (error && error.code === 11000) {
      console.warn('[register][' + requestId + '] Error de indice unico para correo:', email);
      return res.status(409).json({ message: 'Ya existe una cuenta registrada con ese correo.' });
    }

    if (error && error.name === 'ValidationError') {
      console.error('[register][' + requestId + '] Error de validacion:', error.message);
      return res.status(400).json({ message: 'Los datos enviados no son válidos.' });
    }

    console.error('[register][' + requestId + '] Error creando cliente. Estado mongo:', getMongoConnectionStateLabel());
    console.error('[register][' + requestId + '] Detalle:', error && error.stack ? error.stack : error);
    return res.status(500).json({ message: 'No se pudo crear la cuenta en este momento.' });
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