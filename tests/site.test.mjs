import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
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

test('Pages CMS config is parseable and targets the real content files', () => {
  const config = parseYaml(readFileSync(join(root, '.pages.yml'), 'utf8'));
  assert.equal(config.media.input, 'public/uploads');
  assert.equal(config.media.output, '/uploads');
  assert.deepEqual(config.content.map((entry) => entry.name), ['site', 'posts']);
  assert.equal(config.content[0].path, 'src/data/site.json');
  assert.equal(config.content[1].path, 'src/content/posts');
  assert.ok(config.content[1].fields.some((field) => field.name === 'draft' && field.default === true));
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

test('draft content cannot leak into public output', () => {
  const output = walk(dist)
    .filter((path) => ['.html', '.xml', '.txt'].includes(extname(path)))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(output, /טיוטת בדיקה — לא אמורה להופיע באתר/);
  assert.ok(!existsSync(join(dist, 'posts/draft-verification/index.html')));
});

test('every HTML page is Hebrew RTL, index-safe, and has one main heading', () => {
  const htmlFiles = walk(dist).filter((path) => extname(path) === '.html');
  assert.ok(htmlFiles.length >= 7);

  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    assert.match(html, /<html[^>]*lang="he"[^>]*dir="rtl"/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /<meta name="description" content="[^"]+"/);
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, `מספר כותרות h1 שגוי: ${relative(dist, file)}`);
    assert.doesNotMatch(html, /<title>Astro<\/title>/);
  }
});

test('all generated local links resolve inside the deployment base', () => {
  for (const file of walk(dist).filter((path) => extname(path) === '.html')) {
    const html = readFileSync(file, 'utf8');
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      const target = resolveInternalHref(file, href);
      if (target) assert.ok(existsSync(target), `קישור שבור ב-${relative(dist, file)}: ${href}`);
    }
  }
});

test('robots keep the unfinished starter out of search indexes', () => {
  assert.equal(readFileSync(join(dist, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
});
