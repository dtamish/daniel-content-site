import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Bundle production code with only the Firebase SDK boundary replaced; no cloud calls.
const state = globalThis.__firebaseState = { docs: new Map(), uid: 'active-uid', reads: [], writes: [], downloads: [], revoked: [], blobs: [] };
const mockModules = {
  'firebase-client': `export const isFirebaseConfigured=true;
export const anonymousUser=async()=>({uid:globalThis.__firebaseState.uid});
export const firestore=()=>({}); export const storage=()=>({});`,
  'firebase/storage': `export const ref=(_,path)=>path;
export const getBlob=async(path)=>{const s=globalThis.__firebaseState; s.downloads.push(path);return new Blob([path]);};`,
  'firebase/firestore': `
const s=()=>globalThis.__firebaseState;
const snap=(key)=>({id:key.split('/').at(-1),exists:()=>s().docs.has(key),data:()=>structuredClone(s().docs.get(key))});
export const doc=(_,collection,id)=>collection+'/'+id;
export const collection=(_,name)=>name;
export const where=(field,operator,value)=>({field,operator,value});
export const query=(name,...filters)=>({name,filters});
export const getDoc=async(key)=>{s().reads.push(key);return snap(key);};
export const getDocs=async(q)=>{s().reads.push(q);const collection=typeof q==='string'?q:q.name;
const filters=typeof q==='string'?[]:q.filters;
return {docs:[...s().docs.keys()].filter(k=>k.startsWith(collection+'/')).map(k=>snap(k)).filter(d=>filters.every(f=>d.data()[f.field]===f.value))};};
export const setDoc=async(key,value,options)=>{s().writes.push(['set',key,value]);s().docs.set(key,{...(options?.merge?s().docs.get(key):{}),...value});};
export const runTransaction=async(_,callback)=>{const staged=[];const tx={get:async(key)=>snap(key),set:(key,value)=>staged.push(['set',key,value]),update:(key,value)=>staged.push(['update',key,value])};
const result=await callback(tx);for(const [mode,key,value] of staged){s().writes.push([mode,key,value]);s().docs.set(key,{...(mode==='update'?s().docs.get(key):{}),...value});}return result;};`,
};
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/concept-repository.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [{ name: 'firebase-network-boundary', setup(build) {
  build.onResolve({ filter: /^(firebase\/firestore|firebase\/storage)$/ }, args => ({ path: args.path, namespace: 'mock' }));
  build.onResolve({ filter: /firebase-client$/ }, () => ({ path: 'firebase-client', namespace: 'mock' }));
  build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mockModules[args.path], loader: 'js' }));
} }] });
const repository = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const row = (extra = {}) => ({ id: 'source-uuid', title: 'Source', description: 'Text', section: 'queue', priority: 4, locale: 'en', category: 'series', publication_status: 'published', banner_path: 'folder/banner.png', pdf_path: 'folder/concept.pdf', reviews: [], concept_assessments: null, ...extra });
function reset(record = row()) { state.docs.clear(); state.docs.set('concepts/source-uuid', record); state.reads.length = state.writes.length = state.downloads.length = state.revoked.length = 0; repository.releaseMediaUrls(); }
const editor = { kind: 'content_editor', name: 'Editor' };
const advisor = { kind: 'advisor', name: 'Advisor' };

test('one locale/status query maps imported source history and assessment without media fetches', async () => {
  reset(row({ reviews: [{ id: 'source-review', concept_id: 'source-uuid', reviewer_id: 'legacy-uuid', reviewer_role: 'editor', decision: 'wait', notes: 'Old', created_at: '2026-08-01T00:00:00Z', affects_decision: true }], concept_assessments: { concept_id: 'source-uuid', production_speed: 'fast', budget_level: 'low', updated_at: '2026-08-02T00:00:00Z' } }));
  const result = await repository.loadConcepts('en');
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].assessment, { productionSpeed: 'fast', budgetLevel: 'low', updatedAt: '2026-08-02T00:00:00Z' });
  assert.equal(result[0].reviews[0].id, 'source-review');
  assert.equal(result[0].reviews[0].createdAt, '2026-08-01T00:00:00Z');
  assert.equal(result[0].reviews[0].isOwn, false);
  assert.equal(state.reads.length, 1);
  assert.equal(state.reads[0].filters.length, 2);
  assert.deepEqual(state.downloads, []);
});

test('draft is hidden to visitor but visible to selected editor; profile is keyed by Firebase uid', async () => {
  reset(row({ publication_status: 'draft' }));
  assert.equal((await repository.loadConcepts('en')).length, 0);
  assert.equal((await repository.loadConcepts('en', editor)).length, 1);
  assert.equal(state.docs.get('profiles/active-uid').identity_kind, 'content_editor');
  assert.equal(state.docs.get('profiles/active-uid').approved, true);
  assert.equal(state.reads.at(-1).filters.length, 1);
});

test('append-only review archives the same row atomically and preserves prior source row', async () => {
  reset(row({ reviews: [{ id: 'source-review', reviewer_id: 'legacy-uuid', decision: 'wait', created_at: '2026-08-01T00:00:00Z' }] }));
  const result = await repository.saveReview({ conceptId: 'source-uuid', decision: 'priority-approved', notes: 'New', identity: advisor, reviewerId: 'legacy-local-id' });
  const concept = state.docs.get('concepts/source-uuid');
  assert.equal(concept.reviews.length, 2);
  assert.equal(concept.reviews[0].id, 'source-review');
  assert.deepEqual(state.docs.get(`reviews/${result.id}`), concept.reviews[1]);
  assert.equal(concept.reviews[1].reviewer_id, 'active-uid');
  assert.equal(concept.publication_status, 'published');
  assert.equal(state.writes.filter(([op]) => op === 'update').length, 1);
});

test('editing another reviewer history is rejected before archival write', async () => {
  reset(row({ reviews: [{ id: 'other', reviewer_id: 'someone-else', decision: 'wait' }] }));
  await assert.rejects(repository.saveReview({ conceptId: 'source-uuid', decision: 'wait', notes: 'Wrong', identity: advisor, reviewerId: 'ignored', affectsDecision: false, supersedesReviewId: 'other' }), /Only your own/);
  assert.equal([...state.docs.keys()].filter(key => key.startsWith('reviews/')).length, 0);
});

test('editor decision changes publication status; assessment archives and embeds together', async () => {
  reset(row({ publication_status: 'draft' }));
  await repository.saveReview({ conceptId: 'source-uuid', decision: 'priority-approved', notes: '', identity: editor, reviewerId: 'ignored' });
  assert.equal(state.docs.get('concepts/source-uuid').publication_status, 'published');
  await repository.saveConceptEditorialMetadata({ conceptId: 'source-uuid', identity: editor, category: 'film', productionSpeed: 'fast', budgetLevel: 'low' });
  assert.deepEqual(state.docs.get('concept_assessments/source-uuid'), state.docs.get('concepts/source-uuid').concept_assessments);
  assert.equal(state.docs.get('concepts/source-uuid').category, 'film');
  await repository.saveReview({ conceptId: 'source-uuid', decision: 'reset', notes: '', identity: editor, reviewerId: 'ignored', clearPriorNotes: true });
  assert.equal(state.docs.get('concepts/source-uuid').publication_status, 'draft');
});

test('private media is fetched lazily and cached object URL is revoked on close', async () => {
  reset();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let next = 0;
  URL.createObjectURL = () => `blob:local-${++next}`;
  URL.revokeObjectURL = url => state.revoked.push(url);
  try {
    const first = await repository.refreshMediaUrl('concept-pdfs', 'folder/concept.pdf');
    assert.equal(first, 'blob:local-1');
    assert.equal(await repository.refreshMediaUrl('concept-pdfs', 'folder/concept.pdf'), first);
    assert.deepEqual(state.downloads, ['concept-pdfs/folder/concept.pdf']);
    repository.releaseMediaUrl('concept-pdfs', 'folder/concept.pdf');
    assert.deepEqual(state.revoked, [first]);
    assert.equal(await repository.refreshMediaUrl('concept-pdfs', 'folder/concept.pdf'), 'blob:local-2');
  } finally { repository.releaseMediaUrls(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});
