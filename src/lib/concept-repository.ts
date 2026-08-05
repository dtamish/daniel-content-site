import { demoConcepts } from '../data/demo-concepts.mjs';
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client';

export type Identity = { kind: 'honi' | 'itzik' | 'advisor' | 'editor'; name: string };

type DatabaseReview = {
  reviewer_id: string;
  decision: string;
  created_at: string;
  profiles: { display_name: string } | { display_name: string }[] | null;
};

async function signedMediaUrl(bucket: string, path: string | null) {
  const client = getSupabaseClient();
  if (!client || !path) return '';
  const { data } = await client.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? '';
}

export async function loadConcepts() {
  const client = getSupabaseClient();
  if (!client) return structuredClone(demoConcepts);

  const { data, error } = await client
    .from('concepts')
    .select('id,title,description,section,priority,banner_path,pdf_path,reviews(reviewer_id,decision,created_at,profiles(display_name))')
    .eq('publication_status', 'published')
    .order('priority', { ascending: true });
  if (error) throw error;

  return Promise.all((data ?? []).map(async (concept) => ({
    id: concept.id,
    title: concept.title,
    description: concept.description,
    section: concept.section,
    priority: concept.priority,
    bannerUrl: await signedMediaUrl('concept-banners', concept.banner_path),
    pdfUrl: await signedMediaUrl('concept-pdfs', concept.pdf_path),
    pages: [],
    reviews: ((concept.reviews ?? []) as DatabaseReview[]).map((review) => ({
      reviewerId: review.reviewer_id,
      reviewerName: Array.isArray(review.profiles)
        ? review.profiles[0]?.display_name ?? 'סוקר/ת'
        : review.profiles?.display_name ?? 'סוקר/ת',
      decision: review.decision,
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
  if (!userId) throw new Error('לא ניתן ליצור זהות מאומתת לשמירה.');

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
