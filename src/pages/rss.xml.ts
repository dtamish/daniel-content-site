import type { APIContext } from 'astro';
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import settings from '../data/site.json';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
  const site = new URL(import.meta.env.BASE_URL, context.site);

  return rss({
    title: `${settings.title} — ${settings.siteLabel}`,
    description: settings.description,
    site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `posts/${post.id}/`,
      categories: post.data.tags,
    })),
    customData: '<language>he-IL</language>',
  });
}
