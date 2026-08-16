-- Values Arena is a series, not a digital film.
-- The guarded update is safe on initial setup and on reruns.
update public.concepts
set category = 'series'
where title = 'Values Arena'
  and category = 'digital';
