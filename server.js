require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Client = require('./models/Client');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

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

// Connect to MongoDB
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch(err => {
    console.error('Error connecting to MongoDB:', err);
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
    user = await Client.findOne({ email: normalizedEmail });
  } catch (err) {
    console.warn('MongoDB no disponible, usando cliente local:', err.message);
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

    console.error('Error creating client account:', error);
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