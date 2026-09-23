#!/usr/bin/env node
// Read-only attestation: exhaustive Firestore GETs and complete GCS SHA-256 downloads.
import { buildPlan, flags, PATH_FLAGS, localPaths, PROJECT, BUCKET, invariant, hashValue, docName, decodeDocument, redactFailure } from './firebase-import-core.mjs';
import { Client, firebaseToken, durableJson, reportDigest } from './firebase-import-api.mjs';

const LIB = 'C:/Clawy/Workspace/amram360/data/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib';
export async function run(args, injected = {}) {
  const opts = flags(args, { '--project': 'value', '--report': 'value', '--firebase-tools-lib': 'value', ...PATH_FLAGS });
  invariant(opts['--project'] === PROJECT && !!opts['--report'], 'verification requires exact --project and --report');
  const report = { schema: 1, project: PROJECT, bucket: BUCKET, status: 'failed', at: new Date().toISOString(), checked: { documents: 0, media: 0, bytes: 0 } };
  try {
    const plan = await buildPlan(localPaths(opts)); report.plan_digest = reportDigest(plan);
    const client = injected.client || new Client(injected.token || await firebaseToken(opts['--firebase-tools-lib'] || LIB));
    const objectList = await client.listObjects();
    const expectedObjects = new Map(plan.media.map(m => [m.key, m]));
    invariant(objectList.length === plan.media.length, 'remote object count');
    const seenObjects = new Set();
    for (const obj of objectList) {
      const media = expectedObjects.get(obj.name);
      invariant(media && !seenObjects.has(obj.name) && Number(obj.size) === media.bytes, 'remote object inventory/size');
      seenObjects.add(obj.name);
    }
    const byCollection = Map.groupBy(plan.docs, d => d.path.split('/')[0]);
    for (const [collection, expected] of byCollection) {
      const listed = await client.listDocs(PROJECT, collection);
      invariant(listed.length === expected.length, 'remote collection count');
      const names = new Set(expected.map(d => docName(PROJECT, d.path)));
      invariant(listed.every(d => names.has(d.name)) && new Set(listed.map(d => d.name)).size === expected.length, 'remote collection identities');
    }
    const remoteDocs = [];
    for (const doc of plan.docs) {
      const actual = await client.getDoc(PROJECT, doc.path);
      invariant(actual !== null, 'missing remote document');
      const value = decodeDocument(actual, docName(PROJECT, doc.path));
      invariant(hashValue(value) === hashValue(doc.data), 'remote document content');
      remoteDocs.push({ path: doc.path, data: value }); report.checked.documents++;
    }
    const remoteMedia = [];
    for (const media of plan.media) {
      const actual = await client.objectHash(media.key);
      invariant(actual.bytes === media.bytes && actual.sha256 === media.sha256, 'remote media hash');
      remoteMedia.push({ key: media.key, bytes: actual.bytes, sha256: actual.sha256 });
      report.checked.media++; report.checked.bytes += actual.bytes;
    }
    invariant(report.checked.documents === 249 && report.checked.media === 135 && report.checked.bytes === 104901305, 'remote aggregate totals');
    report.counts = plan.summary.counts;
    report.documents_digest = hashValue(remoteDocs);
    report.media_digest = hashValue(remoteMedia);
    invariant(report.documents_digest === plan.summary.documents_digest && report.media_digest === plan.summary.media_digest, 'remote aggregate digests');
    report.status = 'verified';
    await durableJson(opts['--report'], report);
    return report;
  } catch (e) {
    report.failure = redactFailure(e);
    await durableJson(opts['--report'], report);
    throw e;
  }
}
if (process.argv[1] && /firebase-verify\.mjs$/i.test(process.argv[1])) {
  run(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(e => { console.error(redactFailure(e)); process.exitCode = 1; });
}
