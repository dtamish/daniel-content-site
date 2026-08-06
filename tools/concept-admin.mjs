#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { assertDecision, assertDeleteConfirmation, assertLocale, conceptIdentity, parseConceptManifest, planConceptSync, resolveActingEditor } from './concept-admin-core.mjs';

const root = resolve(import.meta.dirname, '..');
const secretPath = process.env.CONCEPT_ADMIN_ENV ?? resolve(root, '.secrets', 'concept-admin.env');

function usage() {
  throw new Error(`Usage:
  node tools/concept-admin.mjs list
  node tools/concept-admin.mjs find <text>
  node tools/concept-admin.mjs import <folder> [--locale he|en] [--publish]
  node tools/concept-admin.mjs sync <folder> [--locale he|en] [--apply]
  node tools/concept-admin.mjs set <concept-id> [--status draft|published] [--section queue|library] [--priority 0..9999]
  node tools/concept-admin.mjs review <concept-id> --decision priority-approved|schedule-approved|wait|canceled [--notes <text>]
  node tools/concept-admin.mjs fetch <concept-id> --asset banner|pdf --out <file>
  node tools/concept-admin.mjs delete <concept-id> --confirm <concept-id>`);
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    return match && !line.trimStart().startsWith('#') ? [[match[1], match[2]]] : [];
  }));
}

async function adminClient() {
  let config;
  try {
    config = parseEnv(await readFile(secretPath, 'utf8'));
  } catch {
    throw new Error(`Missing local agent credentials: ${secretPath}. Create it from .secrets/concept-admin.env.example.`);
  }
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in the local secret file.');
  }
  return { client: createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }), config };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function conceptById(client, id) {
  const { data, error } = await client.from('concepts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Concept not found: ${id}`);
  return data;
}

async function actingEditorId(client, configuredId) {
  const { data, error } = await client.from('profiles').select('id,is_editor,approved').eq('is_editor', true).eq('approved', true);
  if (error) throw error;
  return resolveActingEditor(data, configuredId);
}

async function requireFile(path) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Not a file: ${path}`);
}

async function importBundle(client, config, folder, publish, localeOverride) {
  const manifestPath = resolve(folder, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const plan = parseConceptManifest(manifest, { locale: localeOverride });
  const creator = await actingEditorId(client, config.CONCEPT_ADMIN_CREATED_BY);
  const { data: existing, error: existingError } = await client.from('concepts').select('id,title,locale');
  if (existingError) throw existingError;
  // A title may exist once per language, so identity is the pair, never the title alone.
  const taken = new Set((existing ?? []).map((item) => conceptIdentity(item.locale ?? 'he', item.title)));
  const report = { locale: plan[0]?.locale ?? null, imported: [], skipped: [], failed: [] };

  for (const item of plan) {
    if (taken.has(conceptIdentity(item.locale, item.title))) {
      report.skipped.push({ title: item.title, locale: item.locale });
      continue;
    }
    const bannerFile = resolve(folder, item.banner);
    const pdfFile = resolve(folder, item.pdf);
    await Promise.all([requireFile(bannerFile), requireFile(pdfFile)]);
    const id = randomUUID();
    const bannerPath = `${id}/banner.png`;
    const pdfPath = `${id}/concept.pdf`;
    try {
      const [banner, pdf] = await Promise.all([
        client.storage.from('concept-banners').upload(bannerPath, await readFile(bannerFile), { contentType: 'image/png', upsert: false }),
        client.storage.from('concept-pdfs').upload(pdfPath, await readFile(pdfFile), { contentType: 'application/pdf', upsert: false }),
      ]);
      if (banner.error) throw banner.error;
      if (pdf.error) throw pdf.error;
      const { error } = await client.from('concepts').insert({
        id,
        title: item.title,
        description: item.description || item.title,
        priority: item.priority,
        locale: item.locale,
        section: 'queue',
        publication_status: publish ? 'published' : 'draft',
        banner_path: bannerPath,
        pdf_path: pdfPath,
        created_by: creator,
      });
      if (error) throw error;
      report.imported.push({ id, title: item.title, locale: item.locale, publication_status: publish ? 'published' : 'draft' });
    } catch (error) {
      await Promise.all([
        client.storage.from('concept-banners').remove([bannerPath]),
        client.storage.from('concept-pdfs').remove([pdfPath]),
      ]);
      report.failed.push({ title: item.title, locale: item.locale, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

/**
 * Replaces the assets and copy of concepts that already exist, in place.
 * Storage objects are overwritten at their existing paths, so no record id,
 * path or review linkage changes. Defaults to a dry run.
 */
async function syncBundle(client, folder, localeOverride, apply) {
  const manifest = JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8'));
  const plan = parseConceptManifest(manifest, { locale: localeOverride });
  const { data: existing, error } = await client
    .from('concepts')
    .select('id,title,locale,banner_path,pdf_path');
  if (error) throw error;

  const { matched, missing, untouched } = planConceptSync(plan, existing ?? []);
  const report = {
    mode: apply ? 'applied' : 'dry-run',
    locale: plan[0]?.locale ?? null,
    willRefresh: matched.length,
    missingFromCatalogue: missing,
    untouchedInCatalogue: untouched,
    refreshed: [],
    failed: [],
  };
  if (!apply) return report;

  for (const { item, row } of matched) {
    const bannerFile = resolve(folder, item.banner);
    const pdfFile = resolve(folder, item.pdf);
    await Promise.all([requireFile(bannerFile), requireFile(pdfFile)]);
    try {
      const [banner, pdf] = await Promise.all([
        client.storage.from('concept-banners').upload(row.banner_path, await readFile(bannerFile), { contentType: 'image/png', upsert: true }),
        client.storage.from('concept-pdfs').upload(row.pdf_path, await readFile(pdfFile), { contentType: 'application/pdf', upsert: true }),
      ]);
      if (banner.error) throw banner.error;
      if (pdf.error) throw pdf.error;
      const { error: updateError } = await client.from('concepts').update({
        description: item.description || item.title,
        priority: item.priority,
      }).eq('id', row.id);
      if (updateError) throw updateError;
      report.refreshed.push({ id: row.id, title: item.title, locale: item.locale });
    } catch (cause) {
      report.failed.push({ title: item.title, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return report;
}

const [command, target, ...args] = process.argv.slice(2);
if (!command) usage();
const { client, config } = await adminClient();

if (command === 'list') {
  const { data, error } = await client.from('concepts').select('id,title,locale,section,publication_status,priority,banner_path,pdf_path,updated_at').order('priority');
  if (error) throw error;
  output(data);
} else if (command === 'find') {
  if (!target) usage();
  const query = target.trim().toLocaleLowerCase('he');
  const { data, error } = await client.from('concepts').select('id,title,locale,section,publication_status,priority,banner_path,pdf_path').order('priority');
  if (error) throw error;
  output((data ?? []).filter((item) => item.title.toLocaleLowerCase('he').includes(query)));
} else if (command === 'import') {
  if (!target) usage();
  const localeOverride = option(args, '--locale');
  if (localeOverride !== undefined) assertLocale(localeOverride, 'Import locale');
  output(await importBundle(client, config, target, args.includes('--publish'), localeOverride));
} else if (command === 'sync') {
  if (!target) usage();
  const syncLocale = option(args, '--locale');
  if (syncLocale !== undefined) assertLocale(syncLocale, 'Sync locale');
  output(await syncBundle(client, target, syncLocale, args.includes('--apply')));
} else if (command === 'set') {
  if (!target) usage();
  const patch = {};
  const status = option(args, '--status');
  const section = option(args, '--section');
  const priority = option(args, '--priority');
  if (status) {
    if (!['draft', 'published'].includes(status)) throw new Error('Status must be draft or published.');
    patch.publication_status = status;
  }
  if (section) {
    if (!['queue', 'library'].includes(section)) throw new Error('Section must be queue or library.');
    patch.section = section;
  }
  if (priority !== undefined) {
    const value = Number(priority);
    if (!Number.isInteger(value) || value < 0 || value > 9999) throw new Error('Priority must be an integer from 0 to 9999.');
    patch.priority = value;
  }
  if (!Object.keys(patch).length) usage();
  const { data, error } = await client.from('concepts').update(patch).eq('id', target).select('id,title,section,publication_status,priority').single();
  if (error) throw error;
  output(data);
} else if (command === 'review') {
  if (!target) usage();
  const decision = assertDecision(option(args, '--decision'));
  const reviewerId = await actingEditorId(client, config.CONCEPT_ADMIN_CREATED_BY);
  await conceptById(client, target);
  const notes = option(args, '--notes')?.trim() || null;
  const { data, error } = await client
    .from('reviews')
    .insert({ concept_id: target, reviewer_id: reviewerId, decision, notes })
    .select('id,concept_id,reviewer_id,decision,notes,created_at')
    .single();
  if (error) throw error;
  output(data);
} else if (command === 'fetch') {
  if (!target) usage();
  const asset = option(args, '--asset');
  const outputPath = option(args, '--out');
  if (!['banner', 'pdf'].includes(asset) || !outputPath) usage();
  const concept = await conceptById(client, target);
  const bucket = asset === 'banner' ? 'concept-banners' : 'concept-pdfs';
  const path = asset === 'banner' ? concept.banner_path : concept.pdf_path;
  if (!path) throw new Error(`Concept has no ${asset}.`);
  const { data, error } = await client.storage.from(bucket).download(path);
  if (error) throw error;
  const destination = resolve(outputPath);
  if (!isAbsolute(destination)) throw new Error('Output path must be absolute.');
  await writeFile(destination, Buffer.from(await data.arrayBuffer()), { flag: 'wx' });
  output({ id: target, asset, saved_to: destination });
} else if (command === 'delete') {
  if (!target) usage();
  assertDeleteConfirmation(target, option(args, '--confirm'));
  const concept = await conceptById(client, target);
  const { error } = await client.from('concepts').delete().eq('id', target);
  if (error) throw error;
  await Promise.all([
    concept.banner_path ? client.storage.from('concept-banners').remove([concept.banner_path]) : undefined,
    concept.pdf_path ? client.storage.from('concept-pdfs').remove([concept.pdf_path]) : undefined,
  ].filter(Boolean));
  output({ deleted: target });
} else {
  usage();
}
