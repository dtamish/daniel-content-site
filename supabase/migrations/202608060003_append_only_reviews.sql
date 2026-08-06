-- Review decisions are an auditable history: no reviewer can overwrite or erase a past mark.
-- A changed decision is represented by a new row; the UI may show the current (latest) decision plus history.

drop policy if exists "reviews: authenticated reviewer updates own review" on public.reviews;

create or replace function public.reject_review_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Review history is append-only';
end;
$$;

revoke all on function public.reject_review_mutation() from public;

create or replace function public.stamp_review_creation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.created_at := clock_timestamp();
  new.updated_at := new.created_at;
  return new;
end;
$$;

revoke all on function public.stamp_review_creation() from public;

create trigger reviews_stamp_creation
before insert on public.reviews
for each row execute function public.stamp_review_creation();

create trigger reviews_prevent_update
before update on public.reviews
for each row execute function public.reject_review_mutation();

create trigger reviews_prevent_delete
before delete on public.reviews
for each row execute function public.reject_review_mutation();

comment on table public.reviews is
  'Append-only review history. Current decision is the most recent row per reviewer; every historical decision remains visible on published concepts.';
