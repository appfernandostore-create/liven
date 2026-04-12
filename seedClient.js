require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Client = require('./models/Client');

const MONGODB_URI = process.env.MONGODB_URI;
const seedClients = [
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

async function seed() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI no está configurada en .env');
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI);
  for (const seedClient of seedClients) {
    const hashedPassword = await bcrypt.hash(seedClient.password, 10);

    await Client.findOneAndUpdate(
      { email: String(seedClient.email).toLowerCase() },
      Object.assign({}, seedClient, { password: hashedPassword }),
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    console.log('Cliente seed sincronizado con correo:', seedClient.email);
  }

  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
