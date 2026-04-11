document.addEventListener('DOMContentLoaded', function () {
  const body = document.body;
  const isPortalPage = body.classList.contains('dashboard-body');
  let isPortalNavigating = false;
  const ACTIVE_CLIENT_STORAGE_KEY = 'livenActiveClient';
  const REGISTERED_CLIENT_DRAFT_STORAGE_KEY = 'livenRegisteredClientDraft';
  const DEFAULT_ACTIVE_CLIENT = {
    fullName: 'Liven Premium+',
    email: 'cliente@liven.com',
    role: 'CLIENTE',
    plan: 'PREMIUM_PLUS'
  };

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
      return '3';
    }

    if (normalizedPlan === 'PREMIUM_PLUS') {
      return 'Ilimitado';
    }

    return '30';
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

    return fullName || 'Liven App';
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

  const saveRegisteredClientDraft = function (client) {
    window.localStorage.setItem(REGISTERED_CLIENT_DRAFT_STORAGE_KEY, JSON.stringify(normalizeActiveClient(client)));
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
        '  <p>Actualiza para desbloquear todas las funciones premium y publicar mas eventos dentro de Liven.</p>',
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
        '  <p>Tienes acceso completo a todas las funcionalidades de Liven.</p>',
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
        '  <p>Tienes acceso a venta de boleteria y hasta 30 eventos mensuales dentro de Liven.</p>',
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

  const profileSetup = document.querySelector('[data-profile-setup]');
  if (profileSetup) {
    const profilePanels = Array.from(profileSetup.querySelectorAll('[data-profile-panel]'));
    const continueButton = document.getElementById('profileContinueButton');

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

    if (continueButton) {
      continueButton.addEventListener('click', function () {
        if (continueButton.disabled) {
          return;
        }

        navigateWithPortalTransition('business-profile-details.html');
      });
    }

    setActivePanel('natural');
  }

  const categoryChips = document.querySelectorAll('[data-category-chip]');
  if (categoryChips.length) {
    const syncCategoryChipAvailability = function () {
      const selectedCount = Array.from(categoryChips).filter(function (selectedChip) {
        return selectedChip.getAttribute('aria-pressed') === 'true';
      }).length;

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

    syncCategoryChipAvailability();
  }

  const createBusinessProfileButton = document.getElementById('createBusinessProfileButton');
  if (createBusinessProfileButton) {
    createBusinessProfileButton.addEventListener('click', function (event) {
      event.preventDefault();
    });
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
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
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
