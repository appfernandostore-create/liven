require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('./models/Client');

const MONGODB_URI = process.env.MONGODB_URI;
const seedClient = {
  firstName: 'Liven',
  lastName: 'Cliente',
  email: 'cliente@liven.com',
  password: 'Cliente123!',
  role: 'CLIENTE'
};

async function seed() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI no está configurada en .env');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  const existing = await Client.findOne({ email: seedClient.email });
  if (existing) {
    console.log('El cliente ya existe:', seedClient.email);
    process.exit(0);
  }

  await Client.create(seedClient);
  console.log('Cliente seed creado con correo:', seedClient.email);
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
