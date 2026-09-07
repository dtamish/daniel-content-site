/**
 * The reader paints each PDF page onto a canvas, so a link an author wrote inside the
 * document arrives as nothing but a rectangle of ink. This module turns pdf.js link
 * annotations into the two things the reader needs to lay a real anchor over that ink:
 * a vetted address, and a box expressed as a share of the page.
 *
 * It deliberately knows nothing about pdf.js or the DOM. The reader hands it an already
 * loaded annotation list and a viewport, which keeps every rule below directly testable.
 */

/** A document may link to the web. It may not run script, or reach the local machine. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/** Control characters and inner spaces; `java\tscript:` survives a plain scheme check. */
const HIDDEN_CHARACTERS = /[\u0000-\u0020\u007f-\u009f]/;

/**
 * Returns the address exactly as the document spells it when it is an ordinary web link,
 * and `null` for everything else.
 *
 * The literal string is returned rather than the parser's `href` on purpose: parsing
 * normalises a URL — it can add a path, re-encode a query, lower-case a host — and a
 * normalised link is not the link that was written, reviewed and approved. Parsing is
 * used only as the test, never as the result.
 */
export function safeLinkUrl(raw) {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim();
  if (!candidate || HIDDEN_CHARACTERS.test(candidate)) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;   // relative, malformed, or scheme-less: not something to open blindly
  }
  return SAFE_PROTOCOLS.has(parsed.protocol) ? candidate : null;
}

/**
 * Converts one annotation rectangle into a box measured in per cent of the page.
 *
 * pdf.js reports the rectangle in PDF user space, whose origin is the bottom-left corner
 * and whose axes ignore page rotation; `convertToViewportPoint` applies the viewport's
 * scale and rotation to one corner at a time. Which corner ends up left or top depends on
 * that rotation, so the two results are normalised here rather than trusted for order.
 *
 * Per cent — not pixels — is what makes the anchors survive the reader. The canvas is
 * re-rendered at a new size for every zoom step, every device pixel ratio and every
 * resize, but a link's share of its page never changes, so one box stays correct through
 * all of them, with no rounding drift against the bitmap underneath.
 */
export function annotationBox(rect, viewport) {
  if (!Array.isArray(rect) || rect.length < 4) return null;
  if (!viewport || typeof viewport.convertToViewportPoint !== 'function') return null;
  const { width: pageWidth, height: pageHeight } = viewport;
  if (!(pageWidth > 0) || !(pageHeight > 0)) return null;
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  if (width <= 0 || height <= 0) return null;   // a degenerate hotspot is not clickable
  return {
    left: (Math.min(x1, x2) / pageWidth) * 100,
    top: (Math.min(y1, y2) / pageHeight) * 100,
    width: (width / pageWidth) * 100,
    height: (height / pageHeight) * 100,
  };
}

/**
 * The link annotations of one page, in the order the document declares them.
 *
 * `unsafeUrl` is the address as written in the file and is preferred, so a click lands on
 * the author's exact URI. pdf.js's own `url` is the fallback for the one case where the
 * literal cannot stand alone — an address written without a scheme — and it goes through
 * the same test rather than being trusted for being pdf.js's.
 */
export function collectPageLinks(annotations, viewport) {
  const links = [];
  for (const annotation of annotations ?? []) {
    if (!annotation || annotation.subtype !== 'Link') continue;
    const url = safeLinkUrl(annotation.unsafeUrl) ?? safeLinkUrl(annotation.url);
    if (!url) continue;
    const box = annotationBox(annotation.rect, viewport);
    if (!box) continue;
    links.push({ url, ...box });
  }
  return links;
}
