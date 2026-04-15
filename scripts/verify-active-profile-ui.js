require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ACTIVE_CLIENT_STORAGE_KEY = 'livenActiveClient';
const ACTIVE_BUSINESS_PROFILE_STORAGE_KEY = 'livenActiveBusinessProfileId';
const BASE_URL = String(process.env.LOCAL_UI_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const PROFILE_ID = String(process.env.UI_TEST_PROFILE_ID || '').trim();
const OWNER_EMAIL = String(process.env.UI_TEST_OWNER_EMAIL || '').trim().toLowerCase();
const OWNER_NAME = String(process.env.UI_TEST_OWNER_NAME || '').trim();
const OWNER_PLAN = String(process.env.UI_TEST_OWNER_PLAN || 'GRATUITO').trim().toUpperCase();
const EXPECT_NO_PROFILES_AFTER_DELETE = String(process.env.UI_TEST_EXPECT_NO_PROFILES_AFTER_DELETE || '').trim().toLowerCase() === 'true';
const SKIP_EDIT_FLOW = String(process.env.UI_TEST_SKIP_EDIT || '').trim().toLowerCase() === 'true';
const SCREENSHOT_DIR = path.join(process.cwd(), 'tmp', 'ui-verification');
const UPDATED_BUSINESS_NAME = 'Perfil Activo Editado QA';
const UPDATED_BUSINESS_USERNAME = 'activo-qa-editado';
const DESIRED_CATEGORIES = ['Artísticos', 'Sociales'];

const logStep = function (message) {
  process.stdout.write('[verify-active-ui] ' + String(message || '') + '\n');
};

const ensureDirectory = function (dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
};

const wait = function (ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
};

const expect = function (condition, message) {
  if (!condition) {
    throw new Error(message);
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

const waitForVisible = async function (locator, timeoutMs) {
  const timeout = Number(timeoutMs || 5000);
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeout) {
    if (await locator.isVisible().catch(function () { return false; })) {
      return true;
    }

    await wait(100);
  }

  return false;
};

const waitForHidden = async function (locator, timeoutMs) {
  const timeout = Number(timeoutMs || 5000);
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeout) {
    const visible = await locator.isVisible().catch(function () { return false; });

    if (!visible) {
      return true;
    }

    await wait(100);
  }

  return false;
};

const getSelectedCategories = async function (page) {
  return page.locator('[data-category-chip]').evaluateAll(function (nodes) {
    return nodes.filter(function (node) {
      return node.getAttribute('aria-pressed') === 'true';
    }).map(function (node) {
      return String(node.textContent || '').trim();
    });
  });
};

const setDesiredCategories = async function (page, desiredCategories) {
  const normalizedDesired = desiredCategories.map(function (category) {
    return String(category || '').trim().toLowerCase();
  });
  const chips = page.locator('[data-category-chip]');
  const chipCount = await chips.count();

  for (let index = 0; index < chipCount; index += 1) {
    const chip = chips.nth(index);
    const label = String(await chip.textContent() || '').trim();
    const normalizedLabel = label.toLowerCase();
    const isSelected = (await chip.getAttribute('aria-pressed')) === 'true';
    const shouldBeSelected = normalizedDesired.includes(normalizedLabel);

    if (isSelected !== shouldBeSelected) {
      await chip.click();
      await wait(120);
    }
  }
};

const main = async function () {
  expect(PROFILE_ID, 'UI_TEST_PROFILE_ID no está configurado.');
  expect(OWNER_EMAIL, 'UI_TEST_OWNER_EMAIL no está configurado.');
  ensureDirectory(SCREENSHOT_DIR);

  const browser = await chromium.launch({ headless: true });
  logStep('browser launched');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const summary = {
    baseUrl: BASE_URL,
    profileId: PROFILE_ID,
    ownerEmail: OWNER_EMAIL,
    screenshots: {},
    assertions: {}
  };

  await context.addInitScript(function (payload) {
    window.sessionStorage.setItem(payload.activeClientKey, JSON.stringify(payload.activeClient));
    window.sessionStorage.setItem(payload.activeProfileKey, payload.profileId);
  }, {
    activeClientKey: ACTIVE_CLIENT_STORAGE_KEY,
    activeProfileKey: ACTIVE_BUSINESS_PROFILE_STORAGE_KEY,
    profileId: PROFILE_ID,
    activeClient: {
      fullName: OWNER_NAME || OWNER_EMAIL,
      email: OWNER_EMAIL,
      role: 'CLIENTE',
      plan: OWNER_PLAN
    }
  });

  const page = await context.newPage();

  try {
    logStep('opening detail page');
    await page.goto(BASE_URL + '/business-profile-details.html?profileId=' + encodeURIComponent(PROFILE_ID), { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-profile-status-chip]');
    logStep('detail page loaded');

    const chip = page.locator('[data-profile-status-chip]');
    const chipText = String(await chip.textContent() || '').trim();
    summary.assertions.statusChip = chipText;
    expect(chipText === 'Estado: Activo', 'El chip no muestra "Estado: Activo". Valor actual: ' + chipText);

    const defaultCreateButtonVisible = await page.locator('a.profile-back-button:has-text("Crear otro perfil")').isVisible().catch(function () { return false; });
    const defaultSaveButtonVisible = await page.locator('#createBusinessProfileButton').isVisible().catch(function () { return false; });
    summary.assertions.defaultButtonsHidden = !defaultCreateButtonVisible && !defaultSaveButtonVisible;
    expect(summary.assertions.defaultButtonsHidden, 'Los botones por defecto siguen visibles en un perfil activo.');

    const deleteButton = page.locator('[data-profile-delete-trigger]');
    expect(await deleteButton.isVisible(), 'El icono de eliminar no está visible.');
    summary.assertions.activeActionsVisible = true;

    summary.screenshots.activeState = await takeShot(page, 'active-state');
    logStep('active state screenshot captured');

    const nameInitiallyEnabled = !(await page.locator('input[name="businessName"]').isDisabled());
    const usernameInitiallyEnabled = !(await page.locator('input[name="businessUsername"]').isDisabled());
    const cityInitiallyEnabled = !(await page.locator('select[name="businessCity"]').isDisabled());
    const imageInitiallyEnabled = !(await page.locator('[data-profile-image-trigger]').isDisabled());
    summary.assertions.editableFieldsAvailable = {
      businessNameEnabled: nameInitiallyEnabled,
      businessUsernameEnabled: usernameInitiallyEnabled,
      businessCityEnabled: cityInitiallyEnabled,
      profileImageEnabled: imageInitiallyEnabled
    };
    expect(nameInitiallyEnabled, 'El nombre del negocio debería estar habilitado en un perfil activo.');
    expect(usernameInitiallyEnabled, 'El nombre de usuario debería estar habilitado en un perfil activo.');
    expect(cityInitiallyEnabled, 'La ciudad debería estar habilitada en un perfil activo.');
    expect(imageInitiallyEnabled, 'La foto de perfil debería estar habilitada en un perfil activo.');

    if (!SKIP_EDIT_FLOW) {
      const nameInput = page.locator('input[name="businessName"]');
      const usernameInput = page.locator('input[name="businessUsername"]');
      expect(!(await nameInput.isDisabled()), 'Nombre del negocio debería poder editarse en modo edición.');
      expect(!(await usernameInput.isDisabled()), 'Nombre de usuario debería poder editarse en modo edición.');
      expect(!(await page.locator('select[name="businessCity"]').isDisabled()), 'La ciudad debería poder editarse en un perfil activo.');
      expect(!(await page.locator('[data-profile-image-trigger]').isDisabled()), 'La imagen debería poder editarse en un perfil activo.');

      await nameInput.fill(UPDATED_BUSINESS_NAME);
      await usernameInput.fill(UPDATED_BUSINESS_USERNAME);
      await setDesiredCategories(page, DESIRED_CATEGORIES);
      await waitForVisible(page.locator('#saveActiveProfileChangesButton'), 7000);
      logStep('save action enabled after business changes');

      const selectedCategoriesBeforeSave = await getSelectedCategories(page);
      summary.assertions.selectedCategoriesBeforeSave = selectedCategoriesBeforeSave;
      expect(JSON.stringify(selectedCategoriesBeforeSave) === JSON.stringify(DESIRED_CATEGORIES), 'Las categorías seleccionadas no coinciden con las esperadas antes de guardar.');

      await Promise.all([
        page.waitForResponse(function (response) {
          return response.url().includes('/api/business-profiles/' + PROFILE_ID) && response.request().method() === 'PATCH' && response.ok();
        }),
        page.locator('#saveActiveProfileChangesButton').click()
      ]);
      logStep('patch request completed');

      expect(await waitForVisible(page.locator('#profileFeedbackModal'), 7000), 'El modal de feedback no apareció después de guardar cambios.');
      const successTitle = String(await page.locator('#profileFeedbackTitle').textContent() || '').trim();
      summary.assertions.editSaveModalTitle = successTitle;
      expect(successTitle === 'Perfil actualizado con éxito', 'El modal posterior al guardado no mostró el título esperado.');
      expect(await waitForHidden(page.locator('#profileFeedbackModal'), 7000), 'El modal de feedback breve no se cerró automáticamente después de guardar cambios.');
      logStep('save feedback modal closed');

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('[data-profile-status-chip]');

      const persistedName = await page.locator('input[name="businessName"]').inputValue();
      const persistedUsername = await page.locator('input[name="businessUsername"]').inputValue();
      const persistedCategories = await getSelectedCategories(page);
      summary.assertions.persistedAfterReload = {
        businessName: persistedName,
        businessUsername: persistedUsername,
        categories: persistedCategories
      };
      expect(persistedName === UPDATED_BUSINESS_NAME, 'El nombre del negocio no persistió tras recargar.');
      expect(persistedUsername === UPDATED_BUSINESS_USERNAME, 'El nombre de usuario no persistió tras recargar.');
      expect(JSON.stringify(persistedCategories) === JSON.stringify(DESIRED_CATEGORIES), 'Las categorías no persistieron tras recargar.');

      summary.screenshots.afterEditReload = await takeShot(page, 'after-edit-reload');
      logStep('reload and persistence verified');
    }

    await deleteButton.click();
    expect(await waitForVisible(page.locator('#deleteProfileModal'), 5000), 'El modal de eliminación no se abrió en el primer intento.');
    summary.screenshots.deleteModal = await takeShot(page, 'delete-modal');
    logStep('delete modal opened first time');
    await page.locator('#deleteProfileCancelButton').click();
    expect(await waitForHidden(page.locator('#deleteProfileModal'), 5000), 'El modal de eliminación no se cerró al cancelar.');
    summary.assertions.deleteModalCancelWorked = true;

    await deleteButton.click();
    expect(await waitForVisible(page.locator('#deleteProfileModal'), 5000), 'El modal de eliminación no se abrió en el segundo intento.');
    logStep('delete modal reopened');
    await Promise.all([
      page.waitForResponse(function (response) {
        return response.url().includes('/api/business-profiles/' + PROFILE_ID) && response.request().method() === 'DELETE' && response.ok();
      }),
      page.locator('#deleteProfileConfirmButton').click()
    ]);
    logStep('delete request completed');

    expect(await waitForVisible(page.locator('#profileFeedbackModal'), 7000), 'El modal de feedback no apareció después de eliminar el perfil.');
    const deleteSuccessTitle = String(await page.locator('#profileFeedbackTitle').textContent() || '').trim();
    summary.assertions.deleteSuccessModalTitle = deleteSuccessTitle;
    expect(deleteSuccessTitle === 'El perfil fue eliminado', 'El modal de eliminación no mostró el título esperado.');

    await page.locator('#profileFeedbackPrimary').click();
    await page.waitForURL(/dashboard\.html$/);
    await page.waitForLoadState('networkidle');
    await wait(1800);

    if (EXPECT_NO_PROFILES_AFTER_DELETE) {
      const bannerTitle = String(await page.locator('.onboarding-banner-title').textContent() || '').trim();
      const triggerText = String(await page.locator('[data-global-profile-dropdown] .profile-trigger').textContent() || '').trim();
      summary.assertions.dashboardAfterDelete = {
        bannerTitle,
        triggerText
      };
      expect(bannerTitle === 'Aún no has creado tu primer perfil de negocio.', 'El dashboard no mostró el banner esperado tras eliminar el último perfil.');
      expect(triggerText.includes('Crear perfil'), 'El selector superior no quedó en modo crear perfil tras eliminar el último perfil.');
    }

    summary.screenshots.afterDeleteDashboard = await takeShot(page, 'after-delete-dashboard');
    logStep('redirect after delete verified');
    summary.assertions.redirectedAfterDelete = true;

    console.log(JSON.stringify({ ok: true, summary }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
};

main().catch(function (error) {
  console.error(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }, null, 2));
  process.exit(1);
});