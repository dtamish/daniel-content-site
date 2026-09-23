import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPlan, validateSourceRelations, DEFAULTS, encode, decode, hashValue, documentFields, docName, PROJECT, BUCKET } from '../tools/firebase-import-core.mjs';
import { Client, HttpError } from '../tools/firebase-import-api.mjs';
import { run as importRun } from '../tools/firebase-import.mjs';
import { run as verifyRun } from '../tools/firebase-verify.mjs';

let plan;
test('real private snapshot: every document, link, note and 135 SHA-256s validates without cloud', async () => {
  plan = await buildPlan();
  assert.deepEqual(plan.summary.counts, { concepts: 62, reviews: 59, concept_assessments: 17, legacy_profiles: 111, media: 135, bytes: 104901305, reviews_with_notes: 20 });
  assert.equal(plan.docs.length, 249);
  for (const d of plan.docs) assert.deepEqual(Object.fromEntries(Object.entries(documentFields(d.data)).map(([k,v])=>[k,decode(v)])), d.data);
  assert.equal(plan.docs.filter(d=>d.path.startsWith('concepts/')).flatMap(d=>d.data.reviews).length,59);
  const dry = await importRun([]);
  assert.equal(dry.remote_writes, 0); assert.equal(dry.documents_digest, plan.summary.documents_digest);
});

test('reject modified source/notes, orphaned reviews, modified counts and bad media receipts', async () => {
  const temp = mkdtempSync(resolve('tests', '.firebase-import-test-'));
  try {
    const source = JSON.parse(readFileSync(DEFAULTS.source));
    source.reviews[0].notes = 'altered';
    source.reviews[0].reviewer_id = '00000000-0000-0000-0000-000000000000';
    const p = resolve(temp,'source.json'); writeFileSync(p, JSON.stringify(source));
    await assert.rejects(buildPlan({ ...DEFAULTS, source:p }), /trusted source SHA-256/);
    source.reviews[0].reviewer_id = JSON.parse(readFileSync(DEFAULTS.source)).reviews[0].reviewer_id;
    source.counts.reviews = 58; writeFileSync(p, JSON.stringify(source));
    await assert.rejects(buildPlan({ ...DEFAULTS, source:p }), /trusted source SHA-256/);
    const inventory = JSON.parse(readFileSync(DEFAULTS.inventory)); inventory.files[0].bytes++;
    const q=resolve(temp,'inventory.json'); writeFileSync(q,JSON.stringify(inventory));
    await assert.rejects(buildPlan({ ...DEFAULTS, inventory:q }), /trusted inventory SHA-256/);
    const manifest = JSON.parse(readFileSync(DEFAULTS.manifest)); manifest.checks[0].sha256 = '0'.repeat(64);
    const r=resolve(temp,'manifest.json'); writeFileSync(r,JSON.stringify(manifest));
    await assert.rejects(buildPlan({ ...DEFAULTS, manifest:r }), /trusted manifest SHA-256/);
  } finally { rmSync(temp,{recursive:true,force:true}); }
});

test('FK, supersession and notes validation rejects structurally plausible altered rows', () => {
  const source=JSON.parse(readFileSync(DEFAULTS.source));
  const clone=()=>structuredClone(source);
  const orphan=clone(); orphan.reviews[0].reviewer_id='00000000-0000-0000-0000-000000000000';
  assert.throws(()=>validateSourceRelations(orphan),/review foreign key/);
  const badNote=clone(); badNote.reviews[0].notes=42;
  assert.throws(()=>validateSourceRelations(badNote),/review notes type/);
  const badCreator=clone(); badCreator.concepts[0].created_by='00000000-0000-0000-0000-000000000000';
  assert.throws(()=>validateSourceRelations(badCreator),/concept creator foreign key/);
  const badAssessment=clone(); badAssessment.assessments[0].concept_id='00000000-0000-0000-0000-000000000000';
  assert.throws(()=>validateSourceRelations(badAssessment),/assessment foreign key/);
  const badSupersession=clone(); badSupersession.reviews[0].supersedes_review_id=badSupersession.reviews[0].id;
  assert.throws(()=>validateSourceRelations(badSupersession),/superseded review foreign key/);
});

test('unknown flags and missing verifier requirements reject before OAuth or write', async () => {
  await assert.rejects(importRun(['--unknown']), /unknown or repeated/);
  await assert.rejects(verifyRun(['--project',PROJECT]), /requires exact/);
});

test('create-only transport reconciles uncertain success, never overwrites mismatches', async () => {
  const client = new Client('synthetic-token', async()=> { throw Error('No live network'); });
  let present=false, writes=0;
  assert.equal(await client.createOnly(null,async()=>present,async()=>{writes++;present=true;throw new HttpError(503)}),'reconciled');
  assert.equal(writes,1);
  assert.equal(await client.createOnly(null,async()=>present,async()=>{writes++;throw Error('forbidden')}),'reconciled');
  assert.equal(writes,1);
  await assert.rejects(client.createOnly(null,async()=>{throw Error('mismatch')},async()=>{writes++}), /mismatch/);
  assert.equal(writes,1);
});

test('Firestore commit uses exists:false and GCS upload uses generationMatch=0', async () => {
  const calls=[];
  const client=new Client('synthetic-token',async(url,opts)=>{ calls.push({url,opts}); return {ok:true,json:async()=>({}),body:null}; });
  await client.putDoc(PROJECT,{path:'reviews/abc',data:{notes:null,created_at:'2026-01-01T00:00:00.000001+00:00',n:4,yes:false}});
  const payload=JSON.parse(calls[0].opts.body);
  assert.deepEqual(payload.writes[0].currentDocument,{exists:false});
  assert.equal(payload.writes[0].update.name,docName(PROJECT,'reviews/abc'));
  assert.equal(payload.writes[0].update.fields.created_at.stringValue,'2026-01-01T00:00:00.000001+00:00');
  assert.equal(payload.writes[0].update.fields.n.integerValue,'4');
  await client.putObject(plan.media[0]);
  assert.match(calls[1].url,/ifGenerationMatch=0/);
  assert.equal(calls[1].opts.headers['Content-Length'],String(plan.media[0].bytes));
  calls[1].opts.body.destroy();
});

test('GCS downloader streams bytes and SHA-256; HTTP error hides response body', async () => {
  const media=plan.media[0];
  const bytes=readFileSync(media.file);
  let requests=0;
  const client=new Client('synthetic-token',async(_url,opts)=>{requests++; assert.equal(opts.method,'GET');return new Response(bytes,{status:200});});
  assert.deepEqual(await client.objectHash(media.key),{bytes:media.bytes,sha256:media.sha256});
  assert.equal(requests,1);
  const denied=new Client('synthetic-token',async()=>new Response('secret-response-body',{status:403}));
  await assert.rejects(denied.objectHash(media.key), e=>e instanceof HttpError && e.status===403 && !e.message.includes('secret'));
});

test('verification reads every target with no cloud writes and writes bounded report', async () => {
  const temp=mkdtempSync(resolve('tests','.firebase-import-test-')); const report=resolve(temp,'report.json');
  let gets=0,downloads=0,lists=0;
  const fake={
    listObjects:async()=>plan.media.map(m=>({name:m.key,size:String(m.bytes)})),
    listDocs:async(_project,collection)=>{lists++;return plan.docs.filter(d=>d.path.startsWith(`${collection}/`)).map(d=>({name:docName(PROJECT,d.path)}));},
    getDoc:async(_project,path)=>{gets++;const d=plan.docs.find(x=>x.path===path); return {name:docName(PROJECT,path),fields:documentFields(d.data)};},
    objectHash:async key=>{downloads++;const m=plan.media.find(x=>x.key===key);return {bytes:m.bytes,sha256:m.sha256};}
  };
  try {
    const result=await verifyRun(['--project',PROJECT,'--report',report],{client:fake});
    assert.equal(result.status,'verified'); assert.equal(gets,249);assert.equal(downloads,135);assert.equal(lists,4);
    assert.equal(JSON.parse(readFileSync(report)).media_digest,plan.summary.media_digest);
    const bad={...fake,objectHash:async()=>({bytes:0,sha256:'0'.repeat(64)})};
    await assert.rejects(verifyRun(['--project',PROJECT,'--report',report],{client:bad}),/remote media hash/);
    assert.equal(JSON.parse(readFileSync(report)).status,'failed');
  } finally {rmSync(temp,{recursive:true,force:true});}
});
