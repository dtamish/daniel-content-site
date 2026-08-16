-- Make the shared review link frictionless: every visitor may choose a role
-- and review immediately. Supabase anonymous auth remains an invisible row
-- identity for append-only history; it is not an approval gate.

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested_kind text := case
    when new.raw_user_meta_data ->> 'identity_kind' in ('management', 'honi', 'itzik') then 'management'
    when new.raw_user_meta_data ->> 'identity_kind' in ('content_editor', 'editor') then 'content_editor'
    else 'advisor'
  end;
begin
  insert into public.profiles (id, display_name, identity_kind, is_editor, approved)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Reviewer'), 80),
    requested_kind,
    requested_kind = 'content_editor',
    true
  )
  on conflict (id) do update
  set approved = true,
      updated_at = now();
  return new;
end;
$$;

-- Release profiles created by earlier versions of the link.
update public.profiles set approved = true, updated_at = now()
where approved = false;

-- The visible role picker is the source of attribution. Calling this on each
-- save also makes "Change identity" work in an existing browser session.
create or replace function public.set_reviewer_role(requested_kind text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  normalized_kind text := case
    when requested_kind in ('management', 'honi', 'itzik') then 'management'
    when requested_kind in ('content_editor', 'editor') then 'content_editor'
    when requested_kind = 'advisor' then 'advisor'
    else null
  end;
begin
  if auth.uid() is null then
    raise exception 'An authenticated reviewer is required';
  end if;
  if normalized_kind is null then
    raise exception 'Unknown reviewer role' using errcode = '23514';
  end if;

  update public.profiles
  set identity_kind = normalized_kind,
      is_editor = normalized_kind = 'content_editor',
      approved = true,
      updated_at = now()
  where id = auth.uid();
  if not found then
    raise exception 'Profile not found for authenticated user';
  end if;
  return normalized_kind;
end;
$$;
revoke all on function public.set_reviewer_role(text) from public;
grant execute on function public.set_reviewer_role(text) to authenticated;

create or replace function public.force_review_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  profile_record record;
begin
  if auth.uid() is null then
    raise exception 'An authenticated reviewer is required';
  end if;

  select id, identity_kind into profile_record
  from public.profiles
  where id = auth.uid();
  if not found then
    raise exception 'Profile not found for authenticated user';
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

drop policy if exists "reviews: authenticated reviewer inserts own review" on public.reviews;
drop policy if exists "reviews: open link inserts own review" on public.reviews;
create policy "reviews: open link inserts own review"
on public.reviews for insert to authenticated
with check (
  reviewer_id = auth.uid()
  and exists (
    select 1 from public.concepts c
    where c.id = reviews.concept_id and c.publication_status = 'published'
  )
);

-- Upload/admin access remains scoped by the selected content-editor role.
-- Because the link is intentionally open, selecting that role is sufficient.
comment on function public.is_approved_editor() is
  'True for a visitor who selected content_editor; used to scope upload/admin operations by role.';
