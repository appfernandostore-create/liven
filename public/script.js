document.addEventListener('DOMContentLoaded', function () {
  const body = document.body;
  const isPortalPage = body.classList.contains('dashboard-body');
  let isPortalNavigating = false;
  const ACTIVE_CLIENT_STORAGE_KEY = 'livenActiveClient';
  const REGISTERED_CLIENT_DRAFT_STORAGE_KEY = 'livenRegisteredClientDraft';
  const DEFAULT_ACTIVE_CLIENT = {
    fullName: 'Live Premium+',
    email: 'cliente@live.local',
    role: 'CLIENTE',
    plan: 'PREMIUM_PLUS'
  };
  const PROFILE_DOCUMENT_CONFIG = {
    NATURAL: [
      {
        role: 'CEDULA_FRONT',
        title: 'Cédula - frente',
        description: 'Carga la cara frontal del documento de identidad en imagen o PDF.'
      },
      {
        role: 'CEDULA_BACK',
        title: 'Cédula - reverso',
        description: 'Carga la cara posterior del documento de identidad en imagen o PDF.'
      }
    ],
    LEGAL: [
      {
        role: 'RUT',
        title: 'RUT del negocio',
        description: 'Carga el RUT vigente de la empresa o establecimiento.'
      }
    ]
  };
  const ALLOWED_PROFILE_CITY = 'Barranquilla';
  let selectedCategoryApi = null;

  const escapeHtml = function (value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const getPlanLabel = function (plan) {
    const normalizedPlan = String(plan || '').toUpperCase();

    if (normalizedPlan === 'GRATUITO') {
      return 'Plan Gratuito';
    }

    if (normalizedPlan === 'PREMIUM_PLUS') {
      return 'Plan Premium+';
    }

    return 'Plan Premium';
  };

  const getSidebarPlanTitle = function (plan) {
    const normalizedPlan = String(plan || '').toUpperCase();

    if (normalizedPlan === 'GRATUITO') {
      return 'Plan Gratuito';
    }

    if (normalizedPlan === 'PREMIUM_PLUS') {
      return 'Premium+';
    }

    return 'Premium';
  };

  const getPlanEventAvailability = function (plan) {
    const normalizedPlan = String(plan || '').toUpperCase();

    if (normalizedPlan === 'GRATUITO') {
      return '3 días/mes';
    }

    if (normalizedPlan === 'PREMIUM_PLUS') {
      return 'Publicación ilimitada';
    }

    return '30 días/mes';
  };

  const getPlanTier = function (plan) {
    const normalizedPlan = String(plan || '').toUpperCase();

    if (normalizedPlan === 'PREMIUM_PLUS') {
      return 3;
    }

    if (normalizedPlan === 'PREMIUM') {
      return 2;
    }

    return 1;
  };

  const PLAN_FEATURE_REQUIREMENTS = {
    analytics: {
      minTier: 3,
      upgradeTarget: 'plan-selection.html'
    },
    wallet: {
      minTier: 2,
      upgradeTarget: 'plan-selection.html'
    }
  };

  const canAccessFeature = function (plan, featureKey) {
    const featureRule = PLAN_FEATURE_REQUIREMENTS[featureKey];

    if (!featureRule) {
      return true;
    }

    return getPlanTier(plan) >= featureRule.minTier;
  };

  const getDisplayName = function (client) {
    const fullName = String(client.fullName || '').trim();

    return fullName || 'Live App';
  };

  const getInitials = function (client) {
    const nameParts = getDisplayName(client).split(/\s+/).filter(Boolean);
    const initials = nameParts.slice(0, 2).map(function (part) {
      return part.charAt(0).toUpperCase();
    }).join('');

    return initials || 'LA';
  };

  const normalizeActiveClient = function (client) {
    if (!client || typeof client !== 'object') {
      return Object.assign({}, DEFAULT_ACTIVE_CLIENT);
    }

    return {
      fullName: String(client.fullName || [client.firstName, client.lastName].filter(Boolean).join(' ') || DEFAULT_ACTIVE_CLIENT.fullName).trim(),
      email: String(client.email || DEFAULT_ACTIVE_CLIENT.email).trim().toLowerCase(),
      role: client.role || DEFAULT_ACTIVE_CLIENT.role,
      plan: client.plan || DEFAULT_ACTIVE_CLIENT.plan
    };
  };

  const saveActiveClient = function (client) {
    window.sessionStorage.setItem(ACTIVE_CLIENT_STORAGE_KEY, JSON.stringify(normalizeActiveClient(client)));
  };

  const loadActiveClient = function () {
    const storedClient = window.sessionStorage.getItem(ACTIVE_CLIENT_STORAGE_KEY);

    if (!storedClient) {
      return Object.assign({}, DEFAULT_ACTIVE_CLIENT);
    }

    try {
      return normalizeActiveClient(JSON.parse(storedClient));
    } catch (error) {
      window.sessionStorage.removeItem(ACTIVE_CLIENT_STORAGE_KEY);
      return Object.assign({}, DEFAULT_ACTIVE_CLIENT);
    }
  };

  const clearActiveClient = function () {
    window.sessionStorage.removeItem(ACTIVE_CLIENT_STORAGE_KEY);
  };

  const formatTaxId = function (taxId, verificationDigit) {
    const normalizedTaxId = String(taxId || '').replace(/\D/g, '');
    const normalizedVerificationDigit = String(verificationDigit || '').replace(/\D/g, '').slice(0, 1);

    if (!normalizedTaxId && !normalizedVerificationDigit) {
      return '';
    }

    if (!normalizedTaxId) {
      return normalizedVerificationDigit;
    }

    if (!normalizedVerificationDigit) {
      return normalizedTaxId;
    }

    return normalizedTaxId + '-' + normalizedVerificationDigit;
  };

  const saveRegisteredClientDraft = function (client) {
    window.localStorage.setItem(REGISTERED_CLIENT_DRAFT_STORAGE_KEY, JSON.stringify(normalizeActiveClient(client)));
  };

  const getActiveClientEmail = function () {
    return String(loadActiveClient().email || '').trim().toLowerCase();
  };

  const readApiResponse = async function (response) {
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

  const requestJson = async function (url, options) {
    const response = await fetch(url, options || {});
    const result = await readApiResponse(response);

    if (!response.ok) {
      const error = new Error(result.message || 'La solicitud no se pudo completar.');
      error.status = response.status;
      error.result = result;
      throw error;
    }

    return result;
  };

  const mapDocumentTypeValue = function (value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    const documentTypeMap = {
      cc: 'CO_CEDULA_CIUDADANIA',
      ti: 'CO_TARJETA_IDENTIDAD',
      ce: 'CO_CEDULA_EXTRANJERIA',
      pasaporte: 'PASSPORT',
      ppt: 'CO_PPT',
      pep: 'CO_PEP'
    };

    return documentTypeMap[normalizedValue] || normalizedValue.toUpperCase();
  };

  const getProfileIdFromUrl = function () {
    return new URLSearchParams(window.location.search).get('profileId');
  };

  const normalizeBusinessCityValue = function (value) {
    const normalizedValue = String(value || '').trim().toLowerCase();

    if (!normalizedValue) {
      return '';
    }

    return normalizedValue === 'barranquilla' ? ALLOWED_PROFILE_CITY : '';
  };

  const getVerificationStatusLabel = function (status) {
    const normalizedStatus = String(status || '').trim().toUpperCase();

    if (normalizedStatus === 'APPROVED') {
      return 'Aprobado';
    }

    if (normalizedStatus === 'REJECTED') {
      return 'Rechazado';
    }

    if (normalizedStatus === 'MANUAL_REVIEW') {
      return 'Revisión manual';
    }

    if (normalizedStatus === 'PROCESSING') {
      return 'En verificación';
    }

    return 'Pendiente';
  };

  const getVerificationStatusTheme = function (status) {
    const normalizedStatus = String(status || '').trim().toUpperCase();

    if (normalizedStatus === 'APPROVED') {
      return 'is-approved';
    }

    if (normalizedStatus === 'REJECTED') {
      return 'is-rejected';
    }

    if (normalizedStatus === 'MANUAL_REVIEW') {
      return 'is-review';
    }

    if (normalizedStatus === 'PROCESSING') {
      return 'is-processing';
    }

    return 'is-pending';
  };

  const getProfileTriggerMarkup = function (client) {
    const initials = escapeHtml(getInitials(client));
    const displayName = escapeHtml(getDisplayName(client));
    const planLabel = escapeHtml(getPlanLabel(client.plan));

    return [
      '<span>' + initials + '</span>',
      '<div class="profile-info">',
      '  <strong>' + displayName + '</strong>',
      '  <span>' + planLabel + '</span>',
      '</div>',
      '<span class="dropdown-arrow">▾</span>'
    ].join('');
  };

  const getProfileMenuMarkup = function (client) {
    const initials = escapeHtml(getInitials(client));
    const displayName = escapeHtml(getDisplayName(client));
    const email = escapeHtml(client.email);
    const planLabel = escapeHtml(getPlanLabel(client.plan));

    return [
      '<div class="profile-card">',
      '  <span class="profile-avatar">' + initials + '</span>',
      '  <div>',
      '    <strong>' + displayName + '</strong>',
      '    <span>' + email + '</span>',
      '    <span class="status-chip">' + planLabel + '</span>',
      '  </div>',
      '</div>',
      '<nav class="dropdown-links">',
      '  <a href="#" class="dropdown-link">',
      '    <span class="dropdown-link-icon" aria-hidden="true">',
      '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '        <circle cx="12" cy="8" r="3.25" stroke="currentColor" stroke-width="1.8"/>',
      '        <path d="M5 19C5 15.6863 8.13401 13 12 13C15.866 13 19 15.6863 19 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      '      </svg>',
      '    </span>',
      '    <span>Mi Perfil</span>',
      '  </a>',
      '  <a href="#" class="dropdown-link">',
      '    <span class="dropdown-link-icon" aria-hidden="true">',
      '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>',
      '        <path d="M19.4 15A1.65 1.65 0 0 0 19.73 16.82L19.79 16.88A2 2 0 0 1 16.96 19.71L16.9 19.65A1.65 1.65 0 0 0 15.08 19.32A1.65 1.65 0 0 0 14.08 20.83V20.99A2 2 0 0 1 10.08 20.99V20.9A1.65 1.65 0 0 0 9.08 19.39A1.65 1.65 0 0 0 7.26 19.72L7.2 19.78A2 2 0 1 1 4.37 16.95L4.43 16.89A1.65 1.65 0 0 0 4.76 15.07A1.65 1.65 0 0 0 3.25 14.07H3.09A2 2 0 0 1 3.09 10.07H3.18A1.65 1.65 0 0 0 4.69 9.07A1.65 1.65 0 0 0 4.36 7.25L4.3 7.19A2 2 0 1 1 7.13 4.36L7.19 4.42A1.65 1.65 0 0 0 9.01 4.75H9.17A1.65 1.65 0 0 0 10.17 3.24V3.08A2 2 0 0 1 14.17 3.08V3.17A1.65 1.65 0 0 0 15.17 4.68A1.65 1.65 0 0 0 16.99 4.35L17.05 4.29A2 2 0 1 1 19.88 7.12L19.82 7.18A1.65 1.65 0 0 0 19.49 9V9.16A1.65 1.65 0 0 0 21 10.16H21.16A2 2 0 0 1 21.16 14.16H21.07A1.65 1.65 0 0 0 19.56 15.16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
      '      </svg>',
      '    </span>',
      '    <span>Configuración</span>',
      '  </a>',
      '  <a href="#" class="dropdown-link">',
      '    <span class="dropdown-link-icon" aria-hidden="true">',
      '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '        <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" stroke-width="1.8"/>',
      '        <path d="M3.5 10H20.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      '      </svg>',
      '    </span>',
      '    <span>Facturación</span>',
      '  </a>',
      '  <a href="#" class="dropdown-link">',
      '    <span class="dropdown-link-icon" aria-hidden="true">',
      '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '        <path d="M12 3L19 6V11C19 16 15.5 19.5 12 21C8.5 19.5 5 16 5 11V6L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
      '      </svg>',
      '    </span>',
      '    <span>Seguridad</span>',
      '  </a>',
      '  <a href="#" class="dropdown-link">',
      '    <span class="dropdown-link-icon" aria-hidden="true">',
      '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/>',
      '        <path d="M9.09 9A3 3 0 1 1 14.91 10C14.91 12 12 12.5 12 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
      '        <circle cx="12" cy="17" r="1" fill="currentColor"/>',
      '      </svg>',
      '    </span>',
      '    <span>Ayuda y Soporte</span>',
      '  </a>',
      '</nav>',
      '<div class="dropdown-divider" aria-hidden="true"></div>',
      '<button class="dropdown-logout" type="button">',
      '  <span class="dropdown-link-icon" aria-hidden="true">',
      '    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '      <path d="M14 7L19 12L14 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
      '      <path d="M19 12H10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      '      <path d="M10 4H6C4.89543 4 4 4.89543 4 6V18C4 19.1046 4.89543 20 6 20H10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      '    </svg>',
      '  </span>',
      '  <span>Cerrar Sesión</span>',
      '</button>'
    ].join('');
  };

  const getSidebarPlanCardMarkup = function (client) {
    const normalizedPlan = String(client.plan || '').toUpperCase();

    if (normalizedPlan === 'GRATUITO') {
      return [
        '<div class="plan-card free-plan-card">',
        '  <div class="plan-card-header">',
        '    <span class="plan-icon plan-icon-upgrade" aria-hidden="true">',
        '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
        '        <path d="M12 4V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        '        <path d="M7 9L12 4L17 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
        '      </svg>',
        '    </span>',
        '    <div class="plan-card-title-group">',
        '      <strong>' + escapeHtml(getSidebarPlanTitle(client.plan)) + '</strong>',
        '      <span class="plan-membership-status">Plan actual</span>',
        '    </div>',
        '  </div>',
        '  <p>Actualiza para ampliar tus días de publicación mensuales y desbloquear funciones premium.</p>',
        '  <a href="plan-selection.html" class="secondary-button plan-card-action">Actualizar Plan</a>',
        '</div>'
      ].join('');
    }

    if (normalizedPlan === 'PREMIUM_PLUS') {
      return [
        '<div class="plan-card premium-plan-card">',
        '  <div class="plan-card-header">',
        '    <span class="plan-icon plan-icon-crown" aria-hidden="true">',
        '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
        '        <path d="M4 17.5L6.6 9L10.4 12.2L12 6.5L13.6 12.2L17.4 9L20 17.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
        '        <path d="M7.2 14.4H16.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        '        <path d="M8.4 17.5H15.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        '        <circle cx="12" cy="5.2" r="1.1" fill="currentColor" stroke="none"/>',
        '      </svg>',
        '    </span>',
        '    <div class="plan-card-title-group">',
        '      <strong>Premium+</strong>',
        '      <span class="plan-membership-status">Premium+ activo</span>',
        '    </div>',
        '  </div>',
        '  <p>Incluye publicación ilimitada, analíticas completas y acceso total a la experiencia Live.</p>',
        '</div>'
      ].join('');
    }

    if (normalizedPlan === 'PREMIUM') {
      return [
        '<div class="plan-card premium-plan-card">',
        '  <div class="plan-card-header">',
        '    <span class="plan-icon" aria-hidden="true">',
        '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
        '        <path d="M12 4V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
        '        <path d="M7 9L12 4L17 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
        '      </svg>',
        '    </span>',
        '    <div class="plan-card-title-group">',
        '      <strong>Premium</strong>',
        '      <span class="plan-membership-status">Premium activo</span>',
        '    </div>',
        '  </div>',
        '  <p>Incluye 30 días de publicación al mes, venta de boletería y mayor capacidad operativa en Live.</p>',
        '  <a href="plan-selection.html" class="secondary-button plan-card-action">Actualizar Plan</a>',
        '</div>'
      ].join('');
    }

    return [
      '<div class="plan-card premium-plan-card">',
      '  <div class="plan-card-header">',
      '    <span class="plan-icon" aria-hidden="true">',
      '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '        <path d="M12 4V20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      '        <path d="M7 9L12 4L17 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
      '      </svg>',
      '    </span>',
      '    <div class="plan-card-title-group">',
      '      <strong>' + escapeHtml(getSidebarPlanTitle(client.plan)) + '</strong>',
      '      <span class="plan-membership-status">Membresia activa</span>',
      '    </div>',
      '  </div>',
      '  <p>Tienes acceso ampliado para publicar eventos y gestionar tu negocio con mas capacidad.</p>',
      '</div>'
    ].join('');
  };

  const renderGlobalProfileDropdown = function () {
    const activeClient = loadActiveClient();

    document.querySelectorAll('.profile-dropdown').forEach(function (profileDropdown, index) {
      const profileTrigger = profileDropdown.querySelector('.profile-trigger');
      const dropdownMenu = profileDropdown.querySelector('.dropdown-menu');

      if (!profileTrigger || !dropdownMenu) {
        return;
      }

      const menuId = dropdownMenu.id || 'profileDropdownMenu' + String(index + 1);
      dropdownMenu.id = menuId;
      profileTrigger.setAttribute('aria-controls', menuId);
      profileTrigger.innerHTML = getProfileTriggerMarkup(activeClient);
      dropdownMenu.innerHTML = getProfileMenuMarkup(activeClient);
      profileDropdown.setAttribute('data-profile-dropdown-global', 'true');
    });
  };

  const renderGlobalSidebarPlanCard = function () {
    const activeClient = loadActiveClient();

    document.querySelectorAll('[data-global-plan-card]').forEach(function (planCardContainer) {
      planCardContainer.innerHTML = getSidebarPlanCardMarkup(activeClient);
    });
  };

  const syncPlanAvailabilityIndicators = function () {
    const activeClient = loadActiveClient();
    const availabilityValue = getPlanEventAvailability(activeClient.plan);

    document.querySelectorAll('[data-events-availability-value]').forEach(function (indicator) {
      indicator.textContent = availabilityValue;
    });
  };

  const renderPlanFeatureAccess = function () {
    const activeClient = loadActiveClient();

    document.querySelectorAll('[data-plan-feature]').forEach(function (featureLink) {
      const featureKey = featureLink.dataset.planFeature;
      const isAccessible = canAccessFeature(activeClient.plan, featureKey);
      const existingLock = featureLink.querySelector('.nav-link-lock');

      featureLink.classList.toggle('is-locked', !isAccessible);
      featureLink.setAttribute('aria-disabled', String(!isAccessible));

      if (existingLock) {
        existingLock.remove();
      }

      if (!isAccessible) {
        featureLink.insertAdjacentHTML('beforeend', [
          '<span class="nav-link-lock" aria-hidden="true">',
          '  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
          '    <rect x="5" y="11" width="14" height="9" rx="2"/>',
          '    <path d="M8 11V8.5C8 6.567 9.567 5 11.5 5H12.5C14.433 5 16 6.567 16 8.5V11" stroke-linecap="round"/>',
          '  </svg>',
          '</span>'
        ].join(''));
      }

      featureLink.onclick = null;
      featureLink.addEventListener('click', function (event) {
        if (canAccessFeature(loadActiveClient().plan, featureKey)) {
          return;
        }

        event.preventDefault();
        const featureRule = PLAN_FEATURE_REQUIREMENTS[featureKey];

        if (featureRule && featureRule.upgradeTarget) {
          navigateWithPortalTransition(featureRule.upgradeTarget);
        }
      });
    });
  };

  const navigateWithPortalTransition = function (targetUrl) {
    if (!targetUrl || isPortalNavigating) {
      return;
    }

    isPortalNavigating = true;
    body.classList.add('portal-page-leaving');

    window.setTimeout(function () {
      window.location.href = targetUrl;
    }, 260);
  };

  if (isPortalPage) {
    const portalTransition = document.createElement('div');
    portalTransition.className = 'portal-page-transition';
    portalTransition.setAttribute('aria-hidden', 'true');
    body.appendChild(portalTransition);

    window.requestAnimationFrame(function () {
      body.classList.add('portal-page-ready');
    });

    document.querySelectorAll('a[href]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        const href = link.getAttribute('href');

        if (!href || href === '#' || href.startsWith('mailto:') || href.startsWith('tel:')) {
          return;
        }

        if (link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        if (!href.endsWith('.html') && !href.includes('.html')) {
          return;
        }

        event.preventDefault();
        navigateWithPortalTransition(href);
      });
    });
  }

  const eyeButtons = document.querySelectorAll('.eye-toggle');
  const EYE_OPEN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_CLOSED = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M9.53 9.53A3 3 0 0 0 12 15a2.97 2.97 0 0 0 2.12-.88"/><path d="M6.71 6.72C4.64 8.11 3.24 10.1 2 12c2.19 3.36 5.58 7 10 7 1.91 0 3.63-.66 5.13-1.7"/><path d="M14.47 14.48L17.29 17.3"/><path d="M10.58 5.08A9.77 9.77 0 0 1 12 5c4.42 0 7.81 3.64 10 7a19.59 19.59 0 0 1-2.13 2.77"/></svg>';
  eyeButtons.forEach(button => {
    button.innerHTML = EYE_CLOSED;
    button.addEventListener('click', function () {
      const parent = this.closest('.password-field');
      const input = parent.querySelector('input');
      if (input.type === 'password') {
        input.type = 'text';
        this.innerHTML = EYE_OPEN;
      } else {
        input.type = 'password';
        this.innerHTML = EYE_CLOSED;
      }
    });
  });

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    const loginSubmitButton = loginForm.querySelector('.login-submit');

    const setLoginLoading = function (isLoading) {
      if (!loginSubmitButton) {
        return;
      }

      loginSubmitButton.classList.toggle('is-loading', isLoading);
      loginSubmitButton.disabled = isLoading;
    };

    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const email = formData.get('email');
      const password = formData.get('password');
      setLoginLoading(true);

      try {
        const response = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch {
          setLoginLoading(false);
          alert(text || 'No se pudo iniciar sesión. Intenta de nuevo.');
          return;
        }

        if (!response.ok) {
          setLoginLoading(false);
          alert(result.message || `Error ${response.status}`);
          return;
        }

        if (result.user) {
          saveActiveClient(result.user);
        }

        document.body.classList.add('is-transitioning');
        window.setTimeout(function () {
          window.location.href = result.redirect || '/dashboard.html';
        }, 650);
      } catch (error) {
        setLoginLoading(false);
        alert('No se pudo iniciar sesión. Intenta de nuevo.');
      }
    });
  }

  renderGlobalProfileDropdown();
  renderGlobalSidebarPlanCard();
  syncPlanAvailabilityIndicators();
  renderPlanFeatureAccess();

  document.querySelectorAll('.profile-dropdown').forEach(function (profileDropdown) {
    const profileTrigger = profileDropdown.querySelector('.profile-trigger');
    const dropdownMenu = profileDropdown.querySelector('.dropdown-menu');
    const logoutButton = profileDropdown.querySelector('.dropdown-logout');

    if (!profileTrigger || !dropdownMenu) {
      return;
    }

    const setDropdownOpen = function (isOpen) {
      profileDropdown.classList.toggle('is-open', isOpen);
      profileTrigger.setAttribute('aria-expanded', String(isOpen));
    };

    profileTrigger.addEventListener('click', function (event) {
      event.stopPropagation();

      document.querySelectorAll('.profile-dropdown.is-open').forEach(function (openDropdown) {
        if (openDropdown !== profileDropdown) {
          openDropdown.classList.remove('is-open');
          const openTrigger = openDropdown.querySelector('.profile-trigger');
          if (openTrigger) {
            openTrigger.setAttribute('aria-expanded', 'false');
          }
        }
      });

      setDropdownOpen(!profileDropdown.classList.contains('is-open'));
    });

    dropdownMenu.addEventListener('click', function (event) {
      event.stopPropagation();
    });

    if (logoutButton) {
      logoutButton.addEventListener('click', function () {
        setDropdownOpen(false);
        clearActiveClient();

        if (isPortalPage) {
          navigateWithPortalTransition('/index.html');
          return;
        }

        window.location.href = '/index.html';
      });
    }
  });

  document.addEventListener('click', function (event) {
    document.querySelectorAll('.profile-dropdown.is-open').forEach(function (profileDropdown) {
      if (!profileDropdown.contains(event.target)) {
        profileDropdown.classList.remove('is-open');
        const profileTrigger = profileDropdown.querySelector('.profile-trigger');
        if (profileTrigger) {
          profileTrigger.setAttribute('aria-expanded', 'false');
        }
      }
    });
  });

  const onboardingBanner = document.getElementById('onboardingBanner');
  const onboardingBannerClose = document.getElementById('onboardingBannerClose');
  const createProfileLink = document.getElementById('createProfileLink');

  if (createProfileLink && createProfileLink.getAttribute('href') === '#') {
    createProfileLink.addEventListener('click', function (event) {
      event.preventDefault();
    });
  }

  if (onboardingBanner && onboardingBannerClose) {
    onboardingBannerClose.addEventListener('click', function () {
      onboardingBanner.classList.add('hidden');
    });
  }

  if (onboardingBanner) {
    const bannerTitle = onboardingBanner.querySelector('.onboarding-banner-title');
    const bannerText = onboardingBanner.querySelector('.onboarding-banner-text');

    requestJson('/api/business-profiles?clientEmail=' + encodeURIComponent(getActiveClientEmail())).then(function (result) {
      const profiles = Array.isArray(result.profiles) ? result.profiles : [];

      if (!profiles.length) {
        return;
      }

      const latestProfile = profiles[0];
      const latestStatusLabel = getVerificationStatusLabel(latestProfile.verificationStatus);

      if (bannerTitle) {
        bannerTitle.textContent = 'Ya tienes ' + profiles.length + ' perfil' + (profiles.length > 1 ? 'es' : '') + ' conectado' + (profiles.length > 1 ? 's' : '') + '.';
      }

      if (bannerText) {
        bannerText.innerHTML = 'Tu perfil más reciente está en estado <strong>' + escapeHtml(latestStatusLabel) + '</strong>. Desde aquí puedes continuar con documentos o revisar su progreso en tiempo real. <a href="business-profile-details.html?profileId=' + encodeURIComponent(latestProfile.id) + '" class="onboarding-banner-link" id="createProfileLink">Gestionar perfil</a>';
      }
    }).catch(function () {
      return null;
    });
  }

  const profileSetup = document.querySelector('[data-profile-setup]');
  if (profileSetup) {
    const profilePanels = Array.from(profileSetup.querySelectorAll('[data-profile-panel]'));
    const continueButton = document.getElementById('profileContinueButton');
    const taxIdInput = profileSetup.querySelector('input[name="taxId"]');
    const verificationDigitInput = profileSetup.querySelector('input[name="verificationDigit"]');
    const taxIdFormattedInput = profileSetup.querySelector('input[name="taxIdFormatted"]');
    const taxIdFormattedDisplay = profileSetup.querySelector('[data-tax-id-formatted]');

    const setContinueLoading = function (isLoading) {
      if (!continueButton) {
        return;
      }

      continueButton.classList.toggle('is-loading', isLoading);
      continueButton.textContent = isLoading ? 'Creando perfil...' : 'Crear perfil y continuar';

      if (isLoading) {
        continueButton.disabled = true;
        return;
      }

      updateContinueState();
    };

    const syncTaxIdFields = function () {
      const normalizedTaxId = String(taxIdInput && taxIdInput.value ? taxIdInput.value : '').replace(/\D/g, '');
      const normalizedVerificationDigit = String(verificationDigitInput && verificationDigitInput.value ? verificationDigitInput.value : '').replace(/\D/g, '').slice(0, 1);
      const formattedTaxId = formatTaxId(normalizedTaxId, normalizedVerificationDigit);

      if (taxIdInput) {
        taxIdInput.value = normalizedTaxId;
      }

      if (verificationDigitInput) {
        verificationDigitInput.value = normalizedVerificationDigit;
      }

      if (taxIdFormattedInput) {
        taxIdFormattedInput.value = formattedTaxId;
      }

      if (taxIdFormattedDisplay) {
        taxIdFormattedDisplay.textContent = formattedTaxId || 'Completa NIT y DV';
      }
    };

    const collectProfileSetupPayload = function () {
      const activePanel = getActivePanel();
      const clientEmail = getActiveClientEmail();

      if (!activePanel) {
        return null;
      }

      if (activePanel.dataset.profilePanel === 'juridica') {
        const companyNameField = activePanel.querySelector('input[name="companyName"]');
        const legalRepresentativeField = activePanel.querySelector('input[name="legalRepresentative"]');
        const taxId = String(taxIdInput && taxIdInput.value ? taxIdInput.value : '').replace(/\D/g, '');
        const verificationDigit = String(verificationDigitInput && verificationDigitInput.value ? verificationDigitInput.value : '').replace(/\D/g, '').slice(0, 1);

        return {
          clientEmail,
          profileType: 'LEGAL',
          companyName: String(companyNameField && companyNameField.value ? companyNameField.value : '').trim(),
          taxId,
          verificationDigit,
          taxIdFormatted: formatTaxId(taxId, verificationDigit),
          legalRepresentative: String(legalRepresentativeField && legalRepresentativeField.value ? legalRepresentativeField.value : '').trim()
        };
      }

      const fullNameField = activePanel.querySelector('input[name="fullName"]');
      const documentTypeField = activePanel.querySelector('select[name="documentType"]');
      const documentNumberField = activePanel.querySelector('input[name="documentNumber"]');
      const expeditionDateField = activePanel.querySelector('input[name="expeditionDate"]');

      return {
        clientEmail,
        profileType: 'NATURAL',
        fullName: String(fullNameField && fullNameField.value ? fullNameField.value : '').trim(),
        documentTypeExpected: mapDocumentTypeValue(documentTypeField && documentTypeField.value ? documentTypeField.value : ''),
        documentNumber: String(documentNumberField && documentNumberField.value ? documentNumberField.value : '').trim(),
        expeditionDate: String(expeditionDateField && expeditionDateField.value ? expeditionDateField.value : '').trim()
      };
    };

    const getActivePanel = function () {
      return profilePanels.find(function (panel) {
        return panel.classList.contains('is-active');
      });
    };

    const updateContinueState = function () {
      if (!continueButton) {
        return;
      }

      const activePanel = getActivePanel();
      if (!activePanel) {
        continueButton.disabled = true;
        return;
      }

      const requiredFields = Array.from(activePanel.querySelectorAll('.profile-type-panel-fieldset [required]')).filter(function (field) {
        return !field.disabled;
      });

      const isComplete = requiredFields.every(function (field) {
        return String(field.value).trim() !== '';
      });

      continueButton.disabled = !isComplete;
    };

    const setActivePanel = function (activeKey) {
      profilePanels.forEach(function (panel) {
        const isActive = panel.dataset.profilePanel === activeKey;
        const badge = panel.querySelector('.profile-panel-badge');
        const fieldset = panel.querySelector('.profile-type-panel-fieldset');

        panel.classList.toggle('is-active', isActive);
        panel.classList.toggle('is-inactive', !isActive);
        panel.setAttribute('aria-pressed', String(isActive));

        if (badge) {
          badge.textContent = isActive ? 'Activo' : 'Inactivo';
        }

        if (fieldset) {
          fieldset.disabled = !isActive;
        }
      });

      updateContinueState();
    };

    profilePanels.forEach(function (panel) {
      panel.addEventListener('click', function () {
        if (!panel.classList.contains('is-active')) {
          setActivePanel(panel.dataset.profilePanel);
        }
      });

      panel.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setActivePanel(panel.dataset.profilePanel);
        }
      });

      panel.querySelectorAll('input, select').forEach(function (field) {
        field.addEventListener('input', updateContinueState);
        field.addEventListener('change', updateContinueState);
      });
    });

    if (taxIdInput) {
      taxIdInput.addEventListener('input', syncTaxIdFields);
      taxIdInput.addEventListener('change', syncTaxIdFields);
    }

    if (verificationDigitInput) {
      verificationDigitInput.addEventListener('input', syncTaxIdFields);
      verificationDigitInput.addEventListener('change', syncTaxIdFields);
    }

    if (continueButton) {
      continueButton.addEventListener('click', async function () {
        if (continueButton.disabled) {
          return;
        }

        const payload = collectProfileSetupPayload();

        if (!payload || !payload.clientEmail) {
          alert('Primero debes iniciar sesión con un cliente válido para crear el perfil.');
          return;
        }

        setContinueLoading(true);

        try {
          const result = await requestJson('/api/business-profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          navigateWithPortalTransition('business-profile-details.html?profileId=' + encodeURIComponent(result.profile.id));
        } catch (error) {
          setContinueLoading(false);
          alert(error.message || 'No se pudo crear el perfil.');
          return;
        }
      });
    }

    syncTaxIdFields();
    setActivePanel('natural');
  }

  const categoryChips = document.querySelectorAll('[data-category-chip]');
  if (categoryChips.length) {
    const getSelectedCategories = function () {
      return Array.from(categoryChips).filter(function (chip) {
        return chip.getAttribute('aria-pressed') === 'true';
      }).map(function (chip) {
        return String(chip.textContent || '').trim();
      });
    };

    const setSelectedCategories = function (categories) {
      const normalizedCategories = Array.isArray(categories)
        ? categories.map(function (category) { return String(category || '').trim().toLowerCase(); })
        : [];

      categoryChips.forEach(function (chip) {
        const chipLabel = String(chip.textContent || '').trim().toLowerCase();
        const isSelected = normalizedCategories.includes(chipLabel);
        chip.setAttribute('aria-pressed', String(isSelected));
        chip.classList.toggle('is-selected', isSelected);
      });

      syncCategoryChipAvailability();
    };

    const syncCategoryChipAvailability = function () {
      const selectedCount = getSelectedCategories().length;

      categoryChips.forEach(function (chip) {
        const isSelected = chip.getAttribute('aria-pressed') === 'true';
        chip.classList.toggle('is-disabled', selectedCount >= 2 && !isSelected);
      });
    };

    categoryChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        const isSelected = chip.getAttribute('aria-pressed') === 'true';

        if (!isSelected) {
          const selectedCount = Array.from(categoryChips).filter(function (selectedChip) {
            return selectedChip.getAttribute('aria-pressed') === 'true';
          }).length;

          if (selectedCount >= 2) {
            return;
          }
        }

        chip.setAttribute('aria-pressed', String(!isSelected));
        chip.classList.toggle('is-selected', !isSelected);
        syncCategoryChipAvailability();
      });
    });

    selectedCategoryApi = {
      getSelectedCategories,
      setSelectedCategories,
      syncCategoryChipAvailability
    };

    syncCategoryChipAvailability();
  }

  const createBusinessProfileButton = document.getElementById('createBusinessProfileButton');
  if (createBusinessProfileButton) {
    const profileId = getProfileIdFromUrl();
    const detailsPage = document.querySelector('[data-profile-details]');
    const businessNameInput = detailsPage ? detailsPage.querySelector('input[name="businessName"]') : null;
    const businessUsernameInput = detailsPage ? detailsPage.querySelector('input[name="businessUsername"]') : null;
    const businessCitySelect = detailsPage ? detailsPage.querySelector('select[name="businessCity"]') : null;
    const statusLabel = detailsPage ? detailsPage.querySelector('[data-profile-status-label]') : null;
    const statusMessage = detailsPage ? detailsPage.querySelector('[data-profile-status-message]') : null;
    const publishFlag = detailsPage ? detailsPage.querySelector('[data-profile-publish-flag]') : null;
    const statusShell = detailsPage ? detailsPage.querySelector('[data-profile-status-shell]') : null;
    const refreshStatusButton = detailsPage ? detailsPage.querySelector('[data-profile-refresh-status]') : null;
    const documentsGrid = detailsPage ? detailsPage.querySelector('[data-profile-documents-grid]') : null;
    let currentProfile = null;

    const setProfileSaveLoading = function (isLoading) {
      createBusinessProfileButton.disabled = isLoading;
      createBusinessProfileButton.classList.toggle('is-loading', isLoading);
      createBusinessProfileButton.textContent = isLoading ? 'Guardando perfil...' : 'Guardar perfil';
    };

    if (businessCitySelect) {
      businessCitySelect.value = ALLOWED_PROFILE_CITY;
    }

    const setStatusRefreshLoading = function (isLoading) {
      if (!refreshStatusButton) {
        return;
      }

      refreshStatusButton.disabled = isLoading;
      refreshStatusButton.textContent = isLoading ? 'Actualizando...' : 'Actualizar estado';
    };

    const renderProfileStatus = function (verificationPayload) {
      if (!verificationPayload || !statusShell) {
        return;
      }

      const verificationStatus = verificationPayload.verificationStatus || (currentProfile && currentProfile.verificationStatus) || 'PENDING';
      const summary = verificationPayload.summary || {};
      const missingDocuments = Array.isArray(summary.missingDocumentRoles) && summary.missingDocumentRoles.length
        ? 'Faltan documentos: ' + summary.missingDocumentRoles.join(', ') + '.'
        : '';
      const rejectionReasons = Array.isArray(summary.rejectionReasons) && summary.rejectionReasons.length
        ? ' Motivos: ' + summary.rejectionReasons.join(', ') + '.'
        : '';
      const baseMessage = verificationPayload.verificationCase && verificationPayload.verificationCase.summary
        ? verificationPayload.verificationCase.summary
        : missingDocuments || 'El estado del perfil se está leyendo en tiempo real desde el backend.';

      statusShell.className = 'profile-status-shell ' + getVerificationStatusTheme(verificationStatus);

      if (statusLabel) {
        statusLabel.textContent = getVerificationStatusLabel(verificationStatus);
      }

      if (statusMessage) {
        statusMessage.textContent = baseMessage + rejectionReasons;
      }

      if (publishFlag) {
        publishFlag.textContent = verificationPayload.canPublishEvents
          ? 'Habilitado para publicar eventos'
          : 'Aún no habilitado para publicar eventos';
        publishFlag.className = 'profile-status-flag ' + (verificationPayload.canPublishEvents ? 'is-approved' : 'is-pending');
      }
    };

    const buildDocumentCardMarkup = function (documentConfig, currentDocument) {
      const currentStatus = currentDocument ? String(currentDocument.verificationStatus || '').toUpperCase() : 'PENDING';
      const allowUpload = !currentDocument || currentStatus === 'REJECTED' || currentStatus === 'MANUAL_REVIEW';
      const actionLabel = currentDocument ? 'Volver a cargar' : 'Subir documento';
      const helperText = currentDocument
        ? (currentDocument.originalFileName || 'Documento cargado') + ' · ' + getVerificationStatusLabel(currentStatus)
        : 'Aún no has subido este documento.';
      const rejectionText = currentDocument && Array.isArray(currentDocument.rejectionReasons) && currentDocument.rejectionReasons.length
        ? '<p class="document-card-reasons">Motivos: ' + escapeHtml(currentDocument.rejectionReasons.join(', ')) + '</p>'
        : '';

      return [
        '<article class="document-upload-card ' + getVerificationStatusTheme(currentStatus) + '" data-document-card data-document-role="' + escapeHtml(documentConfig.role) + '"' + (currentDocument ? ' data-document-id="' + escapeHtml(currentDocument.id) + '"' : '') + '>',
        '  <div class="document-upload-card-head">',
        '    <div>',
        '      <strong>' + escapeHtml(documentConfig.title) + '</strong>',
        '      <p>' + escapeHtml(documentConfig.description) + '</p>',
        '    </div>',
        '    <span class="document-status-pill ' + getVerificationStatusTheme(currentStatus) + '">' + escapeHtml(getVerificationStatusLabel(currentStatus)) + '</span>',
        '  </div>',
        '  <p class="document-card-file">' + escapeHtml(helperText) + '</p>',
           rejectionText,
        '  <label class="document-file-picker">',
        '    <span>Seleccionar archivo</span>',
        '    <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf">',
        '  </label>',
        '  <button type="button" class="secondary-button document-upload-action"' + (allowUpload ? '' : ' disabled') + '>' + actionLabel + '</button>',
        '  <p class="field-helper-text">Formatos permitidos: JPG, PNG, WEBP o PDF.</p>',
        '</article>'
      ].join('');
    };

    const renderDocumentCards = function (profile) {
      if (!documentsGrid || !profile) {
        return;
      }

      const documentConfig = PROFILE_DOCUMENT_CONFIG[String(profile.profileType || '').toUpperCase()] || [];
      const currentDocuments = Array.isArray(profile.documents) ? profile.documents : [];

      documentsGrid.innerHTML = documentConfig.map(function (config) {
        const currentDocument = currentDocuments.find(function (document) {
          return document.documentRole === config.role;
        }) || null;

        return buildDocumentCardMarkup(config, currentDocument);
      }).join('');

      documentsGrid.querySelectorAll('[data-document-card]').forEach(function (card) {
        const fileInput = card.querySelector('input[type="file"]');
        const uploadButton = card.querySelector('.document-upload-action');
        const documentRole = card.dataset.documentRole;
        const documentId = card.dataset.documentId;

        if (!fileInput || !uploadButton || uploadButton.disabled) {
          return;
        }

        uploadButton.addEventListener('click', async function () {
          const selectedFile = fileInput.files && fileInput.files[0];

          if (!selectedFile) {
            alert('Selecciona primero un archivo para ' + documentRole + '.');
            return;
          }

          uploadButton.disabled = true;
          uploadButton.textContent = 'Subiendo...';

          const formData = new FormData();
          formData.append('clientEmail', getActiveClientEmail());
          formData.append('documentRole', documentRole);
          formData.append('document', selectedFile);

          try {
            const endpoint = documentId && (card.classList.contains('is-rejected') || card.classList.contains('is-review'))
              ? '/api/business-profiles/' + encodeURIComponent(profileId) + '/documents/' + encodeURIComponent(documentId) + '/reupload'
              : '/api/business-profiles/' + encodeURIComponent(profileId) + '/documents';
            await requestJson(endpoint, {
              method: 'POST',
              body: formData
            });

            await refreshProfileData();
          } catch (error) {
            uploadButton.disabled = false;
            uploadButton.textContent = documentId ? 'Volver a cargar' : 'Subir documento';
            alert(error.message || 'No se pudo subir el documento.');
          }
        });
      });
    };

    const populateProfileDetails = function (profile) {
      if (!profile) {
        return;
      }

      currentProfile = profile;

      if (businessNameInput) {
        businessNameInput.value = profile.businessName || '';
      }

      if (businessUsernameInput) {
        businessUsernameInput.value = profile.businessUsername || '';
      }

      if (businessCitySelect) {
        businessCitySelect.value = normalizeBusinessCityValue(profile.businessCity) || ALLOWED_PROFILE_CITY;
      }

      if (selectedCategoryApi) {
        selectedCategoryApi.setSelectedCategories(profile.categories || []);
      }

      renderDocumentCards(profile);
    };

    var refreshProfileData = async function () {
      if (!profileId) {
        return;
      }

      setStatusRefreshLoading(true);

      try {
        const clientEmail = getActiveClientEmail();
        const [profileResult, statusResult] = await Promise.all([
          requestJson('/api/business-profiles/' + encodeURIComponent(profileId) + '?clientEmail=' + encodeURIComponent(clientEmail)),
          requestJson('/api/business-profiles/' + encodeURIComponent(profileId) + '/verification-status?clientEmail=' + encodeURIComponent(clientEmail))
        ]);

        populateProfileDetails(profileResult.profile);
        renderProfileStatus(statusResult);
      } catch (error) {
        alert(error.message || 'No se pudo cargar el perfil.');
      } finally {
        setStatusRefreshLoading(false);
      }
    };

    if (!profileId) {
      alert('Primero debes crear el perfil base antes de completar sus detalles.');
      navigateWithPortalTransition('business-profile.html');
      return;
    }

    if (refreshStatusButton) {
      refreshStatusButton.addEventListener('click', function () {
        refreshProfileData();
      });
    }

    createBusinessProfileButton.addEventListener('click', async function (event) {
      event.preventDefault();

      const clientEmail = getActiveClientEmail();
      if (!clientEmail) {
        alert('No hay un cliente activo para actualizar este perfil.');
        return;
      }

      setProfileSaveLoading(true);

      try {
        const selectedBusinessCity = normalizeBusinessCityValue(businessCitySelect ? businessCitySelect.value : '');

        if (selectedBusinessCity !== ALLOWED_PROFILE_CITY) {
          alert('Por ahora solo puedes seleccionar Barranquilla como ciudad del perfil.');
          return;
        }

        const payload = {
          clientEmail,
          businessName: businessNameInput ? businessNameInput.value : '',
          businessUsername: businessUsernameInput ? businessUsernameInput.value : '',
          businessCity: selectedBusinessCity,
          categories: selectedCategoryApi ? selectedCategoryApi.getSelectedCategories() : []
        };

        if (currentProfile && currentProfile.profileType === 'LEGAL' && currentProfile.legalEntity) {
          payload.companyName = currentProfile.legalEntity.companyName;
          payload.taxId = currentProfile.legalEntity.taxId;
          payload.verificationDigit = currentProfile.legalEntity.verificationDigit;
          payload.legalRepresentative = currentProfile.legalEntity.legalRepresentative;
        }

        if (currentProfile && currentProfile.profileType === 'NATURAL' && currentProfile.naturalPerson) {
          payload.fullName = currentProfile.naturalPerson.fullName;
          payload.documentTypeExpected = currentProfile.naturalPerson.documentTypeExpected;
          payload.documentNumber = currentProfile.naturalPerson.documentNumber;
          payload.expeditionDate = currentProfile.naturalPerson.expeditionDate;
        }

        const result = await requestJson('/api/business-profiles/' + encodeURIComponent(profileId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        currentProfile = result.profile;
        await refreshProfileData();
      } catch (error) {
        alert(error.message || 'No se pudo guardar el perfil.');
      } finally {
        setProfileSaveLoading(false);
      }
    });

    refreshProfileData();
  }

  const createEventCard = document.querySelector('.event-card-create[href="#"]');
  if (createEventCard) {
    createEventCard.addEventListener('click', function (event) {
      event.preventDefault();
    });
  }

  const createEventTriggers = document.querySelectorAll('[data-create-event-trigger]');
  if (createEventTriggers.length) {
    createEventTriggers.forEach(function (trigger) {
      trigger.addEventListener('click', async function (event) {
        event.preventDefault();

        try {
          await requestJson('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientEmail: getActiveClientEmail(),
              title: 'Evento de prueba desde UI'
            })
          });
        } catch (error) {
          alert(error.message || 'Aún no puedes crear eventos con tu estado actual.');
        }
      });
    });
  }

  const eventTabs = document.querySelectorAll('[data-event-tab]');
  if (eventTabs.length) {
    const setActiveEventTab = function (activeTab) {
      eventTabs.forEach(function (tab) {
        const isActive = tab === activeTab;
        tab.classList.toggle('is-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
      });
    };

    eventTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        setActiveEventTab(tab);
      });
    });
  }

  const planSelector = document.querySelector('[data-plan-selector]');
  if (planSelector) {
    const activeClient = loadActiveClient();
    const planCards = Array.from(planSelector.querySelectorAll('[data-plan-option]'));

    const getCurrentPlanOptionKey = function (plan) {
      const normalizedPlan = String(plan || '').toUpperCase();

      if (normalizedPlan === 'GRATUITO') {
        return 'gratuito';
      }

      if (normalizedPlan === 'PREMIUM_PLUS') {
        return 'premium-plus';
      }

      return 'premium';
    };

    const applyCurrentPlanState = function (currentPlanKey) {
      planCards.forEach(function (card) {
        const button = card.querySelector('[data-plan-select-button]');
        const existingCurrentLabel = card.querySelector('.plan-current-label');
        const isCurrentPlan = card.dataset.planOption === currentPlanKey;
        const isFreePlan = card.dataset.planOption === 'gratuito';
        const shouldDisable = isFreePlan || isCurrentPlan;

        card.classList.toggle('is-disabled', shouldDisable);
        card.classList.toggle('is-selected', false);
        card.setAttribute('aria-disabled', String(shouldDisable));
        card.setAttribute('aria-pressed', 'false');
        card.tabIndex = shouldDisable ? -1 : 0;

        if (button) {
          button.classList.remove('is-selected');
          button.textContent = 'Seleccionar plan';
          button.hidden = shouldDisable;
        }

        if (existingCurrentLabel) {
          existingCurrentLabel.remove();
        }

        if (isCurrentPlan) {
          card.insertAdjacentHTML('beforeend', '<div class="plan-current-label">Plan actual</div>');
        }
      });
    };

    const getDefaultSelectablePlan = function (currentPlanKey) {
      if (currentPlanKey === 'gratuito') {
        return 'premium';
      }

      if (currentPlanKey === 'premium') {
        return 'premium-plus';
      }

      return null;
    };

    const setSelectedPlan = function (selectedKey) {
      planCards.forEach(function (card) {
        const isSelected = card.dataset.planOption === selectedKey;
        const button = card.querySelector('[data-plan-select-button]');
        const isDisabled = card.classList.contains('is-disabled');

        card.classList.toggle('is-selected', !isDisabled && isSelected);
        card.setAttribute('aria-pressed', String(!isDisabled && isSelected));

        if (button) {
          button.classList.toggle('is-selected', !isDisabled && isSelected);
          button.textContent = !isDisabled && isSelected ? 'Continuar con este plan' : 'Seleccionar plan';
        }
      });
    };

    planCards.forEach(function (card) {
      const button = card.querySelector('[data-plan-select-button]');

      card.addEventListener('click', function () {
        if (card.classList.contains('is-disabled')) {
          return;
        }

        setSelectedPlan(card.dataset.planOption);
      });

      card.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          if (card.classList.contains('is-disabled')) {
            return;
          }

          event.preventDefault();
          setSelectedPlan(card.dataset.planOption);
        }
      });

      if (button) {
        button.addEventListener('click', function (event) {
          event.stopPropagation();

          if (card.classList.contains('is-disabled')) {
            return;
          }

          setSelectedPlan(card.dataset.planOption);
        });
      }
    });

    applyCurrentPlanState(getCurrentPlanOptionKey(activeClient.plan));

    const defaultSelectablePlan = getDefaultSelectablePlan(getCurrentPlanOptionKey(activeClient.plan));
    if (defaultSelectablePlan) {
      setSelectedPlan(defaultSelectablePlan);
    }
  }

  const registerForm = document.querySelector('.register-form');
  if (registerForm) {
    const modal = document.getElementById('successModal');
    const modalClose = document.getElementById('modalClose');
    const registerSubmitButton = registerForm.querySelector('.login-submit');
    let registerRedirectTarget = '/dashboard.html';

    const setRegisterLoading = function (isLoading) {
      if (!registerSubmitButton) {
        return;
      }

      registerSubmitButton.classList.toggle('is-loading', isLoading);
      registerSubmitButton.disabled = isLoading;
    };

    registerForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      const formData = new FormData(registerForm);
      setRegisterLoading(true);

      try {
        const response = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: formData.get('fullName'),
            email: formData.get('email'),
            phone: formData.get('phone'),
            password: formData.get('password')
          })
        });

        const text = await response.text();
        let result;

        try {
          result = JSON.parse(text);
        } catch {
          setRegisterLoading(false);
          alert(text || 'No se pudo crear la cuenta. Intenta de nuevo.');
          return;
        }

        if (!response.ok) {
          setRegisterLoading(false);
          alert(result.message || `Error ${response.status}`);
          return;
        }

        if (result.user) {
          saveActiveClient(result.user);
          saveRegisteredClientDraft(result.user);
        }

        registerRedirectTarget = result.redirect || '/dashboard.html';
        registerForm.reset();
        modal.classList.remove('hidden');
        setRegisterLoading(false);
      } catch (error) {
        setRegisterLoading(false);
        alert('No se pudo crear la cuenta. Intenta de nuevo.');
      }
    });

    if (modalClose) {
      modalClose.addEventListener('click', function () {
        document.getElementById('successModal').classList.add('hidden');
        window.location.href = registerRedirectTarget;
      });
    }

    if (modal) {
      modal.addEventListener('click', function (event) {
        if (event.target === this) {
          this.classList.add('hidden');
        }
      });
    }
  }
});
