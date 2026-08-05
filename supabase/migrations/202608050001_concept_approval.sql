-- Concept approval application: schema, authorization, and private media policies.
-- Run as the postgres owner from the Supabase SQL editor or CLI migration flow.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  identity_kind text not null default 'reviewer'
    check (identity_kind in ('reviewer', 'honi', 'itzik', 'advisor', 'editor')),
  is_editor boolean not null default false,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 140),
  description text not null check (char_length(description) between 1 and 500),
  section text not null default 'queue' check (section in ('queue', 'library')),
  publication_status text not null default 'draft' check (publication_status in ('draft', 'published')),
  priority integer not null default 100 check (priority between 0 and 9999),
  banner_path text unique,
  pdf_path text unique,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (banner_path is null or banner_path ~ '^[0-9a-f-]{36}/banner\.png$'),
  check (pdf_path is null or pdf_path ~ '^[0-9a-f-]{36}/concept\.pdf$')
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.concepts(id) on delete cascade,
  reviewer_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  decision text not null check (decision in (
    'priority-approved', 'schedule-approved', 'wait', 'canceled'
  )),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index concepts_public_queue_idx
  on public.concepts (publication_status, section, priority, updated_at desc);
create index reviews_concept_reviewer_latest_idx
  on public.reviews (concept_id, reviewer_id, created_at desc);

create function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function public.is_approved_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_editor = true and approved = true
  );
$$;
revoke all on function public.is_approved_editor() from public;
grant execute on function public.is_approved_editor() to anon, authenticated;

create function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requested_kind text := coalesce(new.raw_user_meta_data ->> 'identity_kind', 'reviewer');
begin
  if requested_kind not in ('honi', 'itzik', 'advisor', 'editor') then
    requested_kind := 'reviewer';
  end if;
  insert into public.profiles (id, display_name, identity_kind)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'סוקר/ת'), 80),
    requested_kind
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create function public.force_review_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  profile_record record;
begin
  if auth.uid() is null then
    raise exception 'An authenticated reviewer is required';
  end if;

  -- Get the authenticated user's profile
  select id, display_name, approved into profile_record
  from public.profiles
  where id = auth.uid();

  -- Reject if profile doesn't exist
  if not found then
    raise exception 'Profile not found for authenticated user';
  end if;

  -- Reject if profile is not approved
  if not profile_record.approved then
    raise exception 'Profile must be approved to submit reviews';
  end if;

  -- Force reviewer_id from the authenticated profile. The visible reviewer name
  -- is joined from profiles on read; it is never a review field supplied by the client.
  new.reviewer_id := profile_record.id;

  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.force_review_identity() from public;

create trigger on_auth_user_created_concept_profiles
  after insert on auth.users for each row execute function public.handle_new_auth_user();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger concepts_set_updated_at before update on public.concepts
  for each row execute function public.set_updated_at();
create trigger reviews_set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();
create trigger reviews_force_authenticated_identity
  before insert or update on public.reviews
  for each row execute function public.force_review_identity();

alter table public.profiles enable row level security;
alter table public.concepts enable row level security;
alter table public.reviews enable row level security;

create policy "profiles: read self, published reviewers, or editor"
on public.profiles for select to anon, authenticated
using (
  id = auth.uid() or public.is_approved_editor() or exists (
    select 1 from public.reviews r
    join public.concepts c on c.id = r.concept_id
    where r.reviewer_id = profiles.id and c.publication_status = 'published'
  )
);

create policy "profiles: authenticated user creates own non-privileged profile"
on public.profiles for insert to authenticated
with check (id = auth.uid() and is_editor = false and approved = false);

create policy "profiles: reviewer updates own non-privileged profile"
on public.profiles for update to authenticated
using (id = auth.uid() and is_editor = false and approved = false)
with check (id = auth.uid() and is_editor = false and approved = false);

create policy "profiles: approved editors administer profiles"
on public.profiles for all to authenticated
using (public.is_approved_editor()) with check (public.is_approved_editor());

create policy "concepts: public reads published"
on public.concepts for select to anon, authenticated
using (publication_status = 'published' or public.is_approved_editor());
create policy "concepts: approved editors insert"
on public.concepts for insert to authenticated
with check (public.is_approved_editor() and created_by = auth.uid());
create policy "concepts: approved editors update"
on public.concepts for update to authenticated
using (public.is_approved_editor()) with check (public.is_approved_editor());
create policy "concepts: approved editors delete"
on public.concepts for delete to authenticated
using (public.is_approved_editor());

create policy "reviews: public reads reviews of published concepts"
on public.reviews for select to anon, authenticated
using (
  reviewer_id = auth.uid() or public.is_approved_editor() or exists (
    select 1 from public.concepts c
    where c.id = reviews.concept_id and c.publication_status = 'published'
  )
);
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
create policy "reviews: authenticated reviewer updates own review"
on public.reviews for update to authenticated
using (
  reviewer_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved = true
  )
)
with check (
  reviewer_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.approved = true
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('concept-banners', 'concept-banners', false, 5242880, array['image/png']),
  ('concept-pdfs', 'concept-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "concept media: public reads files linked to published concepts"
on storage.objects for select to anon, authenticated
using (
  (bucket_id = 'concept-banners' and exists (
    select 1 from public.concepts c
    where c.publication_status = 'published' and c.banner_path = name
  )) or (bucket_id = 'concept-pdfs' and exists (
    select 1 from public.concepts c
    where c.publication_status = 'published' and c.pdf_path = name
  )) or public.is_approved_editor()
);
create policy "concept media: approved editors upload"
on storage.objects for insert to authenticated
with check (bucket_id in ('concept-banners', 'concept-pdfs') and public.is_approved_editor());
create policy "concept media: approved editors update"
on storage.objects for update to authenticated
using (bucket_id in ('concept-banners', 'concept-pdfs') and public.is_approved_editor())
with check (bucket_id in ('concept-banners', 'concept-pdfs') and public.is_approved_editor());
create policy "concept media: approved editors delete"
on storage.objects for delete to authenticated
using (bucket_id in ('concept-banners', 'concept-pdfs') and public.is_approved_editor());

comment on table public.reviews is
  'Review history. reviewer_id is overwritten from auth.uid() by trigger.';
comment on function public.is_approved_editor() is
  'Server-side authorization; the client role picker never grants editor privileges.';
