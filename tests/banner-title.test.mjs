import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ARTWORK_BANNER_FILE, BANNER_ARTWORK, assertBannerSource, bannerLayoutFromPath,
  constrainedBannerPathFor, coverBox, isArtworkBannerPath, versionedArtworkBannerPath,
} from '../src/lib/banner-artwork.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const room = read('src/styles/room.css');
const globals = read('src/styles/global.css');
const app = read('src/scripts/review-app.ts');
const admin = read('src/scripts/admin-app.ts');
const adminMarkup = read('src/components/AdminApp.astro');
const repository = read('src/lib/concept-repository.ts');
const migration = read('supabase/migrations/202609070003_banner_artwork_path.sql');
const cards = app.slice(app.indexOf('  function renderCards('), app.indexOf('  /**', app.indexOf('  function renderCards(')));
const studio = admin.slice(admin.indexOf('  // ------------------------------------------------------------ banner studio'));

test('a banner declares its own layout through its object name', () => {
  assert.equal(bannerLayoutFromPath('abc/banner-artwork.png'), 'artwork');
  assert.equal(bannerLayoutFromPath('abc/banner.png'), 'composed');
  assert.equal(bannerLayoutFromPath(null), 'composed');
  assert.equal(bannerLayoutFromPath(''), 'composed');
  // A name that merely contains the word is not the name.
  assert.equal(isArtworkBannerPath('abc/banner-artwork.png.bak'), false);
  assert.equal(isArtworkBannerPath('banner-artwork.png/other.png'), false);
});

test('every published banner is a new object, so no earlier version is written over', () => {
  const version = 'ea00b3b6-46b6-4988-ab38-784d99458004';
  assert.equal(versionedArtworkBannerPath(version), `${version}/${ARTWORK_BANNER_FILE}`);
  assert.notEqual(versionedArtworkBannerPath(version), 'd198dd88-fb7a-5f0a-9d05-867919145a31/banner.png');
  assert.equal(bannerLayoutFromPath(versionedArtworkBannerPath(version)), 'artwork');
  assert.throws(() => versionedArtworkBannerPath('abc'), /36-character id/);
  assert.throws(() => versionedArtworkBannerPath(null), /36-character id/);
});

test('the pre-migration fallback still satisfies the hosted banner_path constraint', () => {
  const path = constrainedBannerPathFor('ea00b3b6-46b6-4988-ab38-784d99458004');
  assert.match(path, /^[0-9a-f-]{36}\/banner\.png$/);
  assert.equal(bannerLayoutFromPath(path), 'composed', 'a fallback path cannot claim a live title');
  assert.throws(() => constrainedBannerPathFor('not-a-folder'), /36-character id/);
});

test('the migration widens the banner path check without changing its shape', () => {
  assert.match(migration, /banner\(-artwork\)\?\\\.png/);
  assert.match(migration, /drop constraint if exists concepts_banner_path_check/);
  for (const good of ['abcdef01-2345-6789-abcd-ef0123456789/banner.png',
                      'abcdef01-2345-6789-abcd-ef0123456789/banner-artwork.png']) {
    assert.match(good, /^[0-9a-f-]{36}\/banner(-artwork)?\.png$/);
  }
  for (const bad of ['abcdef01-2345-6789-abcd-ef0123456789/other.png',
                     'abcdef01-2345-6789-abcd-ef0123456789/banner-artwork.png.bak']) {
    assert.doesNotMatch(bad, /^[0-9a-f-]{36}\/banner(-artwork)?\.png$/);
  }
});

test('a source image is refused before anything is uploaded', () => {
  assert.throws(() => assertBannerSource(null), /Choose an image/);
  assert.throws(() => assertBannerSource({ size: 10, type: 'image/gif' }), /PNG, JPEG or WebP/);
  assert.throws(() => assertBannerSource({ size: BANNER_ARTWORK.maxSourceBytes + 1, type: 'image/png' }), /12MB/);
  const file = { size: 2048, type: 'image/jpeg' };
  assert.equal(assertBannerSource(file), file);
  assert.equal(BANNER_ARTWORK.outputType, 'image/png', 'the bucket only accepts PNG');
});

test('artwork fills the band by covering it, never by stretching it', () => {
  const wide = coverBox(2000, 500, 1400, 541);
  assert.equal(Math.round(wide.height), 541);
  assert.ok(wide.width >= 1400);
  assert.equal(Math.round(wide.width / wide.height * 100) / 100, 4);
  const tall = coverBox(500, 2000, 1400, 541);
  assert.equal(Math.round(tall.width), 1400);
  assert.equal(Math.round(tall.x), 0);
  assert.ok(tall.y < 0, 'a tall picture is centred, not squashed');
});

test('a card carries exactly one title, and it is a heading that opens the concept', () => {
  assert.match(cards, /create\('h3', 'card-title'\)/);
  assert.match(cards, /create\('button', 'card-open-title', concept\.title\)/);
  assert.match(cards, /heading\.append\(openTitle\)/);
  // Exactly one place appends the heading, and it is either the band or the body.
  assert.match(cards, /if \(titleOnBanner\) banner\.append\(heading\);\s*\n\s*else body\.append\(heading\);/);
  assert.equal(cards.match(/create\('h3', 'card-title'\)/g).length, 1);
  assert.doesNotMatch(cards, /create\('span', 'card-title'/);
});

test('a live title is painted only over a banner that has none', () => {
  // A recoverable storage path retains its source layout even if initial signing failed.
  assert.match(cards, /const bannerLayout = concept\.bannerUrl \|\| concept\.bannerPath \? concept\.bannerLayout \?\? 'composed' : 'none';/);
  assert.match(cards, /const titleOnBanner = bannerLayout === 'artwork' && catalogueView === 'grid';/);
  assert.match(cards, /banner\.dataset\.bannerLayout = bannerLayout;/);
  // The picture stays decorative either way, so a painted title is never announced twice.
  assert.match(cards, /image\.alt = '';/);
  assert.match(repository, /bannerLayout: bannerLayoutFromPath\(concept\.banner_path\)/);
});

test('the card opens from one control that a keyboard and a screen reader can reach', () => {
  assert.match(cards, /const card = create\('div', 'card-open'\);/);
  assert.match(cards, /closest\('button, a, summary, input, select, textarea, label'\)/);
  assert.match(cards, /openTitle\.addEventListener\('click', \(\) => openReader\(concept\)\)/);
  assert.match(room, /\.room \.card-open-title \{[^}]*text-align: start;/s);
  // A title is text first: a browser makes button contents unselectable by default.
  assert.match(room, /\.room \.card-open-title \{[^}]*user-select: text;/s);
  assert.match(room, /\.room \.card-open \{ cursor: pointer; \}/);
});

test('the painted title sits on solid brand navy at every viewport', () => {
  const band = room.match(/\.room \.card-banner\[data-banner-layout="artwork"\] > \.card-title \{[^}]*\}/s)[0];
  // Solid #061845 behind every line, fading out only above the first one.
  assert.match(band, /background: linear-gradient\(to top, #061845 0 calc\(100% - 3\.2rem\), rgba\(6, 24, 69, 0\) 100%\)/);
  assert.match(band, /padding: 3\.4rem/);
  assert.match(band, /margin-block-start: -3\.2rem/);
  assert.match(band, /color: #ffffff/);
  assert.match(band, /font-size: clamp\(/);
  assert.match(room, /\.room \.card-banner\[data-banner-layout="artwork"\] \{ display: block; background: #061845; \}/);
});

test('the studio preview and the room paint the same band', () => {
  const preview = globals.match(/\.banner-preview \.card-banner\[data-banner-layout="artwork"\] > \.card-title \{[^}]*\}/s)[0];
  for (const declaration of [
    'background: linear-gradient(to top, #061845 0 calc(100% - 3.2rem), rgba(6, 24, 69, 0) 100%)',
    'padding: 3.4rem clamp(0.9rem, 3.4vw, 1.6rem) clamp(0.8rem, 2.6vw, 1.15rem)',
    'font-size: clamp(1.1rem, 4.6vw, 1.5rem)',
    'line-height: 1.24',
  ]) {
    assert.ok(preview.includes(declaration), `the preview is missing: ${declaration}`);
    assert.ok(room.includes(declaration), `the room is missing: ${declaration}`);
  }
});

test('Comments and Reset use equal parallel tracks on desktop and mobile', () => {
  const actions = room.match(/\.room \.card-actions \{[^}]*\}/s)[0];
  const button = room.match(/\.room \.card-actions button \{[^}]*\}/s)[0];
  assert.match(actions, /display: grid/);
  assert.match(actions, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(button, /min-width: 0/);
  assert.match(button, /min-height: 44px/);
  assert.match(button, /width: 100%/);
  assert.match(button, /white-space: normal/);
  assert.match(room, /\.room \.card-actions button:only-child \{ grid-column: 1 \/ -1; \}/);
  assert.ok(room.indexOf('.room .card-actions button') > room.indexOf('.card-actions { grid-template-columns: 1fr;'),
    'the one-per-row mobile rule must be overridden, not left to win');
});

test('the banner studio is inside the approved-editor workspace and holds no secret', () => {
  const workspace = adminMarkup.slice(adminMarkup.indexOf('data-editor-workspace'), adminMarkup.indexOf('</main>'));
  assert.ok(workspace.includes('data-banner-studio'), 'the studio must sit behind the editor gate');
  assert.match(admin, /if \(authorized\) await Promise\.all\(\[loadConceptList\(\), loadBannerConcepts\(\)\]\)/);
  assert.doesNotMatch(admin, /service_role|SERVICE_ROLE|sb_secret/);
  assert.doesNotMatch(adminMarkup, /service_role|SERVICE_ROLE|sb_secret/);
});

test('a preview is never published, and a painted banner is never reused as a background', () => {
  assert.match(studio, /clearPending\(\);\s*\n\s*pendingSave = \{ kind: 'banner', conceptId: concept\.id, blob, url: URL\.createObjectURL\(blob\) \};/);
  assert.match(studio, /if \(!concept \|\| !pending\) \{/);
  assert.match(admin, /אי אפשר להרכיב באנר מעל באנר שהכותרת כבר צרובה בתוכו/);
  // The studio uploads in exactly one place, and only from the publish helper.
  assert.equal(studio.match(/storage\.from\('concept-banners'\)\s*\n?\s*\.upload\(/g).length, 1);
});

test('a title correction never re-encodes the picture', () => {
  const titleOnly = studio.slice(studio.indexOf('async function saveTitleOnly'),
    studio.indexOf("bannerConceptSelect.addEventListener('change'"));
  assert.match(titleOnly, /\.update\(\{ title \}\)/);
  // It reads the path back to report it, but never writes one, uploads, or recomposes.
  assert.doesNotMatch(titleOnly, /banner_path:|\.upload\(|compose/);
  assert.match(studio, /pendingSave = changed \? \{ kind: 'title' \} : null;/);
  // Asking to preview a banner that is already title-free says so instead of recomposing.
  assert.match(studio, /הבאנר כבר נקי מטקסט/);
});

test('a slow decode cannot land on the concept the editor moved to', () => {
  assert.match(studio, /let previewToken = 0;/);
  assert.match(studio, /previewToken \+= 1;/);
  assert.match(studio, /if \(token !== previewToken \|\| selectedBannerConcept\(\)\?\.id !== concept\.id\)/);
  assert.match(studio, /if \(pending\.kind === 'banner' && pending\.conceptId !== concept\.id\)/);
  // The concept cannot be switched while a save is in flight.
  assert.match(studio, /bannerConceptSelect\.disabled = true;/);
});

test('publishing a banner keeps every earlier version recoverable', () => {
  // Immutable: a new folder per save, and an upload that refuses to overwrite.
  assert.match(studio, /const version = crypto\.randomUUID\(\);/);
  assert.match(studio, /upsert: false/);
  assert.doesNotMatch(studio, /upsert: true/);
  // The pointer being replaced is recorded before it moves, and only that is offered back.
  assert.match(studio, /rememberReplacedBanner\(concept\.id, concept\.banner_path\)/);
  assert.match(studio, /record\[conceptId\] \?\?= path;/);
  assert.match(studio, /const original = replacedBanners\(\)\[concept\.id\];/);
  // Two editors cannot silently overwrite each other.
  assert.match(studio, /\.eq\('banner_path', concept\.banner_path\)/);
  assert.match(studio, /\.eq\('title', concept\.title\)/);
  // The only object it ever deletes is one it just uploaded and could not point at.
  assert.equal(studio.match(/\.remove\(\[path\]\)/g).length, 2);
});

test('a category is named once per card, by its group heading or by the card', () => {
  assert.match(app, /renderCards\(visible: Concept\[\], target: HTMLElement, labels: Record<string, string>, colour: string, showCategory = true\)/);
  // Grouped rows sit under a heading that already names the category.
  assert.match(app, /renderCards\(categoryItems, row, labels, colour, false\)/);
  // A flat sorted grid and the editorial queue have no category heading, so their cards keep it.
  assert.match(app, /renderCards\(sharedConcepts, row, labels, '#3d7f73'\);/);
  assert.match(app, /renderCards\(items, row, labels, '#737982'\);/);
  assert.match(cards, /if \(showCategory\) \{\s*\n\s*body\.append\(create\('span', 'card-category'/);
});

test('a group count is announced as a count, not as part of the heading', () => {
  assert.match(app, /badge\.setAttribute\('aria-label', strings\.documents\(total\)\)/);
  assert.match(app, /groupCount\(categoryItems\.length\)/);
  assert.match(app, /groupCount\(items\.length\)/);
  // The badge is built in one place, so no heading can grow a bare digit again.
  assert.equal(app.match(/create\('b', 'group-count', String\(/g).length, 1);
});
