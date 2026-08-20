import { demoConceptsByLocale } from '../data/demo-concepts.mjs';
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client';
import { DEFAULT_LOCALE, STRINGS, type Locale, type ReviewerRole } from './i18n';

export type Identity = { kind: ReviewerRole; name: string };
export type ProductionSpeed = 'fast' | 'medium' | 'slow';
export type BudgetLevel = 'low' | 'medium' | 'high';
export type ConceptCategory = 'series' | 'film' | 'film-short' | 'film-long' | 'digital' | 'podcast';
export type ConceptAssessment = {
  productionSpeed: ProductionSpeed;
  budgetLevel: BudgetLevel;
  updatedAt: string;
};

type DatabaseReview = {
  id: string;
  reviewer_id: string;
  reviewer_role: string;
  decision: string;
  created_at: string;
  notes?: string | null;
  affects_decision?: boolean | null;
  clear_prior_notes?: boolean | null;
  supersedes_review_id?: string | null;
};

type ConceptRow = {
  id: string;
  title: string;
  description: string;
  section: string;
  priority: number;
  publication_status: 'draft' | 'published';
  locale?: string | null;
  category?: string | null;
  banner_path: string | null;
  pdf_path: string | null;
  reviews: DatabaseReview[] | null;
  concept_assessments: {
    production_speed: ProductionSpeed;
    budget_level: BudgetLevel;
    updated_at: string;
  } | Array<{
    production_speed: ProductionSpeed;
    budget_level: BudgetLevel;
    updated_at: string;
  }> | null;
};


function normalizeReviewerRole(value: string | undefined): ReviewerRole {
  if (value === 'content_editor' || value === 'editor') return 'content_editor';
  if (value === 'management' || value === 'honi' || value === 'itzik') return 'management';
  return 'advisor';
}

function compatibleAuthRole(role: ReviewerRole) {
  // Legacy aliases keep authentication working before the hosted migration;
  // the migration normalizes both old and new aliases to the canonical roles.
  if (role === 'management') return 'honi';
  if (role === 'content_editor') return 'editor';
  return 'advisor';
}

function normalizeAssessment(value: ConceptRow['concept_assessments']): ConceptAssessment | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row ? {
    productionSpeed: row.production_speed,
    budgetLevel: row.budget_level,
    updatedAt: row.updated_at,
  } : null;
}

async function signedMediaUrl(bucket: string, path: string | null) {
  const client = getSupabaseClient();
  if (!client || !path) return '';
  const { data } = await client.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? '';
}

/**
 * Loads the published catalogue for one locale. Locale is part of a concept's logical
 * identity: the same idea has an independent record, PDF and banner per language, and a
 * concept with no approved document in a language simply does not exist there.
 */
export async function loadConcepts(locale: Locale = DEFAULT_LOCALE, identity: Identity | null = null) {
  const client = getSupabaseClient();
  if (!client) return structuredClone(demoConceptsByLocale[locale] ?? demoConceptsByLocale[DEFAULT_LOCALE])
    .map((concept) => ({ ...concept, publicationStatus: 'published' as const, assessment: null }));

  if (identity) await ensureReviewerSession(identity);
  const { data: sessionData } = await client.auth.getSession();
  const currentUserId = sessionData.session?.user.id ?? null;
  const REVIEWS = 'reviews(id,reviewer_id,reviewer_role,decision,notes,affects_decision,clear_prior_notes,supersedes_review_id,created_at)';
  const ASSESSMENT = 'concept_assessments(production_speed,budget_level,updated_at)';
  const BASE = 'id,title,description,section,priority,publication_status,locale,banner_path,pdf_path';

  const query = (columns: string) => {
    const catalogue = client
      .from('concepts')
      .select(columns)
      .eq('locale', locale)
      .order('priority', { ascending: true });
    return identity?.kind === 'content_editor'
      ? catalogue.in('publication_status', ['published', 'draft'])
      : catalogue.eq('publication_status', 'published');
  };

  // The category column arrives with its own migration. Until that has been applied the
  // catalogue still loads, ungrouped, rather than the whole room failing to open.
  let { data, error } = await query(`${BASE},category,${REVIEWS},${ASSESSMENT}`);
  if (error) {
    // Assessment support is an additive migration. A stale PostgREST schema cache or
    // a deploy that lands moments before the migration must not take down the catalogue.
    ({ data, error } = await query(`${BASE},category,${REVIEWS}`));
    if (error?.code === '42703') ({ data, error } = await query(`${BASE},${REVIEWS}`));
  }
  if (error) throw error;
  // A select built at runtime cannot be inferred, so the row shape is stated here.
  const rows = (data ?? []) as unknown as ConceptRow[];

  return Promise.all(rows.map(async (concept) => ({
    id: concept.id,
    title: concept.title,
    description: concept.description,
    section: concept.section,
    priority: concept.priority,
    publicationStatus: concept.publication_status,
    locale: (concept.locale ?? locale) as Locale,
    category: concept.category ?? 'series',
    assessment: normalizeAssessment(concept.concept_assessments),
    bannerUrl: await signedMediaUrl('concept-banners', concept.banner_path),
    pdfUrl: await signedMediaUrl('concept-pdfs', concept.pdf_path),
    reviews: (concept.reviews ?? []).map((review) => {
      const role = normalizeReviewerRole(review.reviewer_role);
      return {
        id: review.id,
        reviewerId: review.reviewer_id,
        reviewerName: STRINGS[locale].people[role],
        reviewerRole: role,
        isOwn: review.reviewer_id === currentUserId,
        decision: review.decision,
        notes: review.notes ?? '',
        affectsDecision: review.affects_decision !== false,
        clearPriorNotes: review.clear_prior_notes === true,
        supersedesReviewId: review.supersedes_review_id ?? null,
        createdAt: review.created_at,
      };
    }),
  })));
}

async function ensureReviewerSession(identity: Identity) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase is not configured.');

  let { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    const { data, error } = await client.auth.signInAnonymously({
      options: { data: { display_name: identity.name, identity_kind: compatibleAuthRole(identity.kind) } },
    });
    if (error) throw error;
    sessionData = { session: data.session };
  }

  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Could not establish an authenticated identity for saving.');
  const { error: roleError } = await client.rpc('set_reviewer_role', {
    requested_kind: identity.kind,
  });
  if (roleError) throw roleError;
  return { client, userId };
}

type SupabaseClient = NonNullable<ReturnType<typeof getSupabaseClient>>;

async function restoreConceptPublicationStatus(
  client: SupabaseClient,
  conceptId: string,
  publicationStatus: 'draft' | 'published',
) {
  const { error } = await client.from('concepts')
    .update({ publication_status: publicationStatus })
    .eq('id', conceptId)
    .select('id')
    .single();
  if (error) throw error;
}

async function insertReviewRecord(client: SupabaseClient, payload: {
  conceptId: string; decision: string; notes: string; affectsDecision: boolean;
  clearPriorNotes: boolean; supersedesReviewId: string | null;
}) {
  return client.from('reviews').insert({
    concept_id: payload.conceptId,
    decision: payload.decision,
    notes: payload.notes.trim() || null,
    affects_decision: payload.affectsDecision,
    clear_prior_notes: payload.clearPriorNotes,
    supersedes_review_id: payload.supersedesReviewId,
  }).select('id,reviewer_id,reviewer_role,decision,notes,affects_decision,clear_prior_notes,supersedes_review_id,created_at').single();
}

async function saveEditoriallyGatedReview(client: SupabaseClient, payload: {
  conceptId: string; decision: string; notes: string; affectsDecision: boolean;
  clearPriorNotes: boolean; supersedesReviewId: string | null;
}) {
  const { data: concept, error: readError } = await client.from('concepts')
    .select('publication_status')
    .eq('id', payload.conceptId)
    .single();
  if (readError) throw readError;
  const previousStatus = concept.publication_status as 'draft' | 'published';
  const approvedForWiderReview = ['priority-approved', 'schedule-approved'].includes(payload.decision);
  const desiredStatus = approvedForWiderReview ? 'published' : 'draft';

  // Existing RLS accepts review rows only for published concepts. The concept is exposed
  // only for the insert and immediately settles to the editorial decision; failures restore it.
  try {
    if (previousStatus !== 'published') {
      await restoreConceptPublicationStatus(client, payload.conceptId, 'published');
    }
    const result = await insertReviewRecord(client, payload);
    if (desiredStatus !== 'published') {
      await restoreConceptPublicationStatus(client, payload.conceptId, 'draft');
    }
    return result;
  } catch (error) {
    await restoreConceptPublicationStatus(client, payload.conceptId, previousStatus);
    throw error;
  }
}

export async function saveReview({ conceptId, decision, notes, identity, reviewerId, affectsDecision = true, clearPriorNotes = false, supersedesReviewId = null }: {
  conceptId: string;
  decision: string;
  notes: string;
  identity: Identity;
  reviewerId: string;
  affectsDecision?: boolean;
  clearPriorNotes?: boolean;
  supersedesReviewId?: string | null;
}) {
  const client = getSupabaseClient();
  if (!client) {
    const key = 'concept-approval:demo-reviews';
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]');
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    existing.push({ id, conceptId, decision, notes, identity, reviewerId, affectsDecision, clearPriorNotes, supersedesReviewId, createdAt });
    localStorage.setItem(key, JSON.stringify(existing));
    return { mode: 'demo' as const, id, reviewerId, reviewerRole: identity.kind, createdAt };
  }

  await ensureReviewerSession(identity);

  // The database trigger copies the selected role onto the immutable review row
  // and always binds reviewer_id to the current anonymous session.
  const payload = { conceptId, decision, notes, affectsDecision, clearPriorNotes, supersedesReviewId };
  const { data, error } = identity.kind === 'content_editor' && affectsDecision && !supersedesReviewId
    ? await saveEditoriallyGatedReview(client, payload)
    : await insertReviewRecord(client, payload);
  if (error) throw error;
  return {
    mode: 'supabase' as const,
    id: data.id,
    reviewerId: data.reviewer_id,
    reviewerRole: normalizeReviewerRole(data.reviewer_role),
    createdAt: data.created_at,
  };
}

export async function saveConceptAssessment({ conceptId, productionSpeed, budgetLevel, identity }: {
  conceptId: string;
  productionSpeed: ProductionSpeed;
  budgetLevel: BudgetLevel;
  identity: Identity;
}): Promise<ConceptAssessment & { mode: 'demo' | 'supabase' }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      mode: 'demo', productionSpeed, budgetLevel, updatedAt: new Date().toISOString(),
    };
  }

  await ensureReviewerSession(identity);
  const { data, error } = await client.rpc('set_concept_assessment', {
    p_concept_id: conceptId,
    p_production_speed: productionSpeed,
    p_budget_level: budgetLevel,
  }).single();
  if (error) throw error;
  const row = data as { production_speed: ProductionSpeed; budget_level: BudgetLevel; updated_at: string };
  return {
    mode: 'supabase',
    productionSpeed: row.production_speed,
    budgetLevel: row.budget_level,
    updatedAt: row.updated_at,
  };
}

export async function publishConceptForPending({ conceptId, identity }: {
  conceptId: string;
  identity: Identity;
}) {
  if (identity.kind !== 'content_editor') throw new Error('Content editor role required.');
  const client = getSupabaseClient();
  if (!client) return { conceptId, publicationStatus: 'published' as const, mode: 'demo' as const };

  await ensureReviewerSession(identity);
  const { data, error } = await client.from('concepts')
    .update({ publication_status: 'published' })
    .eq('id', conceptId)
    .eq('publication_status', 'draft')
    .select('id,publication_status')
    .single();
  if (error) throw error;
  return { conceptId: data.id, publicationStatus: data.publication_status as 'published', mode: 'remote' as const };
}

export async function saveConceptEditorialMetadata({ conceptId, category, productionSpeed, budgetLevel, identity }: {
  conceptId: string;
  category: ConceptCategory;
  productionSpeed: ProductionSpeed;
  budgetLevel: BudgetLevel;
  identity: Identity;
}): Promise<ConceptAssessment & { category: ConceptCategory; mode: 'demo' | 'supabase' }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      mode: 'demo', category, productionSpeed, budgetLevel, updatedAt: new Date().toISOString(),
    };
  }

  await ensureReviewerSession(identity);
  const { data, error } = await client.rpc('set_concept_editorial_metadata', {
    p_concept_id: conceptId,
    p_category: category,
    p_production_speed: productionSpeed,
    p_budget_level: budgetLevel,
  }).single();
  if (error) throw error;
  const row = data as {
    category: ConceptCategory;
    production_speed: ProductionSpeed;
    budget_level: BudgetLevel;
    updated_at: string;
  };
  return {
    mode: 'supabase',
    category: row.category,
    productionSpeed: row.production_speed,
    budgetLevel: row.budget_level,
    updatedAt: row.updated_at,
  };
}

export { isSupabaseConfigured };
