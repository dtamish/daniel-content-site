#!/usr/bin/env node
// Read-only attestation: exhaustive Firestore GETs and complete GCS SHA-256 downloads.
import { buildPlan, flags, PATH_FLAGS, localPaths, PROJECT, BUCKET, invariant, hashValue, docName, decodeDocument, redactFailure } from './firebase-import-core.mjs';
import { Client, firebaseToken, durableJson, reportDigest } from './firebase-import-api.mjs';
import { readFile } from 'node:fs/promises';

const LIB = 'C:/Clawy/Workspace/amram360/data/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib';
export function approvedProfileDelta(plan, delta, receipt) {
  invariant(delta?.rows?.length === 1 && delta?.fields?.length === 1, 'approved profile delta cardinality');
  const row = delta.rows[0], entry = delta.fields[0];
  invariant(entry.id === row?.id && JSON.stringify(entry.fields) === JSON.stringify(['updated_at']), 'approved profile delta field');
  const path = `legacy_profiles/${row.id}`;
  const original = plan.docs.find(d => d.path === path);
  invariant(original && Object.keys(row).sort().join(',') === Object.keys(original.data).sort().join(',') &&
    Object.keys(row).filter(k => hashValue(row[k]) !== hashValue(original.data[k])).join(',') === 'updated_at', 'approved profile delta source correspondence');
  invariant(receipt?.status === 'verified' && receipt?.project === PROJECT && receipt?.path === path &&
    receipt.sourceCheckedAt === delta.at && receipt.expectedHash === hashValue(row), 'approved profile delta receipt');
  return { docs: plan.docs.map(d => d.path === path ? { path, data: row } : d), deltaDigest: hashValue({ delta, receipt }) };
}
export async function run(args, injected = {}) {
  const opts = flags(args, { '--project': 'value', '--report': 'value', '--firebase-tools-lib': 'value', '--profile-delta': 'value', '--delta-receipt': 'value', ...PATH_FLAGS });
  invariant(opts['--project'] === PROJECT && !!opts['--report'], 'verification requires exact --project and --report');
  invariant(!!opts['--profile-delta'] === !!opts['--delta-receipt'], 'delta and its verified receipt must be paired');
  const report = { schema: 1, project: PROJECT, bucket: BUCKET, status: 'failed', at: new Date().toISOString(), checked: { documents: 0, media: 0, bytes: 0 } };
  try {
    const plan = await buildPlan(localPaths(opts)); report.plan_digest = reportDigest(plan);
    let expectedDocs = plan.docs;
    if (opts['--profile-delta']) {
      const delta = JSON.parse(await readFile(opts['--profile-delta'],'utf8'));
      const receipt = JSON.parse(await readFile(opts['--delta-receipt'],'utf8'));
      const approved = approvedProfileDelta(plan, delta, receipt);
      expectedDocs = approved.docs;
      report.approved_delta_digest = approved.deltaDigest;
    }
    const client = injected.client || new Client(injected.token || await firebaseToken(opts['--firebase-tools-lib'] || LIB));
    const objectList = await client.listObjects();
    const expectedObjects = new Map(plan.media.map(m => [m.key, m]));
    invariant(objectList.length === plan.media.length, 'remote object count');
    const seenObjects = new Set();
    for (const obj of objectList) {
      const media = expectedObjects.get(obj.name);
      invariant(media && !seenObjects.has(obj.name) && Number(obj.size) === media.bytes, 'remote object inventory/size');
      if (media.conceptId) invariant(obj.metadata?.conceptId === media.conceptId, 'remote object concept permission metadata');
      seenObjects.add(obj.name);
    }
    const byCollection = Map.groupBy(expectedDocs, d => d.path.split('/')[0]);
    for (const [collection, expected] of byCollection) {
      const listed = await client.listDocs(PROJECT, collection);
      invariant(listed.length === expected.length, 'remote collection count');
      const names = new Set(expected.map(d => docName(PROJECT, d.path)));
      invariant(listed.every(d => names.has(d.name)) && new Set(listed.map(d => d.name)).size === expected.length, 'remote collection identities');
    }
    const remoteDocs = [];
    for (const doc of expectedDocs) {
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
    invariant(report.documents_digest === hashValue(expectedDocs) && report.media_digest === plan.summary.media_digest, 'remote aggregate digests');
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
