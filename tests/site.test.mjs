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

test('build contains only the review app routes', () => {
  for (const path of ['index.html', 'admin/index.html', '404.html', 'robots.txt', 'sitemap-index.xml']) {
    assert.ok(existsSync(join(dist, path)), `חסר בתוצר: ${path}`);
  }
  for (const path of ['about/index.html', 'posts/index.html', 'rss.xml']) {
    assert.ok(!existsSync(join(dist, path)), `נמצא תוצר מיושן: ${path}`);
  }
});

test('404 output does not advertise itself as a canonical or social URL', () => {
  const html = readFileSync(join(dist, '404.html'), 'utf8');
  assert.doesNotMatch(html, /<link rel="canonical"/);
  assert.doesNotMatch(html, /<meta property="og:url"/);
});

test('concept review home exposes the focused review flow and exactly three decisions', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');

  assert.match(home, /data-concept-grid/);
  assert.match(home, /Approved — MVP, start production immediately/);
  assert.match(home, /Approved — schedule after launch/);
  assert.match(home, /Not approved/);
  assert.equal((home.match(/name="decision"/g) ?? []).length, 3);
});

test('English is the default and Hebrew remains one clear switch away', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const i18n = readFileSync(join(root, 'src/lib/i18n.ts'), 'utf8');
  assert.match(i18n, /DEFAULT_LOCALE: Locale = 'en'/);
  assert.match(home, /<html[^>]*lang="en"[^>]*dir="ltr"/);
  assert.match(home, /data-locale-toggle/);
  assert.match(home, />עברית</);
});

test('the room exposes three role names without personal reviewer names', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const repository = readFileSync(join(root, 'src/lib/concept-repository.ts'), 'utf8');
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  assert.match(home, /value="management"/);
  assert.match(home, /value="content_editor"/);
  assert.match(home, /value="advisor"/);
  assert.doesNotMatch(home, /value="honi"|value="itzik"/);
  assert.doesNotMatch(repository, /profiles\(display_name/);
  assert.match(repository, /reviewerName: STRINGS\[locale\]\.people\[role\]/);
  assert.match(reviewScript, /strings\.people\[latestRole\]/);
});

test('catalogue supports an explicit grid and compact list view', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  assert.match(home, /data-view="grid"/);
  assert.match(home, /data-view="list"/);
  assert.match(reviewScript, /room-view-list/);
});

test('reader uses one clear flow instead of document/comments tabs', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const styles = readFileSync(join(root, 'src/styles/room.css'), 'utf8');
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  assert.doesNotMatch(home, /data-reader-view=/);
  assert.match(home, /data-open-comments/);
  assert.match(home, /data-view-document/);
  assert.match(home, /data-comments-panel/);
  assert.match(home, /data-comments-list/);
  assert.match(home, /data-comments-form/);
  assert.match(home, /data-reset-dialog/);
  assert.match(home, /name="reset-notes" value="keep"/);
  assert.match(home, /name="reset-notes" value="clear"/);
  assert.match(reviewScript, /card-comments/);
  assert.match(reviewScript, /card-reset/);
  assert.match(styles, /\.card-actions/);
  assert.match(styles, /\.comment-role-management/);
  assert.match(styles, /\.comment-role-content_editor/);
  assert.match(styles, /\.comment-role-advisor/);
  assert.match(home, /role="dialog" aria-modal="true"/);
  assert.match(reviewScript, /readerPreviousFocus|event\.key === 'Tab'/);
});

test('the room offers exactly three review tabs and no side drawer', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');

  assert.match(home, /data-tab="pending"/);
  assert.match(home, /data-tab="approved"/);
  assert.match(home, /data-tab="rejected"/);
  assert.equal((home.match(/data-tab="/g) ?? []).length, 3);
  assert.doesNotMatch(home, /data-drawer|data-open-drawer|filter-drawer/);
});

test('the reader pages a rendered document and ends on the decision', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');

  assert.match(home, /data-page-canvas/);
  assert.match(home, /data-decision-slide/);
  assert.match(home, /data-prev/);
  assert.match(home, /data-next/);
  // The document is rendered in-app; it is no longer handed to an embedded browser viewer.
  assert.doesNotMatch(home, /data-reader-frame|<iframe/);
  assert.match(reviewScript, /pdfjs\.getDocument\(/);
  assert.match(reviewScript, /pointerdown/);
  assert.match(reviewScript, /view = target/);
  assert.match(reviewScript, /gesture = 'pinch'/);
  assert.match(reviewScript, /function releaseSwipe/);
});

test('opening the room asks who is reviewing instead of running an onboarding tour', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');

  assert.match(home, /data-identity-dialog/);
  assert.doesNotMatch(home, /data-welcome-dialog|data-tutorial-dialog|data-skip-tutorial/);
});

test('the language switch swaps interface, catalogue and document together', () => {
  const home = readFileSync(join(dist, 'index.html'), 'utf8');
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  const repository = readFileSync(join(root, 'src/lib/concept-repository.ts'), 'utf8');

  assert.match(home, /data-locale-toggle/);
  assert.match(reviewScript, /document\.documentElement\.dir = direction\(locale\)/);
  assert.match(reviewScript, /if \(!el\.reader\.hidden\) closeReader\(\);/);
  assert.match(reviewScript, /loadCatalogue\(\)/);
  assert.match(repository, /\.eq\('locale', locale\)/);
});

test('admin output makes editor authentication and upload scope explicit', () => {
  const admin = readFileSync(join(dist, 'admin/index.html'), 'utf8');
  assert.match(admin, /קישור כניסה|magic.*link/i);
  assert.match(admin, /pdf|PDF/);
  assert.match(admin, /png|PNG/);
  assert.match(admin, /500/);
});

test('admin refreshes its authorization state when the magic-link session arrives', () => {
  const adminScript = readFileSync(join(root, 'src/scripts/admin-app.ts'), 'utf8');

  assert.match(adminScript, /auth\.onAuthStateChange/);
});

test('the deployment remains compatible while hosted editor roles are migrated', () => {
  const adminScript = readFileSync(join(root, 'src/scripts/admin-app.ts'), 'utf8');
  const repository = readFileSync(join(root, 'src/lib/concept-repository.ts'), 'utf8');

  assert.match(adminScript, /\['content_editor', 'editor'\]\.includes/);
  assert.match(repository, /value === 'content_editor' \|\| value === 'editor'/);
  assert.match(repository, /value === 'management' \|\| value === 'honi' \|\| value === 'itzik'/);
  assert.match(repository, /role === 'management'.*return 'honi'/s);
  assert.match(repository, /role === 'content_editor'.*return 'editor'/s);
  const migration = readFileSync(join(root, 'supabase/migrations/202608160001_roles_and_three_decisions.sql'), 'utf8');
  assert.match(migration, /identity_kind in \('content_editor', 'editor'\)/);
  assert.match(migration, /identity_kind in \('management', 'honi', 'itzik'\)/);
});

test('review saving stays open to every role while editor upload remains role-scoped', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/202608160003_review_flow_reset.sql'), 'utf8');
  const openAccessMigration = readFileSync(join(root, 'supabase/migrations/202608160004_open_reviewer_access.sql'), 'utf8');
  const repository = readFileSync(join(root, 'src/lib/concept-repository.ts'), 'utf8');

  assert.match(migration, /drop policy if exists "profiles: read self, published reviewers, or editor"/);
  assert.match(migration, /identity_kind as reviewer_role|new\.reviewer_role/);
  assert.match(openAccessMigration, /approved\)\s*values[\s\S]*true/);
  assert.match(openAccessMigration, /update public\.profiles set approved = true/);
  assert.match(openAccessMigration, /reviews: open link inserts own review/);
  assert.doesNotMatch(openAccessMigration, /p\.approved = true/);
  assert.match(openAccessMigration, /is_approved_editor\(\)/);
  assert.match(openAccessMigration, /set_reviewer_role/);
  assert.match(migration, /decision in \('priority-approved', 'schedule-approved', 'canceled', 'reset', 'wait'\)/);
  assert.match(migration, /clear_prior_notes/);
  assert.match(migration, /affects_decision/);
  assert.match(migration, /supersedes_review_id/);
  assert.doesNotMatch(repository, /profiles\(identity_kind\)/);
  assert.match(repository, /reviewer_role/);
  assert.match(repository, /affects_decision/);
  assert.match(repository, /rpc\('set_reviewer_role'/);
});

test('approved concepts expose editorial estimates and sorting without affecting other tabs', () => {
  const component = readFileSync(join(root, 'src/components/ReviewApp.astro'), 'utf8');
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  const repository = readFileSync(join(root, 'src/lib/concept-repository.ts'), 'utf8');
  const migration = readFileSync(join(root, 'supabase/migrations/202608160005_concept_assessments.sql'), 'utf8');

  assert.match(component, /data-approved-sort/);
  assert.match(component, /value="viability"/);
  assert.match(reviewScript, /data-assessment-editor/);
  assert.match(reviewScript, /identity\?\.kind === 'content_editor'/);
  assert.match(reviewScript, /sortApprovedConcepts/);
  assert.match(repository, /concept_assessments/);
  assert.match(repository, /query\(`\$\{BASE\},category,\$\{REVIEWS\}`\)/);
  assert.match(repository, /set_concept_assessment/);
  assert.match(migration, /production_speed in \('fast', 'medium', 'slow'\)/);
  assert.match(migration, /budget_level in \('low', 'medium', 'high'\)/);
  assert.match(migration, /Content editor role required/);
  assert.match(migration, /selected_role text/);
  assert.doesNotMatch(migration, /current_role text/);
  assert.match(migration, /Concept must be approved before assessment/);
});

test('native modal dialogs own Escape and Tab before the reader keyboard trap', () => {
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  const modalGuard = reviewScript.indexOf("root.querySelector<HTMLDialogElement>('dialog[open]')");
  const readerGuard = reviewScript.indexOf('if (el.reader.hidden) return;', modalGuard);

  assert.ok(modalGuard >= 0);
  assert.ok(readerGuard > modalGuard);
});

test('admin offers a manifest-backed bulk import for the prepared concept package', () => {
  const admin = readFileSync(join(dist, 'admin/index.html'), 'utf8');

  assert.match(admin, /data-bulk-import-form/);
  assert.match(admin, /data-bulk-import-folder/);
  assert.match(admin, /manifest\.json/);
  assert.match(admin, /בחרו את תיקיית חבילת הייבוא/);
});

test('admin can explicitly publish imported drafts after review', () => {
  const admin = readFileSync(join(dist, 'admin/index.html'), 'utf8');
  const adminScript = readFileSync(join(root, 'src/scripts/admin-app.ts'), 'utf8');

  assert.match(admin, /data-publish-drafts/);
  assert.match(adminScript, /publication_status.*published/);
});

test('page renders are serialised so two never share the canvas', () => {
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');

  // pdf.js throws "Cannot use the same canvas during multiple render() operations"
  // when a zoom, a page change and a resize overlap.
  assert.match(reviewScript, /function requestPaint\(\)/);
  assert.match(reviewScript, /paintChain = paintChain/);
  assert.match(reviewScript, /function cancelRender\(\)/);
  assert.match(reviewScript, /task\.cancel\(\)/);
  assert.doesNotMatch(reviewScript, /void paint\(\)/);
  // A render promise that never settles must not be able to block every later paint.
  assert.doesNotMatch(reviewScript, /await task\.promise/);
  assert.match(reviewScript, /document\.createElement\('canvas'\)/);
  assert.match(reviewScript, /drawImage\(buffer/);
});

test('a swipe is measured from the last movement, not from the ending event', () => {
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');

  // pointercancel and touchcancel commonly carry clientX 0. Reading the distance from the
  // ending event turned every swipe into one large move in whichever direction was negative,
  // which advanced pages in English and did nothing in Hebrew.
  assert.match(reviewScript, /let lastX = 0;/);
  assert.match(reviewScript, /const dx = lastX - startX;/);
  assert.doesNotMatch(reviewScript, /const dx = event\.clientX - startX;/);
  // touch input is handled with touch events rather than pointer capture
  assert.match(reviewScript, /addEventListener\('touchstart'/);
  assert.match(reviewScript, /addEventListener\('touchmove'/);
  assert.match(reviewScript, /event\.pointerType !== 'mouse'/);
});

test('the pager names the decision instead of hiding it behind a dot', () => {
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  const styles = readFileSync(join(root, 'src/styles/room.css'), 'utf8');

  assert.match(reviewScript, /decide-stop/);
  assert.match(reviewScript, /strings\.decisionMarker/);
  assert.match(reviewScript, /goTo\(pageCount\)/);
  assert.match(styles, /\.decide-stop/);
});

test('comment revisions remain append-only instead of mutating review history', () => {
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  const migration = readFileSync(join(root, 'supabase/migrations/202608060003_append_only_reviews.sql'), 'utf8');

  assert.match(reviewScript, /saveReview\(\{/);
  assert.match(reviewScript, /supersedesReviewId: editingReviewId/);
  assert.match(reviewScript, /comment-edit/);
  assert.match(reviewScript, /review\.isOwn && status !== 'pending'/);
  assert.doesNotMatch(reviewScript, /review\.reviewerRole === currentIdentity\.kind/);
  assert.match(reviewScript, /pendingDecision \|\| editingDecision \|\| ownLatestReview\(\)\?\.decision/);
  assert.doesNotMatch(reviewScript, /pendingDecision \|\| latestReview\(active\.reviews\)/);
  assert.match(migration, /before update on public\.reviews/);
  assert.match(migration, /Review history is append-only/);
});

test('legacy wait history is preserved but cannot be inserted again', () => {
  const migration = readFileSync(join(root, 'supabase/migrations/202608160001_roles_and_three_decisions.sql'), 'utf8');

  assert.doesNotMatch(migration, /update public\.reviews set decision/);
  assert.match(migration, /decision in \('priority-approved', 'schedule-approved', 'canceled', 'wait'\)/);
  assert.match(migration, /before insert on public\.reviews/);
  assert.match(migration, /new\.decision = 'wait'/);
});

test('a swipe cannot leave the page stuck invisible', () => {
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');

  // requestAnimationFrame is throttled in background tabs, so the restore must not need it.
  assert.match(reviewScript, /function clearTrack\(\)/);
  assert.match(reviewScript, /function syncView\(\)\s*\{\s*clearTrack\(\);/);
  assert.doesNotMatch(reviewScript, /requestAnimationFrame\(\(\) => \{\s*el\.track/);
});

test('closing the reader releases the signed document URL', () => {
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');

  assert.match(reviewScript, /function closeReader\(\)/);
  assert.match(reviewScript, /loadingTask\?\.destroy\(\)/);
  assert.match(reviewScript, /pdf = null;/);
  assert.match(reviewScript, /el\.canvas\.width = 0;/);
});

test('concept cards preserve the source banner composition', () => {
  const reviewScript = readFileSync(join(root, 'src/scripts/review-app.ts'), 'utf8');
  const styles = readFileSync(join(root, 'src/styles/room.css'), 'utf8');
  const globals = readFileSync(join(root, 'src/styles/global.css'), 'utf8');

  assert.match(reviewScript, /image\.loading = 'lazy'/);
  assert.match(reviewScript, /image\.decoding = 'async'/);
  assert.match(styles, /aspect-ratio: 1785 \/ 690/);
  assert.match(globals, /color-scheme: dark/);
  assert.match(globals, /--accent: #ff7a1a/);
});

test('draft content cannot leak into public output', () => {
  const output = walk(dist)
    .filter((path) => ['.html', '.xml', '.txt'].includes(extname(path)))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  assert.doesNotMatch(output, /טיוטת בדיקה — לא אמורה להופיע באתר/);
});

test('every HTML page follows its configured language, index policy, and has one main heading', () => {
  const htmlFiles = walk(dist).filter((path) => extname(path) === '.html');
  assert.ok(htmlFiles.length >= 2);

  for (const file of htmlFiles) {
    const html = readFileSync(file, 'utf8');
    const outputPath = relative(dist, file).replaceAll('\\', '/');
    const shouldNoIndex = !settings.indexing || ['404.html', 'admin/index.html'].includes(outputPath);
    const expectedRobots = shouldNoIndex ? 'noindex, nofollow' : 'index, follow';

    if (outputPath === 'index.html') assert.match(html, /<html[^>]*lang="en"[^>]*dir="ltr"/);
    else assert.match(html, /<html[^>]*lang="he"[^>]*dir="rtl"/);
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

test('sitemap URLs stay inside the deployment base', () => {
  const files = ['sitemap-index.xml', 'sitemap-0.xml'];
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

  assert.ok(urlCount >= 2, `נמצאו מעט מדי כתובות במפת האתר: ${urlCount}`);
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

test('Values Arena is kept in the series category in repeatable database setup', () => {
  const migration = readFileSync(
    join(root, 'supabase/migrations/202608160002_values_arena_series.sql'),
    'utf8',
  );

  assert.match(migration, /title = 'Values Arena'/);
  assert.match(migration, /set category = 'series'/);
  assert.match(migration, /category = 'digital'/);
});
