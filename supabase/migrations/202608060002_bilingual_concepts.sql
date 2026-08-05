-- Enables independent Hebrew and English concept packages.
-- Run once in the Supabase SQL editor before importing the English package.

alter table public.concepts
  add column if not exists locale text not null default 'he'
  check (locale in ('he', 'en'));

update public.concepts set locale = 'he' where locale is null;

create index if not exists concepts_published_locale_priority_idx
  on public.concepts (publication_status, locale, priority);

-- A title may occur once in each language, but imports must not treat a
-- Hebrew title as a duplicate of its English counterpart.
create unique index if not exists concepts_locale_title_unique_idx
  on public.concepts (locale, title);
