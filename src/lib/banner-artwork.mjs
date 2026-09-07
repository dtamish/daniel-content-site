/**
 * The banner and the card title are one thing.
 *
 * Every banner in the catalogue was rasterised from its concept document's hero band, so
 * the title is baked into the picture (see `banner_note: "concept artwork with the
 * document's own title"` in the import manifests). The card then repeated that same title
 * underneath as live text. Two titles: the painted one shrinks to a few unreadable pixels
 * on a phone and no screen reader can reach it, the live one is a second copy.
 *
 * The fix is not to hide either title. It is to store the hero band *without* its title —
 * the same artwork, the same navy scrim, the same wordmark, the same aspect ratio — and to
 * let the room paint the title over it as real text that wraps, scales and is selectable.
 *
 * A stored banner therefore has one of two layouts, and the room tells them apart from the
 * storage object name alone, so no column and no hosted migration is needed:
 *
 *   <folder>/banner-artwork.png   title-free artwork; the room paints the live title on it
 *   anything else                 the legacy composed band, title baked in, left as it is
 *
 * A regenerated banner is written beside the original rather than over it, so the original
 * object stays in the bucket and switching `banner_path` back restores it exactly.
 */

/** Object name a title-free banner is stored under, inside the concept's own folder. */
export const ARTWORK_BANNER_FILE = 'banner-artwork.png';

/**
 * The hero band, measured from the delivered banners and from the document CSS that made
 * them. Positions are shares of the band so the same spec composes at any output size, and
 * everything horizontal is expressed from the inline start: English puts the scrim and the
 * wordmark on the left, Hebrew mirrors both to the right, exactly as the documents do.
 */
export const BANNER_ARTWORK = Object.freeze({
  width: 1400,
  height: 541,
  navy: Object.freeze([6, 24, 69]),
  /** Scrim stops as [distance from the inline start, navy opacity]. */
  scrim: Object.freeze([[0, 0.97], [0.3, 0.97], [0.52, 0.86], [0.88, 0.1], [1, 0]]),
  /** A light sky at the top of some artwork would swallow the wordmark without this. */
  cap: Object.freeze({ height: 0.27, opacity: 0.62 }),
  logo: Object.freeze({ inlineStart: 0.055, top: 0.139, width: 0.074 }),
  maxSourceBytes: 12 * 1024 * 1024,
  sourceTypes: Object.freeze(['image/png', 'image/jpeg', 'image/webp']),
  /** The bucket accepts PNG only. */
  outputType: 'image/png',
});

/** True when a storage object name is one of our title-free artwork banners. */
export function isArtworkBannerPath(path) {
  return typeof path === 'string' && path.split('/').pop() === ARTWORK_BANNER_FILE;
}

/** 'artwork' when the room should paint a live title over the banner, else 'composed'. */
export function bannerLayoutFromPath(path) {
  return isArtworkBannerPath(path) ? 'artwork' : 'composed';
}

/**
 * Where a concept's regenerated banner belongs: beside its current banner, so the original
 * object is neither moved nor overwritten and the storage policy that publishes exactly
 * `concepts.banner_path` keeps working unchanged.
 */
export function artworkBannerPathFor(bannerPath, conceptId) {
  const folder = typeof bannerPath === 'string' && bannerPath.includes('/')
    ? bannerPath.slice(0, bannerPath.lastIndexOf('/'))
    : String(conceptId ?? '').trim();
  if (!folder) throw new Error('A banner needs either an existing path or a concept id.');
  return `${folder}/${ARTWORK_BANNER_FILE}`;
}

/** Postgres check-constraint violation, as PostgREST reports it. */
export const CHECK_VIOLATION = '23514';

/**
 * Where a regenerated banner can go while the hosted database still pins `banner_path` to
 * `<36 characters>/banner.png` — that is, until 202609070003_banner_artwork_path.sql has
 * been applied by someone who can run SQL against the project.
 *
 * A fresh folder is the only shape that constraint allows for a second banner, and the
 * catalogue already contains banners stored that way. The delivered banner is still
 * untouched at its own path, so restoring it remains one column update; the caller keeps
 * that path in its receipt, because the new folder no longer sits beside it.
 *
 * The cost of this route is only that the room cannot recognise the banner as title-free,
 * so it keeps the heading under the picture instead of on it. The duplicate title is gone
 * either way, because the picture no longer carries one.
 */
export function constrainedBannerPathFor(folderId) {
  const folder = String(folderId ?? '').trim();
  if (!/^[0-9a-f-]{36}$/.test(folder)) throw new Error('A banner folder must be a 36-character id.');
  return `${folder}/banner.png`;
}

/**
 * Refuses a source image the editor cannot safely store before anything is uploaded.
 * The bucket's own 5MB PNG limit still applies to the composed result; this guards the
 * input, which may be a JPEG or a WebP straight from the artwork folder.
 */
export function assertBannerSource(file) {
  if (!file || !file.size) throw new Error('Choose an image for the banner background.');
  if (!BANNER_ARTWORK.sourceTypes.includes(file.type)) {
    throw new Error('The background must be a PNG, JPEG or WebP image.');
  }
  if (file.size > BANNER_ARTWORK.maxSourceBytes) {
    throw new Error('The background image is larger than 12MB.');
  }
  return file;
}

/**
 * How the artwork fills the band. The picture keeps its own proportions and is centred;
 * it is never squashed. This is the same fit the delivered packages used when they cut a
 * hero out of the full artwork, so a regenerated banner frames its picture as before.
 */
export function coverBox(sourceWidth, sourceHeight, width, height) {
  const ratio = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * ratio;
  const drawHeight = sourceHeight * ratio;
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight };
}

const rgba = ([r, g, b], alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

/**
 * Paints one title-free banner onto a 2D context: artwork, the navy scrim the title will
 * later sit on, the top cap, and the SINAI wordmark. No text is drawn — that is the point.
 *
 * `direction` mirrors the composition for Hebrew, the way the Hebrew documents mirror it.
 */
export function paintBannerArtwork(context, { source, wordmark, direction = 'ltr', spec = BANNER_ARTWORK }) {
  const { width, height, navy } = spec;
  const rtl = direction === 'rtl';
  context.clearRect(0, 0, width, height);
  context.fillStyle = rgba(navy, 1);
  context.fillRect(0, 0, width, height);

  const box = coverBox(source.width, source.height, width, height);
  context.drawImage(source, box.x, box.y, box.width, box.height);

  const scrim = context.createLinearGradient(rtl ? width : 0, 0, rtl ? 0 : width, 0);
  for (const [stop, alpha] of spec.scrim) scrim.addColorStop(stop, rgba(navy, alpha));
  context.fillStyle = scrim;
  context.fillRect(0, 0, width, height);

  const capHeight = height * spec.cap.height;
  const cap = context.createLinearGradient(0, 0, 0, capHeight);
  cap.addColorStop(0, rgba(navy, spec.cap.opacity));
  cap.addColorStop(1, rgba(navy, 0));
  context.fillStyle = cap;
  context.fillRect(0, 0, width, capHeight);

  if (wordmark) {
    const markWidth = width * spec.logo.width;
    const markHeight = markWidth * (wordmark.height / wordmark.width);
    const inset = width * spec.logo.inlineStart;
    const x = rtl ? width - inset - markWidth : inset;
    context.drawImage(wordmark, x, height * spec.logo.top, markWidth, markHeight);
  }
  return context;
}

/**
 * Browser-side entry point: composes the banner and hands back PNG bytes for upload.
 * Nothing is stored here — the caller decides whether a preview becomes a published banner.
 */
export async function composeBannerArtwork({ source, wordmark, direction = 'ltr', spec = BANNER_ARTWORK }) {
  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot compose a banner.');
  context.imageSmoothingQuality = 'high';
  paintBannerArtwork(context, { source, wordmark, direction, spec });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, spec.outputType));
  if (!blob) throw new Error('The banner could not be encoded.');
  return blob;
}
