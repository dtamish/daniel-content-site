import { doc, getDoc, getDocs, query, collection, where, runTransaction, setDoc, type DocumentData } from 'firebase/firestore';
import { getBlob, ref } from 'firebase/storage';
import { bannerLayoutFromPath } from './banner-artwork.mjs';
import { createMediaResolver } from './media-resolver.mjs';
import { anonymousUser, firestore, storage, isFirebaseConfigured } from './firebase-client';
import { DEFAULT_LOCALE, STRINGS, type Locale, type ReviewerRole } from './i18n';

export type Identity = { kind: ReviewerRole; name: string };
export type BannerLayout = 'artwork' | 'composed';
export type ProductionSpeed = 'fast' | 'medium' | 'slow';
export type BudgetLevel = 'low' | 'medium' | 'high';
export type ConceptCategory = 'FLAGSHIP SERIES' | 'series' | 'film' | 'film-short' | 'film-long' | 'digital' | 'podcast';
export type ConceptAssessment = { productionSpeed: ProductionSpeed; budgetLevel: BudgetLevel; updatedAt: string };
type ReviewRow = {
  id: string; concept_id: string; reviewer_id: string; reviewer_role: string; decision: string;
  created_at: string; notes?: string | null; affects_decision?: boolean | null;
  clear_prior_notes?: boolean | null; supersedes_review_id?: string | null;
};
type AssessmentRow = { concept_id?: string; production_speed: ProductionSpeed; budget_level: BudgetLevel; updated_at: string };
type ConceptRow = {
  id: string; title: string; description: string; section: string; priority: number;
  publication_status: 'draft' | 'published'; locale?: string | null; category?: string | null;
  banner_path: string | null; pdf_path: string | null;
  reviews?: ReviewRow[] | null; concept_assessments?: AssessmentRow | null;
};

function normalizeRole(role: string): ReviewerRole {
  if (role === 'editor' || role === 'content_editor') return 'content_editor';
  if (role === 'honi' || role === 'itzik' || role === 'management') return 'management';
  return 'advisor';
}

// Private Firebase Storage objects are read using the anonymous user's auth token.
// Object URLs never contain durable download tokens. In-flight requests share a Blob;
// invalidations are scoped so closing a reader cannot cancel an in-flight banner.
const media = new Map<string, string>();
const keyEpoch = new Map<string, number>();
const bucketEpoch = new Map<string, number>();
let allEpoch = 0;
const fetchMedia = createMediaResolver(async (bucket: string, path: string) => {
  await anonymousUser();
  return getBlob(ref(storage(), `${bucket}/${path}`));
});
export async function refreshMediaUrl(bucket: string, path: string | null | undefined): Promise<string> {
  if (!path) return '';
  const key = `${bucket}/${path}`;
  if (media.has(key)) return media.get(key)!;
  const generation = [allEpoch, bucketEpoch.get(bucket) ?? 0, keyEpoch.get(key) ?? 0];
  const blob = await fetchMedia(bucket, path);
  if (generation[0] !== allEpoch || generation[1] !== (bucketEpoch.get(bucket) ?? 0) || generation[2] !== (keyEpoch.get(key) ?? 0)) return '';
  const previous = media.get(key);
  if (previous) return previous;
  const url = URL.createObjectURL(blob);
  media.set(key, url);
  return url;
}
export function releaseMediaUrls(bucket?: string) {
  if (bucket) bucketEpoch.set(bucket, (bucketEpoch.get(bucket) ?? 0) + 1);
  else allEpoch++;
  for (const [key, url] of media) {
    if (!bucket || key.startsWith(`${bucket}/`)) { URL.revokeObjectURL(url); media.delete(key); }
  }
}
export function releaseMediaUrl(bucket: string, path: string | null | undefined) {
  if (!path) return;
  const key = `${bucket}/${path}`;
  keyEpoch.set(key, (keyEpoch.get(key) ?? 0) + 1);
  const url = media.get(key);
  if (url) { URL.revokeObjectURL(url); media.delete(key); }
}

export async function ensureReviewerSession(identity: Identity) {
  const user = await anonymousUser();
  const profileRef = doc(firestore(), 'profiles', user.uid);
  const existing = await getDoc(profileRef);
  const now = new Date().toISOString();
  await setDoc(profileRef, {
    display_name: identity.name, identity_kind: identity.kind,
    is_editor: identity.kind === 'content_editor', approved: true,
    created_at: existing.data()?.created_at ?? now, updated_at: now,
  }, { merge: true });
  return user;
}

/** Exactly one concepts query per locale/status; embedded reviews and assessment are
 * mapped without separate per-card reads or eager Storage downloads. */
export async function loadConcepts(locale: Locale = DEFAULT_LOCALE, identity: Identity | null = null) {
  const user = identity ? await ensureReviewerSession(identity) : await anonymousUser();
  const concepts = collection(firestore(), 'concepts');
  const constraints = identity?.kind === 'content_editor'
    ? [where('locale', '==', locale)]
    : [where('locale', '==', locale), where('publication_status', '==', 'published')];
  const snapshot = await getDocs(query(concepts, ...constraints));
  return snapshot.docs.map((document) => {
    const row = document.data() as ConceptRow;
    const assessment = row.concept_assessments;
    return {
      id: document.id,
      title: row.title, description: row.description, section: row.section,
      priority: row.priority, publicationStatus: row.publication_status,
      locale: (row.locale ?? locale) as Locale,
      category: row.category ?? 'series',
      assessment: assessment ? {
        productionSpeed: assessment.production_speed, budgetLevel: assessment.budget_level,
        updatedAt: assessment.updated_at,
      } : null,
      bannerPath: row.banner_path ?? '', pdfPath: row.pdf_path ?? '',
      bannerLayout: bannerLayoutFromPath(row.banner_path) as BannerLayout,
      bannerUrl: '', pdfUrl: '', // resolved only as images enter the viewport / document opens
      reviews: (row.reviews ?? []).map((review) => {
        const role = normalizeRole(review.reviewer_role);
        return {
          id: review.id, reviewerId: review.reviewer_id, reviewerName: STRINGS[locale].people[role],
          reviewerRole: role, isOwn: review.reviewer_id === user.uid,
          decision: review.decision, notes: review.notes ?? '',
          affectsDecision: review.affects_decision !== false,
          clearPriorNotes: review.clear_prior_notes === true,
          supersedesReviewId: review.supersedes_review_id ?? null, createdAt: review.created_at,
        };
      }),
    };
  }).filter((row) => row.publicationStatus === 'published' || identity?.kind === 'content_editor')
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title));
}

export async function saveReview({ conceptId, decision, notes, identity, affectsDecision = true, clearPriorNotes = false, supersedesReviewId = null }: {
  conceptId: string; decision: string; notes: string; identity: Identity; reviewerId: string;
  affectsDecision?: boolean; clearPriorNotes?: boolean; supersedesReviewId?: string | null;
}) {
  const user = await ensureReviewerSession(identity);
  const id = crypto.randomUUID();
  const created_at = new Date().toISOString();
  const row: ReviewRow = {
    id, concept_id: conceptId, reviewer_id: user.uid, reviewer_role: identity.kind,
    decision, notes: notes.trim() || null, affects_decision: affectsDecision,
    clear_prior_notes: clearPriorNotes, supersedes_review_id: supersedesReviewId, created_at,
  };
  const conceptRef = doc(firestore(), 'concepts', conceptId);
  const reviewRef = doc(firestore(), 'reviews', id);
  await runTransaction(firestore(), async (tx) => {
    const snapshot = await tx.get(conceptRef);
    if (!snapshot.exists()) throw new Error('Concept no longer exists.');
    const concept = snapshot.data() as ConceptRow;
    if (concept.publication_status !== 'published' && identity.kind !== 'content_editor') {
      throw new Error('This concept is not published.');
    }
    if (supersedesReviewId && !(concept.reviews ?? []).some((review) => review.id === supersedesReviewId && review.reviewer_id === user.uid)) {
      throw new Error('Only your own historical review can be amended.');
    }
    const next: DocumentData = { reviews: [...(concept.reviews ?? []), row], updated_at: created_at };
    if (identity.kind === 'content_editor' && affectsDecision && !supersedesReviewId) {
      next.publication_status = ['priority-approved', 'schedule-approved'].includes(decision) ? 'published' : 'draft';
    }
    tx.set(reviewRef, row); // rules permit create only; the same row is embedded atomically
    tx.update(conceptRef, next);
  });
  return { mode: 'firebase' as const, id, reviewerId: user.uid, reviewerRole: identity.kind, createdAt: created_at };
}

async function assessmentUpdate(conceptId: string, identity: Identity, productionSpeed: ProductionSpeed, budgetLevel: BudgetLevel, category?: ConceptCategory) {
  if (identity.kind !== 'content_editor') throw new Error('Content editor role required.');
  await ensureReviewerSession(identity);
  const now = new Date().toISOString();
  const conceptRef = doc(firestore(), 'concepts', conceptId);
  const assessmentRef = doc(firestore(), 'concept_assessments', conceptId);
  await runTransaction(firestore(), async (tx) => {
    const [concept, previous] = await Promise.all([tx.get(conceptRef), tx.get(assessmentRef)]);
    if (!concept.exists()) throw new Error('Concept no longer exists.');
    const row = {
      ...previous.data(), concept_id: conceptId,
      production_speed: productionSpeed, budget_level: budgetLevel, updated_at: now,
    };
    tx.set(assessmentRef, row);
    tx.update(conceptRef, { concept_assessments: row, ...(category ? { category } : {}), updated_at: now });
  });
  return { mode: 'firebase' as const, productionSpeed, budgetLevel, updatedAt: now };
}
export async function saveConceptAssessment({ conceptId, productionSpeed, budgetLevel, identity }: {
  conceptId: string; productionSpeed: ProductionSpeed; budgetLevel: BudgetLevel; identity: Identity;
}) { return assessmentUpdate(conceptId, identity, productionSpeed, budgetLevel); }
export async function saveConceptEditorialMetadata({ conceptId, category, productionSpeed, budgetLevel, identity }: {
  conceptId: string; category: ConceptCategory; productionSpeed: ProductionSpeed; budgetLevel: BudgetLevel; identity: Identity;
}) { return { ...await assessmentUpdate(conceptId, identity, productionSpeed, budgetLevel, category), category }; }

export async function publishConceptForPending({ conceptId, identity }: { conceptId: string; identity: Identity }) {
  if (identity.kind !== 'content_editor') throw new Error('Content editor role required.');
  await ensureReviewerSession(identity);
  const reference = doc(firestore(), 'concepts', conceptId);
  await runTransaction(firestore(), async (tx) => {
    const concept = await tx.get(reference);
    if (!concept.exists() || concept.data().publication_status !== 'draft') throw new Error('Draft has changed. Reload the catalogue.');
    tx.update(reference, { publication_status: 'published', updated_at: new Date().toISOString() });
  });
  return { conceptId, publicationStatus: 'published' as const, mode: 'firebase' as const };
}
export { isFirebaseConfigured };
