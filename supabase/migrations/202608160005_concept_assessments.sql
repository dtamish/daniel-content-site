-- Editorial production estimates for approved concepts.
-- Everyone may read the labels; only a visitor currently acting as content editor
-- may set them, and only while the concept's latest decision is approved.

create table if not exists public.concept_assessments (
  concept_id uuid primary key references public.concepts(id) on delete cascade,
  production_speed text not null check (production_speed in ('fast', 'medium', 'slow')),
  budget_level text not null check (budget_level in ('low', 'medium', 'high')),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.concept_assessments enable row level security;

drop policy if exists "concept assessments: public read" on public.concept_assessments;
create policy "concept assessments: public read"
on public.concept_assessments for select
to anon, authenticated
using (true);

grant select on public.concept_assessments to anon, authenticated;

create or replace function public.set_concept_assessment(
  p_concept_id uuid,
  p_production_speed text,
  p_budget_level text
)
returns table (
  concept_id uuid,
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
  latest_decision text;
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

  if p_production_speed not in ('fast', 'medium', 'slow') then
    raise exception 'Invalid production speed' using errcode = '23514';
  end if;
  if p_budget_level not in ('low', 'medium', 'high') then
    raise exception 'Invalid budget level' using errcode = '23514';
  end if;

  select r.decision into latest_decision
  from public.reviews r
  where r.concept_id = p_concept_id
    and r.affects_decision = true
  order by r.created_at desc, r.id desc
  limit 1;

  if latest_decision is null
     or latest_decision not in ('priority-approved', 'schedule-approved') then
    raise exception 'Concept must be approved before assessment' using errcode = '23514';
  end if;

  insert into public.concept_assessments as assessment (
    concept_id, production_speed, budget_level, updated_by, updated_at
  ) values (
    p_concept_id, p_production_speed, p_budget_level, auth.uid(), now()
  )
  on conflict (concept_id) do update set
    production_speed = excluded.production_speed,
    budget_level = excluded.budget_level,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return query
  select assessment.concept_id, assessment.production_speed,
         assessment.budget_level, assessment.updated_at
  from public.concept_assessments assessment
  where assessment.concept_id = p_concept_id;
end;
$$;

revoke all on function public.set_concept_assessment(uuid, text, text) from public;
grant execute on function public.set_concept_assessment(uuid, text, text) to authenticated;

comment on table public.concept_assessments is
  'Current content-editor estimate for production speed and budget of an approved concept.';
