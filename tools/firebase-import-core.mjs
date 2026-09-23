// Shared, dependency-free snapshot validation and Firebase wire format.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

export const PROJECT = 'sinai-concept-room-dd26';
export const BUCKET = `${PROJECT}.firebasestorage.app`;
export const BASE = 'C:/Users/dtami/AppData/Local/hermes/data';
export const DEFAULTS = {
  source: `${BASE}/concept-firebase-20260923/source-live-readonly.json`,
  inventory: `${BASE}/concept-firebase-20260923/storage-full-inventory.json`,
  verification: `${BASE}/concept-firebase-20260923/full-backup-verification.json`,
  manifest: `${BASE}/concept-room-audit-20260923/backup-manifest.json`,
  extras: `${BASE}/concept-firebase-20260923/extra-download-receipts.json`,
  mediaRoot: `${BASE}/concept-room-audit-20260923/backup-media`,
};
// Approved immutable private metadata: raw bytes never enter the repository.
export const TRUSTED_INPUT_SHA256 = Object.freeze({
  source: '20e497323ec1bf930448dbc30ca64282aea758b534ebdc5d55ac83c85432e9f7',
  inventory: '7ddce723dab180f982afa5af0ce5bb5000812d731c346c10450edc5c1a285e6d',
  verification: 'cbd77853a358d9566dcfcb28fd21456f18ef09fe8c13c257cf351c8cfba8ae4d',
  manifest: '22ca128d9893386a0e538f7f9145bb0aeb2d47093a5463f92ba011d47df3639b',
  extras: 'd7b39093f0f4eed29122f78676a2ab8cad6f2c061bdbf47c1cb08dccad55ef63',
});
export const EXPECTED = Object.freeze({ concepts: 62, reviews: 59, assessments: 17, legacy_profiles: 111, media: 135, bytes: 104901305 });
export function invariant(ok, label) { if (!ok) throw new Error(`Validation failed: ${label}`); }
export function digest(data) { return createHash('sha256').update(data).digest('hex'); }
export function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function hashValue(value) { return digest(canonical(value)); }
export function flags(args, allowed) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    invariant(allowed[key] && !Object.hasOwn(out, key), 'unknown or repeated option');
    out[key] = allowed[key] === true ? true : args[++i];
    invariant(out[key] !== undefined && out[key] !== '', 'missing option value');
  }
  return out;
}
export function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value }; // ISO strings retain source microseconds and offsets.
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    invariant(Number.isFinite(value), 'non-finite number');
    if (Number.isInteger(value)) { invariant(Number.isSafeInteger(value), 'unsafe integer'); return { integerValue: String(value) }; }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  invariant(value && typeof value === 'object', 'unsupported value');
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
}
export function decode(v) {
  invariant(v && typeof v === 'object', 'invalid Firestore value');
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) { const n = Number(v.integerValue); invariant(Number.isSafeInteger(n), 'unsafe Firestore integer'); return n; }
  if ('doubleValue' in v) return v.doubleValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  throw new Error('Unsupported Firestore value type');
}
export function docName(project, path) { return `projects/${project}/databases/(default)/documents/${path}`; }
export function documentFields(row) { return Object.fromEntries(Object.entries(row).map(([key, val]) => [key, encode(val)])); }
export function decodeDocument(doc, name) {
  invariant(doc?.name === name && doc.fields && typeof doc.fields === 'object', 'Firestore document identity/fields');
  return Object.fromEntries(Object.entries(doc.fields).map(([key, value]) => [key, decode(value)]));
}
export async function shaFile(path) {
  const hash = createHash('sha256'); let bytes = 0;
  await pipeline(createReadStream(path), new Writable({ write(chunk, _enc, done) { bytes += chunk.length; hash.update(chunk); done(); } }));
  return { bytes, sha256: hash.digest('hex') };
}
function unique(rows, field, label) {
  const map = new Map();
  for (const row of rows) {
    invariant(row && typeof row === 'object' && typeof row[field] === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(row[field]), `${label} id`);
    invariant(!map.has(row[field]), `${label} duplicate id`); map.set(row[field], row);
  }
  return map;
}
function safeMedia(root, key) {
  invariant(/^(concept-banners|concept-pdfs)\/[0-9a-f-]+\/[a-zA-Z0-9_.-]+$/.test(key) && !key.includes('..'), 'unsafe media key');
  const base = realpathSync(root), file = resolve(base, ...key.split('/'));
  invariant(file.startsWith(base + sep) && !lstatSync(file).isSymbolicLink() && realpathSync(file) === file, 'media escapes backup root');
  return file;
}
export function validateSourceRelations(source) {
  const concepts = unique(source.concepts, 'id', 'concept'); const reviews = unique(source.reviews, 'id', 'review');
  const profiles = unique(source.profiles, 'id', 'profile'); const assessments = unique(source.assessments, 'concept_id', 'assessment');
  const byConcept = new Map([...concepts.keys()].map(id => [id, []]));
  for (const r of reviews.values()) {
    invariant(concepts.has(r.concept_id) && profiles.has(r.reviewer_id), 'review foreign key');
    invariant(r.notes === null || typeof r.notes === 'string', 'review notes type');
    invariant(r.supersedes_review_id === null || (reviews.has(r.supersedes_review_id) && reviews.get(r.supersedes_review_id).concept_id === r.concept_id && r.supersedes_review_id !== r.id), 'superseded review foreign key');
    byConcept.get(r.concept_id).push(r);
  }
  for (const c of concepts.values()) invariant(profiles.has(c.created_by), 'concept creator foreign key');
  for (const a of assessments.values()) invariant(concepts.has(a.concept_id) && profiles.has(a.updated_by), 'assessment foreign key');
  return { concepts, reviews, profiles, assessments, byConcept };
}
export async function buildPlan(paths = DEFAULTS) {
  for (const [name, expected] of Object.entries(TRUSTED_INPUT_SHA256)) invariant(digest(readFileSync(paths[name])) === expected, `trusted ${name} SHA-256`);
  const source = json(paths.source), inventory = json(paths.inventory), verification = json(paths.verification);
  const manifest = json(paths.manifest), extras = json(paths.extras);
  invariant(JSON.stringify(source.counts) === JSON.stringify({ concepts: 62, reviews: 59, profiles: 111, assessments: 17 }), 'source declared counts');
  invariant(source.audit_id_excluded?.length === 2 && !source.profiles.some(p => source.audit_id_excluded.includes(p.id)), 'audit profile exclusion');
  invariant(verification.objects_listed === EXPECTED.media && verification.objects_verified === EXPECTED.media && verification.total_bytes === EXPECTED.bytes && verification.old_count === 124 && verification.extra_count === 11 && Array.isArray(verification.missing_or_mismatch) && verification.missing_or_mismatch.length === 0, 'full verification summary');
  for (const [field, count] of [['concept_count',62],['review_count',59],['assessment_count',17],['profile_count',111]]) invariant(verification[field] === count, `full verification ${field}`);
  invariant(manifest.files_expected === 124 && manifest.files_verified === 124 && manifest.checks?.length === 124 && extras.length === 11 && manifest.missing_or_mismatch?.length === 0, 'backup receipts counts');
  invariant(source.concepts?.length === 62 && source.reviews?.length === 59 && source.assessments?.length === 17 && source.profiles?.length === 111 && inventory.files?.length === 135, 'actual inventory counts');
  const { concepts, reviews, profiles, assessments, byConcept } = validateSourceRelations(source);
  const docs = [];
  for (const c of concepts.values()) {
    const sorted = byConcept.get(c.id).sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    docs.push({ path: `concepts/${c.id}`, data: { ...c, reviews: sorted, concept_assessments: assessments.get(c.id) || null } });
  }
  for (const r of reviews.values()) docs.push({ path: `reviews/${r.id}`, data: r });
  for (const a of assessments.values()) docs.push({ path: `concept_assessments/${a.concept_id}`, data: a });
  for (const p of profiles.values()) docs.push({ path: `legacy_profiles/${p.id}`, data: p });
  invariant(docs.length === 249 && source.reviews.filter(r => r.notes !== null).length === 20, 'document/notes counts');
  const checks = new Map();
  for (const x of manifest.checks) {
    invariant(x.ok === true && x.source === x.relative && x.actual_bytes === x.expected_bytes && /^[0-9a-f]{64}$/.test(x.sha256) && !checks.has(x.relative), 'manifest receipt');
    checks.set(x.relative, { bytes: x.expected_bytes, sha256: x.sha256 });
  }
  for (const x of extras) {
    const key = `${x.bucket}/${x.path}`;
    invariant(!checks.has(key) && /^[0-9a-f]{64}$/.test(x.sha256), 'extra receipt');
    checks.set(key, { bytes: x.bytes, sha256: x.sha256 });
  }
  invariant(checks.size === 135, 'hash receipt coverage');
  // Legacy media paths are not uniformly prefixed with the concept ID. Bind
  // each currently referenced asset to its real concept for Storage rules.
  const conceptForMedia = new Map();
  for (const c of concepts.values()) for (const [field, bucket] of [['banner_path','concept-banners'],['pdf_path','concept-pdfs']]) {
    if (!c[field]) continue;
    const key = `${bucket}/${c[field]}`;
    invariant(!conceptForMedia.has(key) || conceptForMedia.get(key) === c.id, 'shared media has ambiguous concept ownership');
    conceptForMedia.set(key, c.id);
  }
  const media = []; let total = 0;
  for (const x of inventory.files) {
    const key = `${x.bucket}/${x.path}`, check = checks.get(key);
    invariant(check && x.bytes === check.bytes && !media.some(m => m.key === key), 'inventory receipt bijection');
    const file = safeMedia(paths.mediaRoot, key), actual = await shaFile(file);
    invariant(actual.bytes === check.bytes && actual.sha256 === check.sha256, 'backup media hash/size');
    media.push({ key, file, bytes: check.bytes, sha256: check.sha256, conceptId: conceptForMedia.get(key) ?? null }); total += check.bytes;
  }
  invariant(total === EXPECTED.bytes && media.length === checks.size, 'media totals');
  for (const c of concepts.values()) for (const [field, bucket] of [['banner_path','concept-banners'],['pdf_path','concept-pdfs']]) {
    if (c[field] !== null) invariant(media.some(m => m.key === `${bucket}/${c[field]}`), 'referenced concept media');
  }
  docs.sort((a,b) => a.path.localeCompare(b.path)); media.sort((a,b) => a.key.localeCompare(b.key));
  return { docs, media, summary: { counts: { concepts: 62, reviews: 59, concept_assessments: 17, legacy_profiles: 111, media: media.length, bytes: total, reviews_with_notes: 20 }, documents_digest: hashValue(docs), media_digest: hashValue(media.map(({key,bytes,sha256})=>({key,bytes,sha256}))), media_acl_digest: hashValue(media.map(({key,conceptId})=>({key,conceptId}))) } };
}

export function redactFailure(e) { return e instanceof Error && /^Validation failed:/.test(e.message) ? e.message : 'Operation failed; inspect credentials, network, or target state without logging sensitive response bodies.'; }
export function localPaths(options) { return Object.fromEntries(Object.entries(DEFAULTS).map(([k,v]) => [k, options[`--${k}`] || v])); }
export const PATH_FLAGS = Object.fromEntries(Object.keys(DEFAULTS).map(k => [`--${k}`, 'value']));
