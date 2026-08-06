import { demoConceptsByLocale } from '../data/demo-concepts.mjs';
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client';
import { DEFAULT_LOCALE, type Locale } from './i18n';

export type Identity = { kind: 'honi' | 'itzik' | 'advisor' | 'editor'; name: string };

type DatabaseReview = {
  reviewer_id: string;
  decision: string;
  created_at: string;
  notes?: string | null;
  profiles: { display_name: string } | { display_name: string }[] | null;
};

type ConceptRow = {
  id: string;
  title: string;
  description: string;
  section: string;
  priority: number;
  locale?: string | null;
  category?: string | null;
  banner_path: string | null;
  pdf_path: string | null;
  reviews: DatabaseReview[] | null;
};

const ANONYMOUS_REVIEWER = { he: 'סוקר/ת', en: 'Reviewer' } as const;

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
export async function loadConcepts(locale: Locale = DEFAULT_LOCALE) {
  const client = getSupabaseClient();
  if (!client) return structuredClone(demoConceptsByLocale[locale] ?? demoConceptsByLocale[DEFAULT_LOCALE]);

  const REVIEWS = 'reviews(reviewer_id,decision,notes,created_at,profiles(display_name))';
  const BASE = 'id,title,description,section,priority,locale,banner_path,pdf_path';

  const query = (columns: string) => client
    .from('concepts')
    .select(columns)
    .eq('publication_status', 'published')
    .eq('locale', locale)
    .order('priority', { ascending: true });

  // The category column arrives with its own migration. Until that has been applied the
  // catalogue still loads, ungrouped, rather than the whole room failing to open.
  let { data, error } = await query(`${BASE},category,${REVIEWS}`);
  if (error?.code === '42703') ({ data, error } = await query(`${BASE},${REVIEWS}`));
  if (error) throw error;
  // A select built at runtime cannot be inferred, so the row shape is stated here.
  const rows = (data ?? []) as unknown as ConceptRow[];

  return Promise.all(rows.map(async (concept) => ({
    id: concept.id,
    title: concept.title,
    description: concept.description,
    section: concept.section,
    priority: concept.priority,
    locale: (concept.locale ?? locale) as Locale,
    category: concept.category ?? 'series',
    bannerUrl: await signedMediaUrl('concept-banners', concept.banner_path),
    pdfUrl: await signedMediaUrl('concept-pdfs', concept.pdf_path),
    reviews: (concept.reviews ?? []).map((review) => ({
      reviewerId: review.reviewer_id,
      reviewerName: Array.isArray(review.profiles)
        ? review.profiles[0]?.display_name ?? ANONYMOUS_REVIEWER[locale]
        : review.profiles?.display_name ?? ANONYMOUS_REVIEWER[locale],
      decision: review.decision,
      notes: review.notes ?? '',
      createdAt: review.created_at,
    })),
  })));
}

export async function saveReview({ conceptId, decision, notes, identity }: {
  conceptId: string;
  decision: string;
  notes: string;
  identity: Identity;
}) {
  const client = getSupabaseClient();
  if (!client) {
    const key = 'concept-approval:demo-reviews';
    const existing = JSON.parse(localStorage.getItem(key) ?? '[]');
    existing.push({ conceptId, decision, notes, identity, createdAt: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(existing));
    return { mode: 'demo' as const };
  }

  let { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) {
    const { data, error } = await client.auth.signInAnonymously({
      options: { data: { display_name: identity.name, identity_kind: identity.kind } },
    });
    if (error) throw error;
    sessionData = { session: data.session };
  }

  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error('Could not establish an authenticated identity for saving.');

  // The database trigger creates the immutable reviewer profile from auth metadata.
  // A browser is never allowed to upsert a display name or grant itself a role.
  const { error } = await client.from('reviews').insert({
    concept_id: conceptId,
    decision,
    notes: notes.trim() || null,
  });
  if (error) throw error;
  return { mode: 'supabase' as const };
}

export { isSupabaseConfigured };
