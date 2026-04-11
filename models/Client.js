const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Correo electrónico inválido.']
  },
  phone: { type: String, required: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, default: 'CLIENTE' },
  plan: {
    type: String,
    enum: ['GRATUITO', 'PREMIUM', 'PREMIUM_PLUS'],
    default: 'GRATUITO'
  },
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'clients'
});

clientSchema.index({ email: 1 }, { unique: true, name: 'clients_email_unique_idx' });

clientSchema.pre('validate', function () {
  const resolvedFullName = String(this.fullName || '').trim() || [this.firstName, this.lastName].filter(Boolean).join(' ').trim();

  if (resolvedFullName) {
    this.fullName = resolvedFullName;
  }

  if ((!this.firstName || !this.lastName) && resolvedFullName) {
    const nameParts = resolvedFullName.split(/\s+/).filter(Boolean);

    if (!this.firstName) {
      this.firstName = nameParts[0] || resolvedFullName;
    }

    if (!this.lastName) {
      this.lastName = nameParts.slice(1).join(' ') || nameParts[0] || resolvedFullName;
    }
  }
});

module.exports = mongoose.model('Client', clientSchema);
