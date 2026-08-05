function normalizeBase(base) {
  if (!base || base === '/') return '/';
  return `/${String(base).replace(/^\/+|\/+$/g, '')}/`;
}

const LEADING_SLASH_ENTITY = /^(?:&sol;|&#(?:x0*2f|0*47);?)/i;
const DATA_URL_SCHEME = /^data(?::|&colon;|&#(?:x0*3a|0*58);?)/i;
const ROOT_URL_START = String.raw`(?:\/(?!\/)|&sol;|&#(?:x0*2f|0*47);?)`;
const STYLE_QUOTE = String.raw`(?:["']|&quot;|&apos;|&#(?:x0*22|0*34|x0*27|0*39);?)`;
const STYLE_ROOT_URL = new RegExp(
  `url\\(\\s*(${STYLE_QUOTE}?)(${ROOT_URL_START}[^)]*?)(${STYLE_QUOTE}?)\\s*\\)`,
  'gi',
);

function decodeLeadingRootSlashes(value) {
  let decoded = value;
  while (LEADING_SLASH_ENTITY.test(decoded)) {
    decoded = decoded.replace(LEADING_SLASH_ENTITY, '/');
  }
  return decoded;
}

/**
 * Prefix a root-relative content URL with the configured Astro base path.
 * Protocol-relative and already-prefixed URLs are left unchanged.
 *
 * @param {unknown} value
 * @param {string} base
 */
export function rebaseRootRelativeUrl(value, base) {
  if (typeof value !== 'string') return value;

  const decoded = decodeLeadingRootSlashes(value);
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return decoded;

  const normalizedBase = normalizeBase(base);
  if (normalizedBase === '/') return decoded;

  const prefix = normalizedBase.slice(0, -1);
  if (decoded === prefix || decoded.startsWith(`${prefix}/`)) return decoded;
  return decoded === '/' ? normalizedBase : `${prefix}${decoded}`;
}

/** @param {unknown} value @param {string} base */
export function rebaseSrcset(value, base) {
  if (typeof value !== 'string') return value;

  let output = '';
  let index = 0;
  while (index < value.length) {
    const separatorStart = index;
    while (index < value.length && (value[index] === ',' || /\s/.test(value[index]))) index += 1;
    output += value.slice(separatorStart, index);
    if (index >= value.length) break;

    const startsWithDataUrl = DATA_URL_SCHEME.test(value.slice(index));
    const urlStart = index;
    while (
      index < value.length
      && !/\s/.test(value[index])
      && (startsWithDataUrl || value[index] !== ',')
    ) {
      index += 1;
    }
    const rawUrl = value.slice(urlStart, index);
    if (startsWithDataUrl && rawUrl.endsWith(',')) {
      output += `${rebaseRootRelativeUrl(rawUrl.slice(0, -1), base)},`;
      continue;
    }
    output += rebaseRootRelativeUrl(rawUrl, base);

    const descriptorStart = index;
    while (index < value.length && value[index] !== ',') index += 1;
    if (value[index] === ',') index += 1;
    output += value.slice(descriptorStart, index);
  }

  return output;
}

/** @param {unknown} value @param {string} base */
export function rebaseStyleUrls(value, base) {
  if (typeof value !== 'string') return value;
  return value.replace(
    STYLE_ROOT_URL,
    (_, openQuote, url, closeQuote) => (
      `url(${openQuote}${rebaseRootRelativeUrl(url.trim(), base)}${closeQuote || openQuote})`
    ),
  );
}

/** @param {unknown} value @param {string} base */
export function rebaseRawHtml(value, base) {
  if (typeof value !== 'string') return value;

  return value
    .replace(
      /\b(src|href|poster)\s*=\s*(["'])(.*?)\2/gis,
      (_match, attribute, quote, url) => `${attribute}=${quote}${rebaseRootRelativeUrl(url, base)}${quote}`,
    )
    .replace(
      /\bsrcset\s*=\s*(["'])(.*?)\1/gis,
      (_match, quote, srcset) => `srcset=${quote}${rebaseSrcset(srcset, base)}${quote}`,
    )
    .replace(
      /\bstyle\s*=\s*(["'])(.*?)\1/gis,
      (_match, quote, style) => `style=${quote}${rebaseStyleUrls(style, base)}${quote}`,
    );
}

/** @param {unknown} node @param {string} base */
function rebaseNode(node, base) {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'raw') {
    node.value = rebaseRawHtml(node.value, base);
  }

  if (node.type === 'element' && node.properties && typeof node.properties === 'object') {
    for (const property of ['src', 'href', 'poster']) {
      node.properties[property] = rebaseRootRelativeUrl(node.properties[property], base);
    }
    for (const property of ['srcSet', 'srcset']) {
      node.properties[property] = rebaseSrcset(node.properties[property], base);
    }
    node.properties.style = rebaseStyleUrls(node.properties.style, base);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) rebaseNode(child, base);
  }
}

/** @param {unknown} node @param {string} base */
function rebaseMarkdownNode(node, base) {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'html') {
    node.value = rebaseRawHtml(node.value, base);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) rebaseMarkdownNode(child, base);
  }
}

/**
 * Remark companion for raw HTML nodes, which are parsed into HAST only after
 * custom rehype plugins run in Astro's unified processor.
 *
 * @param {{ base?: string }} [options]
 */
export function remarkBasePath(options = {}) {
  const base = normalizeBase(options.base ?? '/');
  return (tree) => {
    rebaseMarkdownNode(tree, base);
    return tree;
  };
}

/**
 * Rehype plugin used by Astro Markdown rendering so Pages CMS media URLs work
 * on both an account root and a GitHub Pages project subpath.
 *
 * @param {{ base?: string }} [options]
 */
export default function rehypeBasePath(options = {}) {
  const base = normalizeBase(options.base ?? '/');
  return (tree) => {
    rebaseNode(tree, base);
    return tree;
  };
}
