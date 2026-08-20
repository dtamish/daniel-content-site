-- Content editors classify and estimate a concept before it reaches wider approval.
-- The three fields are written atomically and remain readable after promotion.

create or replace function public.set_concept_editorial_metadata(
  p_concept_id uuid,
  p_category text,
  p_production_speed text,
  p_budget_level text
)
returns table (
  concept_id uuid,
  category text,
  production_speed text,
  budget_level text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_role text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated session required';
  end if;

  select p.identity_kind into selected_role
  from public.profiles p
  where p.id = auth.uid();

  if selected_role <> 'content_editor' then
    raise exception 'Content editor role required' using errcode = '42501';
  end if;

  if p_category not in ('series', 'film', 'film-short', 'film-long', 'digital', 'podcast') then
    raise exception 'Invalid concept category' using errcode = '23514';
  end if;
  if p_production_speed not in ('fast', 'medium', 'slow') then
    raise exception 'Invalid production speed' using errcode = '23514';
  end if;
  if p_budget_level not in ('low', 'medium', 'high') then
    raise exception 'Invalid budget level' using errcode = '23514';
  end if;

  update public.concepts c
  set category = p_category,
      updated_at = now()
  where c.id = p_concept_id;
  if not found then
    raise exception 'Concept not found' using errcode = 'P0002';
  end if;

  insert into public.concept_assessments as assessment (
    concept_id, production_speed, budget_level, updated_by, updated_at
  ) values (
    p_concept_id, p_production_speed, p_budget_level, auth.uid(), now()
  )
  on conflict on constraint concept_assessments_pkey do update set
    production_speed = excluded.production_speed,
    budget_level = excluded.budget_level,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return query
  select c.id, c.category, assessment.production_speed,
         assessment.budget_level, assessment.updated_at
  from public.concepts c
  join public.concept_assessments assessment on assessment.concept_id = c.id
  where c.id = p_concept_id;
end;
$$;

revoke all on function public.set_concept_editorial_metadata(uuid, text, text, text) from public;
grant execute on function public.set_concept_editorial_metadata(uuid, text, text, text) to authenticated;

comment on function public.set_concept_editorial_metadata(uuid, text, text, text) is
  'Atomically sets category, production speed and budget during content-editor screening, before or after wider approval.';
comment on table public.concept_assessments is
  'Current content-editor estimate for production speed and budget, available during editorial screening and after approval.';
