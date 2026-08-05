// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

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
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin/'),
    }),
  ],
});
