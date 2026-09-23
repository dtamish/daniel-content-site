// REST-only transport. All HTTP errors are deliberately body-redacted.
import { createRequire } from 'node:module';
import { createReadStream } from 'node:fs';
import { writeFile, rename, open, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { BUCKET, PROJECT, invariant, decodeDocument, docName, documentFields, hashValue } from './firebase-import-core.mjs';

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
export class HttpError extends Error { constructor(status) { super(`Remote HTTP status ${status}`); this.status = status; } }
export function storageUrl(key, suffix = '') { return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(key)}${suffix}`; }
export function firestoreUrl(project, path) { return `https://firestore.googleapis.com/v1/${docName(project, path)}`; }
const pause = ms => new Promise(r => setTimeout(r, ms));

export async function firebaseToken(libPath) {
  try {
    const require = createRequire(import.meta.url);
    const auth = require(resolve(libPath, 'auth.js'));
    const account = auth.getGlobalDefaultAccount();
    invariant(account?.tokens?.refresh_token, 'Firebase CLI login required');
    const options = {}; auth.setActiveAccount(options, account);
    const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
    invariant(typeof token?.access_token === 'string' && token.access_token.length > 20, 'Firebase CLI OAuth token unavailable');
    return token.access_token;
  } catch { throw new Error('Firebase CLI OAuth unavailable; run firebase login in the operator session.'); }
}

export class Client {
  constructor(token, fetcher = fetch) { this.token = token; this.fetcher = fetcher; }
  async request(url, { method = 'GET', body, headers = {}, stream = false, timeout = 120000 } = {}) {
    const opts = { method, headers: { ...headers, Authorization: ['Bearer', this.token].join(' ') }, signal: AbortSignal.timeout(timeout) };
    if (body !== undefined) { opts.body = body; if (body?.pipe) opts.duplex = 'half'; }
    const res = await this.fetcher(url, opts);
    if (!res.ok) { await res.body?.cancel?.(); throw new HttpError(res.status); }
    if (stream) return res;
    return res.json();
  }
  async read(url, opts) {
    for (let i = 0; ; i++) {
      try { return await this.request(url, opts); }
      catch (e) { if (i >= 3 || !(TRANSIENT.has(e.status) || e.name === 'TimeoutError' || e.name === 'TypeError')) throw e; await pause(250 * (2 ** i)); }
    }
  }
  async getDoc(project, path) {
    try { return await this.read(firestoreUrl(project, path)); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async getObject(key) {
    try { return await this.read(storageUrl(key)); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async objectHash(key) {
    const res = await this.read(storageUrl(key, '?alt=media'), { stream: true });
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of res.body) { hash.update(chunk); bytes += chunk.length; }
    return { bytes, sha256: hash.digest('hex') };
  }
  async assertObject(media) {
    const obj = await this.getObject(media.key);
    if (!obj) return false;
    invariant(obj.name === media.key && Number(obj.size) === media.bytes, 'remote object identity/size');
    const actual = await this.objectHash(media.key);
    invariant(actual.bytes === media.bytes && actual.sha256 === media.sha256, 'remote object hash');
    return true;
  }
  async assertDoc(project, doc) {
    const got = await this.getDoc(project, doc.path);
    if (!got) return false;
    invariant(hashValue(decodeDocument(got, docName(project, doc.path))) === hashValue(doc.data), 'remote document content');
    return true;
  }
  async putObject(media) {
    // Generation 0 is atomic create-only, including racing operators.
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(BUCKET)}/o?uploadType=media&name=${encodeURIComponent(media.key)}&ifGenerationMatch=0`;
    return this.request(url, { method: 'POST', body: createReadStream(media.file), headers: { 'Content-Type': media.key.startsWith('concept-pdfs/') ? 'application/pdf' : 'image/png', 'Content-Length': String(media.bytes) }, timeout: 180000 });
  }
  async putDoc(project, doc) {
    const name = docName(project, doc.path);
    // Commit precondition exists:false is atomic; never use patch/update without it.
    return this.request(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [{ update: { name, fields: documentFields(doc.data) }, currentDocument: { exists: false } }] }),
    });
  }
  async createOnly(item, exists, create) {
    // Every retry first reconciles an uncertain outcome. A mismatch always halts.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await exists()) return 'reconciled';
      try { await create(); invariant(await exists(), 'post-create readback'); return 'created'; }
      catch (e) {
        // Even an unexpected transport exception might follow a committed write.
        // Reconcile before considering retry or propagating the failure.
        if (await exists()) return 'reconciled';
        if (!(e.status === 409 || e.status === 412 || TRANSIENT.has(e.status) || e.name === 'TimeoutError' || e.name === 'TypeError')) throw e;
        if (attempt === 3) throw e;
        await pause(250 * (2 ** attempt));
      }
    }
    throw new Error('Create retry exhausted');
  }
  async listObjects() {
    const objects = []; let pageToken;
    do {
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}/o?maxResults=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const page = await this.read(url); objects.push(...(page.items || [])); pageToken = page.nextPageToken;
    } while (pageToken);
    return objects;
  }
  async listDocs(project, collection) {
    const docs = []; let pageToken;
    do {
      const url = `${firestoreUrl(project, collection)}?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const page = await this.read(url); docs.push(...(page.documents || [])); pageToken = page.nextPageToken;
    } while (pageToken);
    return docs;
  }
}

export async function durableJson(path, data) {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    const fd = await open(temp, 'wx', 0o600);
    try { await fd.writeFile(JSON.stringify(data) + '\n'); await fd.sync(); } finally { await fd.close(); }
    await rename(temp, path);
    // Directory sync is not supported on all Windows filesystems.
    try { const dir = await open(dirname(resolve(path)), 'r'); try { await dir.sync(); } finally { await dir.close(); } } catch {}
  } catch (e) { throw e; }
}
export function reportDigest(plan) { return hashValue({ project: PROJECT, ...plan.summary }); }
