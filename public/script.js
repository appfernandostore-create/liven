document.addEventListener('DOMContentLoaded', function () {
  const body = document.body;
  const isPortalPage = body.classList.contains('dashboard-body');
  let isPortalNavigating = false;
  const ACTIVE_CLIENT_STORAGE_KEY = 'livenActiveClient';
  const ACTIVE_BUSINESS_PROFILE_STORAGE_KEY = 'livenActiveBusinessProfileId';
  const REGISTERED_CLIENT_DRAFT_STORAGE_KEY = 'livenRegisteredClientDraft';
  const PENDING_PROFILE_SETUP_TRANSITION_STORAGE_KEY = 'livenPendingProfileSetupTransitionId';
  const DEFAULT_ACTIVE_CLIENT = {
    fullName: 'Live Premium+',
    email: 'cliente@live.local',
    role: 'CLIENTE',
    plan: 'PREMIUM_PLUS'
  };
  const MAX_PROFILE_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;
  const MAX_PROFILE_CATEGORIES = 2;
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
        title: 'Comprobante del NIT',
        description: 'Carga el comprobante tributario vigente asociado al NIT de la empresa o establecimiento.'
      }
    ]
  };
  const ALLOWED_PROFILE_CITY = 'Barranquilla';
  let selectedCategoryApi = null;
  let categorySelectionReadonly = false;
  let renderDashboardOnboardingBanner = null;

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

  const getBusinessProfileDisplayName = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return 'Perfil de negocio';
    }

    return String(
      profile.businessName
      || profile.displayName
      || (profile.legalEntity && profile.legalEntity.companyName)
      || (profile.naturalPerson && profile.naturalPerson.fullName)
      || 'Perfil de negocio'
    ).trim();
  };

  const getBusinessProfileInitials = function (profile) {
    const nameParts = getBusinessProfileDisplayName(profile).split(/\s+/).filter(Boolean);
    const initials = nameParts.slice(0, 2).map(function (part) {
      return part.charAt(0).toUpperCase();
    }).join('');

    return initials || 'LN';
  };

  const saveActiveBusinessProfileId = function (profileId) {
    const normalizedProfileId = String(profileId || '').trim();

    if (!normalizedProfileId) {
      window.sessionStorage.removeItem(ACTIVE_BUSINESS_PROFILE_STORAGE_KEY);
      return;
    }

    window.sessionStorage.setItem(ACTIVE_BUSINESS_PROFILE_STORAGE_KEY, normalizedProfileId);
  };

  const loadActiveBusinessProfileId = function () {
    return String(window.sessionStorage.getItem(ACTIVE_BUSINESS_PROFILE_STORAGE_KEY) || '').trim();
  };

  const savePendingProfileSetupTransitionId = function (profileId) {
    const normalizedProfileId = String(profileId || '').trim();

    if (!normalizedProfileId) {
      window.sessionStorage.removeItem(PENDING_PROFILE_SETUP_TRANSITION_STORAGE_KEY);
      return;
    }

    window.sessionStorage.setItem(PENDING_PROFILE_SETUP_TRANSITION_STORAGE_KEY, normalizedProfileId);
  };

  const consumePendingProfileSetupTransitionId = function () {
    const pendingProfileId = String(window.sessionStorage.getItem(PENDING_PROFILE_SETUP_TRANSITION_STORAGE_KEY) || '').trim();

    window.sessionStorage.removeItem(PENDING_PROFILE_SETUP_TRANSITION_STORAGE_KEY);
    return pendingProfileId;
  };

  const clearPendingProfileSetupTransitionId = function () {
    window.sessionStorage.removeItem(PENDING_PROFILE_SETUP_TRANSITION_STORAGE_KEY);
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
    window.sessionStorage.removeItem(ACTIVE_BUSINESS_PROFILE_STORAGE_KEY);
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

  const getFriendlyAuthErrorMessage = function (message, fallbackMessage) {
    const normalizedMessage = String(message || '').trim().toLowerCase();

    if (!normalizedMessage) {
      return fallbackMessage;
    }

    if (normalizedMessage.includes('credenciales')) {
      return 'Los datos ingresados no son correctos. Verifica tu correo y tu contrasena.';
    }

    if (normalizedMessage.includes('correo ya registrado') || normalizedMessage.includes('email ya registrado')) {
      return 'Ese correo ya esta registrado. Inicia sesion o usa otro correo.';
    }

    if (normalizedMessage.includes('contrasena') || normalizedMessage.includes('password')) {
      return 'Revisa los datos ingresados e intenta nuevamente.';
    }

    if (normalizedMessage.includes('demasiado grande') || normalizedMessage.includes('too large')) {
      return 'La informacion enviada es demasiado pesada. Reduce el tamano de los archivos e intenta nuevamente.';
    }

    return fallbackMessage;
  };

  const getFriendlyEventCreationErrorMessage = function (error) {
    const normalizedMessage = String(error && error.message ? error.message : '').trim().toLowerCase();

    if (!normalizedMessage) {
      return 'Aun no puedes crear eventos con tu estado actual.';
    }

    if (normalizedMessage.includes('aprobado') || normalizedMessage.includes('approved')) {
      return 'Tu perfil de negocio debe estar activo antes de publicar eventos.';
    }

    if (normalizedMessage.includes('revision') || normalizedMessage.includes('verificacion') || normalizedMessage.includes('correccion')) {
      return 'Tu perfil todavia esta en revision o requiere ajustes antes de publicar eventos.';
    }

    return 'Aun no puedes crear eventos con tu estado actual.';
  };

  let globalFeedbackModalElements = null;

  const ensureGlobalFeedbackModal = function () {
    if (globalFeedbackModalElements) {
      return globalFeedbackModalElements;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay hidden';
    overlay.id = 'globalFeedbackModal';
    overlay.innerHTML = [
      '<div class="modal-card portal-feedback-modal-card is-error" role="dialog" aria-modal="true" aria-labelledby="globalFeedbackModalTitle">',
      '<span class="portal-feedback-badge" id="globalFeedbackModalBadge">Atención</span>',
      '<h2 id="globalFeedbackModalTitle">Algo salió mal</h2>',
      '<p id="globalFeedbackModalMessage">Intenta nuevamente en unos segundos.</p>',
      '<div class="portal-feedback-actions">',
      '<button class="primary-button" id="globalFeedbackModalPrimary" type="button">Entendido</button>',
      '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);

    const card = overlay.querySelector('.portal-feedback-modal-card');
    const badge = overlay.querySelector('#globalFeedbackModalBadge');
    const title = overlay.querySelector('#globalFeedbackModalTitle');
    const message = overlay.querySelector('#globalFeedbackModalMessage');
    const primary = overlay.querySelector('#globalFeedbackModalPrimary');

    const hide = function () {
      overlay.classList.add('hidden');
    };

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) {
        hide();
      }
    });

    primary.addEventListener('click', hide);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
        hide();
      }
    });

    globalFeedbackModalElements = {
      overlay,
      card,
      badge,
      title,
      message,
      primary,
      hide
    };

    return globalFeedbackModalElements;
  };

  const showGlobalFeedbackModal = function (config) {
    const modal = ensureGlobalFeedbackModal();
    const tone = config && config.tone === 'success' ? 'success' : 'error';

    modal.card.classList.toggle('is-success', tone === 'success');
    modal.card.classList.toggle('is-error', tone !== 'success');
    modal.badge.textContent = config && config.badge ? config.badge : (tone === 'success' ? 'Listo' : 'Atención');
    modal.title.textContent = config && config.title ? config.title : (tone === 'success' ? 'Todo salió bien' : 'Algo salió mal');
    modal.message.textContent = config && config.message ? config.message : 'Intenta nuevamente en unos segundos.';
    modal.primary.textContent = config && config.primaryLabel ? config.primaryLabel : 'Entendido';
    modal.overlay.classList.remove('hidden');
    modal.primary.focus();
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

  const getProfileTypeLabel = function (profileType) {
    return String(profileType || '').trim().toUpperCase() === 'LEGAL' ? 'Persona Jurídica' : 'Persona Natural';
  };

  const getDocumentTypeLabel = function (documentType) {
    const normalizedValue = String(documentType || '').trim().toUpperCase();
    const labelMap = {
      CO_CEDULA_CIUDADANIA: 'Cédula de ciudadanía',
      CO_TARJETA_IDENTIDAD: 'Tarjeta de identidad',
      CO_CEDULA_EXTRANJERIA: 'Cédula de extranjería',
      PASSPORT: 'Pasaporte',
      CO_PPT: 'Permiso por Protección Temporal',
      CO_PEP: 'Permiso Especial de Permanencia'
    };

    return labelMap[normalizedValue] || (normalizedValue ? normalizedValue : 'No registrado');
  };

  const formatDisplayDate = function (value) {
    if (!value) {
      return 'No registrada';
    }

    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(parsedDate);
  };

  const formatInputDateValue = function (value) {
    if (!value) {
      return '';
    }

    const parsedDate = new Date(value);

    if (Number.isNaN(parsedDate.getTime())) {
      return '';
    }

    return parsedDate.toISOString().slice(0, 10);
  };

  const getLegalInfoItems = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return [];
    }

    if (String(profile.profileType || '').trim().toUpperCase() === 'LEGAL') {
      const legalEntity = profile.legalEntity || {};

      return [
        { label: 'Tipo de perfil', value: getProfileTypeLabel(profile.profileType) },
        { label: 'Razón social', value: legalEntity.companyName || 'No registrada' },
        { label: 'NIT', value: legalEntity.taxId || 'No registrado' },
        { label: 'DV', value: legalEntity.verificationDigit || 'No registrado' },
        { label: 'NIT completo', value: legalEntity.taxIdFormatted || formatTaxId(legalEntity.taxId, legalEntity.verificationDigit) || 'No registrado' },
        { label: 'Representante legal', value: legalEntity.legalRepresentative || 'No registrado' }
      ];
    }

    const naturalPerson = profile.naturalPerson || {};

    return [
      { label: 'Tipo de perfil', value: getProfileTypeLabel(profile.profileType) },
      { label: 'Nombre completo', value: naturalPerson.fullName || 'No registrado' },
      { label: 'Tipo de documento', value: getDocumentTypeLabel(naturalPerson.documentTypeExpected) },
      { label: 'Número de documento', value: naturalPerson.documentNumber || 'No registrado' },
      { label: 'Fecha de expedición', value: formatDisplayDate(naturalPerson.expeditionDate) }
    ];
  };

  const canEditRejectedLegalInfo = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return false;
    }

    return String(profile.verificationStatus || '').trim().toUpperCase() === 'REJECTED';
  };

  const canEditRejectedBusinessProfile = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return false;
    }

    return hasPersistedBusinessProfileState(profile) && canEditRejectedLegalInfo(profile);
  };

  const canEditPersistedBusinessProfileInfo = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return false;
    }

    if (!hasPersistedBusinessProfileState(profile)) {
      return false;
    }

    const verificationStatus = String(profile.verificationStatus || '').trim().toUpperCase();
    return verificationStatus === 'APPROVED' || verificationStatus === 'REJECTED';
  };

  const getRejectedLegalEditHelperText = function (profile) {
    if (canEditRejectedLegalInfo(profile)) {
      return 'Puedes corregir los datos legales de este perfil rechazado. El tipo de perfil permanece fijo y no se puede cambiar.';
    }

    return 'Datos registrados para la validación legal del perfil.';
  };

  const getLegalInfoEditableFieldsMarkup = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return '';
    }

    if (String(profile.profileType || '').trim().toUpperCase() === 'LEGAL') {
      const legalEntity = profile.legalEntity || {};

      return [
        '<article class="profile-legal-item is-readonly">',
        '  <span class="profile-legal-item-label">Tipo de perfil</span>',
        '  <span class="profile-legal-item-value">' + escapeHtml(getProfileTypeLabel(profile.profileType)) + '</span>',
        '  <span class="profile-legal-item-caption">Este dato no se puede cambiar. Si necesitas otro tipo de perfil, elimina este y crea uno nuevo.</span>',
        '</article>',
        '<label class="profile-legal-item profile-legal-item-input">',
        '  <span class="profile-legal-item-label">Razón social</span>',
        '  <input class="profile-legal-input" type="text" name="legalCompanyName" value="' + escapeHtml(legalEntity.companyName || '') + '">',
        '</label>',
        '<label class="profile-legal-item profile-legal-item-input">',
        '  <span class="profile-legal-item-label">NIT</span>',
        '  <input class="profile-legal-input" type="text" inputmode="numeric" name="legalTaxId" value="' + escapeHtml(legalEntity.taxId || '') + '">',
        '</label>',
        '<label class="profile-legal-item profile-legal-item-input">',
        '  <span class="profile-legal-item-label">DV</span>',
        '  <input class="profile-legal-input" type="text" inputmode="numeric" maxlength="1" name="legalVerificationDigit" value="' + escapeHtml(legalEntity.verificationDigit || '') + '">',
        '</label>',
        '<label class="profile-legal-item profile-legal-item-input">',
        '  <span class="profile-legal-item-label">Representante legal</span>',
        '  <input class="profile-legal-input" type="text" name="legalRepresentative" value="' + escapeHtml(legalEntity.legalRepresentative || '') + '">',
        '</label>'
      ].join('');
    }

    const naturalPerson = profile.naturalPerson || {};

    return [
      '<article class="profile-legal-item is-readonly">',
      '  <span class="profile-legal-item-label">Tipo de perfil</span>',
      '  <span class="profile-legal-item-value">' + escapeHtml(getProfileTypeLabel(profile.profileType)) + '</span>',
      '  <span class="profile-legal-item-caption">Este dato no se puede cambiar. Si necesitas otro tipo de perfil, elimina este y crea uno nuevo.</span>',
      '</article>',
      '<label class="profile-legal-item profile-legal-item-input">',
      '  <span class="profile-legal-item-label">Nombre completo</span>',
      '  <input class="profile-legal-input" type="text" name="naturalFullName" value="' + escapeHtml(naturalPerson.fullName || '') + '">',
      '</label>',
      '<label class="profile-legal-item profile-legal-item-input">',
      '  <span class="profile-legal-item-label">Tipo de documento</span>',
      '  <select class="profile-legal-input profile-legal-select" name="naturalDocumentType">',
      '    <option value="CO_CEDULA_CIUDADANIA"' + (String(naturalPerson.documentTypeExpected || '').trim().toUpperCase() === 'CO_CEDULA_CIUDADANIA' ? ' selected' : '') + '>Cédula de ciudadanía</option>',
      '    <option value="CO_TARJETA_IDENTIDAD"' + (String(naturalPerson.documentTypeExpected || '').trim().toUpperCase() === 'CO_TARJETA_IDENTIDAD' ? ' selected' : '') + '>Tarjeta de identidad</option>',
      '    <option value="CO_CEDULA_EXTRANJERIA"' + (String(naturalPerson.documentTypeExpected || '').trim().toUpperCase() === 'CO_CEDULA_EXTRANJERIA' ? ' selected' : '') + '>Cédula de extranjería</option>',
      '    <option value="PASSPORT"' + (String(naturalPerson.documentTypeExpected || '').trim().toUpperCase() === 'PASSPORT' ? ' selected' : '') + '>Pasaporte</option>',
      '    <option value="CO_PPT"' + (String(naturalPerson.documentTypeExpected || '').trim().toUpperCase() === 'CO_PPT' ? ' selected' : '') + '>Permiso por Protección Temporal</option>',
      '    <option value="CO_PEP"' + (String(naturalPerson.documentTypeExpected || '').trim().toUpperCase() === 'CO_PEP' ? ' selected' : '') + '>Permiso Especial de Permanencia</option>',
      '  </select>',
      '</label>',
      '<label class="profile-legal-item profile-legal-item-input">',
      '  <span class="profile-legal-item-label">Número de documento</span>',
      '  <input class="profile-legal-input" type="text" inputmode="numeric" name="naturalDocumentNumber" value="' + escapeHtml(naturalPerson.documentNumber || '') + '">',
      '</label>',
      '<label class="profile-legal-item profile-legal-item-input">',
      '  <span class="profile-legal-item-label">Fecha de expedición</span>',
      '  <input class="profile-legal-input" type="date" name="naturalExpeditionDate" value="' + escapeHtml(formatInputDateValue(naturalPerson.expeditionDate)) + '">',
      '</label>'
    ].join('');
  };

  const getVerificationStatusLabel = function (status) {
    const normalizedStatus = String(status || '').trim().toUpperCase();

    if (normalizedStatus === 'APPROVED') {
      return 'Activo';
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

  const getVerificationStatusChipLabel = function (status) {
    const normalizedStatus = String(status || '').trim().toUpperCase();

    if (normalizedStatus === 'APPROVED') {
      return 'Estado: Activo';
    }

    if (normalizedStatus === 'REJECTED') {
      return 'Estado: Rechazado';
    }

    if (normalizedStatus === 'MANUAL_REVIEW' || normalizedStatus === 'PROCESSING') {
      return 'Estado: En revisión';
    }

    return 'Estado: Pendiente';
  };

  const getReusableStatusLabel = function (status) {
    const normalizedStatus = String(status || '').trim().toUpperCase();

    if (normalizedStatus === 'APPROVED') {
      return 'Perfil activo';
    }

    if (normalizedStatus === 'MANUAL_REVIEW') {
      return 'En revisión manual';
    }

    if (normalizedStatus === 'PROCESSING') {
      return 'En verificación';
    }

    return 'Documentación registrada';
  };

  const getProfileDetailsStatusChipLabel = function (profile, fallbackStatus) {
    if (isActiveBusinessProfile(profile)) {
      return 'Estado: Activo';
    }

    return getVerificationStatusChipLabel(fallbackStatus || (profile && profile.verificationStatus) || 'PENDING');
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

  const isActiveBusinessProfile = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return false;
    }

    const verificationStatus = String(profile.verificationStatus || '').trim().toUpperCase();
    const flowState = String(profile.flowState || '').trim().toUpperCase();

    return profile.businessSetupCompleted === true && (
      profile.canPublishEvents === true
      || flowState === 'APPROVED'
      || verificationStatus === 'APPROVED'
    );
  };

  const hasPersistedBusinessProfileState = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return false;
    }

    if (profile.businessSetupCompleted !== true) {
      return false;
    }

    const verificationStatus = String(profile.verificationStatus || '').trim().toUpperCase();
    const flowState = String(profile.flowState || '').trim().toUpperCase();
    const hasUploadedDocuments = Array.isArray(profile.documents) && profile.documents.length > 0;

    return Boolean(
      String(profile.id || '').trim()
      && (
        hasUploadedDocuments
        || profile.canPublishEvents === true
        || flowState === 'APPROVED'
        || flowState === 'NEEDS_CORRECTION'
        || verificationStatus === 'APPROVED'
        || verificationStatus === 'REJECTED'
        || verificationStatus === 'MANUAL_REVIEW'
        || verificationStatus === 'PROCESSING'
      )
    );
  };

  const isApprovedBusinessProfile = function (profile) {
    return isActiveBusinessProfile(profile);
  };

  const requiresBusinessProfileAttention = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return false;
    }

    if (isApprovedBusinessProfile(profile)) {
      return false;
    }

    const verificationStatus = String(profile.verificationStatus || '').trim().toUpperCase();
    const flowState = String(profile.flowState || '').trim().toUpperCase();
    const missingDocumentRoles = profile.verificationSummary && Array.isArray(profile.verificationSummary.missingDocumentRoles)
      ? profile.verificationSummary.missingDocumentRoles.filter(Boolean)
      : [];

    if (profile.businessSetupCompleted !== true) {
      return true;
    }

    return flowState === 'BUSINESS_SETUP'
      || flowState === 'PENDING_REVIEW'
      || flowState === 'NEEDS_CORRECTION'
      || verificationStatus === 'PENDING'
      || verificationStatus === 'PROCESSING'
      || verificationStatus === 'REJECTED'
      || verificationStatus === 'MANUAL_REVIEW'
      || missingDocumentRoles.length > 0;
  };

  const getDashboardBannerContent = function (profiles) {
    const safeProfiles = Array.isArray(profiles) ? profiles : [];
    const selectableProfiles = getSelectableProfilesForDropdown(safeProfiles);
    const activeProfile = resolveActiveBusinessProfile(selectableProfiles);

    if (!selectableProfiles.length) {
      return {
        shouldShow: true,
        title: 'Aún no has creado tu primer perfil de negocio.',
        message: 'Para publicar eventos, gestionar tus establecimientos y consultar analíticas dentro de Live, primero debes crear tu perfil.',
        actionLabel: 'Crear perfil ahora',
        actionHref: 'business-profile.html'
      };
    }

    if (!activeProfile) {
      return {
        shouldShow: true,
        title: 'Selecciona un perfil para continuar.',
        message: 'Elige el perfil que quieres gestionar para ver su estado y continuar el proceso correspondiente.',
        actionLabel: 'Ver perfiles',
        actionHref: 'dashboard.html'
      };
    }

    if (isApprovedBusinessProfile(activeProfile)) {
      return {
        shouldShow: false,
        title: '',
        message: '',
        actionLabel: '',
        actionHref: ''
      };
    }

    const verificationStatusLabel = getVerificationStatusLabel(activeProfile.verificationStatus);
    const missingDocumentRoles = activeProfile.verificationSummary && Array.isArray(activeProfile.verificationSummary.missingDocumentRoles)
      ? activeProfile.verificationSummary.missingDocumentRoles.filter(Boolean)
      : [];
    const flowState = String(activeProfile.flowState || '').trim().toUpperCase();
    const verificationStatus = String(activeProfile.verificationStatus || '').trim().toUpperCase();

    if (activeProfile.businessSetupCompleted !== true) {
      return {
        shouldShow: true,
        title: 'Tienes un perfil en creación que aún no está terminado.',
        message: 'Completa la información pública de tu negocio para terminar el onboarding y enviarlo correctamente a revisión.',
        actionLabel: 'Continuar perfil',
        actionHref: 'business-profile-details.html?profileId=' + encodeURIComponent(activeProfile.id)
      };
    }

    if (flowState === 'NEEDS_CORRECTION' || verificationStatus === 'REJECTED' || missingDocumentRoles.length) {
      return {
        shouldShow: true,
        title: 'Tu perfil activo requiere corrección.',
        message: 'Tu perfil actual está en estado ' + verificationStatusLabel + '. Revisa los documentos observados o incompletos para continuar el proceso.',
        actionLabel: 'Corregir perfil',
        actionHref: 'business-profile-details.html?profileId=' + encodeURIComponent(activeProfile.id)
      };
    }

    return {
      shouldShow: true,
      title: 'Tu perfil activo está en proceso de validación.',
      message: 'Tu perfil actual está en estado ' + verificationStatusLabel + '. Puedes revisarlo y continuar su gestión desde aquí.',
      actionLabel: 'Gestionar perfil',
      actionHref: 'business-profile-details.html?profileId=' + encodeURIComponent(activeProfile.id)
    };
  };

  const getBusinessProfileMeta = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return 'Sin perfiles conectados';
    }

    if (profile.businessUsername) {
      return '@' + String(profile.businessUsername).trim();
    }

    return getVerificationStatusLabel(profile.verificationStatus || 'PENDING');
  };

  const getBusinessProfileStatusText = function (profile) {
    if (!profile || typeof profile !== 'object') {
      return 'Crea tu primer perfil';
    }

    return getVerificationStatusLabel(profile.verificationStatus || 'PENDING');
  };

  const getBusinessProfileAvatarMarkup = function (profile, className) {
    const resolvedClassName = className || 'profile-avatar';
    const imageUrl = profile && profile.profileImageUrl ? String(profile.profileImageUrl).trim() : '';

    if (imageUrl) {
      return '<span class="' + escapeHtml(resolvedClassName) + ' has-image"><img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(getBusinessProfileDisplayName(profile)) + '"></span>';
    }

    return '<span class="' + escapeHtml(resolvedClassName) + '">' + escapeHtml(getBusinessProfileInitials(profile)) + '</span>';
  };

  const getOrderedProfilesForMenu = function (profiles) {
    const safeProfiles = Array.isArray(profiles) ? profiles.slice() : [];
    return safeProfiles.sort(function (leftProfile, rightProfile) {
      const leftCreatedAt = new Date(leftProfile && leftProfile.createdAt ? leftProfile.createdAt : 0).getTime();
      const rightCreatedAt = new Date(rightProfile && rightProfile.createdAt ? rightProfile.createdAt : 0).getTime();

      if (leftCreatedAt !== rightCreatedAt) {
        return leftCreatedAt - rightCreatedAt;
      }

      return String(leftProfile && leftProfile.id ? leftProfile.id : '').localeCompare(String(rightProfile && rightProfile.id ? rightProfile.id : ''));
    });
  };

  const getSelectableProfilesForDropdown = function (profiles) {
    const safeProfiles = Array.isArray(profiles) ? profiles : [];

    return safeProfiles.filter(function (profile) {
      return profile && profile.businessSetupCompleted === true;
    });
  };

  const resolveActiveBusinessProfile = function (profiles) {
    const safeProfiles = Array.isArray(profiles) ? profiles : [];
    const storedProfileId = loadActiveBusinessProfileId();

    if (storedProfileId) {
      const storedProfile = safeProfiles.find(function (profile) {
        return String(profile.id) === storedProfileId;
      }) || null;

      if (storedProfile) {
        return storedProfile;
      }
    }

    const currentProfileId = getProfileIdFromUrl();

    if (currentProfileId) {
      return safeProfiles.find(function (profile) {
        return String(profile.id) === currentProfileId;
      }) || null;
    }

    return safeProfiles[0] || null;
  };

  const getCreateProfileTriggerMarkup = function () {
    return [
      '<span class="profile-create-trigger-icon" aria-hidden="true">',
      '  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
      '    <path d="M12 5V19" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
      '    <path d="M5 12H19" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
      '  </svg>',
      '</span>',
      '<div class="profile-info profile-trigger-info profile-create-trigger-copy">',
      '  <strong>Crear perfil</strong>',
      '  <span>Crea tu primer perfil</span>',
      '</div>'
    ].join('');
  };

  const getProfileTriggerMarkup = function (client, profiles, activeProfile) {
    if (!activeProfile) {
      return getCreateProfileTriggerMarkup(client);
    }

    const triggerStatusTheme = getVerificationStatusTheme(activeProfile.verificationStatus || 'PENDING');

    return [
      getBusinessProfileAvatarMarkup(activeProfile, 'profile-avatar profile-trigger-avatar'),
      '<div class="profile-info profile-trigger-info">',
      '  <strong>' + escapeHtml(getBusinessProfileDisplayName(activeProfile)) + '</strong>',
      '  <span>' + escapeHtml(getBusinessProfileMeta(activeProfile)) + '</span>',
      '  <span class="profile-trigger-status-chip ' + escapeHtml(triggerStatusTheme) + '">' + escapeHtml(getBusinessProfileStatusText(activeProfile)) + '</span>',
      '</div>',
      '<span class="dropdown-arrow">▾</span>'
    ].join('');
  };

  const getAccountTriggerMarkup = function (client) {
    return [
      '<span class="profile-avatar account-trigger-avatar">' + escapeHtml(getInitials(client)) + '</span>',
      '<span class="account-trigger-label">Mi cuenta</span>',
      '<span class="dropdown-arrow">▾</span>'
    ].join('');
  };

  const getProfileMenuMarkup = function (client, profiles, activeProfile) {
    if (!Array.isArray(profiles) || !profiles.length) {
      return [
        '<div class="profile-switcher-empty">',
        '  <strong>Aún no tienes perfiles creados</strong>',
        '  <span>Cuando crees tu primer perfil de negocio aparecerá aquí para cambiarlo rápido.</span>',
        '</div>',
        '<a href="business-profile.html" class="profile-add-option" data-profile-add-option>',
        '  <span class="profile-add-option-icon" aria-hidden="true">+</span>',
        '  <span>Agregar otro perfil</span>',
        '</a>'
      ].join('');
    }

    const orderedProfiles = getOrderedProfilesForMenu(profiles);
    const activeProfileId = activeProfile ? String(activeProfile.id) : '';

    return [
      '<div class="profile-switcher-shell">',
      '  <div class="profile-switcher-head">',
      '    <div class="profile-switcher-head-copy">',
      '      <strong>Perfiles</strong>',
      '      <span>Selecciona el perfil con el que quieres trabajar</span>',
      '    </div>',
      '    <span class="profile-switcher-head-badge">' + String(orderedProfiles.length) + ' ' + (orderedProfiles.length === 1 ? 'perfil' : 'perfiles') + '</span>',
      '  </div>',
      '  <div class="profile-switcher-list">',
      orderedProfiles.map(function (profile) {
        const isActive = String(profile.id) === activeProfileId;
        const settingsLabel = 'Abrir perfil de ' + getBusinessProfileDisplayName(profile);
        const profileStatusTheme = getVerificationStatusTheme(profile.verificationStatus || 'PENDING');

        return [
          '<div class="profile-switch-option-row' + (isActive ? ' is-active' : '') + '">',
          '  <button class="profile-switch-option' + (isActive ? ' is-active' : '') + '" type="button" data-profile-switch-option data-profile-id="' + escapeHtml(profile.id) + '">',
          '    ' + getBusinessProfileAvatarMarkup(profile, 'profile-avatar profile-switch-option-avatar'),
          '    <span class="profile-switch-option-copy">',
          '      <strong>' + escapeHtml(getBusinessProfileDisplayName(profile)) + '</strong>',
          '      <span>' + escapeHtml(getBusinessProfileMeta(profile)) + '</span>',
          '      <span class="profile-switch-status-chip ' + escapeHtml(profileStatusTheme) + '">' + escapeHtml(getBusinessProfileStatusText(profile)) + '</span>',
          '    </span>',
          '    <span class="profile-switch-option-check" aria-hidden="true">' + (isActive ? '✓' : '') + '</span>',
          '  </button>',
          '  <a class="profile-switch-option-settings" href="business-profile-details.html?profileId=' + encodeURIComponent(profile.id) + '" data-profile-settings-option data-profile-id="' + escapeHtml(profile.id) + '" aria-label="' + escapeHtml(settingsLabel) + '">',
          '    <span class="dropdown-link-icon" aria-hidden="true">',
          '      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">',
          '        <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>',
          '        <path d="M19.4 15A1.65 1.65 0 0 0 19.73 16.82L19.79 16.88A2 2 0 0 1 16.96 19.71L16.9 19.65A1.65 1.65 0 0 0 15.08 19.32A1.65 1.65 0 0 0 14.08 20.83V20.99A2 2 0 0 1 10.08 20.99V20.9A1.65 1.65 0 0 0 9.08 19.39A1.65 1.65 0 0 0 7.26 19.72L7.2 19.78A2 2 0 1 1 4.37 16.95L4.43 16.89A1.65 1.65 0 0 0 4.76 15.07A1.65 1.65 0 0 0 3.25 14.07H3.09A2 2 0 0 1 3.09 10.07H3.18A1.65 1.65 0 0 0 4.69 9.07A1.65 1.65 0 0 0 4.36 7.25L4.3 7.19A2 2 0 1 1 7.13 4.36L7.19 4.42A1.65 1.65 0 0 0 9.01 4.75H9.17A1.65 1.65 0 0 0 10.17 3.24V3.08A2 2 0 0 1 14.17 3.08V3.17A1.65 1.65 0 0 0 15.17 4.68A1.65 1.65 0 0 0 16.99 4.35L17.05 4.29A2 2 0 1 1 19.88 7.12L19.82 7.18A1.65 1.65 0 0 0 19.49 9V9.16A1.65 1.65 0 0 0 21 10.16H21.16A2 2 0 0 1 21.16 14.16H21.07A1.65 1.65 0 0 0 19.56 15.16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
          '      </svg>',
          '    </span>',
          '  </a>',
          '</div>'
        ].join('');
      }).join(''),
      '  </div>',
      '  <a href="business-profile.html" class="profile-add-option" data-profile-add-option>',
      '    <span class="profile-add-option-icon" aria-hidden="true">+</span>',
      '    <span>Agregar otro perfil</span>',
      '  </a>',
      '</div>'
    ].join('');
  };

  const getAccountMenuMarkup = function (client) {
    return [
      '<div class="profile-card account-menu-card">',
      '  <span class="profile-avatar account-menu-avatar">' + escapeHtml(getInitials(client)) + '</span>',
      '  <div>',
      '    <strong>' + escapeHtml(getDisplayName(client)) + '</strong>',
      '    <span>' + escapeHtml(client.email) + '</span>',
      '    <span class="status-chip">' + escapeHtml(getPlanLabel(client.plan)) + '</span>',
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
      '    <span>Mi perfil</span>',
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
      '    <span>Ayuda y soporte</span>',
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
      '  <span>Cerrar sesión</span>',
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

  const renderGlobalProfileDropdown = function (profiles, options) {
    const activeClient = loadActiveClient();
    const normalizedProfiles = getSelectableProfilesForDropdown(profiles);
    const activeProfile = resolveActiveBusinessProfile(normalizedProfiles);
    const hasProfiles = normalizedProfiles.length > 0;
    const preserveStoredSelectionWhenEmpty = Boolean(options && options.preserveStoredSelectionWhenEmpty);
    const storedProfileId = loadActiveBusinessProfileId();

    if (!storedProfileId && activeProfile) {
      saveActiveBusinessProfileId(activeProfile.id);
    } else if (!preserveStoredSelectionWhenEmpty) {
      const hasStoredProfileInList = normalizedProfiles.some(function (profile) {
        return String(profile.id) === storedProfileId;
      });

      if (storedProfileId && !hasStoredProfileInList && !activeProfile) {
        saveActiveBusinessProfileId('');
      }
    }

    document.querySelectorAll('[data-global-profile-dropdown]').forEach(function (profileDropdown, index) {
      const profileTrigger = profileDropdown.querySelector('.profile-trigger');
      const dropdownMenu = profileDropdown.querySelector('.dropdown-menu');

      if (!profileTrigger || !dropdownMenu) {
        return;
      }

      const menuId = dropdownMenu.id || 'profileDropdownMenu' + String(index + 1);
      dropdownMenu.id = menuId;
      profileTrigger.classList.toggle('profile-create-trigger', !hasProfiles);
      profileDropdown.classList.toggle('is-action-mode', !hasProfiles);
      profileDropdown.dataset.dropdownMode = hasProfiles ? 'menu' : 'action';
      profileTrigger.innerHTML = getProfileTriggerMarkup(activeClient, normalizedProfiles, activeProfile);
      profileTrigger.setAttribute('aria-expanded', 'false');

      if (hasProfiles) {
        profileTrigger.setAttribute('aria-haspopup', 'true');
        profileTrigger.setAttribute('aria-controls', menuId);
        dropdownMenu.hidden = false;
        dropdownMenu.innerHTML = getProfileMenuMarkup(activeClient, normalizedProfiles, activeProfile);
      } else {
        profileTrigger.setAttribute('aria-haspopup', 'false');
        profileTrigger.removeAttribute('aria-controls');
        dropdownMenu.hidden = true;
        dropdownMenu.innerHTML = '';
      }

      profileDropdown.setAttribute('data-profile-dropdown-global', 'true');
    });
  };

  const syncGlobalBusinessProfilesDropdown = async function () {
    const activeClient = loadActiveClient();

    if (!activeClient.email) {
      renderGlobalProfileDropdown([]);
      if (typeof renderDashboardOnboardingBanner === 'function') {
        renderDashboardOnboardingBanner([]);
      }
      return;
    }

    try {
      const result = await requestJson('/api/business-profiles?clientEmail=' + encodeURIComponent(activeClient.email));
      const profiles = Array.isArray(result.profiles) ? result.profiles : [];
      renderGlobalProfileDropdown(profiles);
      if (typeof renderDashboardOnboardingBanner === 'function') {
        renderDashboardOnboardingBanner(profiles);
      }
    } catch (error) {
      renderGlobalProfileDropdown([]);
      if (typeof renderDashboardOnboardingBanner === 'function') {
        renderDashboardOnboardingBanner([]);
      }
    }
  };

  const getProfileDetailsHref = function (profileId) {
    return 'business-profile-details.html?profileId=' + encodeURIComponent(String(profileId || '').trim());
  };

  const getProfileSwitchTargetHref = function (profileId) {
    const normalizedProfileId = String(profileId || '').trim();

    if (!normalizedProfileId) {
      return window.location.pathname + window.location.search + window.location.hash;
    }

    const currentUrl = new URL(window.location.href);
    const currentPath = String(currentUrl.pathname || '').split('/').pop() || '';

    if (currentPath === 'business-profile-details.html') {
      currentUrl.searchParams.set('profileId', normalizedProfileId);
      return currentUrl.pathname + currentUrl.search + currentUrl.hash;
    }

    if (currentPath === 'business-profile.html') {
      return getProfileDetailsHref(normalizedProfileId);
    }

    return currentUrl.pathname + currentUrl.search + currentUrl.hash;
  };

  const getCurrentPortalView = function () {
    const currentPath = String(window.location.pathname || '').split('/').pop() || '';

    return currentPath || 'index.html';
  };

  const syncSidebarActiveState = function () {
    const activeSidebarHrefByView = {
      'dashboard.html': 'dashboard.html',
      'events.html': 'events.html'
    };
    const currentView = getCurrentPortalView();
    const activeSidebarHref = activeSidebarHrefByView[currentView] || null;

    document.querySelectorAll('.sidebar-nav').forEach(function (nav) {
      nav.querySelectorAll('.nav-link.active').forEach(function (link) {
        link.classList.remove('active');
      });

      if (!activeSidebarHref) {
        return;
      }

      const activeLink = Array.from(nav.querySelectorAll('.nav-link[href]')).find(function (link) {
        const href = link.getAttribute('href');

        if (!href || href === '#') {
          return false;
        }

        const normalizedHref = String(href).split('?')[0].split('#')[0].split('/').pop() || '';
        return normalizedHref === activeSidebarHref;
      });

      if (activeLink) {
        activeLink.classList.add('active');
      }
    });
  };

  const activateBusinessProfileSelection = function (nextProfileId) {
    const normalizedProfileId = String(nextProfileId || '').trim();

    if (!normalizedProfileId) {
      return;
    }

    const previousActiveProfileId = loadActiveBusinessProfileId();
    saveActiveBusinessProfileId(normalizedProfileId);

    const targetHref = getProfileSwitchTargetHref(normalizedProfileId);
    const currentHref = window.location.pathname + window.location.search + window.location.hash;

    if (targetHref === currentHref) {
      syncGlobalBusinessProfilesDropdown();
      return;
    }

    navigateWithPortalTransition(targetHref);
  };

  const openBusinessProfileSettings = function (profileId) {
    const normalizedProfileId = String(profileId || '').trim();

    if (!normalizedProfileId) {
      return;
    }

    navigateWithPortalTransition(getProfileDetailsHref(normalizedProfileId));
  };

  const renderGlobalAccountDropdown = function () {
    const activeClient = loadActiveClient();

    document.querySelectorAll('[data-global-account-dropdown]').forEach(function (profileDropdown, index) {
      const profileTrigger = profileDropdown.querySelector('.profile-trigger');
      const dropdownMenu = profileDropdown.querySelector('.dropdown-menu');

      if (!profileTrigger || !dropdownMenu) {
        return;
      }

      const menuId = dropdownMenu.id || 'accountDropdownMenu' + String(index + 1);
      dropdownMenu.id = menuId;
      profileTrigger.setAttribute('aria-controls', menuId);
      profileTrigger.innerHTML = getAccountTriggerMarkup(activeClient);
      dropdownMenu.innerHTML = getAccountMenuMarkup(activeClient);
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
          showGlobalFeedbackModal({
            badge: 'Inicio de sesión',
            title: 'No pudimos iniciar tu sesión',
            message: getFriendlyAuthErrorMessage(text, 'No se pudo iniciar sesion. Intenta de nuevo.')
          });
          return;
        }

        if (!response.ok) {
          setLoginLoading(false);
          showGlobalFeedbackModal({
            badge: 'Inicio de sesión',
            title: 'No pudimos iniciar tu sesión',
            message: getFriendlyAuthErrorMessage(result.message, 'No se pudo iniciar sesion. Intenta de nuevo.')
          });
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
        showGlobalFeedbackModal({
          badge: 'Inicio de sesión',
          title: 'No pudimos iniciar tu sesión',
          message: 'No se pudo iniciar sesion. Intenta de nuevo.'
        });
      }
    });
  }

  renderGlobalProfileDropdown([], { preserveStoredSelectionWhenEmpty: true });
  syncSidebarActiveState();
  renderGlobalAccountDropdown();
  renderGlobalSidebarPlanCard();
  syncPlanAvailabilityIndicators();
  renderPlanFeatureAccess();
  syncGlobalBusinessProfilesDropdown();

  document.querySelectorAll('.profile-dropdown').forEach(function (profileDropdown) {
    const profileTrigger = profileDropdown.querySelector('.profile-trigger');
    const dropdownMenu = profileDropdown.querySelector('.dropdown-menu');

    if (!profileTrigger || !dropdownMenu) {
      return;
    }

    const setDropdownOpen = function (isOpen) {
      if (profileDropdown.dataset.dropdownMode === 'action') {
        profileDropdown.classList.remove('is-open');
        profileTrigger.setAttribute('aria-expanded', 'false');
        return;
      }

      profileDropdown.classList.toggle('is-open', isOpen);
      profileTrigger.setAttribute('aria-expanded', String(isOpen));
    };

    profileTrigger.addEventListener('click', function (event) {
      event.stopPropagation();

      if (profileDropdown.dataset.dropdownMode === 'action') {
        navigateWithPortalTransition('business-profile.html');
        return;
      }

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

      if (profileDropdown.dataset.dropdownMode === 'action') {
        return;
      }

      const profileSettingsOption = event.target.closest('[data-profile-settings-option]');
      if (profileSettingsOption) {
        event.preventDefault();
        setDropdownOpen(false);
        openBusinessProfileSettings(profileSettingsOption.dataset.profileId);
        return;
      }

      const switchOption = event.target.closest('[data-profile-switch-option]');
      if (switchOption) {
        event.preventDefault();
        setDropdownOpen(false);
        activateBusinessProfileSelection(switchOption.dataset.profileId);
        return;
      }

      const addProfileOption = event.target.closest('[data-profile-add-option]');
      if (addProfileOption) {
        event.preventDefault();
        setDropdownOpen(false);
        navigateWithPortalTransition('business-profile.html');
        return;
      }

      const logoutAction = event.target.closest('.dropdown-logout');
      if (logoutAction) {
        setDropdownOpen(false);
        clearActiveClient();
        saveActiveBusinessProfileId('');

        if (isPortalPage) {
          navigateWithPortalTransition('/index.html');
          return;
        }

        window.location.href = '/index.html';
      }
    });
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

    renderDashboardOnboardingBanner = function (profiles) {
      const bannerContent = getDashboardBannerContent(profiles);

      onboardingBanner.classList.toggle('hidden', !bannerContent.shouldShow);

      if (!bannerContent.shouldShow) {
        return;
      }

      if (bannerTitle) {
        bannerTitle.textContent = bannerContent.title;
      }

      if (bannerText) {
        bannerText.innerHTML = escapeHtml(bannerContent.message) + ' <a href="' + escapeHtml(bannerContent.actionHref) + '" class="onboarding-banner-link">' + escapeHtml(bannerContent.actionLabel) + '</a>';
      }
    };

    requestJson('/api/business-profiles?clientEmail=' + encodeURIComponent(getActiveClientEmail())).then(function (result) {
      renderDashboardOnboardingBanner(Array.isArray(result.profiles) ? result.profiles : []);
    }).catch(function () {
      renderDashboardOnboardingBanner([]);
    });
  }

  const profileSetup = document.querySelector('[data-profile-setup]');
  if (profileSetup) {
    const profilePanels = Array.from(profileSetup.querySelectorAll('[data-profile-panel]'));
    const setupDocumentContainers = Array.from(profileSetup.querySelectorAll('[data-setup-documents]'));
    const reusableProfileBasesSection = profileSetup.querySelector('[data-reusable-profile-bases-section]');
    const reusableProfileBasesContainer = profileSetup.querySelector('[data-reusable-profile-bases]');
    const continueButton = document.getElementById('profileContinueButton');
    const profileSetupFeedbackModal = document.getElementById('profileSetupFeedbackModal');
    const profileSetupFeedbackCard = document.getElementById('profileSetupFeedbackCard');
    const profileSetupFeedbackBadge = document.getElementById('profileSetupFeedbackBadge');
    const profileSetupFeedbackTitle = document.getElementById('profileSetupFeedbackTitle');
    const profileSetupFeedbackMessage = document.getElementById('profileSetupFeedbackMessage');
    const profileSetupFeedbackPrimary = document.getElementById('profileSetupFeedbackPrimary');
    const taxIdInput = profileSetup.querySelector('input[name="taxId"]');
    const verificationDigitInput = profileSetup.querySelector('input[name="verificationDigit"]');
    const taxIdFormattedInput = profileSetup.querySelector('input[name="taxIdFormatted"]');
    const taxIdFormattedDisplay = profileSetup.querySelector('[data-tax-id-formatted]');
    const selectedSetupDocuments = {
      NATURAL: {},
      LEGAL: {}
    };
    let reusableProfileBases = [];
    let selectedReusableProfileBaseId = '';
    let activeSetupPath = 'manual-natural';
    let createdSetupProfileDraft = null;
    let profileSetupFeedbackPrimaryHandler = null;

    const cleanupIncompleteProfiles = async function () {
      const clientEmail = getActiveClientEmail();

      clearPendingProfileSetupTransitionId();

      if (!clientEmail) {
        return;
      }

      try {
        await requestJson('/api/business-profiles/incomplete?clientEmail=' + encodeURIComponent(clientEmail), {
          method: 'DELETE'
        });
      } catch (error) {
      }
    };

    const hideProfileSetupFeedbackModal = function () {
      if (!profileSetupFeedbackModal) {
        return;
      }

      profileSetupFeedbackModal.classList.add('hidden');
      profileSetupFeedbackPrimaryHandler = null;
    };

    const showProfileSetupFeedbackModal = function (config) {
      if (!profileSetupFeedbackModal || !profileSetupFeedbackCard || !profileSetupFeedbackTitle || !profileSetupFeedbackMessage || !profileSetupFeedbackPrimary) {
        return;
      }

      const tone = config && config.tone === 'error' ? 'error' : 'success';
      profileSetupFeedbackCard.classList.toggle('is-error', tone === 'error');
      profileSetupFeedbackCard.classList.toggle('is-success', tone !== 'error');

      if (profileSetupFeedbackBadge) {
        const badgeText = String(config && config.badge ? config.badge : '').trim();
        profileSetupFeedbackBadge.textContent = badgeText;
        profileSetupFeedbackBadge.classList.toggle('hidden', !badgeText);
      }

      profileSetupFeedbackTitle.textContent = String(config && config.title ? config.title : 'No se pudo continuar');
      profileSetupFeedbackMessage.textContent = String(config && config.message ? config.message : 'Intenta nuevamente.');
      profileSetupFeedbackPrimary.textContent = String(config && config.primaryLabel ? config.primaryLabel : 'Entendido');
      profileSetupFeedbackPrimaryHandler = config && typeof config.onPrimary === 'function'
        ? config.onPrimary
        : function () {
            hideProfileSetupFeedbackModal();
          };

      profileSetupFeedbackModal.classList.remove('hidden');
    };

    const setContinueLoading = function (isLoading) {
      if (!continueButton) {
        return;
      }

      continueButton.classList.toggle('is-loading', isLoading);
      continueButton.textContent = isLoading ? 'Guardando datos...' : 'Guardar datos y continuar';

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

    const getSelectedReusableProfileBase = function () {
      return reusableProfileBases.find(function (option) {
        return option.sourceProfileId === selectedReusableProfileBaseId;
      }) || null;
    };

    const isReusePathActive = function () {
      return activeSetupPath === 'reuse';
    };

    const getManualPathFromPanel = function (panelKey) {
      return panelKey === 'juridica' ? 'manual-legal' : 'manual-natural';
    };

    const renderSetupPathState = function () {
      profilePanels.forEach(function (panel) {
        const panelKey = String(panel.dataset.profilePanel || '').trim();
        const panelPath = getManualPathFromPanel(panelKey);
        const isActive = !isReusePathActive() && activeSetupPath === panelPath;
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

      if (reusableProfileBasesSection) {
        reusableProfileBasesSection.classList.toggle('is-active', isReusePathActive());
        reusableProfileBasesSection.classList.toggle('is-inactive', !isReusePathActive());
      }
    };

    const buildReusableProfileBaseMarkup = function (option) {
      const isSelected = option.sourceProfileId === selectedReusableProfileBaseId;
      const duplicateLabel = option.duplicateCount > 1 ? 'Usado en ' + option.duplicateCount + ' perfiles' : 'Disponible para reutilizar';
      const identifierExtra = option.profileType === 'LEGAL' && option.verificationDigit
        ? '<span class="reusable-profile-meta-inline">DV ' + escapeHtml(option.verificationDigit) + '</span>'
        : '';
      const trailingLine = option.profileType === 'LEGAL'
        ? (option.legalRepresentative ? '<p class="reusable-profile-card-foot">Representante: ' + escapeHtml(option.legalRepresentative) + '</p>' : '')
        : '<p class="reusable-profile-card-foot">' + escapeHtml(getDocumentTypeLabel(option.documentTypeExpected)) + '</p>';

      return [
        '<button type="button" class="reusable-profile-card' + (isSelected ? ' is-selected' : '') + '" data-reusable-profile-base data-source-profile-id="' + escapeHtml(option.sourceProfileId) + '" aria-pressed="' + String(isSelected) + '">',
        '  <div class="reusable-profile-card-top">',
        '    <span class="reusable-profile-card-type">' + escapeHtml(option.title) + '</span>',
        '    <span class="reusable-profile-card-status">' + escapeHtml(getReusableStatusLabel(option.verificationStatus)) + '</span>',
        '  </div>',
        '  <strong>' + escapeHtml(option.subtitle) + '</strong>',
        '  <div class="reusable-profile-card-meta">',
        '    <span>' + escapeHtml(option.identifierLabel) + ': ' + escapeHtml(option.identifierValue) + '</span>',
             identifierExtra,
        '  </div>',
             trailingLine,
        '  <span class="reusable-profile-card-caption">' + escapeHtml(duplicateLabel) + '</span>',
        '</button>'
      ].join('');
    };

    const renderReusableProfileBases = function () {
      if (!reusableProfileBasesSection || !reusableProfileBasesContainer) {
        return;
      }

      reusableProfileBasesSection.classList.toggle('hidden', !reusableProfileBases.length);

      if (!reusableProfileBases.length) {
        reusableProfileBasesContainer.innerHTML = '';
        return;
      }

      reusableProfileBasesContainer.innerHTML = reusableProfileBases.map(function (option) {
        return buildReusableProfileBaseMarkup(option);
      }).join('');

      reusableProfileBasesContainer.querySelectorAll('[data-reusable-profile-base]').forEach(function (card) {
        card.addEventListener('click', function () {
          const sourceProfileId = String(card.dataset.sourceProfileId || '').trim();
          const optionExists = reusableProfileBases.some(function (candidate) {
            return candidate.sourceProfileId === sourceProfileId;
          });

          if (!optionExists) {
            return;
          }

          activeSetupPath = 'reuse';
          selectedReusableProfileBaseId = sourceProfileId;
          resetCreatedSetupDraft();
          renderSetupPathState();
          renderReusableProfileBases();
          renderSetupDocuments();
          updateContinueState();
        });
      });
    };

    const loadReusableProfileBases = async function () {
      try {
        const clientEmail = getActiveClientEmail();

        if (!clientEmail) {
          reusableProfileBases = [];
          renderReusableProfileBases();
          return;
        }

        const result = await requestJson('/api/business-profiles?clientEmail=' + encodeURIComponent(clientEmail));
        reusableProfileBases = Array.isArray(result.reusableProfileBases) ? result.reusableProfileBases : [];
        renderReusableProfileBases();
      } catch (error) {
        reusableProfileBases = [];
        renderReusableProfileBases();
      }
    };

    const collectProfileSetupPayload = function () {
      const clientEmail = getActiveClientEmail();
      const selectedReusableProfileBase = getSelectedReusableProfileBase();

      if (isReusePathActive()) {
        if (!selectedReusableProfileBase) {
          return null;
        }

        return {
          clientEmail,
          profileType: selectedReusableProfileBase.profileType,
          reuseSourceProfileId: selectedReusableProfileBase.sourceProfileId
        };
      }

      const activePanel = getActivePanel();

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

    const getSetupProfileTypeFromPanel = function (panelKey) {
      return panelKey === 'juridica' ? 'LEGAL' : 'NATURAL';
    };

    const getRequiredSetupDocuments = function (profileType) {
      return PROFILE_DOCUMENT_CONFIG[String(profileType || '').toUpperCase()] || [];
    };

    const getMissingSetupDocuments = function (profileType) {
      return getRequiredSetupDocuments(profileType).filter(function (config) {
        return !(selectedSetupDocuments[profileType] && selectedSetupDocuments[profileType][config.role]);
      });
    };

    const resetCreatedSetupDraft = function () {
      createdSetupProfileDraft = null;
    };

    const getFriendlyProfileSetupErrorMessage = function (error) {
      const rawMessage = String(error && error.message ? error.message : '').trim();
      const normalizedMessage = rawMessage.toLowerCase();
      const errorCode = String(error && error.result && error.result.code ? error.result.code : '').trim().toUpperCase();

      if (errorCode === 'DOCUMENT_ASSOCIATED_WITH_ANOTHER_ACCOUNT') {
        return 'Esta cédula ya está asociada a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.';
      }

      if (errorCode === 'NATURAL_DOCUMENT_ASSOCIATED_WITH_ANOTHER_ACCOUNT') {
        return 'Esta cédula ya está asociada a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.';
      }

      if (errorCode === 'LEGAL_TAX_ID_ASSOCIATED_WITH_ANOTHER_ACCOUNT') {
        return 'Este NIT ya está asociado a otra cuenta. No puedes crear un perfil con este documento desde una cuenta diferente.';
      }

      if (errorCode === 'BUSINESS_PROFILE_LIMIT_REACHED') {
        return 'Tu cuenta ya alcanzó el máximo de 5 perfiles en total. No puedes crear más perfiles en esta cuenta.';
      }

      if (normalizedMessage.includes('mongodb') || normalizedMessage.includes('modo local') || normalizedMessage.includes('no se encontró un cliente')) {
        return 'No pudimos validar tu cuenta en este momento. Cierra sesión e ingresa nuevamente para continuar con la creación del perfil.';
      }

      if (normalizedMessage.includes('request entity too large') || normalizedMessage.includes('demasiado pesado')) {
        return 'Uno de los archivos es demasiado pesado. Sube documentos más livianos para continuar.';
      }

      return rawMessage || 'No se pudo crear el perfil en este momento. Intenta nuevamente.';
    };

    const formatSelectedDocumentName = function (fileName) {
      const normalizedFileName = String(fileName || '').trim();

      if (!normalizedFileName) {
        return '';
      }

      const extensionMatch = normalizedFileName.match(/(\.[^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1] : '';
      const baseName = extension ? normalizedFileName.slice(0, -extension.length) : normalizedFileName;
      const condensedBaseName = baseName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

      if (condensedBaseName.length <= 28) {
        return condensedBaseName + extension;
      }

      return condensedBaseName.slice(0, 25).trim() + '...' + extension;
    };

    const buildSetupDocumentMarkup = function (profileType, config) {
      const selectedFile = selectedSetupDocuments[profileType] ? selectedSetupDocuments[profileType][config.role] : null;
      const fileName = selectedFile ? formatSelectedDocumentName(selectedFile.name) : 'Aún no has seleccionado un archivo.';
      const fileNameClass = selectedFile ? 'setup-document-file-name' : 'setup-document-file-name is-empty';
      const cardClassName = selectedFile ? 'setup-document-card has-file' : 'setup-document-card';

      return [
        '<article class="' + cardClassName + '" data-setup-document-card data-document-role="' + escapeHtml(config.role) + '">',
        '  <div class="setup-document-copy">',
        '    <strong>' + escapeHtml(config.title) + '</strong>',
        '    <span>' + escapeHtml(config.description) + '</span>',
        '  </div>',
        '  <div class="setup-document-actions">',
        '    <button type="button" class="setup-document-select">Seleccionar archivo</button>',
        '    <span class="' + fileNameClass + '"' + (selectedFile ? ' title="' + escapeHtml(selectedFile.name) + '"' : '') + '>' + (selectedFile ? '<span class="setup-document-file-state" aria-hidden="true">Cargado</span>' : '') + escapeHtml(fileName) + '</span>',
        '    <input class="document-file-input" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" hidden>',
        '  </div>',
        '</article>'
      ].join('');
    };

    const renderSetupDocuments = function () {
      setupDocumentContainers.forEach(function (container) {
        const setupPanelKey = String(container.dataset.setupDocuments || '').toLowerCase();
        const profileType = getSetupProfileTypeFromPanel(setupPanelKey === 'legal' ? 'juridica' : setupPanelKey);
        const documentConfig = getRequiredSetupDocuments(profileType);

        container.innerHTML = documentConfig.map(function (config) {
          return buildSetupDocumentMarkup(profileType, config);
        }).join('');

        container.querySelectorAll('[data-setup-document-card]').forEach(function (card) {
          const fileInput = card.querySelector('.document-file-input');
          const selectButton = card.querySelector('.setup-document-select');
          const documentRole = String(card.dataset.documentRole || '').trim();

          if (!fileInput || !selectButton || !documentRole) {
            return;
          }

          selectButton.addEventListener('click', function () {
            fileInput.click();
          });

          fileInput.addEventListener('change', function () {
            const selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

            if (!selectedFile) {
              return;
            }

            selectedSetupDocuments[profileType][documentRole] = selectedFile;
            resetCreatedSetupDraft();
            renderSetupDocuments();
            updateContinueState();
          });
        });
      });
    };

    const uploadInitialDocuments = async function (profileId, profileType, clientEmail) {
      const requiredDocuments = getRequiredSetupDocuments(profileType);

      for (const config of requiredDocuments) {
        const selectedFile = selectedSetupDocuments[profileType] ? selectedSetupDocuments[profileType][config.role] : null;

        if (!selectedFile) {
          throw new Error('Debes seleccionar ' + config.title.toLowerCase() + ' para continuar.');
        }

        const formData = new FormData();
        formData.append('clientEmail', clientEmail);
        formData.append('documentRole', config.role);
        formData.append('document', selectedFile);

        await requestJson('/api/business-profiles/' + encodeURIComponent(profileId) + '/documents', {
          method: 'POST',
          body: formData
        });
      }
    };

    const getActivePanel = function () {
      return profilePanels.find(function (panel) {
        return panel.classList.contains('is-active');
      });
    };

    const isTypingFieldTarget = function (target) {
      if (!target || !(target instanceof Element)) {
        return false;
      }

      return Boolean(target.closest('input, select, textarea, button'));
    };

    const updateContinueState = function () {
      if (!continueButton) {
        return;
      }

      if (isReusePathActive()) {
        continueButton.disabled = !getSelectedReusableProfileBase();
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

      const profileType = getSetupProfileTypeFromPanel(activePanel.dataset.profilePanel);
      const hasRequiredDocuments = getMissingSetupDocuments(profileType).length === 0;

      continueButton.disabled = !isComplete || !hasRequiredDocuments;
    };

    const setActivePanel = function (activeKey) {
      activeSetupPath = getManualPathFromPanel(activeKey);
      selectedReusableProfileBaseId = '';

      if (createdSetupProfileDraft && createdSetupProfileDraft.profileType !== getSetupProfileTypeFromPanel(activeKey)) {
        resetCreatedSetupDraft();
      }

      renderSetupPathState();
      renderReusableProfileBases();
      renderSetupDocuments();
      updateContinueState();
    };

    profilePanels.forEach(function (panel) {
      panel.addEventListener('click', function () {
        resetCreatedSetupDraft();
        setActivePanel(panel.dataset.profilePanel);
      });

      panel.addEventListener('keydown', function (event) {
        if (isTypingFieldTarget(event.target)) {
          return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          resetCreatedSetupDraft();
          setActivePanel(panel.dataset.profilePanel);
        }
      });

      panel.querySelectorAll('input, select').forEach(function (field) {
        field.addEventListener('input', function () {
          resetCreatedSetupDraft();
          updateContinueState();
        });
        field.addEventListener('change', function () {
          resetCreatedSetupDraft();
          updateContinueState();
        });
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
          showProfileSetupFeedbackModal({
            tone: 'error',
            badge: 'Sesión requerida',
            title: 'Inicia sesión para continuar',
            message: 'Necesitas una cuenta activa para crear tu perfil de negocio.',
            primaryLabel: 'Entendido'
          });
          return;
        }

        setContinueLoading(true);

        try {
          const missingDocuments = getMissingSetupDocuments(payload.profileType);
          const isReusingProfileData = Boolean(String(payload.reuseSourceProfileId || '').trim());

          if (!isReusingProfileData && missingDocuments.length) {
            throw new Error('Debes cargar todos los documentos requeridos antes de continuar.');
          }

          if (!createdSetupProfileDraft || createdSetupProfileDraft.profileType !== payload.profileType) {
            const result = await requestJson('/api/business-profiles', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            createdSetupProfileDraft = {
              id: result.profile.id,
              profileType: payload.profileType
            };
          }

          if (!isReusingProfileData) {
            await uploadInitialDocuments(createdSetupProfileDraft.id, payload.profileType, payload.clientEmail);
          }

          savePendingProfileSetupTransitionId(createdSetupProfileDraft.id);
          navigateWithPortalTransition('business-profile-details.html?profileId=' + encodeURIComponent(createdSetupProfileDraft.id));
        } catch (error) {
          setContinueLoading(false);
          showProfileSetupFeedbackModal({
            tone: 'error',
            badge: 'No se pudo crear',
            title: 'No pudimos avanzar con el perfil',
            message: getFriendlyProfileSetupErrorMessage(error),
            primaryLabel: 'Entendido'
          });
          return;
        }
      });
    }

    if (profileSetupFeedbackPrimary) {
      profileSetupFeedbackPrimary.addEventListener('click', function () {
        if (typeof profileSetupFeedbackPrimaryHandler === 'function') {
          profileSetupFeedbackPrimaryHandler();
          return;
        }

        hideProfileSetupFeedbackModal();
      });
    }

    if (profileSetupFeedbackModal) {
      profileSetupFeedbackModal.addEventListener('click', function (event) {
        if (event.target === profileSetupFeedbackModal) {
          hideProfileSetupFeedbackModal();
        }
      });
    }

    renderSetupDocuments();
    syncTaxIdFields();
    setActivePanel('natural');
    cleanupIncompleteProfiles().finally(loadReusableProfileBases);
  }

  const categoryChips = document.querySelectorAll('[data-category-chip]');
  if (categoryChips.length) {
    const categorySelectionCounter = document.querySelector('[data-category-selection-counter]');

    const getSelectedCategories = function () {
      return Array.from(categoryChips).filter(function (chip) {
        return chip.getAttribute('aria-pressed') === 'true';
      }).map(function (chip) {
        return String(chip.textContent || '').trim();
      });
    };

    const syncCategorySelectionCounter = function () {
      if (!categorySelectionCounter) {
        return;
      }

      categorySelectionCounter.textContent = '(' + String(getSelectedCategories().length) + '/' + String(MAX_PROFILE_CATEGORIES) + ') seleccionadas';
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
      syncCategorySelectionCounter();
    };

    const syncCategoryChipAvailability = function () {
      const selectedCount = getSelectedCategories().length;

      categoryChips.forEach(function (chip) {
        const isSelected = chip.getAttribute('aria-pressed') === 'true';
        const isDisabled = categorySelectionReadonly || (selectedCount >= MAX_PROFILE_CATEGORIES && !isSelected);
        chip.disabled = isDisabled;
        chip.classList.toggle('is-disabled', isDisabled);
      });

      syncCategorySelectionCounter();
    };

    categoryChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (chip.disabled) {
          return;
        }

        const isSelected = chip.getAttribute('aria-pressed') === 'true';

        if (!isSelected) {
          const selectedCount = Array.from(categoryChips).filter(function (selectedChip) {
            return selectedChip.getAttribute('aria-pressed') === 'true';
          }).length;

          if (selectedCount >= MAX_PROFILE_CATEGORIES) {
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
      setReadonly: function (nextReadonlyState) {
        categorySelectionReadonly = nextReadonlyState === true;
        syncCategoryChipAvailability();
      },
      syncCategoryChipAvailability
    };

    syncCategoryChipAvailability();
    syncCategorySelectionCounter();
  }

  const createBusinessProfileButton = document.getElementById('createBusinessProfileButton');
  if (createBusinessProfileButton) {
    const profileId = getProfileIdFromUrl();
    const pendingSetupTransitionProfileId = consumePendingProfileSetupTransitionId();
    const detailsPage = document.querySelector('[data-profile-details]');
    const profileFeedbackModal = document.getElementById('profileFeedbackModal');
    const profileFeedbackCard = document.getElementById('profileFeedbackCard');
    const profileFeedbackBadge = document.getElementById('profileFeedbackBadge');
    const profileFeedbackTitle = document.getElementById('profileFeedbackTitle');
    const profileFeedbackMessage = document.getElementById('profileFeedbackMessage');
    const profileFeedbackActions = (detailsPage ? detailsPage.querySelector('#profileFeedbackModal .portal-feedback-actions') : null)
      || document.querySelector('#profileFeedbackModal .portal-feedback-actions');
    const profileFeedbackPrimary = document.getElementById('profileFeedbackPrimary');
    const profileFeedbackSecondary = document.getElementById('profileFeedbackSecondary');
    const profileDetailsIntro = detailsPage ? detailsPage.querySelector('[data-profile-details-intro]') : null;
    const profileLegalCard = detailsPage ? detailsPage.querySelector('[data-profile-legal-card]') : null;
    const profileLegalHeader = detailsPage ? detailsPage.querySelector('[data-profile-legal-header]') : null;
    const profileLegalToggle = detailsPage ? detailsPage.querySelector('[data-profile-legal-toggle]') : null;
    const profileLegalContent = detailsPage ? detailsPage.querySelector('[data-profile-legal-content]') : null;
    const profileLegalGrid = detailsPage ? detailsPage.querySelector('[data-profile-legal-grid]') : null;
    const profileLegalHelper = detailsPage ? detailsPage.querySelector('[data-profile-legal-helper]') : null;
    const profileImageTrigger = detailsPage ? detailsPage.querySelector('[data-profile-image-trigger]') : null;
    const profileImageInput = detailsPage ? detailsPage.querySelector('[data-profile-image-input]') : null;
    const profileImagePreview = detailsPage ? detailsPage.querySelector('[data-profile-image-preview]') : null;
    const profileImagePreviewImg = detailsPage ? detailsPage.querySelector('[data-profile-image-preview-img]') : null;
    const profileImagePlaceholder = detailsPage ? detailsPage.querySelector('[data-profile-image-placeholder]') : null;
    const businessNameInput = detailsPage ? detailsPage.querySelector('input[name="businessName"]') : null;
    const businessUsernameInput = detailsPage ? detailsPage.querySelector('input[name="businessUsername"]') : null;
    const businessCitySelect = detailsPage ? detailsPage.querySelector('select[name="businessCity"]') : null;
    const statusChip = detailsPage ? detailsPage.querySelector('[data-profile-status-chip]') : null;
    const activeProfileActions = detailsPage ? detailsPage.querySelector('[data-active-profile-actions]') : null;
    const profileEditToggleButton = detailsPage ? detailsPage.querySelector('[data-profile-edit-toggle]') : null;
    const profileDeleteTriggerButton = detailsPage ? detailsPage.querySelector('[data-profile-delete-trigger]') : null;
    const defaultProfileActions = detailsPage ? detailsPage.querySelector('[data-default-profile-actions]') : null;
    const businessSaveActions = detailsPage ? detailsPage.querySelector('[data-business-save-actions]') : null;
    const saveActiveProfileChangesButton = document.getElementById('saveActiveProfileChangesButton');
    const profileLegalActions = detailsPage ? detailsPage.querySelector('[data-profile-legal-actions]') : null;
    const profileLegalEditToggleButton = detailsPage ? detailsPage.querySelector('[data-profile-legal-edit-toggle]') : null;
    const legalEditActions = detailsPage ? detailsPage.querySelector('[data-profile-legal-edit-actions]') : null;
    const cancelLegalProfileEditButton = detailsPage ? detailsPage.querySelector('[data-profile-legal-edit-cancel]') : null;
    const saveLegalProfileChangesButton = document.getElementById('saveLegalProfileChangesButton');
    const documentsShell = detailsPage ? detailsPage.querySelector('[data-profile-documents-shell]') : null;
    const documentsGrid = detailsPage ? detailsPage.querySelector('[data-profile-documents-grid]') : null;
    const deleteProfileModal = document.getElementById('deleteProfileModal');
    const deleteProfileCancelButton = document.getElementById('deleteProfileCancelButton');
    const deleteProfileConfirmButton = document.getElementById('deleteProfileConfirmButton');
    let currentProfile = null;
    let pendingProfileImageUrl = '';
    let profileFeedbackPrimaryHandler = null;
    let profileFeedbackSecondaryHandler = null;
    let profileFeedbackAutoCloseTimeout = null;
    let isBusinessProfileDirty = false;
    let isLegalProfileEditMode = false;

    const canEditBusinessProfileSection = function (profile) {
      return canEditPersistedBusinessProfileInfo(profile);
    };

    const canEditLegalProfileSection = function (profile) {
      return canEditRejectedBusinessProfile(profile);
    };

    const setLegalProfileCardExpanded = function (shouldExpand) {
      const nextExpandedState = shouldExpand === true;

      if (profileLegalToggle) {
        profileLegalToggle.setAttribute('aria-expanded', String(nextExpandedState));
        profileLegalToggle.setAttribute('aria-label', nextExpandedState ? 'Contraer información legal' : 'Expandir información legal');
        profileLegalToggle.setAttribute('title', nextExpandedState ? 'Contraer información legal' : 'Expandir información legal');
      }

      if (profileLegalContent) {
        profileLegalContent.classList.toggle('hidden', !nextExpandedState);
      }

      if (profileLegalCard) {
        profileLegalCard.classList.toggle('is-expanded', nextExpandedState);
      }
    };

    const toggleLegalProfileCard = function () {
      if (!profileLegalToggle) {
        return;
      }

      const isExpanded = profileLegalToggle.getAttribute('aria-expanded') === 'true';

      if (isLegalProfileEditMode && isExpanded) {
        return;
      }

      setLegalProfileCardExpanded(!isExpanded);
    };

    const expandLegalProfileCard = function () {
      setLegalProfileCardExpanded(true);
    };

    const getBusinessProfileDraftSnapshot = function (profile) {
      if (profile && typeof profile === 'object') {
        return JSON.stringify({
          businessName: String(profile.businessName || '').trim(),
          businessUsername: String(profile.businessUsername || '').trim(),
          businessCity: normalizeBusinessCityValue(profile.businessCity) || '',
          categories: Array.isArray(profile.categories) ? profile.categories.slice() : [],
          profileImageUrl: String(profile.profileImageUrl || '').trim()
        });
      }

      return JSON.stringify({
        businessName: String(businessNameInput && businessNameInput.value ? businessNameInput.value : '').trim(),
        businessUsername: String(businessUsernameInput && businessUsernameInput.value ? businessUsernameInput.value : '').trim(),
        businessCity: normalizeBusinessCityValue(businessCitySelect && businessCitySelect.value ? businessCitySelect.value : '') || '',
        categories: selectedCategoryApi ? selectedCategoryApi.getSelectedCategories() : [],
        profileImageUrl: String(pendingProfileImageUrl || '').trim()
      });
    };

    const syncBusinessProfileSaveState = function (profile) {
      const canEditBusinessSection = canEditBusinessProfileSection(profile);
      const hasPersistedProfileState = hasPersistedBusinessProfileState(profile);
      const hasBusinessChanges = canEditBusinessSection && hasPersistedProfileState && getBusinessProfileDraftSnapshot() !== getBusinessProfileDraftSnapshot(profile);

      isBusinessProfileDirty = hasBusinessChanges;

      if (businessSaveActions) {
        businessSaveActions.classList.toggle('hidden', !(hasBusinessChanges && !isLegalProfileEditMode));
      }
    };

    const restoreBusinessProfileInputs = function () {
      if (!currentProfile) {
        return;
      }

      if (businessNameInput) {
        businessNameInput.value = currentProfile.businessName || '';
      }

      if (businessUsernameInput) {
        businessUsernameInput.value = currentProfile.businessUsername || '';
      }

      if (selectedCategoryApi) {
        selectedCategoryApi.setSelectedCategories(currentProfile.categories || []);
      }

      pendingProfileImageUrl = String(currentProfile.profileImageUrl || '').trim();
      renderProfileImage(pendingProfileImageUrl);

      if (profileImageInput) {
        profileImageInput.value = '';
      }

      syncBusinessProfileSaveState(currentProfile);
    };

    const syncProfileFieldAvailability = function (profile) {
      const hasPersistedProfileState = hasPersistedBusinessProfileState(profile);
      const canEditPrimaryFields = !hasPersistedProfileState || canEditBusinessProfileSection(profile);

      if (businessNameInput) {
        businessNameInput.disabled = !canEditPrimaryFields;
      }

      if (businessUsernameInput) {
        businessUsernameInput.disabled = !canEditPrimaryFields;
      }

      if (businessCitySelect) {
        businessCitySelect.disabled = !canEditPrimaryFields;
      }

      if (profileImageTrigger) {
        profileImageTrigger.disabled = !canEditPrimaryFields;
        profileImageTrigger.classList.toggle('is-locked', !canEditPrimaryFields);
      }

      if (selectedCategoryApi && typeof selectedCategoryApi.setReadonly === 'function') {
        selectedCategoryApi.setReadonly(hasPersistedProfileState && !canEditBusinessProfileSection(profile));
      }
    };

    const syncProfileDetailActionState = function (profile) {
      const hasPersistedProfileState = hasPersistedBusinessProfileState(profile);
      const canEditBusinessSection = canEditBusinessProfileSection(profile);
      const canEditLegalSection = canEditLegalProfileSection(profile);

      if (!hasPersistedProfileState) {
        isBusinessProfileDirty = false;
        isLegalProfileEditMode = false;
      }

      if (!canEditBusinessSection) {
        isBusinessProfileDirty = false;
      }

      if (!canEditLegalSection) {
        isLegalProfileEditMode = false;
      }

      if (defaultProfileActions) {
        defaultProfileActions.classList.toggle('hidden', hasPersistedProfileState);
      }

      if (activeProfileActions) {
        activeProfileActions.classList.toggle('hidden', !hasPersistedProfileState);
      }

      if (profileLegalActions) {
        profileLegalActions.classList.toggle('hidden', !canEditLegalSection);
      }

      if (legalEditActions) {
        legalEditActions.classList.toggle('hidden', !(canEditLegalSection && isLegalProfileEditMode));
      }

      if (profileDetailsIntro) {
        profileDetailsIntro.classList.toggle('hidden', hasPersistedProfileState);
      }

      if (detailsPage) {
        detailsPage.classList.toggle('is-active-profile', hasPersistedProfileState);
        detailsPage.classList.toggle('is-profile-editing', canEditBusinessSection);
        detailsPage.classList.toggle('is-legal-editing', canEditLegalSection && isLegalProfileEditMode);
      }

      if (profileEditToggleButton) {
        profileEditToggleButton.classList.add('hidden');
        profileEditToggleButton.classList.remove('is-active');
        profileEditToggleButton.setAttribute('aria-pressed', 'false');
      }

      if (profileLegalEditToggleButton) {
        profileLegalEditToggleButton.classList.toggle('is-active', canEditLegalSection && isLegalProfileEditMode);
        profileLegalEditToggleButton.setAttribute('aria-pressed', String(canEditLegalSection && isLegalProfileEditMode));
      }

      syncProfileFieldAvailability(profile);
      syncBusinessProfileSaveState(profile);
      renderLegalProfileInformation(profile);
    };

    const exitLegalProfileEditMode = function () {
      isLegalProfileEditMode = false;
      syncProfileDetailActionState(currentProfile);
    };

    const hideDeleteProfileModal = function () {
      if (!deleteProfileModal) {
        return;
      }

      deleteProfileModal.classList.add('hidden');
    };

    const renderLegalProfileInformation = function (profile) {
      if (!profileLegalGrid) {
        return;
      }

      if (profileLegalHelper) {
        profileLegalHelper.textContent = getRejectedLegalEditHelperText(profile);
      }

      if (canEditLegalProfileSection(profile) && isLegalProfileEditMode) {
        profileLegalGrid.innerHTML = getLegalInfoEditableFieldsMarkup(profile);
        return;
      }

      const items = getLegalInfoItems(profile);

      profileLegalGrid.innerHTML = items.map(function (item) {
        const value = String(item && item.value ? item.value : '').trim();

        return [
          '<article class="profile-legal-item">',
          '  <span class="profile-legal-item-label">' + escapeHtml(item.label) + '</span>',
          '  <span class="profile-legal-item-value' + (!value || value.toLowerCase().indexOf('no registr') === 0 ? ' is-empty' : '') + '">' + escapeHtml(value || 'No registrado') + '</span>',
          '</article>'
        ].join('');
      }).join('');
    };

    const showDeleteProfileModal = function () {
      if (!deleteProfileModal) {
        return;
      }

      deleteProfileModal.classList.remove('hidden');

      if (deleteProfileConfirmButton) {
        deleteProfileConfirmButton.focus();
      }
    };

    const hideProfileFeedbackModal = function () {
      if (!profileFeedbackModal) {
        return;
      }

      if (profileFeedbackAutoCloseTimeout) {
        window.clearTimeout(profileFeedbackAutoCloseTimeout);
        profileFeedbackAutoCloseTimeout = null;
      }

      profileFeedbackModal.classList.add('hidden');
      profileFeedbackCard.classList.remove('is-brief');
      profileFeedbackPrimaryHandler = null;
      profileFeedbackSecondaryHandler = null;
    };

    const showProfileFeedbackModal = function (config) {
      if (!profileFeedbackModal || !profileFeedbackCard || !profileFeedbackTitle || !profileFeedbackMessage || !profileFeedbackPrimary) {
        return;
      }

      const tone = config && config.tone === 'error' ? 'error' : 'success';
      const isBrief = Boolean(config && config.brief);
      const hasCustomMessage = Boolean(config) && Object.prototype.hasOwnProperty.call(config, 'message');
      const messageText = hasCustomMessage
        ? String(config && config.message ? config.message : '').trim()
        : 'La solicitud se completó correctamente.';
      profileFeedbackCard.classList.toggle('is-error', tone === 'error');
      profileFeedbackCard.classList.toggle('is-success', tone !== 'error');
      profileFeedbackCard.classList.toggle('is-brief', isBrief);
      profileFeedbackCard.classList.toggle('is-title-only', !messageText);

      if (profileFeedbackBadge) {
        const badgeText = isBrief ? '' : String(config && config.badge ? config.badge : '').trim();
        profileFeedbackBadge.textContent = badgeText;
        profileFeedbackBadge.classList.toggle('hidden', !badgeText);
      }

      profileFeedbackTitle.textContent = String(config && config.title ? config.title : 'Actualización del perfil');
      profileFeedbackMessage.textContent = messageText;
      profileFeedbackMessage.classList.toggle('hidden', !messageText);

      profileFeedbackPrimary.textContent = String(config && config.primaryLabel ? config.primaryLabel : 'Entendido');
      profileFeedbackPrimaryHandler = config && typeof config.onPrimary === 'function' ? config.onPrimary : function () {
        hideProfileFeedbackModal();
      };

      if (profileFeedbackSecondary) {
        const secondaryLabel = String(config && config.secondaryLabel ? config.secondaryLabel : '').trim();
        profileFeedbackSecondary.textContent = secondaryLabel;
        profileFeedbackSecondary.classList.toggle('hidden', !secondaryLabel);
        profileFeedbackSecondaryHandler = secondaryLabel && config && typeof config.onSecondary === 'function'
          ? config.onSecondary
          : function () {
              hideProfileFeedbackModal();
            };
      }

      if (profileFeedbackActions) {
        const shouldHideActions = isBrief || Boolean(config && config.hideActions);
        profileFeedbackActions.classList.toggle('hidden', shouldHideActions);
      }

      profileFeedbackModal.classList.remove('hidden');

      if (profileFeedbackAutoCloseTimeout) {
        window.clearTimeout(profileFeedbackAutoCloseTimeout);
        profileFeedbackAutoCloseTimeout = null;
      }

      if (config && Number(config.autoCloseMs) > 0) {
        profileFeedbackAutoCloseTimeout = window.setTimeout(function () {
          profileFeedbackAutoCloseTimeout = null;
          if (typeof config.onAutoClose === 'function') {
            config.onAutoClose();
            return;
          }

          hideProfileFeedbackModal();
        }, Number(config.autoCloseMs));
      }
    };

    const getFriendlyProfileSaveError = function (error) {
      const rawMessage = String(error && error.message ? error.message : '').trim();
      const normalizedMessage = rawMessage.toLowerCase();

      if ((error && error.status === 413) || normalizedMessage.includes('request entity too large') || normalizedMessage.includes('demasiado pesado')) {
        return {
          tone: 'error',
          badge: 'Archivo pesado',
          title: 'El archivo es demasiado pesado',
          message: 'Sube una imagen o documento más liviano para continuar con la creación del perfil.',
          primaryLabel: 'Entendido'
        };
      }

      return {
        tone: 'error',
        badge: 'No se pudo guardar',
        title: 'No pudimos guardar tu perfil',
        message: rawMessage || 'Intenta nuevamente en un momento. Si el problema continúa, vuelve a cargar la página.',
        primaryLabel: 'Entendido'
      };
    };

    const renderProfileImage = function (imageUrl) {
      const normalizedImageUrl = String(imageUrl || '').trim();

      if (!profileImagePreview || !profileImagePreviewImg || !profileImagePlaceholder) {
        return;
      }

      if (!normalizedImageUrl) {
        profileImagePreview.hidden = true;
        profileImagePreviewImg.removeAttribute('src');
        profileImagePlaceholder.hidden = false;
        if (profileImageTrigger) {
          profileImageTrigger.classList.remove('has-image');
        }
        return;
      }

      profileImagePreviewImg.src = normalizedImageUrl;
      profileImagePreview.hidden = false;
      profileImagePlaceholder.hidden = true;
      if (profileImageTrigger) {
        profileImageTrigger.classList.add('has-image');
      }
    };

    const readSelectedProfileImage = function (file) {
      return new Promise(function (resolve, reject) {
        const reader = new FileReader();

        reader.onload = function () {
          resolve(String(reader.result || ''));
        };

        reader.onerror = function () {
          reject(new Error('No se pudo leer la imagen seleccionada.'));
        };

        reader.readAsDataURL(file);
      });
    };

    const setProfileSaveLoading = function (isLoading) {
      createBusinessProfileButton.disabled = isLoading;
      createBusinessProfileButton.classList.toggle('is-loading', isLoading);
      createBusinessProfileButton.textContent = isLoading ? 'Guardando perfil...' : 'Guardar perfil';

      if (saveActiveProfileChangesButton) {
        saveActiveProfileChangesButton.disabled = isLoading;
        saveActiveProfileChangesButton.classList.toggle('is-loading', isLoading);
        saveActiveProfileChangesButton.textContent = isLoading ? 'Guardando cambios...' : 'Guardar cambios';
      }

      if (saveLegalProfileChangesButton) {
        saveLegalProfileChangesButton.disabled = isLoading;
        saveLegalProfileChangesButton.classList.toggle('is-loading', isLoading);
        saveLegalProfileChangesButton.textContent = isLoading ? 'Guardando cambios legales...' : 'Guardar cambios legales';
      }

      if (profileEditToggleButton) {
        profileEditToggleButton.disabled = isLoading;
      }

      if (profileLegalEditToggleButton) {
        profileLegalEditToggleButton.disabled = isLoading;
      }

      if (profileDeleteTriggerButton) {
        profileDeleteTriggerButton.disabled = isLoading;
      }

      if (cancelLegalProfileEditButton) {
        cancelLegalProfileEditButton.disabled = isLoading;
      }
    };

    const buildLegalProfileCorrectionPayload = function (profile) {
      if (!canEditLegalProfileSection(profile)) {
        return null;
      }

      if (profile && profile.profileType === 'LEGAL') {
        const companyNameField = profileLegalGrid.querySelector('input[name="legalCompanyName"]');
        const taxIdField = profileLegalGrid.querySelector('input[name="legalTaxId"]');
        const verificationDigitField = profileLegalGrid.querySelector('input[name="legalVerificationDigit"]');
        const legalRepresentativeField = profileLegalGrid.querySelector('input[name="legalRepresentative"]');
        const companyName = String(companyNameField && companyNameField.value ? companyNameField.value : '').trim();
        const taxId = String(taxIdField && taxIdField.value ? taxIdField.value : '').trim();
        const verificationDigit = String(verificationDigitField && verificationDigitField.value ? verificationDigitField.value : '').trim();
        const legalRepresentative = String(legalRepresentativeField && legalRepresentativeField.value ? legalRepresentativeField.value : '').trim();

        if (!companyName || !taxId || !verificationDigit || !legalRepresentative) {
          showProfileFeedbackModal({
            tone: 'error',
            badge: 'Datos incompletos',
            title: 'Completa la información legal',
            message: 'Para corregir este perfil rechazado debes diligenciar razón social, NIT, DV y representante legal.',
            primaryLabel: 'Entendido'
          });
          return null;
        }

        return {
          companyName,
          taxId,
          verificationDigit,
          legalRepresentative
        };
      }

      if (profile && profile.profileType === 'NATURAL') {
        const fullNameField = profileLegalGrid.querySelector('input[name="naturalFullName"]');
        const documentTypeField = profileLegalGrid.querySelector('select[name="naturalDocumentType"]');
        const documentNumberField = profileLegalGrid.querySelector('input[name="naturalDocumentNumber"]');
        const expeditionDateField = profileLegalGrid.querySelector('input[name="naturalExpeditionDate"]');
        const fullName = String(fullNameField && fullNameField.value ? fullNameField.value : '').trim();
        const documentTypeExpected = String(documentTypeField && documentTypeField.value ? documentTypeField.value : '').trim();
        const documentNumber = String(documentNumberField && documentNumberField.value ? documentNumberField.value : '').trim();
        const expeditionDate = String(expeditionDateField && expeditionDateField.value ? expeditionDateField.value : '').trim();

        if (!fullName || !documentTypeExpected || !documentNumber || !expeditionDate) {
          showProfileFeedbackModal({
            tone: 'error',
            badge: 'Datos incompletos',
            title: 'Completa la información legal',
            message: 'Para corregir este perfil rechazado debes diligenciar nombre completo, tipo de documento, número y fecha de expedición.',
            primaryLabel: 'Entendido'
          });
          return null;
        }

        return {
          fullName,
          documentTypeExpected,
          documentNumber,
          expeditionDate
        };
      }

      return null;
    };

    if (businessCitySelect) {
      businessCitySelect.value = ALLOWED_PROFILE_CITY;
    }

    if (profileImageTrigger && profileImageInput) {
      profileImageTrigger.addEventListener('click', function () {
        if (profileImageTrigger.disabled) {
          return;
        }

        profileImageInput.click();
      });

      profileImageInput.addEventListener('change', async function () {
        const selectedFile = profileImageInput.files && profileImageInput.files[0];

        if (!selectedFile) {
          return;
        }

        if (selectedFile.size > MAX_PROFILE_IMAGE_SIZE_BYTES) {
          profileImageInput.value = '';
          showProfileFeedbackModal({
            tone: 'error',
            badge: 'Imagen pesada',
            title: 'La imagen es demasiado pesada',
            message: 'Sube una imagen de perfil más liviana para continuar. El peso máximo recomendado es 4 MB.',
            primaryLabel: 'Entendido'
          });
          return;
        }

        try {
          pendingProfileImageUrl = await readSelectedProfileImage(selectedFile);
          renderProfileImage(pendingProfileImageUrl);
          syncBusinessProfileSaveState(currentProfile);
        } catch (error) {
          showProfileFeedbackModal({
            tone: 'error',
            badge: 'Imagen inválida',
            title: 'No se pudo cargar la imagen',
            message: error.message || 'Selecciona otra imagen para continuar.',
            primaryLabel: 'Entendido'
          });
        }
      });
    }

    if (profileFeedbackPrimary) {
      profileFeedbackPrimary.addEventListener('click', function () {
        if (typeof profileFeedbackPrimaryHandler === 'function') {
          profileFeedbackPrimaryHandler();
          return;
        }

        hideProfileFeedbackModal();
      });
    }

    if (profileFeedbackSecondary) {
      profileFeedbackSecondary.addEventListener('click', function () {
        if (typeof profileFeedbackSecondaryHandler === 'function') {
          profileFeedbackSecondaryHandler();
          return;
        }

        hideProfileFeedbackModal();
      });
    }

    if (profileFeedbackModal) {
      profileFeedbackModal.addEventListener('click', function (event) {
        if (event.target === profileFeedbackModal) {
          hideProfileFeedbackModal();
        }
      });
    }

    if (profileLegalToggle && profileLegalContent) {
      profileLegalToggle.addEventListener('click', function () {
        toggleLegalProfileCard();
      });
    }

    if (profileLegalHeader) {
      profileLegalHeader.addEventListener('click', function (event) {
        if (event.target.closest('[data-profile-legal-edit-toggle]') || event.target.closest('[data-profile-legal-toggle]')) {
          return;
        }

        toggleLegalProfileCard();
      });
    }

    if (deleteProfileModal) {
      deleteProfileModal.addEventListener('click', function (event) {
        if (event.target === deleteProfileModal) {
          hideDeleteProfileModal();
        }
      });
    }

    if (deleteProfileCancelButton) {
      deleteProfileCancelButton.addEventListener('click', hideDeleteProfileModal);
    }

    if (profileLegalEditToggleButton) {
      profileLegalEditToggleButton.addEventListener('click', function () {
        if (!canEditLegalProfileSection(currentProfile)) {
          return;
        }

        const nextLegalEditState = !isLegalProfileEditMode;
        isLegalProfileEditMode = nextLegalEditState;

        if (nextLegalEditState) {
          expandLegalProfileCard();
        }

        syncProfileDetailActionState(currentProfile);

        if (nextLegalEditState) {
          const firstLegalField = profileLegalGrid.querySelector('input, select, textarea');
          if (firstLegalField && typeof firstLegalField.focus === 'function') {
            firstLegalField.focus();
          }
        }
      });
    }

    if (cancelLegalProfileEditButton) {
      cancelLegalProfileEditButton.addEventListener('click', function () {
        exitLegalProfileEditMode();
      });
    }

    if (profileDeleteTriggerButton) {
      profileDeleteTriggerButton.addEventListener('click', function () {
        if (!hasPersistedBusinessProfileState(currentProfile)) {
          return;
        }

        showDeleteProfileModal();
      });
    }

    if (deleteProfileConfirmButton) {
      deleteProfileConfirmButton.addEventListener('click', async function () {
        const clientEmail = getActiveClientEmail();

        if (!clientEmail) {
          hideDeleteProfileModal();
          showProfileFeedbackModal({
            tone: 'error',
            badge: 'Sesión requerida',
            title: 'No hay una cuenta activa',
            message: 'Inicia sesión nuevamente para eliminar este perfil.',
            primaryLabel: 'Entendido'
          });
          return;
        }

        deleteProfileConfirmButton.disabled = true;
        deleteProfileConfirmButton.textContent = 'Eliminando...';
        deleteProfileCancelButton.disabled = true;

        try {
          await requestJson('/api/business-profiles/' + encodeURIComponent(profileId) + '?clientEmail=' + encodeURIComponent(clientEmail), {
            method: 'DELETE'
          });

          saveActiveBusinessProfileId('');
          hideDeleteProfileModal();
          showProfileFeedbackModal({
            tone: 'success',
            badge: 'Perfil eliminado',
            title: 'El perfil fue eliminado',
            message: 'El perfil activo se eliminó correctamente y ya no estará disponible en tu cuenta.',
            primaryLabel: 'Ir al dashboard',
            onPrimary: function () {
              hideProfileFeedbackModal();
              navigateWithPortalTransition('dashboard.html');
            }
          });
        } catch (error) {
          hideDeleteProfileModal();
          showProfileFeedbackModal({
            tone: 'error',
            badge: 'No se pudo eliminar',
            title: 'No pudimos eliminar el perfil',
            message: String(error && error.message ? error.message : 'Intenta nuevamente en unos segundos.'),
            primaryLabel: 'Entendido'
          });
        } finally {
          deleteProfileConfirmButton.disabled = false;
          deleteProfileConfirmButton.textContent = 'Eliminar perfil';
          deleteProfileCancelButton.disabled = false;
        }
      });
    }

    if (profileImagePreviewImg) {
      profileImagePreviewImg.addEventListener('error', function () {
        pendingProfileImageUrl = '';
        renderProfileImage('');
        syncBusinessProfileSaveState(currentProfile);
      });
    }

    [businessNameInput, businessUsernameInput].forEach(function (field) {
      if (!field) {
        return;
      }

      field.addEventListener('input', function () {
        syncBusinessProfileSaveState(currentProfile);
      });
    });

    if (businessCitySelect) {
      businessCitySelect.addEventListener('change', function () {
        syncBusinessProfileSaveState(currentProfile);
      });
    }

    if (detailsPage) {
      detailsPage.querySelectorAll('[data-category-chip]').forEach(function (chip) {
        chip.addEventListener('click', function () {
          syncBusinessProfileSaveState(currentProfile);
        });
      });
    }

    const renderProfileStatus = function (verificationPayload) {
      if (!verificationPayload || !statusChip) {
        return;
      }

      const verificationStatus = verificationPayload.verificationStatus || (currentProfile && currentProfile.verificationStatus) || 'PENDING';
      statusChip.textContent = getProfileDetailsStatusChipLabel(currentProfile, verificationStatus);
      statusChip.className = 'profile-status-chip ' + getVerificationStatusTheme(verificationStatus);
    };

    const buildDocumentCardMarkup = function (profile, documentConfig, currentDocument) {
      const currentStatus = currentDocument ? String(currentDocument.verificationStatus || '').toUpperCase() : 'PENDING';
      const allowUpload = canEditRejectedBusinessProfile(profile) && (!currentDocument || currentStatus === 'REJECTED' || currentStatus === 'MANUAL_REVIEW');
      const actionLabel = currentDocument ? 'Volver a cargar' : 'Subir documento';
      const helperText = currentDocument
        ? (currentDocument.originalFileName || 'Documento cargado') + ' · ' + getVerificationStatusLabel(currentStatus)
        : 'Aún no has subido este documento.';
      const rejectionText = currentDocument && Array.isArray(currentDocument.rejectionReasons) && currentDocument.rejectionReasons.length
        ? '<p class="document-card-reasons">Motivos: ' + escapeHtml(currentDocument.rejectionReasons.join(', ')) + '</p>'
        : '';
      const uploadControlsMarkup = allowUpload
        ? [
            '    <div class="document-upload-inline">',
            '      <button type="button" class="secondary-button document-upload-action">' + actionLabel + '</button>',
            '      <input class="document-file-input" type="file" accept="image/png,image/jpeg,image/webp,application/pdf">',
            '    </div>'
          ].join('')
        : '';

      return [
        '<article class="document-upload-card ' + getVerificationStatusTheme(currentStatus) + '" data-document-card data-document-role="' + escapeHtml(documentConfig.role) + '"' + (currentDocument ? ' data-document-id="' + escapeHtml(currentDocument.id) + '"' : '') + '>',
        '  <div class="document-upload-card-row">',
        '    <div class="document-upload-card-copy">',
        '      <strong>' + escapeHtml(documentConfig.title) + '</strong>',
        '      <p class="document-card-file">' + escapeHtml(helperText) + '</p>',
        '    </div>',
        '    <span class="document-status-pill ' + getVerificationStatusTheme(currentStatus) + '">' + escapeHtml(getVerificationStatusLabel(currentStatus)) + '</span>',
             uploadControlsMarkup,
        '  </div>',
           rejectionText,
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

        return buildDocumentCardMarkup(profile, config, currentDocument);
      }).join('');

      documentsGrid.querySelectorAll('[data-document-card]').forEach(function (card) {
        const fileInput = card.querySelector('.document-file-input');
        const uploadButton = card.querySelector('.document-upload-action');
        const documentRole = card.dataset.documentRole;
        const documentId = card.dataset.documentId;

        if (!fileInput || !uploadButton || uploadButton.disabled) {
          return;
        }

        const runUpload = async function () {
          const selectedFile = fileInput.files && fileInput.files[0];

          if (!selectedFile) {
            fileInput.click();
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
            showProfileFeedbackModal(getFriendlyProfileSaveError(error));
          }
        };

        uploadButton.addEventListener('click', runUpload);
        fileInput.addEventListener('change', function () {
          if (fileInput.files && fileInput.files[0]) {
            runUpload();
          }
        });
      });
    };

    const syncDocumentCorrectionVisibility = function (profile) {
      if (!documentsShell || !documentsGrid) {
        return;
      }

      const documentConfig = PROFILE_DOCUMENT_CONFIG[String(profile && profile.profileType ? profile.profileType : '').toUpperCase()] || [];
      const currentDocuments = Array.isArray(profile && profile.documents) ? profile.documents : [];
      const shouldShowDocumentCorrection = Boolean(
        profile
        && profile.id
        && (documentConfig.length > 0 || currentDocuments.length > 0)
      );

      documentsShell.hidden = !shouldShowDocumentCorrection;

      if (!shouldShowDocumentCorrection) {
        documentsGrid.innerHTML = '';
        return;
      }

      renderDocumentCards(profile);
    };

    const populateProfileDetails = function (profile) {
      if (!profile) {
        return;
      }

      currentProfile = profile;
      syncGlobalBusinessProfilesDropdown();

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

      pendingProfileImageUrl = String(profile.profileImageUrl || '').trim();
      renderProfileImage(pendingProfileImageUrl);

      if (profileImageInput) {
        profileImageInput.value = '';
      }

      renderLegalProfileInformation(profile);

      syncDocumentCorrectionVisibility(profile);
      syncProfileDetailActionState(profile);
      renderProfileStatus({ verificationStatus: profile.verificationStatus });
    };

    var refreshProfileData = async function () {
      if (!profileId) {
        return;
      }

      try {
        const clientEmail = getActiveClientEmail();
        const [profileResult, statusResult] = await Promise.all([
          requestJson('/api/business-profiles/' + encodeURIComponent(profileId) + '?clientEmail=' + encodeURIComponent(clientEmail)),
          requestJson('/api/business-profiles/' + encodeURIComponent(profileId) + '/verification-status?clientEmail=' + encodeURIComponent(clientEmail))
        ]);

        const loadedProfile = profileResult.profile;
        const isIncompleteProfile = loadedProfile && loadedProfile.businessSetupCompleted !== true;

        if (isIncompleteProfile && pendingSetupTransitionProfileId !== String(loadedProfile.id || '').trim()) {
          try {
            await requestJson('/api/business-profiles/' + encodeURIComponent(profileId) + '?clientEmail=' + encodeURIComponent(clientEmail), {
              method: 'DELETE'
            });
          } catch (cleanupError) {
          }

          showProfileFeedbackModal({
            tone: 'error',
            badge: 'Proceso reiniciado',
            title: 'Debes comenzar otra vez',
            message: 'La creación del perfil no se completó y el proceso anterior fue descartado. Vuelve a iniciar desde cero.',
            primaryLabel: 'Ir al primer paso',
            onPrimary: function () {
              hideProfileFeedbackModal();
              navigateWithPortalTransition('business-profile.html');
            }
          });
          return;
        }

        populateProfileDetails(loadedProfile);
        renderProfileStatus(statusResult);
      } catch (error) {
        showProfileFeedbackModal({
          tone: 'error',
          badge: 'No se pudo cargar',
          title: 'No pudimos cargar el perfil',
          message: 'Intenta nuevamente en un momento. Si el problema continúa, vuelve al dashboard y reabre este perfil.',
          primaryLabel: 'Entendido'
        });
      }
    };

    if (!profileId) {
      showProfileFeedbackModal({
        tone: 'error',
        badge: 'Perfil no encontrado',
        title: 'Primero debes crear el perfil base',
        message: 'Vuelve al paso anterior para iniciar correctamente la creación del perfil de negocio.',
        primaryLabel: 'Ir al primer paso',
        onPrimary: function () {
          hideProfileFeedbackModal();
          navigateWithPortalTransition('business-profile.html');
        }
      });
      return;
    }

    const handleProfileSave = async function (event, requestedSaveMode) {
      event.preventDefault();

      const clientEmail = getActiveClientEmail();
      if (!clientEmail) {
        showProfileFeedbackModal({
          tone: 'error',
          badge: 'Sesión requerida',
          title: 'No hay una cuenta activa',
          message: 'Inicia sesión nuevamente para continuar con la creación del perfil.',
          primaryLabel: 'Entendido'
        });
        return;
      }

      setProfileSaveLoading(true);

      try {
        const hasPersistedProfileState = hasPersistedBusinessProfileState(currentProfile);
        const wasInitialBusinessSetup = !(currentProfile && currentProfile.businessSetupCompleted === true);
        const saveMode = requestedSaveMode || (hasPersistedProfileState ? 'business' : 'initial');
        const isInitialSave = saveMode === 'initial';
        const isBusinessSave = saveMode === 'business';
        const isLegalSave = saveMode === 'legal';
        const selectedBusinessCity = normalizeBusinessCityValue(businessCitySelect ? businessCitySelect.value : '');

        if (isInitialSave && selectedBusinessCity !== ALLOWED_PROFILE_CITY) {
          showProfileFeedbackModal({
            tone: 'error',
            badge: 'Ciudad no permitida',
            title: 'Solo puedes usar Barranquilla',
            message: 'Por ahora la ciudad disponible para los perfiles es Barranquilla.',
            primaryLabel: 'Entendido'
          });
          return;
        }

        const payload = {
          clientEmail
        };

        if (isInitialSave || isBusinessSave) {
          payload.businessName = businessNameInput ? businessNameInput.value : '';
          payload.businessUsername = businessUsernameInput ? businessUsernameInput.value : '';
          payload.businessCity = selectedBusinessCity;
          payload.categories = selectedCategoryApi ? selectedCategoryApi.getSelectedCategories() : [];
          payload.profileImageUrl = pendingProfileImageUrl || (currentProfile && currentProfile.profileImageUrl) || '';
        }

        if (isLegalSave) {
          const legalPayload = buildLegalProfileCorrectionPayload(currentProfile);

          if (!legalPayload) {
            return;
          }

          Object.assign(payload, legalPayload);
        }

        if (isInitialSave && currentProfile && currentProfile.profileType === 'LEGAL' && currentProfile.legalEntity) {
          payload.companyName = currentProfile.legalEntity.companyName;
          payload.taxId = currentProfile.legalEntity.taxId;
          payload.verificationDigit = currentProfile.legalEntity.verificationDigit;
          payload.legalRepresentative = currentProfile.legalEntity.legalRepresentative;
        }

        if (isInitialSave && currentProfile && currentProfile.profileType === 'NATURAL' && currentProfile.naturalPerson) {
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
        pendingProfileImageUrl = String(result.profile && result.profile.profileImageUrl ? result.profile.profileImageUrl : pendingProfileImageUrl || '');
        renderProfileImage(pendingProfileImageUrl);

        if (hasPersistedProfileState) {
          if (isLegalSave) {
            isLegalProfileEditMode = false;
          }
        }

        await refreshProfileData();

        if (wasInitialBusinessSetup) {
          showProfileFeedbackModal({
            tone: 'success',
            brief: true,
            hideActions: true,
            title: 'Perfil enviado a revisión',
            message: 'Tu perfil fue creado correctamente y ahora está en proceso de validación.',
            autoCloseMs: 1800,
            onAutoClose: function () {
              hideProfileFeedbackModal();
              navigateWithPortalTransition('dashboard.html');
            }
          });
        } else {
          showProfileFeedbackModal({
            tone: 'success',
            brief: true,
            hideActions: true,
            title: isLegalSave ? 'Información legal actualizada' : 'Perfil actualizado con éxito',
            message: '',
            autoCloseMs: 1000
          });
        }
      } catch (error) {
        showProfileFeedbackModal(getFriendlyProfileSaveError(error));
      } finally {
        setProfileSaveLoading(false);
      }
    };

    createBusinessProfileButton.addEventListener('click', function (event) {
      handleProfileSave(event, 'initial');
    });

    if (saveActiveProfileChangesButton) {
      saveActiveProfileChangesButton.addEventListener('click', function (event) {
        handleProfileSave(event, 'business');
      });
    }

    if (saveLegalProfileChangesButton) {
      saveLegalProfileChangesButton.addEventListener('click', function (event) {
        handleProfileSave(event, 'legal');
      });
    }

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
            showGlobalFeedbackModal({
              badge: 'Eventos',
              title: 'Aún no puedes publicar eventos',
              message: getFriendlyEventCreationErrorMessage(error)
            });
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
          showGlobalFeedbackModal({
            badge: 'Registro',
            title: 'No pudimos crear tu cuenta',
            message: getFriendlyAuthErrorMessage(text, 'No se pudo crear la cuenta. Intenta de nuevo.')
          });
          return;
        }

        if (!response.ok) {
          setRegisterLoading(false);
          showGlobalFeedbackModal({
            badge: 'Registro',
            title: 'No pudimos crear tu cuenta',
            message: getFriendlyAuthErrorMessage(result.message, 'No se pudo crear la cuenta. Intenta de nuevo.')
          });
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
        showGlobalFeedbackModal({
          badge: 'Registro',
          title: 'No pudimos crear tu cuenta',
          message: 'No se pudo crear la cuenta. Intenta de nuevo.'
        });
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
