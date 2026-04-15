require('dotenv').config();
const mongoose = require('mongoose');
const Client = require('../models/Client');
const { BusinessProfile } = require('../models/BusinessProfile');
const { ProfileDocument } = require('../models/ProfileDocument');
const { VerificationCase } = require('../models/VerificationCase');
const { runAutomaticDocumentVerification } = require('../services/documentVerification/runDocumentVerification');

const MONGODB_URI = String(process.env.MONGODB_URI || '').trim();

const getArgumentValue = function (flagName) {
  const match = process.argv.slice(2).find(function (argument) {
    return argument.indexOf(flagName + '=') === 0;
  });

  return match ? match.slice(flagName.length + 1) : '';
};

const getBooleanArgument = function (flagName) {
  const value = String(getArgumentValue(flagName) || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
};

const getRequiredDocumentRoles = function (profileType) {
  return profileType === 'LEGAL' ? ['RUT'] : ['CEDULA_FRONT', 'CEDULA_BACK'];
};

const getVerificationSummaryMessage = function (state, missingDocumentRoles, rejectionReasons) {
  if (state === 'APPROVED') {
    return 'El perfil cuenta con toda la documentación requerida aprobada.';
  }

  if (state === 'REJECTED') {
    return rejectionReasons.length
      ? 'Se requiere volver a cargar documentos rechazados: ' + rejectionReasons.join(', ') + '.'
      : 'La verificación fue rechazada. Se requiere volver a cargar documentos.';
  }

  if (state === 'MANUAL_REVIEW') {
    return 'La documentación requiere revisión manual.';
  }

  if (state === 'PROCESSING') {
    return 'La documentación ya está completa y quedó lista para verificación.';
  }

  if (missingDocumentRoles.length) {
    return 'Faltan documentos requeridos: ' + missingDocumentRoles.join(', ') + '.';
  }

  return 'El perfil fue creado y está pendiente de documentación.';
};

const synchronizeVerificationState = async function (businessProfile) {
  const activeDocuments = await ProfileDocument.find({
    businessProfileId: businessProfile._id,
    activeVersion: true
  }).sort({ createdAt: -1 });

  const requiredDocumentRoles = getRequiredDocumentRoles(businessProfile.profileType);
  const uploadedDocumentRoles = Array.from(new Set(activeDocuments.map(function (document) {
    return document.documentRole;
  })));
  const missingDocumentRoles = requiredDocumentRoles.filter(function (documentRole) {
    return !uploadedDocumentRoles.includes(documentRole);
  });
  const rejectedDocuments = activeDocuments.filter(function (document) {
    return document.verificationStatus === 'REJECTED';
  });
  const reviewDocuments = activeDocuments.filter(function (document) {
    return document.verificationStatus === 'MANUAL_REVIEW';
  });
  const approvedDocumentRoles = Array.from(new Set(activeDocuments.filter(function (document) {
    return document.verificationStatus === 'APPROVED';
  }).map(function (document) {
    return document.documentRole;
  })));
  const allRequiredApproved = requiredDocumentRoles.every(function (documentRole) {
    return approvedDocumentRoles.includes(documentRole);
  });
  const allRequiredUploaded = !missingDocumentRoles.length;

  let nextVerificationStatus = 'PENDING';

  if (allRequiredApproved) {
    nextVerificationStatus = 'APPROVED';
  } else if (rejectedDocuments.length) {
    nextVerificationStatus = 'REJECTED';
  } else if (reviewDocuments.length) {
    nextVerificationStatus = 'MANUAL_REVIEW';
  } else if (allRequiredUploaded) {
    nextVerificationStatus = 'PROCESSING';
  }

  const decisionReasons = rejectedDocuments.flatMap(function (document) {
    return (document.rejectionReasons || []).length
      ? document.rejectionReasons
      : ['Documento ' + document.documentRole + ' rechazado.'];
  });
  const summary = getVerificationSummaryMessage(nextVerificationStatus, missingDocumentRoles, decisionReasons);

  const verificationCase = await VerificationCase.findOneAndUpdate(
    { businessProfileId: businessProfile._id },
    {
      ownerClientId: businessProfile.ownerClientId,
      profileType: businessProfile.profileType,
      requiredDocuments: requiredDocumentRoles,
      processedDocuments: activeDocuments.map(function (document) { return document._id; }),
      state: nextVerificationStatus,
      decisionReasons,
      summary,
      completedAt: nextVerificationStatus === 'APPROVED' ? new Date() : null
    },
    {
      upsert: true,
      returnDocument: 'after',
      setDefaultsOnInsert: true,
      runValidators: true
    }
  );

  const updatedNaturalPerson = Object.assign({}, businessProfile.naturalPerson ? businessProfile.naturalPerson.toObject() : {});
  const updatedLegalEntity = Object.assign({}, businessProfile.legalEntity ? businessProfile.legalEntity.toObject() : {});
  const latestDocumentByRole = {};

  activeDocuments.forEach(function (document) {
    if (!latestDocumentByRole[document.documentRole]) {
      latestDocumentByRole[document.documentRole] = document;
    }
  });

  if (businessProfile.profileType === 'NATURAL') {
    updatedNaturalPerson.frontDocumentId = latestDocumentByRole.CEDULA_FRONT ? latestDocumentByRole.CEDULA_FRONT._id : undefined;
    updatedNaturalPerson.backDocumentId = latestDocumentByRole.CEDULA_BACK ? latestDocumentByRole.CEDULA_BACK._id : undefined;
    businessProfile.naturalPerson = updatedNaturalPerson;
  }

  if (businessProfile.profileType === 'LEGAL') {
    updatedLegalEntity.rutDocumentId = latestDocumentByRole.RUT ? latestDocumentByRole.RUT._id : undefined;
    businessProfile.legalEntity = updatedLegalEntity;
  }

  businessProfile.documents = activeDocuments.map(function (document) {
    return document._id;
  });
  businessProfile.verificationStatus = nextVerificationStatus;
  businessProfile.canPublishEvents = nextVerificationStatus === 'APPROVED';
  businessProfile.verificationSummary = {
    requiredDocumentRoles,
    uploadedDocumentRoles,
    missingDocumentRoles,
    rejectionReasons: decisionReasons,
    lastCaseId: verificationCase._id,
    lastUpdatedAt: new Date()
  };

  await businessProfile.save();

  return {
    profile: businessProfile,
    verificationCase,
    documents: activeDocuments
  };
};

const resolveProfilesToProcess = async function () {
  const profileId = getArgumentValue('--profileId');
  const ownerEmail = String(getArgumentValue('--ownerEmail') || '').trim().toLowerCase();
  const statusesArgument = String(getArgumentValue('--statuses') || 'REJECTED,MANUAL_REVIEW').trim();
  const statuses = statusesArgument.split(',').map(function (value) {
    return String(value || '').trim().toUpperCase();
  }).filter(Boolean);

  if (profileId) {
    const profile = await BusinessProfile.findById(profileId);
    return profile ? [profile] : [];
  }

  if (ownerEmail) {
    const ownerClient = await Client.findOne({ email: ownerEmail });

    if (!ownerClient) {
      return [];
    }

    return BusinessProfile.find({ ownerClientId: ownerClient._id }).sort({ createdAt: -1 });
  }

  const matchingDocuments = await ProfileDocument.find({
    activeVersion: true,
    verificationStatus: { $in: statuses }
  }).distinct('businessProfileId');

  return BusinessProfile.find({ _id: { $in: matchingDocuments } }).sort({ createdAt: -1 });
};

const reprocessProfileDocuments = async function (businessProfile) {
  const statusesArgument = String(getArgumentValue('--statuses') || 'REJECTED,MANUAL_REVIEW').trim();
  const allowedStatuses = statusesArgument.split(',').map(function (value) {
    return String(value || '').trim().toUpperCase();
  }).filter(Boolean);
  const syncOnly = getBooleanArgument('--syncOnly');
  const activeDocuments = await ProfileDocument.find({
    businessProfileId: businessProfile._id,
    activeVersion: true
  }).sort({ createdAt: -1 });
  const documentsToReprocess = syncOnly
    ? []
    : activeDocuments.filter(function (profileDocument) {
      return allowedStatuses.includes(String(profileDocument.verificationStatus || '').trim().toUpperCase());
    });

  const results = [];

  for (const profileDocument of documentsToReprocess) {
    const previousStatus = profileDocument.verificationStatus;
    const verificationResult = await runAutomaticDocumentVerification(profileDocument, businessProfile);
    results.push({
      documentId: String(profileDocument._id),
      role: profileDocument.documentRole,
      previousStatus,
      nextStatus: verificationResult.profileDocument.verificationStatus,
      recommendedDecision: verificationResult.profileDocument.validationResult && verificationResult.profileDocument.validationResult.recommendedDecision,
      notes: verificationResult.profileDocument.validationResult && verificationResult.profileDocument.validationResult.notes
    });
  }

  const synchronized = await synchronizeVerificationState(businessProfile);

  return {
    profileId: String(businessProfile._id),
    profileStatus: synchronized.profile.verificationStatus,
    verificationCaseState: synchronized.verificationCase.state,
    canPublishEvents: synchronized.profile.canPublishEvents,
    reprocessedDocuments: results.length,
    documents: results
  };
};

const main = async function () {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI no está configurada.');
  }

  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  const profiles = await resolveProfilesToProcess();

  if (!profiles.length) {
    console.log(JSON.stringify({ ok: true, processedProfiles: 0, results: [] }, null, 2));
    return;
  }

  const results = [];

  for (const businessProfile of profiles) {
    results.push(await reprocessProfileDocuments(businessProfile));
  }

  console.log(JSON.stringify({ ok: true, processedProfiles: results.length, results }, null, 2));
};

main()
  .catch(function (error) {
    console.error(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  })
  .finally(async function () {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  });