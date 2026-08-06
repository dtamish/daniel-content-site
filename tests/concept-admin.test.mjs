import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertDeleteConfirmation,
  assertDecision,
  assertLocale,
  conceptIdentity,
  parseConceptManifest,
  planConceptSync,
  resolveActingEditor,
} from '../tools/concept-admin-core.mjs';

const item = (extra = {}) => ({
  title: 'קונספט לדוגמה',
  description_draft: 'תיאור קצר',
  priority: 7,
  banner: 'banners/example.png',
  pdf: 'pdf/example.pdf',
  ...extra,
});

test('manifest parsing rejects a concept without both private assets', () => {
  assert.throws(
    () => parseConceptManifest({ items: [{ title: 'חסר PDF', banner: 'banners/item.png' }] }),
    /PDF/i,
  );
});

test('manifest parsing creates an immutable import plan from a valid item', () => {
  const plan = parseConceptManifest({
    concept_count: 1,
    items: [{
      title: 'קונספט לדוגמה',
      description_draft: 'תיאור קצר',
      priority: 7,
      banner: 'banners/example.png',
      pdf: 'pdf/example.pdf',
    }],
  });

  assert.deepEqual(plan, [{
    title: 'קונספט לדוגמה',
    description: 'תיאור קצר',
    priority: 7,
    locale: 'he',
    category: 'series',
    sourceId: null,
    banner: 'banners/example.png',
    pdf: 'pdf/example.pdf',
  }]);
});

test('an import package carries its language from the manifest, the item, or the operator', () => {
  assert.equal(parseConceptManifest({ items: [item()] })[0].locale, 'he');
  assert.equal(parseConceptManifest({ locale: 'en', items: [item()] })[0].locale, 'en');
  assert.equal(parseConceptManifest({ items: [item({ locale: 'en' })] })[0].locale, 'en');
  // An explicit operator choice wins, so a package can be redirected deliberately.
  assert.equal(parseConceptManifest({ locale: 'he', items: [item()] }, { locale: 'en' })[0].locale, 'en');
});

test('an unknown language is refused rather than silently treated as Hebrew', () => {
  assert.throws(() => parseConceptManifest({ locale: 'fr', items: [item()] }), /locale/i);
  assert.throws(() => parseConceptManifest({ items: [item({ locale: 'ru' })] }), /locale/i);
  assert.throws(() => parseConceptManifest({ items: [item()] }, { locale: 'de' }), /locale/i);
  assert.throws(() => assertLocale(''), /locale/i);
});

test('a title identifies a concept only together with its language', () => {
  // The same idea exists once per language; that pair mirrors the database unique index.
  assert.notEqual(conceptIdentity('he', 'Values Arena'), conceptIdentity('en', 'Values Arena'));
  assert.equal(conceptIdentity('en', ' Values Arena '), conceptIdentity('en', 'Values Arena'));
});

test('a manifest that repeats one title inside a single language is rejected', () => {
  assert.throws(
    () => parseConceptManifest({ items: [item(), item()] }),
    /repeats this title/i,
  );
  assert.doesNotThrow(
    () => parseConceptManifest({ items: [item({ locale: 'he' }), item({ locale: 'en' })] }),
  );
});

test('the prepared Hebrew package parses as 22 Hebrew concepts', async () => {
  const { readFileSync } = await import('node:fs');
  const path = 'C:\\Users\\dtami\\Documents\\Sinai Concept Review Import v2\\manifest.json';
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return; // the private package is not present on every machine
  }
  const plan = parseConceptManifest(manifest);
  assert.equal(plan.length, 22);
  assert.ok(plan.every((concept) => concept.locale === 'he'));
  assert.ok(plan.every((concept) => concept.sourceId));
});

test('a sync pairs the package with existing records and never invents one', () => {
  const plan = parseConceptManifest({
    items: [item({ title: 'קיים' }), item({ title: 'חדש' })],
  });
  const existing = [
    { id: 'a', title: 'קיים', locale: 'he', banner_path: 'a/banner.png', pdf_path: 'a/concept.pdf' },
    { id: 'b', title: 'לא בחבילה', locale: 'he', banner_path: 'b/banner.png', pdf_path: 'b/concept.pdf' },
  ];
  const { matched, missing, untouched } = planConceptSync(plan, existing);

  assert.deepEqual(matched.map(({ row }) => row.id), ['a']);
  assert.deepEqual(missing, ['חדש']);
  assert.deepEqual(untouched, ['לא בחבילה']);
});

test('a sync will not match a record in another language', () => {
  const plan = parseConceptManifest({ locale: 'en', items: [item({ title: 'Values Arena' })] });
  const existing = [
    { id: 'a', title: 'Values Arena', locale: 'he', banner_path: 'a/banner.png', pdf_path: 'a/concept.pdf' },
  ];
  const { matched, missing } = planConceptSync(plan, existing);

  assert.equal(matched.length, 0);
  assert.deepEqual(missing, ['Values Arena']);
});

test('a sync refuses a record that has no asset path to overwrite', () => {
  const plan = parseConceptManifest({ items: [item({ title: 'ללא נכס' })] });
  assert.throws(
    () => planConceptSync(plan, [{ id: 'a', title: 'ללא נכס', locale: 'he', banner_path: null, pdf_path: null }]),
    /asset path/i,
  );
});

test('a concept carries a content type from a fixed vocabulary', async () => {
  const { assertCategory } = await import('../tools/concept-admin-core.mjs');
  assert.equal(assertCategory('podcast'), 'podcast');
  assert.equal(parseConceptManifest({ items: [item({ category_key: 'digital' })] })[0].category, 'digital');
  assert.equal(parseConceptManifest({ items: [item()] })[0].category, 'series');
  assert.throws(() => assertCategory('documentary'), /category/i);
  assert.throws(() => parseConceptManifest({ items: [item({ category_key: 'reels' })] }), /category/i);
});

test('acting editor selection refuses ambiguity instead of attributing changes to the wrong person', () => {
  assert.throws(
    () => resolveActingEditor([
      { id: 'editor-one', is_editor: true, approved: true },
      { id: 'editor-two', is_editor: true, approved: true },
    ]),
    /CONCEPT_ADMIN_CREATED_BY/i,
  );
  assert.equal(
    resolveActingEditor([{ id: 'editor-one', is_editor: true, approved: true }]),
    'editor-one',
  );
});

test('agent accepts only the four production decisions', () => {
  assert.equal(assertDecision('priority-approved'), 'priority-approved');
  assert.equal(assertDecision('schedule-approved'), 'schedule-approved');
  assert.equal(assertDecision('wait'), 'wait');
  assert.equal(assertDecision('canceled'), 'canceled');
  assert.throws(() => assertDecision('publish-now'), /decision/i);
});

test('deletion requires repeating the exact target id', () => {
  assert.throws(() => assertDeleteConfirmation('concept-123', 'other-concept'), /אימות/i);
  assert.doesNotThrow(() => assertDeleteConfirmation('concept-123', 'concept-123'));
});
