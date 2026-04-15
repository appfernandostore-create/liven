require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const Client = require('../models/Client');
const { BusinessProfile, normalizeIdentityDocumentNumber } = require('../models/BusinessProfile');
const { IdentityDocumentOwnership } = require('../models/IdentityDocumentOwnership');

const ACTIVE_CLIENT_STORAGE_KEY = 'livenActiveClient';
const ACTIVE_BUSINESS_PROFILE_STORAGE_KEY = 'livenActiveBusinessProfileId';
const BASE_URL = String(process.env.LOCAL_UI_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();
const RUN_ID = String(Date.now());
const SCREENSHOT_DIR = path.join(process.cwd(), 'tmp', 'ui-business-rule-verification', RUN_ID);
const EXPECTED_LIMIT_MESSAGE = 'Tu cuenta ya alcanzó el máximo de 5 perfiles en total. No puedes crear más perfiles en esta cuenta.';
const EXPECTED_CROSS_ACCOUNT_MESSAGE = 'Esta cédula ya está asociada a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.';
const DOCUMENT_BASE = String(Number(RUN_ID.slice(-8)) || 52345000);
const SHARED_DOCUMENT_NORMALIZED = DOCUMENT_BASE;
const THIRD_DOCUMENT_NORMALIZED = String(Number(DOCUMENT_BASE) + 1);
const FOURTH_DOCUMENT_NORMALIZED = String(Number(DOCUMENT_BASE) + 2);
const FIFTH_DOCUMENT_NORMALIZED = String(Number(DOCUMENT_BASE) + 3);
const SIXTH_DOCUMENT_NORMALIZED = String(Number(DOCUMENT_BASE) + 4);
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO1m5+0AAAAASUVORK5CYII=',
  'base64'
);

const accountA = {
  fullName: 'QA Regla Cuenta A ' + RUN_ID,
  email: 'qa.rule.a.' + RUN_ID + '@live.local',
  phone: '+57 320 100 ' + RUN_ID.slice(-4),
  password: 'Cliente123!',
  plan: 'GRATUITO'
};

const accountB = {
  fullName: 'QA Regla Cuenta B ' + RUN_ID,
  email: 'qa.rule.b.' + RUN_ID + '@live.local',
  phone: '+57 320 200 ' + RUN_ID.slice(-4),
  password: 'Cliente123!',
  plan: 'GRATUITO'
};

const naturalProfilesForAccountA = [
  { label: 'perfil-1', fullName: 'QA Natural Uno ' + RUN_ID, documentNumber: SHARED_DOCUMENT_NORMALIZED.slice(0, 2) + '.' + SHARED_DOCUMENT_NORMALIZED.slice(2, 5) + '.' + SHARED_DOCUMENT_NORMALIZED.slice(5), expeditionDate: '2020-01-10' },
  { label: 'perfil-2', fullName: 'QA Natural Dos ' + RUN_ID, documentNumber: SHARED_DOCUMENT_NORMALIZED, expeditionDate: '2020-01-11' },
  { label: 'perfil-3', fullName: 'QA Natural Tres ' + RUN_ID, documentNumber: THIRD_DOCUMENT_NORMALIZED, expeditionDate: '2020-01-12' },
  { label: 'perfil-4', fullName: 'QA Natural Cuatro ' + RUN_ID, documentNumber: FOURTH_DOCUMENT_NORMALIZED, expeditionDate: '2020-01-13' },
  { label: 'perfil-5', fullName: 'QA Natural Cinco ' + RUN_ID, documentNumber: FIFTH_DOCUMENT_NORMALIZED, expeditionDate: '2020-01-14' }
];

const blockedSixthProfile = {
  label: 'perfil-6-bloqueado',
  fullName: 'QA Natural Seis ' + RUN_ID,
  documentNumber: SIXTH_DOCUMENT_NORMALIZED,
  expeditionDate: '2020-01-15'
};

const crossAccountBlockedProfile = {
  label: 'cuenta-b-cedula-duplicada',
  fullName: 'QA Natural Bloqueado ' + RUN_ID,
  documentNumber: SHARED_DOCUMENT_NORMALIZED.slice(0, 2) + ' ' + SHARED_DOCUMENT_NORMALIZED.slice(2, 5) + ' ' + SHARED_DOCUMENT_NORMALIZED.slice(5),
  expeditionDate: '2020-02-01'
};

const results = {
  runId: RUN_ID,
  baseUrl: BASE_URL,
  accounts: {
    accountA: { email: accountA.email },
    accountB: { email: accountB.email }
  },
  accountACreations: [],
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
  process.stdout.write('[verify-profile-rules] ' + String(message || '') + '\n');
};

const ensureDirectory = function (dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
};

const wait = function (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
};

const safeClose = async function (resource, label) {
  if (!resource || typeof resource.close !== 'function') {
    return;
  }

  try {
    await resource.close();
  } catch (error) {
    logStep((label || 'resource') + ' close ignored: ' + (error && error.message ? error.message : error));
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
  expect(result && result.user && result.user.email === account.email, 'El registro no devolvió el usuario esperado para ' + account.email + '.');

  return result.user;
};

const createNaturalProfileViaApi = async function (account, profileData) {
  const response = await fetch(BASE_URL + '/api/business-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: account.email,
      profileType: 'NATURAL',
      fullName: profileData.fullName,
      documentTypeExpected: 'CO_CEDULA_CIUDADANIA',
      documentNumber: profileData.documentNumber,
      expeditionDate: profileData.expeditionDate
    })
  });
  const result = await asJson(response);

  expect(response.status === 201, 'La API no creo ' + profileData.label + ' correctamente. Respuesta: ' + JSON.stringify(result));
  expect(result && result.profile && result.profile.id, 'La API no devolvio el perfil creado para ' + profileData.label + '.');

  return result;
};

const completeBusinessProfileSetupViaApi = async function (account, profileId, profileData) {
  const response = await fetch(BASE_URL + '/api/business-profiles/' + encodeURIComponent(profileId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientEmail: account.email,
      businessName: 'Negocio ' + profileData.label + ' ' + RUN_ID,
      businessUsername: 'qa-natural-' + sanitizeLabel(profileData.label) + '-' + RUN_ID,
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

const fillNaturalProfileSetup = async function (page, profileData) {
  await page.goto(BASE_URL + '/business-profile.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-profile-setup]');
  await page.fill('input[name="fullName"]', profileData.fullName);
  await page.selectOption('select[name="documentType"]', 'cc');
  await page.fill('input[name="documentNumber"]', profileData.documentNumber);
  await page.fill('input[name="expeditionDate"]', profileData.expeditionDate);

  const fileInputs = page.locator('[data-setup-documents="natural"] .document-file-input');
  expect(await fileInputs.count() === 2, 'No se encontraron los dos inputs de documento para persona natural.');

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

const expectContinueEnabled = async function (page) {
  const button = page.locator('#profileContinueButton');
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < 8000) {
    if (!(await button.isDisabled())) {
      return;
    }

    await wait(100);
  }

  throw new Error('El boton de continuar no se habilito despues de completar el formulario.');
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

const createNaturalProfileThroughUi = async function (page, profileData) {
  await fillNaturalProfileSetup(page, profileData);

  const createResponsePromise = waitForBusinessProfileCreateResponse(page);
  await page.locator('#profileContinueButton').click();
  const createResponse = await createResponsePromise;
  const status = createResponse.status();
  const body = await createResponse.json().catch(async function () {
    return asJson(createResponse);
  });

  expect(status === 201, 'La creacion de ' + profileData.label + ' no devolvio 201. Respuesta: ' + JSON.stringify(body));

  await page.waitForURL(/business-profile-details\.html\?profileId=/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  return {
    status,
    body,
    profileId: body && body.profile && body.profile.id ? String(body.profile.id) : String(new URL(page.url()).searchParams.get('profileId') || '')
  };
};

const expectBlockedNaturalProfileThroughUi = async function (page, profileData, expectedMessage) {
  await fillNaturalProfileSetup(page, profileData);

  const createResponsePromise = waitForBusinessProfileCreateResponse(page);
  await page.locator('#profileContinueButton').click();
  const createResponse = await createResponsePromise;
  const status = createResponse.status();
  const body = await createResponse.json().catch(async function () {
    return asJson(createResponse);
  });

  expect(status === 409, 'La creacion bloqueada de ' + profileData.label + ' debia devolver 409. Respuesta: ' + JSON.stringify(body));

  const modal = page.locator('#profileSetupFeedbackModal');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  const title = String(await page.locator('#profileSetupFeedbackTitle').textContent() || '').trim();
  const message = String(await page.locator('#profileSetupFeedbackMessage').textContent() || '').trim();
  expect(title === 'No pudimos avanzar con el perfil', 'El modal de error no mostro el titulo esperado. Valor: ' + title);
  expect(message === expectedMessage, 'El modal de error no mostro el mensaje esperado. Valor: ' + message);

  return {
    status,
    body,
    title,
    message,
    urlAfterAttempt: page.url()
  };
};

const connectMongo = async function () {
  expect(MONGODB_URI, 'MONGODB_URI no esta configurada para ejecutar la verificacion real.');

  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(MONGODB_URI);
};

const getClientByEmail = async function (email) {
  return Client.findOne({ email: String(email || '').trim().toLowerCase() });
};

const countProfilesForClient = async function (clientId) {
  return BusinessProfile.countDocuments({ ownerClientId: clientId });
};

const getProfilesForClient = async function (clientId) {
  return BusinessProfile.find({ ownerClientId: clientId }).sort({ createdAt: 1 });
};

const getOwnership = async function (documentNumber) {
  return IdentityDocumentOwnership.findOne({
    identifierType: 'NATURAL_DOCUMENT',
    normalizedValue: normalizeIdentityDocumentNumber(documentNumber)
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

    expect(optionCountBeforeRefresh === expectedProfiles, 'La UI del dashboard antes de refresh mostro ' + optionCountBeforeRefresh + ' perfiles en vez de ' + expectedProfiles + '.');
    expect(optionCountAfterRefresh === expectedProfiles, 'La UI del dashboard despues de refresh mostro ' + optionCountAfterRefresh + ' perfiles en vez de ' + expectedProfiles + '.');
    expect(triggerTextAfterRefresh.includes(String(expectedProfiles) + ' perfiles'), 'El trigger del dashboard no refleja la cantidad de perfiles despues del refresh. Valor: ' + triggerTextAfterRefresh);

    return {
      triggerTextBeforeRefresh,
      triggerTextAfterRefresh,
      optionCountBeforeRefresh,
      optionCountAfterRefresh
    };
  } finally {
    await context.close();
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

    expect(triggerTextAfterRefresh.includes('Crear perfil'), 'La cuenta B deberia seguir sin perfiles despues del refresh. Trigger actual: ' + triggerTextAfterRefresh);
    expect(bannerTitleAfterRefresh === 'Aún no has creado tu primer perfil de negocio.', 'La cuenta B no mostro el banner vacio esperado despues del refresh. Valor: ' + bannerTitleAfterRefresh);

    return {
      triggerTextBeforeRefresh,
      triggerTextAfterRefresh,
      bannerTitleBeforeRefresh,
      bannerTitleAfterRefresh
    };
  } finally {
    await context.close();
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

  try {
    const contextA = await createAuthedContext(browser, registeredAccountA);

    try {
      for (const profileData of naturalProfilesForAccountA) {
        logStep('creating ' + profileData.label + ' in account A');
        const creationResult = await createNaturalProfileViaApi(registeredAccountA, profileData);
        const completedProfile = await completeBusinessProfileSetupViaApi(registeredAccountA, creationResult.profile.id, profileData);
        results.accountACreations.push({
          label: profileData.label,
          documentNumber: profileData.documentNumber,
          normalizedDocumentNumber: normalizeIdentityDocumentNumber(profileData.documentNumber),
          profileId: String(completedProfile.id),
          responseStatus: 201
        });
      }

      logStep('checking Mongo after five successful profiles');
      const clientA = await getClientByEmail(accountA.email);
      expect(clientA, 'No se encontro la cuenta A en Mongo despues del registro.');
      const profilesAfterFive = await getProfilesForClient(clientA._id);
      expect(profilesAfterFive.length === 5, 'Mongo deberia tener 5 perfiles para la cuenta A y tiene ' + profilesAfterFive.length + '.');

      const duplicateProfilesInSameAccount = profilesAfterFive.filter(function (profile) {
        return String(profile.naturalPerson && profile.naturalPerson.documentNumberNormalized || '') === normalizeIdentityDocumentNumber(naturalProfilesForAccountA[0].documentNumber);
      });
      expect(duplicateProfilesInSameAccount.length === 2, 'La cuenta A deberia tener 2 perfiles con la misma cédula normalizada y tiene ' + duplicateProfilesInSameAccount.length + '.');

      const ownershipForSharedDocument = await getOwnership(naturalProfilesForAccountA[0].documentNumber);
      expect(ownershipForSharedDocument, 'No existe registro de ownership para la cédula compartida.');
      expect(String(ownershipForSharedDocument.ownerClientId) === String(clientA._id), 'La cédula compartida no quedo reservada para la cuenta A.');

      results.mongoChecks.accountAAfterFive = {
        profileCount: profilesAfterFive.length,
        duplicateProfilesSameCedula: duplicateProfilesInSameAccount.length,
        ownershipOwnerClientId: String(ownershipForSharedDocument.ownerClientId)
      };

      logStep('attempting sixth profile in account A and expecting business limit');
      const pageAForLimit = await contextA.newPage();

      try {
        const blockedLimitResult = await expectBlockedNaturalProfileThroughUi(pageAForLimit, blockedSixthProfile, EXPECTED_LIMIT_MESSAGE);
        results.limitAttempt = Object.assign({
          documentNumber: blockedSixthProfile.documentNumber,
          normalizedDocumentNumber: normalizeIdentityDocumentNumber(blockedSixthProfile.documentNumber)
        }, blockedLimitResult);
        results.screenshots.accountALimitBlocked = await takeShot(pageAForLimit, 'account-a-limit-blocked');
      } finally {
        await safeClose(pageAForLimit, 'pageA-limit');
      }

      const profilesAfterBlockedSixth = await getProfilesForClient(clientA._id);
      const sixthProfileExists = profilesAfterBlockedSixth.some(function (profile) {
        return String(profile.naturalPerson && profile.naturalPerson.documentNumberNormalized || '') === normalizeIdentityDocumentNumber(blockedSixthProfile.documentNumber);
      });
      expect(profilesAfterBlockedSixth.length === 5, 'Mongo no debio crear un sexto perfil para la cuenta A. Conteo actual: ' + profilesAfterBlockedSixth.length + '.');
      expect(!sixthProfileExists, 'Mongo creo por error un sexto perfil bloqueado para la cuenta A.');

      results.mongoChecks.accountAAfterBlockedSixth = {
        profileCount: profilesAfterBlockedSixth.length,
        blockedDocumentCreated: sixthProfileExists
      };
    } catch (error) {
      error.message = 'Fallo el flujo de la cuenta A despues de ' + results.accountACreations.length + ' creaciones exitosas. ' + error.message;
      throw error;
    } finally {
      await safeClose(contextA, 'contextA');
    }

    const contextB = await createAuthedContext(browser, registeredAccountB);

    try {
      logStep('attempting duplicated cedula from account B');
      const pageB = await contextB.newPage();

      try {
        const blockedCrossAccountResult = await expectBlockedNaturalProfileThroughUi(pageB, crossAccountBlockedProfile, EXPECTED_CROSS_ACCOUNT_MESSAGE);
        results.crossAccountAttempt = Object.assign({
          documentNumber: crossAccountBlockedProfile.documentNumber,
          normalizedDocumentNumber: normalizeIdentityDocumentNumber(crossAccountBlockedProfile.documentNumber)
        }, blockedCrossAccountResult);
        results.screenshots.accountBCrossAccountBlocked = await takeShot(pageB, 'account-b-cross-account-blocked');
      } finally {
        await safeClose(pageB, 'pageB-cross-account');
      }

      const clientB = await getClientByEmail(accountB.email);
      expect(clientB, 'No se encontro la cuenta B en Mongo despues del registro.');
      const profilesInAccountB = await getProfilesForClient(clientB._id);
      const conflictingDocInAccountB = profilesInAccountB.some(function (profile) {
        return String(profile.naturalPerson && profile.naturalPerson.documentNumberNormalized || '') === normalizeIdentityDocumentNumber(crossAccountBlockedProfile.documentNumber);
      });
      const ownershipForSharedDocument = await getOwnership(crossAccountBlockedProfile.documentNumber);

      expect(profilesInAccountB.length === 0, 'La cuenta B no deberia tener perfiles creados. Conteo actual: ' + profilesInAccountB.length + '.');
      expect(!conflictingDocInAccountB, 'La cuenta B recibio por error un perfil con la cédula bloqueada.');
      expect(ownershipForSharedDocument, 'El ownership de la cédula compartida desaparecio despues del intento de la cuenta B.');
      expect(String(ownershipForSharedDocument.ownerClientId) === String(results.mongoChecks.accountAAfterFive.ownershipOwnerClientId), 'El ownership de la cédula compartida cambio de dueño despues del intento bloqueado de la cuenta B.');

      results.mongoChecks.accountBAfterBlockedAttempt = {
        profileCount: profilesInAccountB.length,
        blockedDocumentCreated: conflictingDocInAccountB,
        ownershipOwnerClientId: String(ownershipForSharedDocument.ownerClientId)
      };
    } catch (error) {
      error.message = 'Fallo el flujo de la cuenta B. ' + error.message;
      throw error;
    } finally {
      await safeClose(contextB, 'contextB');
    }

    logStep('verifying dashboard refresh consistency in UI');
    results.uiChecks.accountARefresh = await verifyDashboardForAccountA(browser, registeredAccountA, 5);
    results.uiChecks.accountBRefresh = await verifyDashboardForAccountB(browser, registeredAccountB);

    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await safeClose(browser, 'browser');
    await mongoose.disconnect();
  }
};

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error), results }, null, 2));
  process.exit(1);
});