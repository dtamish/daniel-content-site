const MAX_DESCRIPTION_LENGTH = 500;
const DECISIONS = new Set(['priority-approved', 'schedule-approved', 'wait', 'canceled']);

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function safeRelativePath(value, label, extension) {
  const path = requiredText(value, label).replaceAll('\\', '/');
  if (path.startsWith('/') || path.includes('../') || !path.toLowerCase().endsWith(extension)) {
    throw new Error(`${label} must be a safe ${extension} relative path.`);
  }
  return path;
}

export function parseConceptManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.items) || !manifest.items.length) {
    throw new Error('Manifest must include at least one concept item.');
  }
  if (manifest.concept_count !== undefined && manifest.concept_count !== manifest.items.length) {
    throw new Error('Manifest concept_count does not match its items.');
  }

  return manifest.items.map((item, index) => {
    const title = requiredText(item?.title, `Concept ${index + 1} title`);
    const description = String(item?.description_draft ?? item?.description ?? '').trim().slice(0, MAX_DESCRIPTION_LENGTH);
    const priority = Number(item?.priority ?? index + 1);
    if (!Number.isInteger(priority) || priority < 0 || priority > 9999) {
      throw new Error(`${title}: priority must be an integer from 0 to 9999.`);
    }

    return Object.freeze({
      title,
      description,
      priority,
      banner: safeRelativePath(item?.banner, `${title} banner`, '.png'),
      pdf: safeRelativePath(item?.pdf, `${title} PDF`, '.pdf'),
    });
  });
}

export function resolveActingEditor(profiles, configuredId = '') {
  const approvedEditors = (profiles ?? []).filter((profile) => profile?.is_editor && profile?.approved && profile?.id);
  if (configuredId) {
    if (!approvedEditors.some((profile) => profile.id === configuredId)) {
      throw new Error('CONCEPT_ADMIN_CREATED_BY must reference an approved editor profile.');
    }
    return configuredId;
  }
  if (approvedEditors.length !== 1) {
    throw new Error('Set CONCEPT_ADMIN_CREATED_BY to an approved editor profile id.');
  }
  return approvedEditors[0].id;
}

export function assertDecision(decision) {
  if (!DECISIONS.has(decision)) throw new Error('Invalid decision.');
  return decision;
}

export function assertDeleteConfirmation(targetId, confirmation) {
  if (!targetId || confirmation !== targetId) {
    throw new Error('אימות מחיקה נכשל: יש לחזור במדויק על מזהה הקונספט.');
  }
}

export const conceptAdminLimits = Object.freeze({ MAX_DESCRIPTION_LENGTH });
