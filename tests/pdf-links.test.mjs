import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { annotationBox, collectPageLinks, safeLinkUrl } from '../src/lib/pdf-links.mjs';

const markup = readFileSync(new URL('../src/components/ReviewApp.astro', import.meta.url), 'utf8');
const room = readFileSync(new URL('../src/styles/room.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/scripts/review-app.ts', import.meta.url), 'utf8');
const strings = readFileSync(new URL('../src/lib/i18n.ts', import.meta.url), 'utf8');

/**
 * A stand-in for a pdf.js `PageViewport`, exposing the one method the module uses.
 *
 * These four cases are pdf.js's own `PageViewport` transform written out longhand, for a
 * page whose viewBox starts at the origin: at 0° only the bottom-left origin is flipped;
 * at 90° the axes are swapped outright; 180° and 270° add the mirrorings. Writing them
 * out rather than reimplementing the matrix keeps the expectations below readable.
 */
function viewport({ width, height, rotation = 0, scale = 1 }) {
  const pageWidth = rotation % 180 === 0 ? width : height;
  const pageHeight = rotation % 180 === 0 ? height : width;
  return {
    width: pageWidth * scale,
    height: pageHeight * scale,
    convertToViewportPoint(x, y) {
      if (rotation === 90) return [y * scale, x * scale];
      if (rotation === 180) return [(width - x) * scale, y * scale];
      if (rotation === 270) return [(height - y) * scale, (width - x) * scale];
      return [x * scale, (height - y) * scale];   // 0°: flip the bottom-left origin
    },
  };
}

// The one link in the delivered document, at its real coordinates.
const REFERENCE_URL = 'https://youtube.com/shorts/lrd7qqPXcr8?si=oZ-3-rWmFKJX9epy';
const REFERENCE_RECT = [54, 684.42, 163.5, 696.42];
const A4 = { width: 594.96, height: 841.92 };

test('an ordinary web link is kept exactly as the document spells it', () => {
  assert.equal(safeLinkUrl(REFERENCE_URL), REFERENCE_URL);
  assert.equal(safeLinkUrl('http://example.com/a%20b?q=1&r=2#x'), 'http://example.com/a%20b?q=1&r=2#x');
  // No normalisation: a parser would turn this into `https://youtube.com/` with a path.
  assert.equal(safeLinkUrl('https://YouTube.com'), 'https://YouTube.com');
  assert.equal(safeLinkUrl(`  ${REFERENCE_URL}  `), REFERENCE_URL);
});

test('anything that is not plain http or https is refused', () => {
  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///C:/Windows/System32/drivers/etc/hosts',
    'blob:https://example.com/1234',
    'mailto:someone@example.com',
    'tel:+972500000000',
    'ftp://example.com/secret.txt',
    'about:blank',
    '//example.com/protocol-relative',
    '/relative/path.pdf',
    'example.com',
    '',
    '   ',
  ]) {
    assert.equal(safeLinkUrl(hostile), null, `${hostile} must not become a link`);
  }
  for (const notAString of [null, undefined, 42, {}, ['https://example.com']]) {
    assert.equal(safeLinkUrl(notAString), null);
  }
});

test('a scheme hidden behind a control character does not slip through', () => {
  // `new URL()` alone accepts every one of these and reports protocol `javascript:`.
  assert.equal(safeLinkUrl('java\u0000script:alert(1)'), null);
  assert.equal(safeLinkUrl('java\tscript:alert(1)'), null);
  assert.equal(safeLinkUrl('java\nscript:alert(1)'), null);
  assert.equal(safeLinkUrl('java\rscript:alert(1)'), null);
  assert.equal(safeLinkUrl('https://example.com/a b'), null);
  assert.equal(safeLinkUrl('https://example.com/\u0085next-line'), null);
});

test('a link box is the share of the page it covers, so it survives any scale', () => {
  const box = annotationBox(REFERENCE_RECT, viewport(A4));
  // 54/594.96 across, and 841.92 − 696.42 = 145.5 down from the top.
  assert.equal(box.left.toFixed(4), ((54 / 594.96) * 100).toFixed(4));
  assert.equal(box.top.toFixed(4), ((145.5 / 841.92) * 100).toFixed(4));
  assert.equal(box.width.toFixed(4), ((109.5 / 594.96) * 100).toFixed(4));
  assert.equal(box.height.toFixed(4), ((12 / 841.92) * 100).toFixed(4));

  // The same box at a fitted scale, at a zoomed scale, and on a 3× device pixel ratio.
  for (const scale of [0.4783, 1, 2.6, 2.6 * 3, 11]) {
    const scaled = annotationBox(REFERENCE_RECT, viewport({ ...A4, scale }));
    for (const side of ['left', 'top', 'width', 'height']) {
      assert.ok(Math.abs(scaled[side] - box[side]) < 1e-9, `${side} drifted at scale ${scale}`);
    }
  }
});

test('a rotated page moves the box with the ink', () => {
  const upright = annotationBox(REFERENCE_RECT, viewport(A4));
  const quarter = annotationBox(REFERENCE_RECT, viewport({ ...A4, rotation: 90 }));
  const half = annotationBox(REFERENCE_RECT, viewport({ ...A4, rotation: 180 }));

  // A 90° turn swaps the axes: the box keeps its size but changes which one it spans,
  // and what was 9.08% across the upright page is now 9.08% down the turned one.
  assert.ok(Math.abs(quarter.width - upright.height) < 1e-9);
  assert.ok(Math.abs(quarter.height - upright.width) < 1e-9);
  assert.ok(Math.abs(quarter.top - upright.left) < 1e-9);
  assert.ok(Math.abs(quarter.left - (100 - upright.top - upright.height)) < 1e-9);
  // A 180° turn mirrors both axes; the box keeps its size.
  assert.ok(Math.abs(half.width - upright.width) < 1e-9);
  assert.ok(Math.abs(half.left - (100 - upright.left - upright.width)) < 1e-9);

  for (const rotation of [0, 90, 180, 270]) {
    const box = annotationBox(REFERENCE_RECT, viewport({ ...A4, rotation }));
    for (const side of ['left', 'top']) assert.ok(box[side] >= 0 && box[side] <= 100, `${side} left the page at ${rotation}°`);
  }
});

test('corners in either order still produce a positive box', () => {
  const forward = annotationBox([54, 684.42, 163.5, 696.42], viewport(A4));
  const reversed = annotationBox([163.5, 696.42, 54, 684.42], viewport(A4));
  assert.deepEqual(reversed, forward);
});

test('a viewport without the point conversion pdf.js provides is refused, not guessed', () => {
  // pdf.js 6 dropped `convertToViewportRectangle`; only `convertToViewportPoint` remains.
  assert.equal(annotationBox([0, 0, 10, 10], { width: 100, height: 100 }), null);
  assert.equal(annotationBox([0, 0, 10, 10], { width: 100, height: 100, convertToViewportRectangle: () => [0, 0, 1, 1] }), null);
});

test('a box that cannot be drawn is dropped rather than guessed', () => {
  assert.equal(annotationBox([54, 684.42, 54, 696.42], viewport(A4)), null, 'zero width');
  assert.equal(annotationBox([54, 684.42, 163.5, 684.42], viewport(A4)), null, 'zero height');
  assert.equal(annotationBox([0, 0, Number.NaN, 10], viewport(A4)), null, 'not a number');
  assert.equal(annotationBox([0, 0, 10, 10], viewport({ width: 0, height: 0 })), null, 'empty page');
  assert.equal(annotationBox('nonsense', viewport(A4)), null);
  assert.equal(annotationBox([0, 0, 10, 10], null), null);
});

test('the delivered document yields exactly one link, at the exact reference URI', () => {
  const links = collectPageLinks([
    { subtype: 'Link', rect: REFERENCE_RECT, url: REFERENCE_URL, unsafeUrl: REFERENCE_URL },
  ], viewport(A4));
  assert.equal(links.length, 1);
  assert.equal(links[0].url, REFERENCE_URL);
  assert.ok(links[0].width > 0 && links[0].height > 0);
});

test('only link annotations with a usable address become hotspots', () => {
  const links = collectPageLinks([
    { subtype: 'Widget', rect: [0, 0, 10, 10], url: 'https://example.com/form' },
    { subtype: 'Link', rect: [0, 0, 10, 10], dest: 'page-3' },                       // internal jump
    { subtype: 'Link', rect: [0, 0, 10, 10], unsafeUrl: 'javascript:alert(1)', url: 'javascript:alert(1)' },
    { subtype: 'Link', rect: [0, 0, 0, 10], unsafeUrl: 'https://example.com/flat' },  // no area
    { subtype: 'Link', rect: [10, 10, 40, 30], unsafeUrl: 'https://example.com/good' },
    null,
  ], viewport(A4));
  assert.deepEqual(links.map(({ url }) => url), ['https://example.com/good']);
  assert.deepEqual(collectPageLinks(undefined, viewport(A4)), []);
});

test("the document's own spelling wins, and pdf.js only fills a missing scheme", () => {
  const [literal] = collectPageLinks([
    // pdf.js normalises; the reviewed document said `youtube.com`, not `www.youtube.com`.
    { subtype: 'Link', rect: [0, 0, 10, 10], unsafeUrl: REFERENCE_URL, url: 'https://www.youtube.com/shorts/lrd7qqPXcr8' },
  ], viewport(A4));
  assert.equal(literal.url, REFERENCE_URL);

  const [completed] = collectPageLinks([
    { subtype: 'Link', rect: [0, 0, 10, 10], unsafeUrl: 'example.com/deck', url: 'http://example.com/deck' },
  ], viewport(A4));
  assert.equal(completed.url, 'http://example.com/deck');

  // The fallback is not a bypass: pdf.js's own value is tested the same way.
  assert.deepEqual(collectPageLinks([
    { subtype: 'Link', rect: [0, 0, 10, 10], unsafeUrl: 'javascript:a', url: 'javascript:a' },
  ], viewport(A4)), []);
});

// ---------------------------------------------------------------- reader wiring

test('the link layer sits inside the page frame, over the canvas', () => {
  assert.match(markup, /<div class="reader-slide" data-page-slide>/);
  assert.match(markup, /<div class="reader-page" data-page-frame>/);
  const frame = markup.slice(markup.indexOf('data-page-frame'), markup.indexOf('reader-decide'));
  assert.ok(frame.indexOf('data-page-canvas') < frame.indexOf('data-link-layer'), 'the layer paints over the canvas');
  assert.match(frame, /<div class="reader-links" data-link-layer hidden>/);
});

test('the layer never steals a page gesture, but its anchors take a click', () => {
  const layer = room.slice(room.indexOf('.reader-links {'), room.indexOf('.reader-link:hover'));
  assert.match(layer, /\.reader-links \{[^}]*pointer-events: none;/s);
  assert.match(layer, /\.reader-link \{[^}]*pointer-events: auto;/s);
  assert.match(room, /\.reader-page \{ position: relative;/);
  assert.match(room, /\.reader-link:focus-visible \{ outline: 2px solid var\(--accent\);/);
});

test('every hotspot opens in a new tab with no handle on the room', () => {
  const paint = app.slice(app.indexOf('function paintPageLinks'), app.indexOf('async function paint()'));
  assert.match(paint, /anchor\.href = link\.url;/);
  assert.match(paint, /anchor\.target = '_blank';/);
  assert.match(paint, /anchor\.rel = 'noopener noreferrer';/);
  assert.match(paint, /aria-label', strings\.documentLink\(link\.url\)/);
  // Percent, not pixels: the anchors follow the canvas instead of being repositioned.
  for (const side of ['left', 'top', 'width', 'height']) {
    assert.ok(paint.includes(`anchor.style.${side} = \`\${link.${side}}%\`;`), `${side} is set in per cent`);
  }
});

test('links are cleared whenever the page or the document changes', () => {
  assert.match(app, /function clearPageLinks\(\) \{\s*el\.linkLayer\.replaceChildren\(\);\s*el\.linkLayer\.hidden = true;/);
  const paint = app.slice(app.indexOf('async function paint()'), app.indexOf('function renderDots'));
  assert.ok(paint.includes('clearPageLinks();'), 'a repaint drops the previous page\'s links first');
  // The hotspots go up only once the new bitmap is on screen, and only if still current.
  assert.ok(paint.indexOf('drawImage') < paint.indexOf('paintPageLinks(links)'));
  assert.match(paint, /const links = await annotations;\s*if \(token !== renderToken\) return;\s*paintPageLinks\(links\);/);
  for (const owner of ['async function openReader', 'function closeReader']) {
    const body = app.slice(app.indexOf(owner));
    assert.ok(body.slice(0, body.indexOf('\n  }')).includes('clearPageLinks()'), `${owner} clears the layer`);
  }
});

test('page gestures do not swallow a link click, and a link tap does not zoom', () => {
  // A drag that began on a link is a page gesture; a keyboard activation never is.
  assert.match(app, /if \(event\.detail > 0 && gestureTravelled\) event\.preventDefault\(\);/);
  assert.match(app, /beginGesture\(event\.touches\[0\]\.clientX, event\.touches\[0\]\.clientY, isLinkTarget\(event\.target\)\)/);
  assert.match(app, /beginGesture\(event\.clientX, event\.clientY, isLinkTarget\(event\.target\)\)/);
  assert.match(app, /if \(gestureOnLink\) \{\s*lastTap = 0;/);
  assert.match(app, /addEventListener\('dblclick', \(event\) => \{\s*if \(isLinkTarget\(event\.target\)\) return;/);
});

test('the hotspot label is offered in both languages', () => {
  assert.match(strings, /documentLink: \(url: string\) => string;/);
  assert.match(strings, /documentLink: \(url\) => `Link in the document: \$\{url\}/);
  assert.match(strings, /documentLink: \(url\) => `\u05e7\u05d9\u05e9\u05d5\u05e8 \u05d1\u05de\u05e1\u05de\u05da: \$\{url\}/);
});
