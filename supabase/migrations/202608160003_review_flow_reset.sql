-- Fix review saving, add append-only comment revisions, and support reversible decisions.

alter table public.reviews
  add column if not exists reviewer_role text,
  add column if not exists affects_decision boolean not null default true,
  add column if not exists clear_prior_notes boolean not null default false,
  add column if not exists supersedes_review_id uuid references public.reviews(id);

update public.reviews r
set reviewer_role = case
  when p.identity_kind in ('content_editor', 'editor') then 'content_editor'
  when p.identity_kind in ('management', 'honi', 'itzik') then 'management'
  else 'advisor'
end
from public.profiles p
where p.id = r.reviewer_id and r.reviewer_role is null;

alter table public.reviews alter column reviewer_role set not null;
alter table public.reviews drop constraint if exists reviews_reviewer_role_check;
alter table public.reviews add constraint reviews_reviewer_role_check
  check (reviewer_role in ('management', 'content_editor', 'advisor'));
alter table public.reviews drop constraint if exists reviews_clear_notes_only_on_reset_check;
alter table public.reviews add constraint reviews_clear_notes_only_on_reset_check
  check (decision = 'reset' or clear_prior_notes = false);

alter table public.reviews drop constraint if exists reviews_decision_check;
alter table public.reviews add constraint reviews_decision_check
  check (decision in ('priority-approved', 'schedule-approved', 'canceled', 'reset', 'wait'));

-- The role picker controls attribution only. Upload authorization remains separately
-- restricted by is_approved_editor(), which still requires an approved content editor.
create or replace function public.force_review_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  profile_record record;
begin
  if auth.uid() is null then
    raise exception 'An authenticated reviewer is required';
  end if;

  select id, identity_kind, approved into profile_record
  from public.profiles
  where id = auth.uid();
  if not found then
    raise exception 'Profile not found for authenticated user';
  end if;
  if not profile_record.approved then
    raise exception 'Reviewer profile is awaiting approval';
  end if;

  new.reviewer_id := profile_record.id;
  new.reviewer_role := case
    when profile_record.identity_kind in ('content_editor', 'editor') then 'content_editor'
    when profile_record.identity_kind in ('management', 'honi', 'itzik') then 'management'
    else 'advisor'
  end;

  if new.decision = 'reset' then
    new.notes := null;
    new.affects_decision := true;
    new.supersedes_review_id := null;
  elsif new.clear_prior_notes then
    raise exception 'Only a reset can clear prior notes' using errcode = '23514';
  end if;

  if new.supersedes_review_id is not null and not exists (
    select 1 from public.reviews previous
    where previous.id = new.supersedes_review_id
      and previous.concept_id = new.concept_id
      and previous.reviewer_id = auth.uid()
      and previous.notes is not null
  ) then
    raise exception 'A comment can revise only your own comment on this concept'
      using errcode = '23514';
  end if;

  if new.supersedes_review_id is not null then
    new.affects_decision := false;
  end if;

  return new;
end;
$$;

-- Remove the profiles -> reviews -> profiles RLS cycle that caused PostgreSQL 42P17.
drop policy if exists "profiles: read self, published reviewers, or editor" on public.profiles;
drop policy if exists "profiles: read self or editor" on public.profiles;
create policy "profiles: read self or editor"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_approved_editor());

drop policy if exists "reviews: authenticated reviewer inserts own review" on public.reviews;
create policy "reviews: authenticated reviewer inserts own review"
on public.reviews for insert to authenticated
with check (
  reviewer_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved = true
  )
  and exists (
    select 1 from public.concepts c
    where c.id = reviews.concept_id and c.publication_status = 'published'
  )
);

drop policy if exists "reviews: authenticated reviewer updates own review" on public.reviews;

create index if not exists reviews_supersedes_idx
  on public.reviews (supersedes_review_id)
  where supersedes_review_id is not null;

comment on column public.reviews.reviewer_role is
  'Canonical role copied by the server trigger so public review reads never join profiles.';
comment on column public.reviews.affects_decision is
  'False for later comments and comment revisions, so writing notes cannot change project status.';
comment on column public.reviews.clear_prior_notes is
  'On a reset event, hides older comments from the active view without deleting audit history.';
comment on column public.reviews.supersedes_review_id is
  'Append-only comment edit: the newer review replaces this older comment in the active view.';
