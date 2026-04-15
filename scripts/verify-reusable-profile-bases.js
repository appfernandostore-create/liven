require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const Client = require('../models/Client');
const { BusinessProfile, normalizeIdentityDocumentNumber, normalizeTaxIdentifier } = require('../models/BusinessProfile');
const { ProfileDocument } = require('../models/ProfileDocument');
const { IdentityDocumentOwnership } = require('../models/IdentityDocumentOwnership');
const { VerificationCase } = require('../models/VerificationCase');

const ACTIVE_CLIENT_STORAGE_KEY = 'livenActiveClient';
const ACTIVE_BUSINESS_PROFILE_STORAGE_KEY = 'livenActiveBusinessProfileId';
const BASE_URL = String(process.env.LOCAL_UI_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const RUN_ID = String(Date.now());
const SCREENSHOT_DIR = path.join(process.cwd(), 'tmp', 'ui-reusable-profile-verification', RUN_ID);
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO1m5+0AAAAASUVORK5CYII=',
  'base64'
);

const IDENTIFIER_BASE = String(Number(RUN_ID.slice(-9)) || 910000001);
const accountA = {
  fullName: 'QA Reuse Cuenta A ' + RUN_ID,
  email: 'qa.reuse.a.' + RUN_ID + '@live.local',
  phone: '+57 323 100 ' + RUN_ID.slice(-4),
  password: 'Cliente123!'
};
const accountB = {
  fullName: 'QA Reuse Cuenta B ' + RUN_ID,
  email: 'qa.reuse.b.' + RUN_ID + '@live.local',
  phone: '+57 323 200 ' + RUN_ID.slice(-4),
  password: 'Cliente123!'
};
const naturalSeed = {
  fullName: 'QA Reuse Natural Base ' + RUN_ID,
  documentNumber: IDENTIFIER_BASE.slice(0, 2) + '.' + IDENTIFIER_BASE.slice(2, 5) + '.' + IDENTIFIER_BASE.slice(5),
  expeditionDate: '2020-04-10'
};
const legalSeed = {
  companyName: 'QA Reuse Legal Base ' + RUN_ID,
  taxId: IDENTIFIER_BASE.slice(0, 3) + '.' + IDENTIFIER_BASE.slice(3, 6) + '.' + IDENTIFIER_BASE.slice(6),
  verificationDigit: '4',
  legalRepresentative: 'Representante Reuse ' + RUN_ID
};
const results = {
  runId: RUN_ID,
  baseUrl: BASE_URL,
  accounts: {
    accountA: { email: accountA.email },
    accountB: { email: accountB.email }
  },
  reusableUi: {},
  mongoChecks: {},
  screenshots: {}
};

const expect = function (condition, message) {
  if (!condition) {
    throw new Error(message);
  }
};

const logStep = function (message) {
  process.stdout.write('[verify-reusable-bases] ' + String(message || '') + '\n');
};

const ensureDirectory = function (dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
};

const wait = function (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
};

const safeClose = async function (resource) {
  if (!resource || typeof resource.close !== 'function') {
    return;
  }

  try {
    await resource.close();
  } catch (error) {
    return;
  }
};

const sanitizeLabel = function (value) {
  return String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
};

const takeShot = async function (page, label) {
  const filePath = path.join(SCREENSHOT_DIR, sanitizeLabel(label) + '.png');
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
};

const asJson = async function (response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { message: text };
  }
};

const registerAccount = async function (account) {
  const response = await fetch(BASE_URL + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(account)
  });
  const result = await asJson(response);

  expect(response.status === 201, 'No se pudo registrar la cuenta ' + account.email + '. Respuesta: ' + JSON.stringify(result));
  return result.user;
};

const createNaturalProfileViaApi = async function (accountEmail, payload) {
  const response = await fetch(BASE_URL + '/api/business-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: accountEmail,
      profileType: 'NATURAL',
      fullName: payload.fullName,
      documentTypeExpected: 'CO_CEDULA_CIUDADANIA',
      documentNumber: payload.documentNumber,
      expeditionDate: payload.expeditionDate
    })
  });
  const result = await asJson(response);

  expect(response.status === 201, 'No se pudo crear el perfil natural base. Respuesta: ' + JSON.stringify(result));
  return result.profile;
};

const createLegalProfileViaApi = async function (accountEmail, payload) {
  const response = await fetch(BASE_URL + '/api/business-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: accountEmail,
      profileType: 'LEGAL',
      companyName: payload.companyName,
      taxId: payload.taxId,
      verificationDigit: payload.verificationDigit,
      legalRepresentative: payload.legalRepresentative
    })
  });
  const result = await asJson(response);

  expect(response.status === 201, 'No se pudo crear el perfil jurídico base. Respuesta: ' + JSON.stringify(result));
  return result.profile;
};

const completeBusinessProfileSetupViaApi = async function (accountEmail, profileId, label) {
  const response = await fetch(BASE_URL + '/api/business-profiles/' + encodeURIComponent(profileId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: accountEmail,
      businessName: 'Negocio base ' + label + ' ' + RUN_ID,
      businessUsername: 'qa-reuse-' + sanitizeLabel(label) + '-' + RUN_ID,
      businessCity: 'Barranquilla',
      categories: ['Sociales']
    })
  });
  const result = await asJson(response);

  expect(response.status === 200, 'No se pudo completar la configuración del perfil base ' + label + '. Respuesta: ' + JSON.stringify(result));
  expect(result && result.profile && result.profile.businessSetupCompleted === true, 'El perfil base ' + label + ' no quedó marcado como completado.');

  return result.profile;
};

const completeReusableProfileViaApi = async function (accountEmail, profile, label) {
  const response = await fetch(BASE_URL + '/api/business-profiles/' + encodeURIComponent(profile.id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: accountEmail,
      businessName: 'Perfil reutilizado ' + label + ' ' + RUN_ID,
      businessUsername: 'qa-reuse-final-' + sanitizeLabel(label) + '-' + RUN_ID,
      businessCity: 'Barranquilla',
      categories: ['Sociales']
    })
  });
  const result = await asJson(response);

  expect(response.status === 200, 'No se pudo completar el perfil reutilizado ' + label + '. Respuesta: ' + JSON.stringify(result));
  expect(result && result.profile && result.profile.businessSetupCompleted === true, 'El perfil reutilizado ' + label + ' no quedó completado.');

  return result.profile;
};

const uploadProfileDocumentViaApi = async function (accountEmail, profileId, documentRole, fileName) {
  const formData = new FormData();
  formData.append('clientEmail', accountEmail);
  formData.append('documentRole', documentRole);
  formData.append('document', new Blob([ONE_BY_ONE_PNG], { type: 'image/png' }), fileName);

  const response = await fetch(BASE_URL + '/api/business-profiles/' + encodeURIComponent(profileId) + '/documents', {
    method: 'POST',
    body: formData
  });
  const result = await asJson(response);

  expect(response.status === 201, 'No se pudo cargar el documento ' + documentRole + '. Respuesta: ' + JSON.stringify(result));
  return result.profile;
};

const forceReusableSourceReady = async function (profileId, profileType) {
  const activeDocuments = await ProfileDocument.find({ businessProfileId: profileId, activeVersion: true });

  for (const document of activeDocuments) {
    document.verificationStatus = 'APPROVED';
    document.uploadStatus = 'STORED';
    document.rejectionReasons = [];
    await document.save();
  }

  const businessProfile = await BusinessProfile.findById(profileId);
  const requiredDocuments = profileType === 'LEGAL' ? ['RUT'] : ['CEDULA_FRONT', 'CEDULA_BACK'];

  businessProfile.verificationStatus = 'APPROVED';
  businessProfile.businessSetupCompleted = true;
  businessProfile.canPublishEvents = true;
  businessProfile.documents = activeDocuments.map(function (document) {
    return document._id;
  });
  businessProfile.verificationSummary = {
    requiredDocumentRoles: requiredDocuments,
    uploadedDocumentRoles: requiredDocuments,
    missingDocumentRoles: [],
    rejectionReasons: [],
    lastUpdatedAt: new Date()
  };

  if (profileType === 'LEGAL' && businessProfile.legalEntity) {
    businessProfile.legalEntity.rutDocumentId = activeDocuments[0] ? activeDocuments[0]._id : undefined;
  }

  if (profileType === 'NATURAL' && businessProfile.naturalPerson) {
    const frontDocument = activeDocuments.find(function (document) {
      return String(document.documentRole || '') === 'CEDULA_FRONT';
    });
    const backDocument = activeDocuments.find(function (document) {
      return String(document.documentRole || '') === 'CEDULA_BACK';
    });
    businessProfile.naturalPerson.frontDocumentId = frontDocument ? frontDocument._id : undefined;
    businessProfile.naturalPerson.backDocumentId = backDocument ? backDocument._id : undefined;
  }

  await businessProfile.save();

  await VerificationCase.findOneAndUpdate(
    { businessProfileId: profileId },
    {
      ownerClientId: businessProfile.ownerClientId,
      profileType,
      requiredDocuments,
      processedDocuments: activeDocuments.map(function (document) { return document._id; }),
      state: 'APPROVED',
      decisionReasons: [],
      summary: 'Expediente preparado para reutilización QA.',
      completedAt: new Date()
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      runValidators: true
    }
  );
};

const connectMongo = async function () {
  expect(MONGODB_URI, 'MONGODB_URI no está configurada.');

  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(MONGODB_URI);
};

const createAuthedContext = async function (browser, client) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });

  await context.addInitScript(function (payload) {
    window.sessionStorage.setItem(payload.activeClientKey, JSON.stringify(payload.activeClient));
    window.sessionStorage.removeItem(payload.activeProfileKey);
  }, {
    activeClientKey: ACTIVE_CLIENT_STORAGE_KEY,
    activeProfileKey: ACTIVE_BUSINESS_PROFILE_STORAGE_KEY,
    activeClient: {
      fullName: client.fullName,
      email: client.email,
      role: client.role || 'CLIENTE',
      plan: client.plan || 'GRATUITO'
    }
  });

  return context;
};

const waitForBusinessProfileCreateResponse = async function (page) {
  return page.waitForResponse(function (response) {
    const request = response.request();

    if (request.method() !== 'POST') {
      return false;
    }

    try {
      return new URL(response.url()).pathname === '/api/business-profiles';
    } catch (error) {
      return false;
    }
  });
};

const verifyReusableCards = async function (page, expectedCount) {
  await page.goto(BASE_URL + '/business-profile.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-profile-setup]');
  await page.waitForSelector('[data-reusable-profile-base]');
  await wait(1200);

  const cards = page.locator('[data-reusable-profile-base]');
  const count = await cards.count();
  expect(count === expectedCount, 'Se esperaban ' + expectedCount + ' tarjetas reutilizables y se encontraron ' + count + '.');

  const labels = await cards.evaluateAll(function (nodes) {
    return nodes.map(function (node) {
      return String(node.textContent || '').trim();
    });
  });

  return labels;
};

const createProfileFromReusableCard = async function (page, cardTitle, expectedFieldText) {
  await page.goto(BASE_URL + '/business-profile.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-profile-setup]');
  await page.waitForSelector('[data-reusable-profile-base]');
  await wait(1200);

  const card = page.locator('[data-reusable-profile-base]').filter({ hasText: cardTitle }).first();
  await card.click();
  await wait(250);

  expect((await card.getAttribute('aria-pressed')) === 'true', 'La tarjeta reutilizable ' + cardTitle + ' no quedó seleccionada.');
  expect(await page.locator('#profileContinueButton').isDisabled() === false, 'El botón continuar debería habilitarse al reutilizar ' + cardTitle + '.');

  const createResponsePromise = waitForBusinessProfileCreateResponse(page);
  await page.locator('#profileContinueButton').click();
  const createResponse = await createResponsePromise;
  const body = await createResponse.json().catch(async function () {
    return asJson(createResponse);
  });

  expect(createResponse.status() === 201, 'La creación reutilizando ' + cardTitle + ' no devolvió 201. Respuesta: ' + JSON.stringify(body));
  await page.waitForURL(/business-profile-details\.html\?profileId=/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  expect(String(await page.locator('body').textContent() || '').includes(expectedFieldText), 'La vista de detalle reutilizada no mostró los datos esperados para ' + cardTitle + '.');

  return body.profile;
};

const main = async function () {
  ensureDirectory(SCREENSHOT_DIR);
  await connectMongo();

  logStep('registering accounts');
  const registeredAccountA = await registerAccount(accountA);
  const registeredAccountB = await registerAccount(accountB);

  logStep('creating reusable seed profiles');
  const naturalBaseProfile = await createNaturalProfileViaApi(accountA.email, naturalSeed);
  const legalBaseProfile = await createLegalProfileViaApi(accountA.email, legalSeed);

  await uploadProfileDocumentViaApi(accountA.email, naturalBaseProfile.id, 'CEDULA_FRONT', 'cedula-frente-base-' + sanitizeLabel(RUN_ID) + '.png');
  await uploadProfileDocumentViaApi(accountA.email, naturalBaseProfile.id, 'CEDULA_BACK', 'cedula-reverso-base-' + sanitizeLabel(RUN_ID) + '.png');
  await uploadProfileDocumentViaApi(accountA.email, legalBaseProfile.id, 'RUT', 'rut-base-' + sanitizeLabel(RUN_ID) + '.png');
  await completeBusinessProfileSetupViaApi(accountA.email, naturalBaseProfile.id, 'natural-base');
  await completeBusinessProfileSetupViaApi(accountA.email, legalBaseProfile.id, 'legal-base');
  await forceReusableSourceReady(naturalBaseProfile.id, 'NATURAL');
  await forceReusableSourceReady(legalBaseProfile.id, 'LEGAL');

  const browser = await chromium.launch({ headless: true });

  try {
    const contextA = await createAuthedContext(browser, registeredAccountA);
    const pageA = await contextA.newPage();

    try {
      logStep('verifying reusable cards for account A');
      results.reusableUi.initialCards = await verifyReusableCards(pageA, 2);
      results.screenshots.accountAReusableCardsInitial = await takeShot(pageA, 'account-a-reusable-cards-initial');

      logStep('creating natural profile from reusable card');
      const reusedNaturalProfile = await createProfileFromReusableCard(pageA, 'Persona Natural', naturalSeed.fullName);
      const completedNaturalReuse = await completeReusableProfileViaApi(accountA.email, reusedNaturalProfile, 'natural');
      results.reusableUi.reusedNaturalProfileId = completedNaturalReuse.id;
      await pageA.reload({ waitUntil: 'networkidle' });
      results.screenshots.accountANaturalReusedDetail = await takeShot(pageA, 'account-a-natural-reused-detail');

      logStep('creating legal profile from reusable card');
      const reusedLegalProfile = await createProfileFromReusableCard(pageA, 'Persona Jurídica', legalSeed.companyName);
      const completedLegalReuse = await completeReusableProfileViaApi(accountA.email, reusedLegalProfile, 'legal');
      results.reusableUi.reusedLegalProfileId = completedLegalReuse.id;
      await pageA.reload({ waitUntil: 'networkidle' });
      results.screenshots.accountALegalReusedDetail = await takeShot(pageA, 'account-a-legal-reused-detail');

      logStep('rechecking deduplicated reusable cards after duplicates were created');
      results.reusableUi.cardsAfterReuse = await verifyReusableCards(pageA, 2);
      results.screenshots.accountAReusableCardsAfter = await takeShot(pageA, 'account-a-reusable-cards-after');
    } finally {
      await safeClose(contextA);
    }

    const contextB = await createAuthedContext(browser, registeredAccountB);
    const pageB = await contextB.newPage();

    try {
      logStep('verifying no reusable cards leak into account B');
      await pageB.goto(BASE_URL + '/business-profile.html', { waitUntil: 'networkidle' });
      await pageB.waitForSelector('[data-profile-setup]');
      await wait(1200);
      const cardsCountB = await pageB.locator('[data-reusable-profile-base]').count();
      expect(cardsCountB === 0, 'La cuenta B no debería ver tarjetas reutilizables de otra cuenta y vio ' + cardsCountB + '.');
      results.screenshots.accountBNoReusableCards = await takeShot(pageB, 'account-b-no-reusable-cards');
    } finally {
      await safeClose(contextB);
    }
  } finally {
    await safeClose(browser);
  }

  const clientA = await Client.findOne({ email: accountA.email.toLowerCase() });
  const clientB = await Client.findOne({ email: accountB.email.toLowerCase() });
  const profilesA = await BusinessProfile.find({ ownerClientId: clientA._id }).sort({ createdAt: 1 });
  const profilesB = await BusinessProfile.find({ ownerClientId: clientB._id }).sort({ createdAt: 1 });
  const naturalProfilesA = profilesA.filter(function (profile) { return String(profile.profileType) === 'NATURAL'; });
  const legalProfilesA = profilesA.filter(function (profile) { return String(profile.profileType) === 'LEGAL'; });
  const repeatedNaturalProfiles = naturalProfilesA.filter(function (profile) {
    return String(profile.naturalPerson && profile.naturalPerson.documentNumberNormalized || '') === normalizeIdentityDocumentNumber(IDENTIFIER_BASE);
  });
  const repeatedLegalProfiles = legalProfilesA.filter(function (profile) {
    return String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '') === normalizeTaxIdentifier(IDENTIFIER_BASE);
  });
  const naturalCloneDocuments = await ProfileDocument.find({ businessProfileId: results.reusableUi.reusedNaturalProfileId, activeVersion: true }).sort({ createdAt: 1 });
  const legalCloneDocuments = await ProfileDocument.find({ businessProfileId: results.reusableUi.reusedLegalProfileId, activeVersion: true }).sort({ createdAt: 1 });
  const naturalBaseDocuments = await ProfileDocument.find({ businessProfileId: naturalBaseProfile.id, activeVersion: true }).sort({ createdAt: 1 });
  const legalBaseDocuments = await ProfileDocument.find({ businessProfileId: legalBaseProfile.id, activeVersion: true }).sort({ createdAt: 1 });
  const naturalOwnership = await IdentityDocumentOwnership.findOne({ identifierType: 'NATURAL_DOCUMENT', normalizedValue: normalizeIdentityDocumentNumber(IDENTIFIER_BASE) });
  const legalOwnership = await IdentityDocumentOwnership.findOne({ identifierType: 'LEGAL_TAX_ID', normalizedValue: normalizeTaxIdentifier(IDENTIFIER_BASE) });

  expect(profilesA.length === 4, 'La cuenta A debería terminar con 4 perfiles y quedó con ' + profilesA.length + '.');
  expect(repeatedNaturalProfiles.length === 2, 'La cuenta A debería tener 2 perfiles naturales con la misma cédula y tiene ' + repeatedNaturalProfiles.length + '.');
  expect(repeatedLegalProfiles.length === 2, 'La cuenta A debería tener 2 perfiles jurídicos con el mismo NIT y tiene ' + repeatedLegalProfiles.length + '.');
  expect(profilesB.length === 0, 'La cuenta B no debería tener perfiles creados.');
  expect(naturalCloneDocuments.length === 2, 'El perfil natural reutilizado debería tener 2 documentos clonados.');
  expect(legalCloneDocuments.length === 1, 'El perfil jurídico reutilizado debería tener 1 documento clonado.');
  expect(naturalCloneDocuments[0] && naturalBaseDocuments[0] && String(naturalCloneDocuments[0]._id) !== String(naturalBaseDocuments[0]._id), 'Los documentos naturales reutilizados no se clonaron en nuevos registros.');
  expect(legalCloneDocuments[0] && legalBaseDocuments[0] && String(legalCloneDocuments[0]._id) !== String(legalBaseDocuments[0]._id), 'Los documentos jurídicos reutilizados no se clonaron en nuevos registros.');
  expect(naturalCloneDocuments[0] && naturalBaseDocuments[0] && String(naturalCloneDocuments[0].storageKey || '') === String(naturalBaseDocuments[0].storageKey || ''), 'La reutilización natural no reaprovechó el archivo documental existente.');
  expect(legalCloneDocuments[0] && legalBaseDocuments[0] && String(legalCloneDocuments[0].storageKey || '') === String(legalBaseDocuments[0].storageKey || ''), 'La reutilización jurídica no reaprovechó el archivo documental existente.');
  expect(naturalOwnership && String(naturalOwnership.ownerClientId) === String(clientA._id), 'El ownership natural no quedó asociado a la cuenta A.');
  expect(legalOwnership && String(legalOwnership.ownerClientId) === String(clientA._id), 'El ownership legal no quedó asociado a la cuenta A.');

  results.mongoChecks = {
    accountATotalProfiles: profilesA.length,
    accountBTotalProfiles: profilesB.length,
    repeatedNaturalProfiles: repeatedNaturalProfiles.length,
    repeatedLegalProfiles: repeatedLegalProfiles.length,
    naturalCloneDocumentIds: naturalCloneDocuments.map(function (document) { return String(document._id); }),
    legalCloneDocumentIds: legalCloneDocuments.map(function (document) { return String(document._id); }),
    naturalBaseStorageKeys: naturalBaseDocuments.map(function (document) { return String(document.storageKey || ''); }),
    naturalCloneStorageKeys: naturalCloneDocuments.map(function (document) { return String(document.storageKey || ''); }),
    legalBaseStorageKeys: legalBaseDocuments.map(function (document) { return String(document.storageKey || ''); }),
    legalCloneStorageKeys: legalCloneDocuments.map(function (document) { return String(document.storageKey || ''); }),
    naturalOwnershipOwnerClientId: String(naturalOwnership.ownerClientId),
    legalOwnershipOwnerClientId: String(legalOwnership.ownerClientId)
  };

  console.log(JSON.stringify({ ok: true, results }, null, 2));
  await mongoose.disconnect();
};

main().catch(async function (error) {
  console.error(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error), results }, null, 2));

  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    return;
  }

  process.exit(1);
});
