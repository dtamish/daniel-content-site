import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../src/components/ReviewApp.astro', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/styles/room.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const global = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const diagram = readFileSync(new URL('../src/styles/production-diagram.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/scripts/review-app.ts', import.meta.url), 'utf8');

const bar = markup.slice(markup.indexOf('<div class="reader-bar">'), markup.indexOf('<div class="reader-document"'));
const head = bar.slice(bar.indexOf('reader-bar-head'), bar.indexOf('reader-bar-controls'));
const controls = bar.slice(bar.indexOf('reader-bar-controls'));

test('the reader bar is grouped into two economical lines, not one control per row', () => {
  assert.match(bar, /class="reader-bar-line reader-bar-head"/);
  assert.match(bar, /class="reader-bar-line reader-bar-controls"/);
  // Head line: close, title, zoom. Controls line: comments action, badge, counter.
  for (const hook of ['data-close-reader', 'data-reader-title', 'data-zoom-out', 'data-zoom-in']) {
    assert.ok(head.includes(hook), `${hook} belongs on the head line`);
  }
  for (const hook of ['data-open-comments', 'data-editorial-reader-badge', 'data-page-count']) {
    assert.ok(controls.includes(hook), `${hook} belongs on the controls line`);
  }
  // Both lines share one row on a wide screen and split into exactly two on a narrow one.
  assert.match(room, /\.reader-bar-head \{ flex: 1 1 12rem; \}/);
  assert.match(room, /\.reader-bar-controls \{ flex: 0 1 auto;/);
  assert.match(room, /\.reader-bar-head, \.reader-bar-controls \{ flex: 1 1 100%; \}/);
});

test('legacy reader-dialog chrome cannot outrank the room reader bar', () => {
  // These rules sit outside every @layer, so unscoped they beat room.css and forced a
  // 68px/62px bar on the concept room's own reader.
  const unscoped = global.match(/(?<!\.reader-dialog )\.reader-bar\s*\{/g) ?? [];
  assert.deepEqual(unscoped, [], 'every .reader-bar rule in global.css is scoped to .reader-dialog');
  assert.match(global, /\.reader-dialog \.reader-bar \{ min-height: 68px;/);
  assert.match(global, /\.reader-dialog \.reader-bar \{ min-height:62px;/);
});

test('the title truncates with an ellipsis and stays available in full', () => {
  assert.match(room, /\.reader-bar h2 \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/s);
  assert.match(room, /\.reader-bar h2 \{[^}]*min-width: 0;/s);
  // The element keeps the whole title as its text, so it still names the dialog, and
  // repeats it as a tooltip for a pointer.
  assert.match(app, /el\.readerTitle\.textContent = concept\.title;/);
  assert.match(app, /el\.readerTitle\.title = concept\.title;/);
  assert.match(app, /el\.readerTitle\.title = '';/);
  assert.match(markup, /aria-labelledby="reader-title"/);
});

test('every reader control keeps a 44px hit target', () => {
  assert.match(room, /\.room \.icon, \.room \.reader-zoom \.icon \{ width: 44px; height: 44px;/);
  assert.match(room, /\.reader-comments-action, \.secondary, \.danger, \.danger-quiet, \.decide-stop \{ min-height: 44px; \}/);
  assert.match(room, /\.reader-comments-action \{[^}]*min-height: 44px;/s);
  // The old 34px zoom buttons are gone.
  assert.doesNotMatch(room, /\.reader-zoom \.icon \{ width: 34px/);
});

test('Comments and Production Status share one neutral gray control style', () => {
  const action = room.match(/\.reader-comments-action \{[^}]*\}/s)[0];
  assert.match(action, /border: 1px solid var\(--line\);/);
  assert.match(action, /background: var\(--surface\);/);
  assert.match(action, /color: var\(--ink\);/);
  assert.doesNotMatch(action, /accent/);
  assert.doesNotMatch(action, /border-radius: 999px/);
  assert.doesNotMatch(action, /width: 100%/);
  // Production Status is created from the comments button's own class, so the two can
  // never drift apart.
  const mjs = readFileSync(new URL('../src/scripts/production-diagram.mjs', import.meta.url), 'utf8');
  assert.match(mjs, /button\.className\s*=\s*commentsButton\.className/);
  // No stretch-to-full-width override survives for either of them.
  assert.doesNotMatch(diagram, /\.reader-comments-action\{flex:1 1 0;width:0/);
  assert.doesNotMatch(diagram, /flex:0 0 100%;width:100%/);
  assert.match(diagram, /\.pd-reader-actions\{display:flex;align-items:center;gap:6px;min-width:0\}/);
  // An empty action group takes no space on the controls line.
  assert.match(diagram, /\.pd-reader-actions:not\(:has\(\.reader-comments-action:not\(\[hidden\]\)\)\)\{display:none\}/);
});

test('the reader re-checks the approved-only production gate on every state change', () => {
  // `canShowProductionDiagram` itself is covered in production-diagram.test.mjs. Here we
  // assert the reader keeps asking it everywhere the controls line can change.
  const syncs = app.match(/productionDiagram\.sync\(\)/g) ?? [];
  assert.ok(syncs.length >= 3, 'the reader re-checks the production gate as its state changes');
  for (const fn of ['function switchReaderView', 'function renderComments', 'async function openReader']) {
    const start = app.indexOf(fn);
    assert.ok(start > -1, `${fn} exists`);
    const body = app.slice(start, start + 900);
    assert.match(body, /productionDiagram\.sync\(\)/);
  }
});

test('zoom and the page counter are never hidden to buy density', () => {
  // The only rule that takes them out is the comments panel, where there is no document
  // on screen to zoom or page through.
  const hides = room.match(/^\s*[^\n]*display: none[^\n]*$/gm) ?? [];
  const readerHides = hides.filter((rule) => /reader-zoom|reader-count|reader-bar-controls/.test(rule));
  assert.deepEqual(readerHides.map((r) => r.trim()), [
    '.reader-comments-open .reader-zoom, .reader-comments-open .reader-bar-controls { display: none; }',
  ]);
  assert.match(markup, /<span class="reader-count" data-page-count><\/span>/);
});

test('the decision stop is a neutral, prominent footer control without a ring or glow', () => {
  const base = room.match(/\.decide-stop \{\n(?:.*\n)*?  \}/)[0];
  assert.doesNotMatch(base, /box-shadow/);
  assert.match(base, /border: 1px solid var\(--line\);/);
  assert.match(base, /background: var\(--surface\);/);
  assert.match(room, /\.decide-stop \{ min-height: 44px; padding: 0\.25rem 0\.85rem; border-width: 1px; box-shadow: none; \}/);
  assert.match(room, /\.decide-stop\.is-on \{\n\s*background: #454545;\n\s*border-color: #cfcfcf;\n\s*color: #ffffff;\n\s*\}/);
  // No accent ring, halo or filter is reintroduced anywhere for the decision stop.
  for (const rule of room.match(/\.decide-stop[^{]*\{[^}]*\}/gs) ?? []) {
    assert.doesNotMatch(rule, /0 0 0 \d+px/);
    assert.doesNotMatch(rule, /drop-shadow|blur\(/);
  }
});

test('the bottom safe area is paid for exactly once per visible surface', () => {
  const owners = room.match(/[^\n{]*env\(safe-area-inset-bottom\)/g) ?? [];
  assert.equal(owners.length, 2, 'only the pager foot and the comments panel claim it');
  assert.match(room, /padding: 0\.45rem 0\.9rem calc\(0\.5rem \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(room, /\.comments-inner \{ padding: 0\.85rem 0\.75rem calc\(1rem \+ env\(safe-area-inset-bottom\)\); \}/);
  // Those two surfaces are the document panel and the comments panel, which are mutually
  // exclusive, so only one of them is ever on screen.
  assert.match(app, /el\.documentPanel\.hidden = comments;/);
  assert.match(app, /el\.commentsPanel\.hidden = !comments;/);
});

test('leaving the comments panel keeps the page and hands focus back', () => {
  const handler = app.slice(app.indexOf("el.viewDocument.addEventListener"), app.indexOf("el.resetDecision.addEventListener"));
  assert.match(handler, /switchReaderView\('document'\)/);
  assert.match(handler, /el\.openComments\.hidden\s*\?\s*need<HTMLButtonElement>\('\[data-close-reader\]'\)\s*:\s*el\.openComments/s);
  assert.match(handler, /back\.focus\(\{ preventScroll: true \}\)/);
  // Switching panels must not move the reader off the page it was on.
  const switcher = app.slice(app.indexOf('function switchReaderView'), app.indexOf('function ownLatestReview'));
  assert.doesNotMatch(switcher, /\bview = |goTo\(/);
});

test('closing the reader still destroys the document and clears the canvas', () => {
  const close = app.slice(app.indexOf('function closeReader()'), app.indexOf('/** Keeps the same point'));
  assert.match(close, /loadingTask\?\.destroy\(\)/);
  assert.match(close, /context\?\.clearRect\(0, 0, el\.canvas\.width, el\.canvas\.height\)/);
  assert.match(close, /el\.canvas\.width = 0/);
  assert.match(close, /readerPreviousFocus\?\.focus\(\)/);
});
