-- Three explicit roles and three explicit decisions.
-- Review rows stay append-only: editing a comment creates a newer row and preserves history.

alter table public.profiles drop constraint if exists profiles_identity_kind_check;
update public.profiles
set identity_kind = case
  when identity_kind in ('content_editor', 'editor') then 'content_editor'
  when identity_kind in ('management', 'honi', 'itzik') then 'management'
  else 'advisor'
end;
alter table public.profiles add constraint profiles_identity_kind_check
  check (identity_kind in ('management', 'content_editor', 'advisor'));

alter table public.reviews drop constraint if exists reviews_decision_check;
alter table public.reviews add constraint reviews_decision_check
  check (decision in ('priority-approved', 'schedule-approved', 'canceled', 'wait'));

-- Keep old "wait" rows as honest history, but reject it for every new decision.
create or replace function public.reject_legacy_wait_decision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.decision = 'wait' then
    raise exception 'wait is a legacy decision and cannot be submitted'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists reviews_reject_legacy_wait on public.reviews;
create trigger reviews_reject_legacy_wait
  before insert on public.reviews
  for each row execute function public.reject_legacy_wait_decision();

create or replace function public.is_approved_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and identity_kind = 'content_editor'
      and approved = true
  );
$$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested_kind text := case
    when new.raw_user_meta_data ->> 'identity_kind' in ('management', 'honi', 'itzik') then 'management'
    when new.raw_user_meta_data ->> 'identity_kind' in ('content_editor', 'editor') then 'content_editor'
    else 'advisor'
  end;
begin
  insert into public.profiles (id, display_name, identity_kind, is_editor)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Reviewer'), 80),
    requested_kind,
    requested_kind = 'content_editor'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on table public.reviews is
  'Append-only decision and comment history. A revised own comment is a new row with the same decision.';