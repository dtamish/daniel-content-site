-- Let a concept point at a title-free banner.
--
-- Every banner in the catalogue was rasterised from its concept document's hero band, so
-- the title is painted into the picture and the card had to print the same title again
-- underneath. The room removes that duplicate by painting the title over a banner that has
-- none — but it has to be able to tell the two kinds of banner apart, and the only thing it
-- reads about a banner is its storage object name.
--
-- `<uuid>/banner-artwork.png` is that name. It is a second object beside the delivered
-- `<uuid>/banner.png`, never a replacement for it, so pointing a concept back at its
-- original banner stays a single-column update and the delivered asset is never destroyed.
--
-- Nothing else changes: the shape stays one 36-character folder and one PNG, the storage
-- policies keep publishing exactly `concepts.banner_path`, and a catalogue that has not run
-- this migration keeps working — its banners simply keep their painted titles, and the room
-- keeps showing the heading below the picture.

alter table public.concepts drop constraint if exists concepts_banner_path_check;

alter table public.concepts add constraint concepts_banner_path_check
  check (banner_path is null or banner_path ~ '^[0-9a-f-]{36}/banner(-artwork)?\.png$');

comment on column public.concepts.banner_path is
  'Storage object in concept-banners. A name ending in banner-artwork.png is title-free: '
  'the room paints the concept title over it. Any other name still has its title painted in.';
