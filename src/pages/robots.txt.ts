import type { APIContext } from 'astro';
import settings from '../data/site.json';

export function GET(context: APIContext) {
  const base = import.meta.env.BASE_URL;
  const body = settings.indexing
    ? `User-agent: *\nAllow: /\nSitemap: ${new URL(`${base}sitemap-index.xml`, context.site)}\n`
    : 'User-agent: *\nDisallow: /\n';

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
