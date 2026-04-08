require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const Client = require('./models/Client');

const app = express();
const PORT = process.env.PORT || 3000;

const DEFAULT_CLIENT = {
  firstName: 'Liven',
  lastName: 'Cliente',
  email: 'cliente@liven.com',
  password: 'Cliente123!',
  role: 'CLIENTE'
};

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
.then(() => {
  console.log('Connected to MongoDB');
})
.catch(err => {
  console.error('Error connecting to MongoDB:', err);
});

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

  let user = null;
  try {
    user = await Client.findOne({ email: email.toLowerCase().trim() });
  } catch (err) {
    console.warn('MongoDB no disponible, usando cliente local:', err.message);
  }

  if (!user && email.toLowerCase().trim() === DEFAULT_CLIENT.email && password === DEFAULT_CLIENT.password) {
    user = DEFAULT_CLIENT;
  }

  if (!user || user.password !== password) {
    return res.status(401).json({ message: 'Credenciales inválidas.' });
  }

  return res.json({ success: true, redirect: '/dashboard.html' });
});

// Basic route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});