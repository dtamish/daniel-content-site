import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { serializeJsonForHtml } from '../src/lib/serialize-json-for-html.mjs';
import rehypeBasePath, {
  rebaseRootRelativeUrl,
  rebaseSrcset,
  remarkBasePath,
} from '../src/lib/rehype-base-path.mjs';

test('JSON-LD serialization cannot terminate the script element', () => {
  const payload = {
    headline: '</script><script>globalThis.PWNED = true</script>',
    description: '<img src=x onerror=alert(1)> & text',
  };

  const serialized = serializeJsonForHtml(payload);

  assert.doesNotMatch(serialized, /<\/script/i);
  assert.doesNotMatch(serialized, /[<>&]/);
  assert.deepEqual(JSON.parse(serialized), payload);
});

test('root-relative content URLs are rebased without touching external URLs', () => {
  const base = '/daniel-content-site/';

  assert.equal(rebaseRootRelativeUrl('/uploads/photo.webp', base), '/daniel-content-site/uploads/photo.webp');
  assert.equal(rebaseRootRelativeUrl('/', base), '/daniel-content-site/');
  assert.equal(rebaseRootRelativeUrl('/daniel-content-site/uploads/photo.webp', base), '/daniel-content-site/uploads/photo.webp');
  assert.equal(rebaseRootRelativeUrl('https://cdn.example/photo.webp', base), 'https://cdn.example/photo.webp');
  assert.equal(rebaseRootRelativeUrl('//cdn.example/photo.webp', base), '//cdn.example/photo.webp');
  assert.equal(rebaseRootRelativeUrl('data:image/gif;base64,AAAA', base), 'data:image/gif;base64,AAAA');
});

test('remark rebases root-relative URLs inside raw Markdown HTML', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'html',
        value: '<video poster="/uploads/poster.webp"></video>',
      },
      {
        type: 'html',
        value: '<img src="&#x2F;uploads/entity.webp"><div style="background-image:url(&#x27;&#47;uploads/bg.webp&#39;)"></div>',
      },
    ],
  };

  remarkBasePath({ base: '/daniel-content-site/' })(tree);

  assert.equal(
    tree.children[0].value,
    '<video poster="/daniel-content-site/uploads/poster.webp"></video>',
  );
  assert.equal(
    tree.children[1].value,
    '<img src="/daniel-content-site/uploads/entity.webp"><div style="background-image:url(&#x27;/daniel-content-site/uploads/bg.webp&#39;)"></div>',
  );
});

test('rehype media rebasing covers src, srcset, href, poster, and CSS URLs', () => {
  const tree = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'img',
        properties: {
          src: '/uploads/photo.webp',
          srcSet: '/uploads/photo.webp 1x, /uploads/photo@2x.webp 2x',
          style: "background-image: url('/uploads/preview.webp')",
        },
        children: [],
      },
      {
        type: 'element',
        tagName: 'a',
        properties: { href: '/about/' },
        children: [
          {
            type: 'element',
            tagName: 'video',
            properties: { poster: '/uploads/poster.webp' },
            children: [],
          },
        ],
      },
      {
        type: 'raw',
        value: '<video poster="/uploads/raw-poster.webp"><source srcset="/uploads/raw.webp 1x, https://cdn.example/raw.webp 2x"></video>',
      },
    ],
  };

  rehypeBasePath({ base: '/daniel-content-site/' })(tree);

  assert.equal(tree.children[0].properties.src, '/daniel-content-site/uploads/photo.webp');
  assert.equal(
    tree.children[0].properties.srcSet,
    '/daniel-content-site/uploads/photo.webp 1x, /daniel-content-site/uploads/photo@2x.webp 2x',
  );
  assert.equal(
    tree.children[0].properties.style,
    "background-image: url('/daniel-content-site/uploads/preview.webp')",
  );
  assert.equal(tree.children[1].properties.href, '/daniel-content-site/about/');
  assert.equal(tree.children[1].children[0].properties.poster, '/daniel-content-site/uploads/poster.webp');
  assert.equal(
    tree.children[2].value,
    '<video poster="/daniel-content-site/uploads/raw-poster.webp"><source srcset="/daniel-content-site/uploads/raw.webp 1x, https://cdn.example/raw.webp 2x"></video>',
  );
  assert.equal(
    rebaseSrcset('https://cdn.example/a.webp 1x, /uploads/b.webp 2x', '/daniel-content-site/'),
    'https://cdn.example/a.webp 1x, /daniel-content-site/uploads/b.webp 2x',
  );
  assert.equal(
    rebaseSrcset('  /uploads/leading.webp 1x, /uploads/second.webp 2x', '/daniel-content-site/'),
    '  /daniel-content-site/uploads/leading.webp 1x, /daniel-content-site/uploads/second.webp 2x',
  );
  assert.equal(
    rebaseSrcset('data:image/svg+xml,/uploads-inside-data 1x, /uploads/real.webp 2x', '/daniel-content-site/'),
    'data:image/svg+xml,/uploads-inside-data 1x, /daniel-content-site/uploads/real.webp 2x',
  );
  assert.equal(
    rebaseSrcset('data:image/svg+xml,%3Csvg%3E, /uploads/no-descriptor.webp 2x', '/daniel-content-site/'),
    'data:image/svg+xml,%3Csvg%3E, /daniel-content-site/uploads/no-descriptor.webp 2x',
  );
  assert.equal(
    rebaseSrcset('DATA:image/svg+xml,/uploads-inside-data 1x, /uploads/real.webp 2x', '/daniel-content-site/'),
    'DATA:image/svg+xml,/uploads-inside-data 1x, /daniel-content-site/uploads/real.webp 2x',
  );
  assert.equal(
    rebaseSrcset('data&colon;image/svg+xml,/uploads-inside-data 1x, /uploads/real.webp 2x', '/daniel-content-site/'),
    'data&colon;image/svg+xml,/uploads-inside-data 1x, /daniel-content-site/uploads/real.webp 2x',
  );
});

test('Astro unified Markdown processor rebases encoded and raw media URLs', async () => {
  const base = '/daniel-content-site/';
  const processor = await createMarkdownProcessor({
    remarkPlugins: [[remarkBasePath, { base }]],
    rehypePlugins: [[rehypeBasePath, { base }]],
    syntaxHighlight: false,
  });
  const markdown = [
    '![markdown](/uploads/markdown.png)',
    '',
    '<img id="entity" src="&#x2F;uploads/entity.png">',
    '',
    '<div id="raw-style" style="background-image:url(&#x27;&#47;uploads/bg.png&#x27;)"></div>',
  ].join('\n');

  const result = await processor.render(markdown, {
    fileURL: new URL('file:///C:/media-rebasing-probe.md'),
  });

  assert.match(result.code, /src="\/daniel-content-site\/uploads\/markdown\.png"/);
  assert.match(result.code, /src="\/daniel-content-site\/uploads\/entity\.png"/);
  assert.match(
    result.code,
    /style="background-image:url\(&#x27;\/daniel-content-site\/uploads\/bg\.png&#x27;\)"/,
  );
  assert.doesNotMatch(result.code, /(?:src|url\()[^>\n]*["'(]\/uploads\//);
});

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255);
  const linear = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test('muted small text meets WCAG AA contrast on the paper background', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../src/styles/global.css'), 'utf8');
  const muted = css.match(/--muted:\s*(#[0-9a-f]{6})/i)?.[1];
  const paper = css.match(/--paper:\s*(#[0-9a-f]{6})/i)?.[1];

  assert.ok(muted && paper, 'חסרים משתני הצבע --muted או --paper');
  assert.ok(
    contrastRatio(muted, paper) >= 4.5,
    `יחס הניגודיות של ${muted} על ${paper} נמוך מ-4.5:1`,
  );
});
