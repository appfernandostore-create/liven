require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const Client = require('../models/Client');
const { BusinessProfile, normalizeTaxIdentifier } = require('../models/BusinessProfile');
const { IdentityDocumentOwnership } = require('../models/IdentityDocumentOwnership');
const { ProfileDocument } = require('../models/ProfileDocument');
const { VerificationCase } = require('../models/VerificationCase');

const ACTIVE_CLIENT_STORAGE_KEY = 'livenActiveClient';
const ACTIVE_BUSINESS_PROFILE_STORAGE_KEY = 'livenActiveBusinessProfileId';
const BASE_URL = String(process.env.LOCAL_UI_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const RUN_ID = String(Date.now());
const SCREENSHOT_DIR = path.join(process.cwd(), 'tmp', 'ui-legal-business-rule-verification', RUN_ID);
const EXPECTED_LIMIT_MESSAGE = 'Tu cuenta ya alcanzó el máximo de 5 perfiles en total. No puedes crear más perfiles en esta cuenta.';
const EXPECTED_CROSS_ACCOUNT_MESSAGE = 'Este NIT ya está asociado a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.';
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO1m5+0AAAAASUVORK5CYII=',
  'base64'
);
const NIT_BASE = String(Number(RUN_ID.slice(-9)) || 870000001);
const SHARED_NIT = NIT_BASE;
const THIRD_NIT = String(Number(NIT_BASE) + 1);
const FOURTH_NIT = String(Number(NIT_BASE) + 2);
const FIFTH_NIT = String(Number(NIT_BASE) + 3);
const SIXTH_NIT = String(Number(NIT_BASE) + 4);

const accountA = {
  fullName: 'QA Legal Cuenta A ' + RUN_ID,
  email: 'qa.legal.a.' + RUN_ID + '@live.local',
  phone: '+57 321 100 ' + RUN_ID.slice(-4),
  password: 'Cliente123!',
  plan: 'GRATUITO'
};

const accountB = {
  fullName: 'QA Legal Cuenta B ' + RUN_ID,
  email: 'qa.legal.b.' + RUN_ID + '@live.local',
  phone: '+57 321 200 ' + RUN_ID.slice(-4),
  password: 'Cliente123!',
  plan: 'GRATUITO'
};

const legalProfilesForAccountA = [
  { label: 'perfil-1', companyName: 'QA Legal Uno ' + RUN_ID, taxId: SHARED_NIT.slice(0, 3) + '.' + SHARED_NIT.slice(3, 6) + '.' + SHARED_NIT.slice(6), verificationDigit: '4', legalRepresentative: 'Representante Uno ' + RUN_ID },
  { label: 'perfil-2', companyName: 'QA Legal Dos ' + RUN_ID, taxId: SHARED_NIT, verificationDigit: '4', legalRepresentative: 'Representante Dos ' + RUN_ID },
  { label: 'perfil-3', companyName: 'QA Legal Tres ' + RUN_ID, taxId: THIRD_NIT, verificationDigit: '5', legalRepresentative: 'Representante Tres ' + RUN_ID },
  { label: 'perfil-4', companyName: 'QA Legal Cuatro ' + RUN_ID, taxId: FOURTH_NIT, verificationDigit: '6', legalRepresentative: 'Representante Cuatro ' + RUN_ID },
  { label: 'perfil-5', companyName: 'QA Legal Cinco ' + RUN_ID, taxId: FIFTH_NIT, verificationDigit: '7', legalRepresentative: 'Representante Cinco ' + RUN_ID }
];

const blockedSixthProfile = {
  label: 'perfil-6-bloqueado',
  companyName: 'QA Legal Seis ' + RUN_ID,
  taxId: SIXTH_NIT,
  verificationDigit: '8',
  legalRepresentative: 'Representante Seis ' + RUN_ID
};

const crossAccountBlockedProfile = {
  label: 'cuenta-b-nit-duplicado',
  companyName: 'QA Legal Bloqueado ' + RUN_ID,
  taxId: SHARED_NIT.slice(0, 3) + ' ' + SHARED_NIT.slice(3, 6) + ' ' + SHARED_NIT.slice(6),
  verificationDigit: '4',
  legalRepresentative: 'Representante Bloqueado ' + RUN_ID
};

const results = {
  runId: RUN_ID,
  baseUrl: BASE_URL,
  accounts: {
    accountA: { email: accountA.email },
    accountB: { email: accountB.email }
  },
  accountACreations: [],
  nitProofUpload: null,
  limitAttempt: null,
  crossAccountAttempt: null,
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
  process.stdout.write('[verify-legal-rules] ' + String(message || '') + '\n');
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

const createLegalProfileViaApi = async function (account, profileData) {
  const response = await fetch(BASE_URL + '/api/business-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: account.email,
      profileType: 'LEGAL',
      companyName: profileData.companyName,
      taxId: profileData.taxId,
      verificationDigit: profileData.verificationDigit,
      legalRepresentative: profileData.legalRepresentative
    })
  });
  const result = await asJson(response);

  expect(response.status === 201, 'La API no creó ' + profileData.label + '. Respuesta: ' + JSON.stringify(result));
  expect(result && result.profile && result.profile.id, 'La API no devolvió el perfil legal creado para ' + profileData.label + '.');

  return result.profile;
};

const completeBusinessProfileSetupViaApi = async function (account, profileId, profileData) {
  const response = await fetch(BASE_URL + '/api/business-profiles/' + encodeURIComponent(profileId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: account.email,
      businessName: 'Negocio ' + profileData.label + ' ' + RUN_ID,
      businessUsername: 'qa-legal-' + sanitizeLabel(profileData.label) + '-' + RUN_ID,
      businessCity: 'Barranquilla',
      categories: ['Sociales']
    })
  });
  const result = await asJson(response);

  expect(response.status === 200, 'La API no completó la configuración del perfil jurídico ' + profileData.label + '. Respuesta: ' + JSON.stringify(result));
  expect(result && result.profile && result.profile.businessSetupCompleted === true, 'El perfil jurídico ' + profileData.label + ' no quedó marcado como completado.');

  return result.profile;
};

const uploadNitProofViaApi = async function (accountEmail, profileId) {
  const formData = new FormData();
  formData.append('clientEmail', accountEmail);
  formData.append('documentRole', 'RUT');
  formData.append('document', new Blob([ONE_BY_ONE_PNG], { type: 'image/png' }), 'comprobante-nit-' + sanitizeLabel(RUN_ID) + '.png');

  const response = await fetch(BASE_URL + '/api/business-profiles/' + encodeURIComponent(profileId) + '/documents', {
    method: 'POST',
    body: formData
  });
  const result = await asJson(response);

  expect(response.status === 201, 'No se pudo cargar el comprobante del NIT. Respuesta: ' + JSON.stringify(result));

  return result;
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

  throw new Error('El botón de continuar no se habilitó para el flujo jurídico.');
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

const expectBlockedLegalProfileThroughUi = async function (page, profileData, expectedMessage) {
  await fillLegalProfileSetup(page, profileData);
  const createResponsePromise = waitForBusinessProfileCreateResponse(page);

  await page.locator('#profileContinueButton').click();
  const createResponse = await createResponsePromise;
  const status = createResponse.status();
  const body = await createResponse.json().catch(async function () {
    return asJson(createResponse);
  });

  expect(status === 409, 'La creación jurídica bloqueada debía responder 409. Respuesta: ' + JSON.stringify(body));

  await page.locator('#profileSetupFeedbackModal').waitFor({ state: 'visible', timeout: 10000 });
  const title = String(await page.locator('#profileSetupFeedbackTitle').textContent() || '').trim();
  const message = String(await page.locator('#profileSetupFeedbackMessage').textContent() || '').trim();

  expect(title === 'No pudimos avanzar con el perfil', 'El modal de error jurídico no mostró el título esperado.');
  expect(message === expectedMessage, 'El modal jurídico no mostró el mensaje esperado. Valor: ' + message);

  return {
    status,
    body,
    title,
    message,
    urlAfterAttempt: page.url()
  };
};

const connectMongo = async function () {
  expect(MONGODB_URI, 'MONGODB_URI no está configurada.');

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

const getOwnership = async function (taxId) {
  return IdentityDocumentOwnership.findOne({
    identifierType: 'LEGAL_TAX_ID',
    normalizedValue: normalizeTaxIdentifier(taxId)
  });
};

const verifyLegalDetailAfterRefresh = async function (browser, client, profileId, expectedProfile) {
  const context = await createAuthedContext(browser, client);
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL + '/business-profile-details.html?profileId=' + encodeURIComponent(profileId), { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-profile-status-chip]');
    await wait(1200);

    const chipBeforeRefresh = String(await page.locator('[data-profile-status-chip]').textContent() || '').trim();
    const legalInfoValuesBefore = await page.locator('[data-profile-legal-grid] .profile-legal-item-value').evaluateAll(function (nodes) {
      return nodes.map(function (node) {
        return String(node.textContent || '').trim();
      });
    });
    const documentCardTitleBefore = String(await page.locator('[data-document-card] strong').textContent() || '').trim();
    const documentCardStatusBefore = String(await page.locator('.document-status-pill').textContent() || '').trim();
    results.screenshots.legalDetailBeforeRefresh = await takeShot(page, 'legal-detail-before-refresh');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-profile-status-chip]');
    await wait(1200);

    const chipAfterRefresh = String(await page.locator('[data-profile-status-chip]').textContent() || '').trim();
    const legalInfoValuesAfter = await page.locator('[data-profile-legal-grid] .profile-legal-item-value').evaluateAll(function (nodes) {
      return nodes.map(function (node) {
        return String(node.textContent || '').trim();
      });
    });
    const documentCardTitleAfter = String(await page.locator('[data-document-card] strong').textContent() || '').trim();
    const documentCardStatusAfter = String(await page.locator('.document-status-pill').textContent() || '').trim();
    results.screenshots.legalDetailAfterRefresh = await takeShot(page, 'legal-detail-after-refresh');

    expect(chipAfterRefresh === 'Estado: En revisión', 'El detalle jurídico no quedó en estado de revisión después del refresh. Valor: ' + chipAfterRefresh);
    expect(legalInfoValuesAfter.includes(expectedProfile.companyName), 'La razón social no se mantuvo visible después del refresh.');
    expect(legalInfoValuesAfter.includes(normalizeTaxIdentifier(expectedProfile.taxId)), 'El NIT no se mantuvo visible después del refresh.');
    expect(legalInfoValuesAfter.includes(expectedProfile.verificationDigit), 'El DV no se mantuvo visible después del refresh.');
    expect(documentCardTitleAfter === 'Comprobante del NIT', 'El documento jurídico no se mostró con el título esperado después del refresh.');
    expect(documentCardStatusAfter === 'Revisión manual', 'El comprobante del NIT no se mostró en revisión manual después del refresh.');

    return {
      chipBeforeRefresh,
      chipAfterRefresh,
      documentCardTitleBefore,
      documentCardTitleAfter,
      documentCardStatusBefore,
      documentCardStatusAfter,
      legalInfoValuesBefore,
      legalInfoValuesAfter
    };
  } finally {
    await safeClose(context);
  }
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

    expect(optionCountBeforeRefresh === expectedProfiles, 'La cuenta A jurídica no mostró ' + expectedProfiles + ' perfiles antes del refresh.');
    expect(optionCountAfterRefresh === expectedProfiles, 'La cuenta A jurídica no mostró ' + expectedProfiles + ' perfiles después del refresh.');

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
    const bannerTitleBeforeRefresh = String(await page.locator('.onboarding-banner-title').textContent() || '').trim();
    results.screenshots.accountBDashboardBeforeRefresh = await takeShot(page, 'account-b-dashboard-before-refresh');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-global-profile-dropdown] .profile-trigger');
    await wait(1200);

    const triggerTextAfterRefresh = String(await page.locator('[data-global-profile-dropdown] .profile-trigger').textContent() || '').trim();
    const bannerTitleAfterRefresh = String(await page.locator('.onboarding-banner-title').textContent() || '').trim();
    results.screenshots.accountBDashboardAfterRefresh = await takeShot(page, 'account-b-dashboard-after-refresh');

    expect(triggerTextAfterRefresh.includes('Crear perfil'), 'La cuenta B jurídica no quedó vacía después del refresh.');
    expect(bannerTitleAfterRefresh === 'Aún no has creado tu primer perfil de negocio.', 'La cuenta B jurídica no mostró el banner vacío esperado.');

    return {
      triggerTextBeforeRefresh,
      triggerTextAfterRefresh,
      bannerTitleBeforeRefresh,
      bannerTitleAfterRefresh
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

  const browser = await chromium.launch({ headless: true });
  let proofUploadResult = null;

  try {
    logStep('creating five legal profiles in account A');
    for (let index = 0; index < legalProfilesForAccountA.length; index += 1) {
      const profileData = legalProfilesForAccountA[index];
      const createdProfile = await createLegalProfileViaApi(registeredAccountA, profileData);

      if (index === 0) {
        proofUploadResult = await uploadNitProofViaApi(accountA.email, createdProfile.id);
      }

      const completedProfile = await completeBusinessProfileSetupViaApi(registeredAccountA, createdProfile.id, profileData);
      results.accountACreations.push({
        label: profileData.label,
        taxId: profileData.taxId,
        normalizedTaxId: normalizeTaxIdentifier(profileData.taxId),
        profileId: String(completedProfile.id),
        responseStatus: 201
      });
    }

    const clientA = await getClientByEmail(accountA.email);
    expect(clientA, 'No se encontró la cuenta jurídica A en Mongo.');
    const profilesAfterFive = await getProfilesForClient(clientA._id);
    const duplicateProfilesSameNit = profilesAfterFive.filter(function (profile) {
      return String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '') === normalizeTaxIdentifier(legalProfilesForAccountA[0].taxId);
    });
    const ownershipForSharedNit = await getOwnership(legalProfilesForAccountA[0].taxId);

    expect(profilesAfterFive.length === 5, 'Mongo debería tener 5 perfiles jurídicos para la cuenta A y tiene ' + profilesAfterFive.length + '.');
    expect(duplicateProfilesSameNit.length === 2, 'La cuenta A jurídica debería tener 2 perfiles con el mismo NIT y tiene ' + duplicateProfilesSameNit.length + '.');
    expect(ownershipForSharedNit, 'No existe ownership para el NIT compartido.');
    expect(String(ownershipForSharedNit.ownerClientId) === String(clientA._id), 'El ownership del NIT compartido no quedó asociado a la cuenta A.');

    results.mongoChecks.accountAAfterFive = {
      profileCount: profilesAfterFive.length,
      duplicateProfilesSameNit: duplicateProfilesSameNit.length,
      ownershipOwnerClientId: String(ownershipForSharedNit.ownerClientId)
    };

    logStep('verifying nit proof persistence for first legal profile');
    const uploadedDocument = await ProfileDocument.findOne({
      businessProfileId: results.accountACreations[0].profileId,
      ownerClientId: clientA._id,
      documentRole: 'RUT',
      activeVersion: true
    });
    const verificationCase = await VerificationCase.findOne({ businessProfileId: results.accountACreations[0].profileId });
    const refreshedFirstProfile = await BusinessProfile.findById(results.accountACreations[0].profileId);

    expect(proofUploadResult.profile.verificationStatus === 'MANUAL_REVIEW', 'El perfil jurídico debería quedar en MANUAL_REVIEW después de subir el comprobante del NIT.');
    expect(uploadedDocument, 'No se encontró el comprobante del NIT en Mongo.');
    expect(String(uploadedDocument.verificationStatus) === 'MANUAL_REVIEW', 'El comprobante del NIT no quedó en MANUAL_REVIEW.');
    expect(verificationCase, 'No se creó verification case para el perfil jurídico.');
    expect(String(verificationCase.state) === 'MANUAL_REVIEW', 'El verification case jurídico no quedó en MANUAL_REVIEW.');
    expect(Array.isArray(verificationCase.requiredDocuments) && verificationCase.requiredDocuments.includes('RUT'), 'El verification case jurídico no registró el documento requerido.');
    expect(refreshedFirstProfile && String(refreshedFirstProfile.verificationStatus) === 'MANUAL_REVIEW', 'El estado del perfil jurídico no persistió como MANUAL_REVIEW.');
    expect(refreshedFirstProfile && refreshedFirstProfile.legalEntity && String(refreshedFirstProfile.legalEntity.rutDocumentId || '') === String(uploadedDocument._id), 'El comprobante del NIT no quedó asociado en legalEntity.rutDocumentId.');

    results.nitProofUpload = {
      profileId: results.accountACreations[0].profileId,
      documentId: String(uploadedDocument._id),
      documentStatus: String(uploadedDocument.verificationStatus),
      verificationCaseId: String(verificationCase._id),
      verificationCaseState: String(verificationCase.state),
      profileVerificationStatus: String(refreshedFirstProfile.verificationStatus)
    };

    const contextA = await createAuthedContext(browser, registeredAccountA);
    const pageA = await contextA.newPage();

    try {
      logStep('attempting sixth legal profile in account A and expecting business limit');
      const blockedLimitResult = await expectBlockedLegalProfileThroughUi(pageA, blockedSixthProfile, EXPECTED_LIMIT_MESSAGE);
      results.limitAttempt = Object.assign({
        taxId: blockedSixthProfile.taxId,
        normalizedTaxId: normalizeTaxIdentifier(blockedSixthProfile.taxId)
      }, blockedLimitResult);
      results.screenshots.accountALimitBlocked = await takeShot(pageA, 'account-a-legal-limit-blocked');
    } finally {
      await safeClose(contextA);
    }

    const profilesAfterBlockedSixth = await getProfilesForClient(clientA._id);
    const sixthProfileExists = profilesAfterBlockedSixth.some(function (profile) {
      return String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '') === normalizeTaxIdentifier(blockedSixthProfile.taxId);
    });

    expect(profilesAfterBlockedSixth.length === 5, 'Mongo creó por error un sexto perfil jurídico.');
    expect(!sixthProfileExists, 'Mongo persistió el sexto NIT bloqueado en la cuenta A.');

    results.mongoChecks.accountAAfterBlockedSixth = {
      profileCount: profilesAfterBlockedSixth.length,
      blockedTaxIdCreated: sixthProfileExists
    };

    const crossAccountBrowser = await chromium.launch({ headless: true });

    try {
      const contextB = await createAuthedContext(crossAccountBrowser, registeredAccountB);
      const pageB = await contextB.newPage();

      try {
        logStep('attempting duplicated nit from account B');
        const blockedCrossAccountResult = await expectBlockedLegalProfileThroughUi(pageB, crossAccountBlockedProfile, EXPECTED_CROSS_ACCOUNT_MESSAGE);
        results.crossAccountAttempt = Object.assign({
          taxId: crossAccountBlockedProfile.taxId,
          normalizedTaxId: normalizeTaxIdentifier(crossAccountBlockedProfile.taxId)
        }, blockedCrossAccountResult);
        results.screenshots.accountBCrossAccountBlocked = await takeShot(pageB, 'account-b-legal-cross-account-blocked');
      } finally {
        await safeClose(contextB);
      }
    } finally {
      await safeClose(crossAccountBrowser);
    }

    const clientB = await getClientByEmail(accountB.email);
    expect(clientB, 'No se encontró la cuenta jurídica B en Mongo.');
    const profilesInAccountB = await getProfilesForClient(clientB._id);
    const conflictingNitInAccountB = profilesInAccountB.some(function (profile) {
      return String(profile.legalEntity && profile.legalEntity.taxIdNormalized || '') === normalizeTaxIdentifier(crossAccountBlockedProfile.taxId);
    });
    const ownershipAfterBlockedCrossAccount = await getOwnership(crossAccountBlockedProfile.taxId);

    expect(profilesInAccountB.length === 0, 'La cuenta B jurídica no debería tener perfiles creados.');
    expect(!conflictingNitInAccountB, 'La cuenta B jurídica recibió por error un perfil con el NIT bloqueado.');
    expect(ownershipAfterBlockedCrossAccount && String(ownershipAfterBlockedCrossAccount.ownerClientId) === String(clientA._id), 'El ownership del NIT compartido cambió después del intento bloqueado.');

    results.mongoChecks.accountBAfterBlockedAttempt = {
      profileCount: profilesInAccountB.length,
      blockedTaxIdCreated: conflictingNitInAccountB,
      ownershipOwnerClientId: String(ownershipAfterBlockedCrossAccount.ownerClientId)
    };

    logStep('verifying legal detail and dashboard refresh consistency in UI');

    const detailBrowser = await chromium.launch({ headless: true });

    try {
      results.uiChecks.legalDetailRefresh = await verifyLegalDetailAfterRefresh(detailBrowser, registeredAccountA, results.accountACreations[0].profileId, legalProfilesForAccountA[0]);
    } finally {
      await safeClose(detailBrowser);
    }

    const dashboardABrowser = await chromium.launch({ headless: true });

    try {
      results.uiChecks.accountARefresh = await verifyDashboardForAccountA(dashboardABrowser, registeredAccountA, 5);
    } finally {
      await safeClose(dashboardABrowser);
    }

    const dashboardBBrowser = await chromium.launch({ headless: true });

    try {
      results.uiChecks.accountBRefresh = await verifyDashboardForAccountB(dashboardBBrowser, registeredAccountB);
    } finally {
      await safeClose(dashboardBBrowser);
    }

    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await safeClose(browser);
    await mongoose.disconnect();
  }
};

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error), results }, null, 2));
  process.exit(1);
});