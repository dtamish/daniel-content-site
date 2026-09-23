#!/usr/bin/env node
// One-shot, create-only importer. Nothing remote happens without --apply and exact --project.
import { existsSync } from 'node:fs';
import { buildPlan, flags, PATH_FLAGS, localPaths, PROJECT, redactFailure, invariant, json, hashValue } from './firebase-import-core.mjs';
import { Client, firebaseToken, durableJson, reportDigest } from './firebase-import-api.mjs';

const LIB = 'C:/Clawy/Workspace/amram360/data/npm-cache/_npx/ba4f1959e38407b5/node_modules/firebase-tools/lib';
export async function run(args, injected = {}) {
  const opts = flags(args, { '--apply': true, '--project': 'value', '--receipts': 'value', '--firebase-tools-lib': 'value', ...PATH_FLAGS });
  invariant(!opts['--apply'] || (opts['--project'] === PROJECT && opts['--receipts']), 'apply requires exact --project and --receipts');
  invariant(!opts['--project'] || opts['--project'] === PROJECT, 'project not allowlisted');
  const plan = await buildPlan(localPaths(opts));
  const planHash = reportDigest(plan);
  if (!opts['--apply']) return { mode: 'dry-run', project: PROJECT, ...plan.summary, plan_digest: planHash, remote_writes: 0 };
  const receiptPath = opts['--receipts'];
  const old = existsSync(receiptPath) ? json(receiptPath) : null;
  invariant(!old || (old.schema === 1 && old.project === PROJECT && old.plan_digest === planHash && old.items && typeof old.items === 'object'), 'receipt plan mismatch');
  const receipts = old || { schema: 1, project: PROJECT, plan_digest: planHash, items: {} };
  const token = injected.token || await firebaseToken(opts['--firebase-tools-lib'] || LIB);
  const client = injected.client || new Client(token);
  let created = 0, reconciled = 0;
  const record = async (key, outcome) => {
    receipts.items[key] = { outcome, at: new Date().toISOString() };
    await durableJson(receiptPath, receipts); // fsync per item before proceeding
    if (outcome === 'created') created++; else reconciled++;
  };
  // Media first, because Firestore documents refer to it. Even receipt-bearing items are re-read.
  for (const media of plan.media) {
    const outcome = await client.createOnly(media, () => client.assertObject(media), () => client.putObject(media));
    await record(`object:${media.key}`, outcome);
  }
  for (const doc of plan.docs) {
    const outcome = await client.createOnly(doc, () => client.assertDoc(PROJECT, doc), () => client.putDoc(PROJECT, doc));
    await record(`document:${doc.path}`, outcome);
  }
  invariant(Object.keys(receipts.items).length === plan.media.length + plan.docs.length, 'receipt item count');
  return { mode: 'apply', project: PROJECT, ...plan.summary, plan_digest: planHash, created, reconciled, receipt_items: Object.keys(receipts.items).length };
}
if (process.argv[1] && /firebase-import\.mjs$/i.test(process.argv[1])) {
  run(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(e => { console.error(redactFailure(e)); process.exitCode = 1; });
}
