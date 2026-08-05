// @ts-check
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import rehypeBasePath, { remarkBasePath } from './src/lib/rehype-base-path.mjs';

const owner = process.env.GITHUB_REPOSITORY_OWNER?.toLowerCase();
const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1);
const isAccountSite = Boolean(
  owner && repository?.toLowerCase() === `${owner}.github.io`,
);
const derivedBase = owner && repository && !isAccountSite ? `/${repository}` : '/';
const configuredBase = process.env.BASE_PATH || derivedBase;
const base = configuredBase === '/' ? '/' : `/${configuredBase.replace(/^\/+|\/+$/g, '')}`;
const site = process.env.SITE_URL || (owner ? `https://${owner}.github.io` : 'http://localhost:4321');

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  markdown: {
    processor: unified({
      remarkPlugins: [[remarkBasePath, { base }]],
      rehypePlugins: [[rehypeBasePath, { base }]],
    }),
  },
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin/'),
    }),
  ],
});
