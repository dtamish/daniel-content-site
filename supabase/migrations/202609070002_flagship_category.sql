-- Scoped category addition only. Does not publish or approve concepts.
-- Apply once through an authenticated database-owner path, then read back.
begin;
alter table public.concepts drop constraint if exists concepts_category_check;
alter table public.concepts add constraint concepts_category_check
 check (category in ('FLAGSHIP SERIES', 'series', 'film', 'film-short', 'film-long', 'digital', 'podcast'));
-- Preserve the currently installed RPC, including concurrent changes, owner and grants.
do $$
declare definition text;
 old_guard text := 'p_category not in (''series'', ''film'', ''film-short'', ''film-long'', ''digital'', ''podcast'')';
begin
 select pg_get_functiondef('public.set_concept_editorial_metadata(uuid,text,text,text)'::regprocedure) into definition;
 if position(old_guard in definition) > 0 then
  execute replace(definition, old_guard, 'p_category not in (''FLAGSHIP SERIES'', ''series'', ''film'', ''film-short'', ''film-long'', ''digital'', ''podcast'')');
 elsif position('''FLAGSHIP SERIES''' in definition) = 0 then
  raise exception 'Editorial RPC changed: review live definition before migration';
 end if;
end $$;
commit;
