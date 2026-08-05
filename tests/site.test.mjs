import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const settings = JSON.parse(readFileSync(join(root, 'src/data/site.json'), 'utf8'));

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function decodeHtmlAttribute(value) {
  const named = {
    amp: '&',
    apos: "'",
    colon: ':',
    gt: '>',
    lt: '<',
    quot: '"',
    sol: '/',
  };

  return value.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z]+));/gi,
    (entity, hexadecimal, decimal, name) => {
      const codePoint = hexadecimal
        ? Number.parseInt(hexadecimal, 16)
        : decimal
          ? Number.parseInt(decimal, 10)
          : undefined;
      if (Number.isInteger(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
      return named[name?.toLowerCase()] ?? entity;
    },
  );
}

function extractSrcsetUrls(value) {
  const urls = [];
  let index = 0;

  while (index < value.length) {
    while (index < value.length && (value[index] === ',' || /\s/.test(value[index]))) index += 1;
    if (index >= value.length) break;

    const startsWithDataUrl = /^data:/i.test(value.slice(index));
    const start = index;
    while (
      index < value.length
      && !/\s/.test(value[index])
      && (startsWithDataUrl || value[index] !== ',')
    ) {
      index += 1;
    }

    const url = value.slice(start, index);
    if (startsWithDataUrl && url.endsWith(',')) {
      urls.push(url.slice(0, -1));
      continue;
    }
    if (url) urls.push(url);

    while (index < value.length && value[index] !== ',') index += 1;
    if (value[index] === ',') index += 1;
  }

  return urls;
}

function deploymentBase() {
  const owner = process.env.GITHUB_REPOSITORY_OWNER?.toLowerCase();
  const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1);
  const isAccountSite = Boolean(owner && repository?.toLowerCase() === `${owner}.github.io`);
  const raw = process.env.BASE_PATH || (owner && repository && !isAccountSite ? `/${repository}` : '/');
  return raw === '/' ? '/' : `/${raw.replace(/^\/+|\/+$/g, '')}/`;
}

function resolveInternalHref(htmlFile, href) {
  const cleaned = href.split('#')[0].split('?')[0];
  if (!cleaned || /^(?:https?:|mailto:|tel:|data:|javascript:)/.test(cleaned)) return null;

  const base = deploymentBase();
  let pathname;
  if (cleaned.startsWith('/')) {
    assert.ok(cleaned === base.slice(0, -1) || cleaned.startsWith(base), `קישור חורג מנתיב הבסיס: ${cleaned}`);
    pathname = cleaned === base.slice(0, -1) ? '' : cleaned.slice(base.length);
  } else {
    pathname = relative(dist, resolve(dirname(htmlFile), cleaned)).replaceAll('\\', '/');
  }

  const target = join(dist, pathname);
  if (cleaned.endsWith('/') || !extname(target)) return join(target, 'index.html');
  return target;
}

test('srcset URL extraction keeps data URL commas intact', () => {
  assert.deepEqual(
    extractSrcsetUrls('data:image/svg+xml,%3Csvg%3E 1x, /daniel-content-site/uploads/photo.webp 2x'),
    ['data:image/svg+xml,%3Csvg%3E', '/daniel-content-site/uploads/photo.webp'],
  );
  assert.deepEqual(
    extractSrcsetUrls('data:image/svg+xml,%3Csvg%3E, /daniel-content-site/uploads/no-descriptor.webp 2x'),
    ['data:image/svg+xml,%3Csvg%3E', '/daniel-content-site/uploads/no-descriptor.webp'],
  );
  assert.deepEqual(
    extractSrcsetUrls('DATA:image/svg+xml,/uploads-inside-data 1x, /daniel-content-site/uploads/photo.webp 2x'),
    ['DATA:image/svg+xml,/uploads-inside-data', '/daniel-content-site/uploads/photo.webp'],
  );
  assert.deepEqual(
    extractSrcsetUrls(decodeHtmlAttribute('data&colon;image/svg+xml,/uploads-inside-data 1x, /daniel-content-site/uploads/photo.webp 2x')),
    ['data:image/svg+xml,/uploads-inside-data', '/daniel-content-site/uploads/photo.webp'],
  );
});

test('Pages CMS config is parseable and targets the real content files', () => {
  const config = parseYaml(readFileSync(join(root, '.pages.yml'), 'utf8'));
  assert.equal(config.media.input, 'public/uploads');
  assert.equal(config.media.output, '/uploads');
  assert.equal(config.media.rename, 'safe');
  assert.deepEqual(config.media.extensions, ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif']);
  assert.deepEqual(config.content.map((entry) => entry.name), ['site', 'posts']);
  assert.equal(config.content[0].path, 'src/data/site.json');
  assert.equal(config.content[1].path, 'src/content/posts');
  assert.ok(config.content[1].fields.some((field) => field.name === 'draft' && field.default === true));
});

test('deploy workflow grants write permissions only to the deploy job', () => {
  const workflow = parseYaml(readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8'));

  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.jobs.build.permissions, { contents: 'read' });
  assert.deepEqual(workflow.jobs.deploy.permissions, {
    pages: 'write',
    'id-token': 'write',
  });

  const actionRefs = Object.values(workflow.jobs)
    .flatMap((job) => job.steps ?? [])
    .map((step) => step.uses)
    .filter(Boolean);
  const checkoutStep = workflow.jobs.build.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkoutStep?.with?.['persist-credentials'], false);
  assert.ok(actionRefs.length >= 3);
  for (const actionRef of actionRefs) {
    assert.match(actionRef, /^[^@]+@[0-9a-f]{40}$/, `Action אינו מוצמד ל-SHA: ${actionRef}`);
  }
});

test('build contains the public routes and durable publishing artifacts', () => {
  for (const path of [
    'index.html',
    'about/index.html',
    'admin/index.html',
    'posts/index.html',
    'posts/welcome/index.html',
    'posts/publishing-flow/index.html',
    '404.html',
    'rss.xml',
    'robots.txt',
    'sitemap-index.xml',
  ]) {
    assert.ok(existsSync(join(dist, path)), `חסר בתוצר: ${path}`);
  }
});

test('404 output does not advertise itself as a canonical or social URL', () => {
  const html = readFileSync(join(dist, '404.html'), 'utf8');
  assert.doesNotMatch(html, /<link rel="canonical"/);
  assert.doesNotMatch(html, /<meta property="og:url"/);
});

test('archive and home post lists preserve the heading hierarchy', () => {
  const archive = readFileSync(join(dist, 'posts/index.html'), 'utf8');
  const home = readFileSync(join(dist, 'index.html'), 'utf8');

  assert.match(archive, /<ul class="post-list">[\s\S]*?<h2>/);
  assert.doesNotMatch(archive, /<ul class="post-list">[\s\S]*?<h3>/);
  assert.match(home, /<ul class="post-list">[\s\S]*?<h3>/);
});

test('article JSON-LD is parseable and embedded with HTML-safe serialization', () => {
  for (const path of ['posts/welcome/index.html', 'posts/publishing-flow/index.html']) {
    const html = readFileSync(join(dist, path), 'utf8');
    const serialized = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];

    assert.ok(serialized, `חסר JSON-LD ב-${path}`);
    assert.doesNotMatch(serialized, /[<>&]/);
    const data = JSON.parse(serialized);
    assert.equal(data['@type'], 'Article');
    assert.match(data.mainEntityOfPage, /^https?:\/\//);
    assert.ok(
      new URL(data.mainEntityOfPage).pathname.startsWith(deploymentBase()),
      `JSON-LD חורג מנתיב הבסיס: ${data.mainEntityOfPage}`,
    );
  }
});

test('draft content cannot leak into public output', () => {
  const output = walk(dist)
    .filter((path) => ['.html', '.xml', '.txt'].includes(extname(path)))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(output, /טיוטת בדיקה — לא אמורה להופיע באתר/);
  assert.ok(!existsSync(join(dist, 'posts/draft-verification/index.html')));
});

test('every HTML page is Hebrew RTL, follows the configured index policy, and has one main heading', () => {
  const htmlFiles = walk(dist).filter((path) => extname(path) === '.html');
  assert.ok(htmlFiles.length >= 7);

  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    const outputPath = relative(dist, file).replaceAll('\\', '/');
    const shouldNoIndex = !settings.indexing || ['404.html', 'admin/index.html'].includes(outputPath);
    const expectedRobots = shouldNoIndex ? 'noindex, nofollow' : 'index, follow';

    assert.match(html, /<html[^>]*lang="he"[^>]*dir="rtl"/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<meta name="description" content="[^"]+"/);
    assert.ok(
      html.includes(`<meta name="robots" content="${expectedRobots}"`),
      `מדיניות אינדוקס שגויה: ${outputPath}`,
    );
    assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, `מספר כותרות h1 שגוי: ${outputPath}`);
    assert.doesNotMatch(html, /<title>Astro<\/title>/);
  }
});

test('all generated local links, media, and CSS URLs resolve inside the deployment base', () => {
  const assertReference = (file, reference) => {
    const decodedReference = decodeHtmlAttribute(reference);
    const target = resolveInternalHref(file, decodedReference);
    if (target) {
      assert.ok(
        existsSync(target),
        `הפניה שבורה ב-${relative(dist, file)}: ${decodedReference}`,
      );
    }
  };

  for (const file of walk(dist).filter((path) => extname(path) === '.html')) {
    const html = readFileSync(file, 'utf8');
    for (const [, reference] of html.matchAll(/(?:href|src|poster)="([^"]+)"/g)) {
      assertReference(file, reference);
    }
    for (const [, srcset] of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const reference of extractSrcsetUrls(decodeHtmlAttribute(srcset))) {
        assertReference(file, reference);
      }
    }
    for (const [, style] of html.matchAll(/style="([^"]+)"/g)) {
      const decodedStyle = decodeHtmlAttribute(style);
      for (const [, reference] of decodedStyle.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) {
        assertReference(file, reference);
      }
    }
  }

  for (const file of walk(dist).filter((path) => extname(path) === '.css')) {
    const css = readFileSync(file, 'utf8');
    for (const [, reference] of css.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)) {
      assertReference(file, reference);
    }
  }
});

test('RSS and sitemap URLs stay inside the deployment base', () => {
  const files = ['rss.xml', 'sitemap-index.xml', 'sitemap-0.xml'];
  let urlCount = 0;

  for (const path of files) {
    const xml = readFileSync(join(dist, path), 'utf8');
    for (const [, url] of xml.matchAll(/<(?:loc|link)>(https?:\/\/[^<]+)<\//g)) {
      urlCount += 1;
      assert.ok(
        new URL(url).pathname.startsWith(deploymentBase()),
        `URL חורג מנתיב הבסיס ב-${path}: ${url}`,
      );
    }
  }

  assert.ok(urlCount >= 5, `נמצאו מעט מדי כתובות ב-RSS וב-sitemap: ${urlCount}`);
});

test('robots output follows the configured indexing state', () => {
  const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');

  if (settings.indexing) {
    assert.match(robots, /^User-agent: \*\nAllow: \/\nSitemap: https?:\/\//);
    assert.ok(
      robots.trimEnd().endsWith(`${deploymentBase()}sitemap-index.xml`),
      `מפת האתר ב-robots חורגת מנתיב הבסיס: ${robots}`,
    );
  } else {
    assert.equal(robots, 'User-agent: *\nDisallow: /\n');
  }
});
