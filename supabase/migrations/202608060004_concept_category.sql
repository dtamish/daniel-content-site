-- Groups the board by content type. The values are fixed vocabulary, like the decisions:
-- the interface colours and orders by them, so an unknown value must not be storable.
--
-- 'film' is the five standalone documentaries. No concept document in either language
-- states a running time, so they are not split into short and long until someone decides;
-- both values exist here so that split needs no further migration.

alter table public.concepts
  add column if not exists category text not null default 'series';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'concepts_category_check'
  ) then
    alter table public.concepts
      add constraint concepts_category_check
      check (category in ('series', 'film', 'film-short', 'film-long', 'digital', 'podcast'));
  end if;
end $$;

create index if not exists concepts_published_category_idx
  on public.concepts (publication_status, locale, category, priority);
