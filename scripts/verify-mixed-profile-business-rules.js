require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const Client = require('../models/Client');
const { BusinessProfile, normalizeIdentityDocumentNumber, normalizeTaxIdentifier } = require('../models/BusinessProfile');
const { IdentityDocumentOwnership } = require('../models/IdentityDocumentOwnership');

const ACTIVE_CLIENT_STORAGE_KEY = 'livenActiveClient';
const ACTIVE_BUSINESS_PROFILE_STORAGE_KEY = 'livenActiveBusinessProfileId';
const BASE_URL = String(process.env.LOCAL_UI_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const RUN_ID = String(Date.now());
const SCREENSHOT_DIR = path.join(process.cwd(), 'tmp', 'ui-mixed-business-rule-verification', RUN_ID);
const EXPECTED_LIMIT_MESSAGE = 'Tu cuenta ya alcanzó el máximo de 5 perfiles en total. No puedes crear más perfiles en esta cuenta.';
const EXPECTED_NATURAL_CROSS_ACCOUNT_MESSAGE = 'Esta cédula ya está asociada a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.';
const EXPECTED_LEGAL_CROSS_ACCOUNT_MESSAGE = 'Este NIT ya está asociado a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.';
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO1m5+0AAAAASUVORK5CYII=',
  'base64'
);

const IDENTIFIER_BASE = String(Number(RUN_ID.slice(-9)) || 880000001);
const SECOND_NATURAL_DOCUMENT = String(Number(IDENTIFIER_BASE) + 1);
const SIXTH_IDENTIFIER = String(Number(IDENTIFIER_BASE) + 2);

const accountA = {
  fullName: 'QA Mixto Cuenta A ' + RUN_ID,
  email: 'qa.mixed.a.' + RUN_ID + '@live.local',
  phone: '+57 322 100 ' + RUN_ID.slice(-4),
  password: 'Cliente123!',
  plan: 'GRATUITO'
};

const accountB = {
  fullName: 'QA Mixto Cuenta B ' + RUN_ID,
  email: 'qa.mixed.b.' + RUN_ID + '@live.local',
  phone: '+57 322 200 ' + RUN_ID.slice(-4),
  password: 'Cliente123!',
  plan: 'GRATUITO'
};

const accountAProfiles = [
  {
    label: 'natural-1',
    profileType: 'NATURAL',
    fullName: 'QA Mixto Natural Uno ' + RUN_ID,
    documentNumber: IDENTIFIER_BASE.slice(0, 2) + '.' + IDENTIFIER_BASE.slice(2, 5) + '.' + IDENTIFIER_BASE.slice(5),
    expeditionDate: '2020-03-10'
  },
  {
    label: 'natural-2',
    profileType: 'NATURAL',
    fullName: 'QA Mixto Natural Dos ' + RUN_ID,
    documentNumber: IDENTIFIER_BASE,
    expeditionDate: '2020-03-11'
  },
  {
    label: 'legal-1',
    profileType: 'LEGAL',
    companyName: 'QA Mixto Legal Uno ' + RUN_ID,
    taxId: IDENTIFIER_BASE.slice(0, 3) + '.' + IDENTIFIER_BASE.slice(3, 6) + '.' + IDENTIFIER_BASE.slice(6),
    verificationDigit: '4',
    legalRepresentative: 'Representante Mixto Uno ' + RUN_ID
  },
  {
    label: 'legal-2',
    profileType: 'LEGAL',
    companyName: 'QA Mixto Legal Dos ' + RUN_ID,
    taxId: IDENTIFIER_BASE,
    verificationDigit: '4',
    legalRepresentative: 'Representante Mixto Dos ' + RUN_ID
  },
  {
    label: 'natural-3',
    profileType: 'NATURAL',
    fullName: 'QA Mixto Natural Tres ' + RUN_ID,
    documentNumber: SECOND_NATURAL_DOCUMENT,
    expeditionDate: '2020-03-12'
  }
];

const blockedSixthProfile = {
  label: 'legal-6-bloqueado',
  profileType: 'LEGAL',
  companyName: 'QA Mixto Legal Seis ' + RUN_ID,
  taxId: SIXTH_IDENTIFIER,
  verificationDigit: '5',
  legalRepresentative: 'Representante Mixto Seis ' + RUN_ID
};

const crossAccountBlockedNaturalProfile = {
  label: 'cuenta-b-cedula-duplicada',
  profileType: 'NATURAL',
  fullName: 'QA Mixto Natural Bloqueado ' + RUN_ID,
  documentNumber: IDENTIFIER_BASE.slice(0, 2) + ' ' + IDENTIFIER_BASE.slice(2, 5) + ' ' + IDENTIFIER_BASE.slice(5),
  expeditionDate: '2020-03-20'
};

const crossAccountBlockedLegalProfile = {
  label: 'cuenta-b-nit-duplicado',
  profileType: 'LEGAL',
  companyName: 'QA Mixto Legal Bloqueado ' + RUN_ID,
  taxId: IDENTIFIER_BASE.slice(0, 3) + ' ' + IDENTIFIER_BASE.slice(3, 6) + ' ' + IDENTIFIER_BASE.slice(6),
  verificationDigit: '4',
  legalRepresentative: 'Representante Mixto Bloqueado ' + RUN_ID
};

const results = {
  runId: RUN_ID,
  baseUrl: BASE_URL,
  accounts: {
    accountA: { email: accountA.email },
    accountB: { email: accountB.email }
  },
  creations: [],
  mongoChecks: {},
  uiChecks: {},
  screenshots: {}
};

const expect = function (condition, message) {
  if (!condition) {
    throw new Error(message);
  }
};

const logStep = function (message) {
  process.stdout.write('[verify-mixed-rules] ' + String(message || '') + '\n');
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
    body: JSON.stringify({
      fullName: account.fullName,
      email: account.email,
      phone: account.phone,
      password: account.password
    })
  });
  const result = await asJson(response);

  expect(response.status === 201, 'No se pudo registrar la cuenta ' + account.email + '. Respuesta: ' + JSON.stringify(result));
  return result.user;
};

const createProfileViaApi = async function (account, profileData) {
  const body = {
    clientEmail: account.email,
    profileType: profileData.profileType
  };

  if (profileData.profileType === 'LEGAL') {
    body.companyName = profileData.companyName;
    body.taxId = profileData.taxId;
    body.verificationDigit = profileData.verificationDigit;
    body.legalRepresentative = profileData.legalRepresentative;
  } else {
    body.fullName = profileData.fullName;
    body.documentTypeExpected = 'CO_CEDULA_CIUDADANIA';
    body.documentNumber = profileData.documentNumber;
    body.expeditionDate = profileData.expeditionDate;
  }

  const response = await fetch(BASE_URL + '/api/business-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await asJson(response);

  expect(response.status === 201, 'La API no creó ' + profileData.label + '. Respuesta: ' + JSON.stringify(result));
  expect(result && result.profile && result.profile.id, 'La API no devolvió el perfil esperado para ' + profileData.label + '.');

  return result.profile;
};

const completeBusinessProfileSetupViaApi = async function (account, createdProfile, profileData) {
  const response = await fetch(BASE_URL + '/api/business-profiles/' + encodeURIComponent(createdProfile.id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: account.email,
      businessName: 'Negocio ' + profileData.label + ' ' + RUN_ID,
      businessUsername: 'qa-mixto-' + sanitizeLabel(profileData.label) + '-' + RUN_ID,
      businessCity: 'Barranquilla',
      categories: ['Sociales']
    })
  });
  const result = await asJson(response);

  expect(response.status === 200, 'La API no completó la configuración del perfil ' + profileData.label + '. Respuesta: ' + JSON.stringify(result));
  expect(result && result.profile && result.profile.businessSetupCompleted === true, 'El perfil ' + profileData.label + ' no quedó marcado como completado.');

  return result.profile;
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

const expectContinueEnabled = async function (page) {
  const button = page.locator('#profileContinueButton');
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 8000) {
    if (!(await button.isDisabled())) {
      return;
    }

    await wait(100);
  }

  throw new Error('El botón de continuar no se habilitó después de completar el formulario.');
};

const fillNaturalProfileSetup = async function (page, profileData) {
  await page.goto(BASE_URL + '/business-profile.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-profile-setup]');
  await page.fill('input[name="fullName"]', profileData.fullName);
  await page.selectOption('select[name="documentType"]', 'cc');
  await page.fill('input[name="documentNumber"]', profileData.documentNumber);
  await page.fill('input[name="expeditionDate"]', profileData.expeditionDate);

  const fileInputs = page.locator('[data-setup-documents="natural"] .document-file-input');
  expect(await fileInputs.count() === 2, 'No se encontraron los dos inputs documentales del flujo natural.');

  await fileInputs.nth(0).setInputFiles({
    name: 'cedula-frente-' + sanitizeLabel(profileData.label) + '.png',
    mimeType: 'image/png',
    buffer: ONE_BY_ONE_PNG
  });

  await fileInputs.nth(1).setInputFiles({
    name: 'cedula-reverso-' + sanitizeLabel(profileData.label) + '.png',
    mimeType: 'image/png',
    buffer: ONE_BY_ONE_PNG
  });

  await expectContinueEnabled(page);
};

const fillLegalProfileSetup = async function (page, profileData) {
  await page.goto(BASE_URL + '/business-profile.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-profile-setup]');
  await page.locator('[data-profile-panel="juridica"]').click();
  await page.fill('input[name="companyName"]', profileData.companyName);
  await page.fill('input[name="taxId"]', profileData.taxId);
  await page.fill('input[name="verificationDigit"]', profileData.verificationDigit);
  await page.fill('input[name="legalRepresentative"]', profileData.legalRepresentative);

  const fileInput = page.locator('[data-setup-documents="legal"] .document-file-input').nth(0);
  await fileInput.setInputFiles({
    name: 'comprobante-nit-' + sanitizeLabel(profileData.label) + '.png',
    mimeType: 'image/png',
    buffer: ONE_BY_ONE_PNG
  });

  await expectContinueEnabled(page);
};

const waitForBusinessProfileCreateResponse = async function (page) {
  return page.waitForResponse(function (response) {
    const request = response.request();

    if (request.method() !== 'POST') {
      return false;
    }

    try {
      const url = new URL(response.url());
      return url.pathname === '/api/business-profiles';
    } catch (error) {
      return false;
    }
  });
};

const expectBlockedProfileThroughUi = async function (page, profileData, expectedMessage) {
  if (profileData.profileType === 'LEGAL') {
    await fillLegalProfileSetup(page, profileData);
  } else {
    await fillNaturalProfileSetup(page, profileData);
  }

  const createResponsePromise = waitForBusinessProfileCreateResponse(page);
  await page.locator('#profileContinueButton').click();
  const createResponse = await createResponsePromise;
  const status = createResponse.status();
  const body = await createResponse.json().catch(async function () {
    return asJson(createResponse);
  });

  expect(status === 409, 'La creación bloqueada de ' + profileData.label + ' debía responder 409. Respuesta: ' + JSON.stringify(body));

  await page.locator('#profileSetupFeedbackModal').waitFor({ state: 'visible', timeout: 10000 });
  const title = String(await page.locator('#profileSetupFeedbackTitle').textContent() || '').trim();
  const message = String(await page.locator('#profileSetupFeedbackMessage').textContent() || '').trim();

  expect(title === 'No pudimos avanzar con el perfil', 'El modal de error no mostró el título esperado.');
  expect(message === expectedMessage, 'El modal de error no mostró el mensaje esperado. Valor: ' + message);

  return {
    status,
    body,
    title,
    message,
    urlAfterAttempt: page.url()
  };
};

const connectMongo = async function () {
  expect(MONGODB_URI, 'MONGODB_URI no está configurada para esta verificación.');

  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(MONGODB_URI);
};

const getClientByEmail = async function (email) {
  return Client.findOne({ email: String(email || '').trim().toLowerCase() });
};

const getProfilesForClient = async function (clientId) {
  return BusinessProfile.find({ ownerClientId: clientId }).sort({ createdAt: 1 });
};

const getOwnership = async function (identifierType, normalizedValue) {
  return IdentityDocumentOwnership.findOne({
    identifierType,
    normalizedValue
  });
};

const verifyDashboardForAccountA = async function (browser, client, expectedProfiles) {
  const context = await createAuthedContext(browser, client);
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL + '/dashboard.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-global-profile-dropdown] .profile-trigger');
    await wait(1200);

    const triggerTextBeforeRefresh = String(await page.locator('[data-global-profile-dropdown] .profile-trigger').textContent() || '').trim();
    await page.locator('[data-global-profile-dropdown] .profile-trigger').click();
    await page.waitForSelector('[data-profile-switch-option]');
    const optionCountBeforeRefresh = await page.locator('[data-profile-switch-option]').count();
    results.screenshots.accountADashboardBeforeRefresh = await takeShot(page, 'account-a-dashboard-before-refresh');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-global-profile-dropdown] .profile-trigger');
    await wait(1200);

    const triggerTextAfterRefresh = String(await page.locator('[data-global-profile-dropdown] .profile-trigger').textContent() || '').trim();
    await page.locator('[data-global-profile-dropdown] .profile-trigger').click();
    await page.waitForSelector('[data-profile-switch-option]');
    const optionCountAfterRefresh = await page.locator('[data-profile-switch-option]').count();
    results.screenshots.accountADashboardAfterRefresh = await takeShot(page, 'account-a-dashboard-after-refresh');

    expect(optionCountBeforeRefresh === expectedProfiles, 'El dashboard de la cuenta A mostró ' + optionCountBeforeRefresh + ' perfiles antes del refresh en vez de ' + expectedProfiles + '.');
    expect(optionCountAfterRefresh === expectedProfiles, 'El dashboard de la cuenta A mostró ' + optionCountAfterRefresh + ' perfiles después del refresh en vez de ' + expectedProfiles + '.');

    return {
      triggerTextBeforeRefresh,
      triggerTextAfterRefresh,
      optionCountBeforeRefresh,
      optionCountAfterRefresh
    };
  } finally {
    await safeClose(context);
  }
};

const verifyDashboardForAccountB = async function (browser, client) {
  const context = await createAuthedContext(browser, client);
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL + '/dashboard.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-global-profile-dropdown] .profile-trigger');
    await wait(1200);

    const triggerTextBeforeRefresh = String(await page.locator('[data-global-profile-dropdown] .profile-trigger').textContent() || '').trim();
    results.screenshots.accountBDashboardBeforeRefresh = await takeShot(page, 'account-b-dashboard-before-refresh');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-global-profile-dropdown] .profile-trigger');
    await wait(1200);

    const triggerTextAfterRefresh = String(await page.locator('[data-global-profile-dropdown] .profile-trigger').textContent() || '').trim();
    results.screenshots.accountBDashboardAfterRefresh = await takeShot(page, 'account-b-dashboard-after-refresh');

    expect(triggerTextAfterRefresh.includes('Crear perfil'), 'La cuenta B debería seguir sin perfiles después de los intentos bloqueados.');

    return {
      triggerTextBeforeRefresh,
      triggerTextAfterRefresh
    };
  } finally {
    await safeClose(context);
  }
};

const main = async function () {
  ensureDirectory(SCREENSHOT_DIR);
  await connectMongo();

  logStep('registering test accounts');
  const registeredAccountA = await registerAccount(accountA);
  const registeredAccountB = await registerAccount(accountB);
  results.accounts.accountA.id = registeredAccountA.id;
  results.accounts.accountB.id = registeredAccountB.id;

  logStep('creating mixed profiles in account A');
  for (const profileData of accountAProfiles) {
    const createdProfile = await createProfileViaApi(registeredAccountA, profileData);
    const completedProfile = await completeBusinessProfileSetupViaApi(registeredAccountA, createdProfile, profileData);
    results.creations.push({
      label: profileData.label,
      profileType: profileData.profileType,
      identifier: profileData.profileType === 'LEGAL' ? normalizeTaxIdentifier(profileData.taxId) : normalizeIdentityDocumentNumber(profileData.documentNumber),
      profileId: String(completedProfile.id)
    });
  }

  const clientA = await getClientByEmail(accountA.email);
  const clientB = await getClientByEmail(accountB.email);
  expect(clientA, 'No se encontró la cuenta A en Mongo.');
  expect(clientB, 'No se encontró la cuenta B en Mongo.');

  const profilesA = await getProfilesForClient(clientA._id);
  const naturalProfilesA = profilesA.filter(function (profile) {
    return String(profile.profileType || '') === 'NATURAL';
  });
  const legalProfilesA = profilesA.filter(function (profile) {
    return String(profile.profileType || '') === 'LEGAL';
  });
  const repeatedNaturalProfiles = naturalProfilesA.filter(function (profile) {
    return String(profile.naturalPerson && profile.naturalPerson.documentNumberNormalized || '') === normalizeIdentityDocumentNumber(IDENTIFIER_BASE);
  });
  const repeatedLegalProfiles = legalProfilesA.filter(function (profile) {
    return String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '') === normalizeTaxIdentifier(IDENTIFIER_BASE);
  });
  const sameNumericNaturalAndLegal = naturalProfilesA.some(function (profile) {
    return String(profile.naturalPerson && profile.naturalPerson.documentNumberNormalized || '') === IDENTIFIER_BASE;
  }) && legalProfilesA.some(function (profile) {
    return String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '') === IDENTIFIER_BASE;
  });
  const naturalOwnership = await getOwnership('NATURAL_DOCUMENT', normalizeIdentityDocumentNumber(IDENTIFIER_BASE));
  const legalOwnership = await getOwnership('LEGAL_TAX_ID', normalizeTaxIdentifier(IDENTIFIER_BASE));

  expect(profilesA.length === 5, 'La cuenta A debería tener 5 perfiles en total y tiene ' + profilesA.length + '.');
  expect(naturalProfilesA.length === 3, 'La cuenta A debería tener 3 perfiles naturales y tiene ' + naturalProfilesA.length + '.');
  expect(legalProfilesA.length === 2, 'La cuenta A debería tener 2 perfiles jurídicos y tiene ' + legalProfilesA.length + '.');
  expect(repeatedNaturalProfiles.length === 2, 'La cuenta A debería permitir 2 perfiles con la misma cédula y tiene ' + repeatedNaturalProfiles.length + '.');
  expect(repeatedLegalProfiles.length === 2, 'La cuenta A debería permitir 2 perfiles con el mismo NIT y tiene ' + repeatedLegalProfiles.length + '.');
  expect(sameNumericNaturalAndLegal, 'No se preservó la coexistencia del mismo valor numérico entre cédula y NIT dentro de la misma cuenta.');
  expect(naturalOwnership && String(naturalOwnership.ownerClientId) === String(clientA._id), 'El ownership de la cédula repetida no quedó asociado a la cuenta A.');
  expect(legalOwnership && String(legalOwnership.ownerClientId) === String(clientA._id), 'El ownership del NIT repetido no quedó asociado a la cuenta A.');

  results.mongoChecks.accountAAfterMixedCreation = {
    totalProfiles: profilesA.length,
    naturalProfiles: naturalProfilesA.length,
    legalProfiles: legalProfilesA.length,
    repeatedNaturalProfiles: repeatedNaturalProfiles.length,
    repeatedLegalProfiles: repeatedLegalProfiles.length,
    sameNumericNaturalAndLegal,
    naturalOwnershipOwnerClientId: String(naturalOwnership.ownerClientId),
    legalOwnershipOwnerClientId: String(legalOwnership.ownerClientId)
  };

  const browser = await chromium.launch({ headless: true });

  try {
    const contextA = await createAuthedContext(browser, registeredAccountA);
    const pageA = await contextA.newPage();

    try {
      logStep('attempting sixth mixed profile in account A');
      results.uiChecks.limitAttempt = await expectBlockedProfileThroughUi(pageA, blockedSixthProfile, EXPECTED_LIMIT_MESSAGE);
      results.screenshots.accountALimitBlocked = await takeShot(pageA, 'account-a-mixed-limit-blocked');
    } finally {
      await safeClose(contextA);
    }

    const contextB = await createAuthedContext(browser, registeredAccountB);
    const pageB = await contextB.newPage();

    try {
      logStep('attempting duplicated cedula from account B');
      results.uiChecks.crossAccountNaturalAttempt = await expectBlockedProfileThroughUi(pageB, crossAccountBlockedNaturalProfile, EXPECTED_NATURAL_CROSS_ACCOUNT_MESSAGE);
      results.screenshots.accountBCrossAccountNaturalBlocked = await takeShot(pageB, 'account-b-natural-cross-account-blocked');

      logStep('attempting duplicated nit from account B');
      results.uiChecks.crossAccountLegalAttempt = await expectBlockedProfileThroughUi(pageB, crossAccountBlockedLegalProfile, EXPECTED_LEGAL_CROSS_ACCOUNT_MESSAGE);
      results.screenshots.accountBCrossAccountLegalBlocked = await takeShot(pageB, 'account-b-legal-cross-account-blocked');
    } finally {
      await safeClose(contextB);
    }

    logStep('verifying dashboard consistency after refresh');
    results.uiChecks.accountARefresh = await verifyDashboardForAccountA(browser, registeredAccountA, 5);
    results.uiChecks.accountBRefresh = await verifyDashboardForAccountB(browser, registeredAccountB);
  } finally {
    await safeClose(browser);
  }

  const profilesAAfterBlocked = await getProfilesForClient(clientA._id);
  const profilesBAfterBlocked = await getProfilesForClient(clientB._id);
  const sixthProfileExists = profilesAAfterBlocked.some(function (profile) {
    return String(profile.profileType || '') === 'LEGAL'
      && String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '') === normalizeTaxIdentifier(blockedSixthProfile.taxId);
  });
  const blockedNaturalExistsInB = profilesBAfterBlocked.some(function (profile) {
    return String(profile.profileType || '') === 'NATURAL'
      && String(profile.naturalPerson && profile.naturalPerson.documentNumberNormalized || '') === normalizeIdentityDocumentNumber(crossAccountBlockedNaturalProfile.documentNumber);
  });
  const blockedLegalExistsInB = profilesBAfterBlocked.some(function (profile) {
    return String(profile.profileType || '') === 'LEGAL'
      && String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '') === normalizeTaxIdentifier(crossAccountBlockedLegalProfile.taxId);
  });

  expect(profilesAAfterBlocked.length === 5, 'La cuenta A no debería superar el total de 5 perfiles después del intento bloqueado.');
  expect(!sixthProfileExists, 'El sexto perfil mixto fue persistido por error.');
  expect(profilesBAfterBlocked.length === 0, 'La cuenta B no debería tener perfiles después de los intentos bloqueados.');
  expect(!blockedNaturalExistsInB, 'La cuenta B recibió por error un perfil con la cédula bloqueada.');
  expect(!blockedLegalExistsInB, 'La cuenta B recibió por error un perfil con el NIT bloqueado.');

  results.mongoChecks.afterBlockedAttempts = {
    accountATotalProfiles: profilesAAfterBlocked.length,
    sixthProfileCreated: sixthProfileExists,
    accountBTotalProfiles: profilesBAfterBlocked.length,
    blockedNaturalCreatedInB: blockedNaturalExistsInB,
    blockedLegalCreatedInB: blockedLegalExistsInB
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