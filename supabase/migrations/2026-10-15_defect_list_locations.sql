-- ============================================================================
--  Location on a defect-list item  —  2026-10-15
-- ----------------------------------------------------------------------------
--  WHY: 2026-09-30_defect_lists.sql deliberately left location OFF a list item,
--  on the reasoning that location changes per job and a default that is wrong
--  most of the time is worse than blank. That reasoning holds for a generic
--  template like "Standard PCI" and is wrong for the case Spiro raised on
--  2026-10-15:
--
--      "If you've got a group of 10 properties side by side, all the same
--       trades worked on them, you can anticipate that all of the defects are
--       going to be similar, so you can pretty much import for future homes."
--
--  Ten identical houses in a row are the opposite case. "Bedroom 2 door
--  binding" on lot 5 is "Bedroom 2 door binding" on lot 6, and throwing the
--  room away makes the template markedly less useful — the supervisor has to
--  re-pick 90 locations by hand.
--
--  So: nullable, because both kinds of list now exist in the same bank. A
--  generic template leaves it blank and behaves exactly as it does today; a
--  list exported from a real job carries the rooms across.
--
--  SAFE TO RUN ANY TIME. One ADD COLUMN IF NOT EXISTS on a table this app
--  owns. Nothing is altered, dropped, or backfilled, no policy changes, and
--  nothing CH Tracker reads is touched. Existing rows get NULL, which is the
--  behaviour they already have.
--
--  REQUIRES 2026-09-30_defect_lists.sql to have been run first.
--
--  HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================================

do $$
begin
    if to_regclass('public.dm_defect_list_items') is null then
        raise exception 'dm_defect_list_items does not exist — run 2026-09-30_defect_lists.sql first.';
    end if;
end $$;

alter table public.dm_defect_list_items
    add column if not exists location text;

comment on column public.dm_defect_list_items.location is
    'Room/area for this item, or NULL. Set when a list is exported from a real job (identical houses repeat their rooms); left NULL on a generic template, where a presumed room would be wrong more often than right. Matched against DEFECT_LOCATIONS in index.html, but free text is accepted — the review screen keeps an unrecognised value rather than dropping it.';

-- ----------------------------------------------------------------------------
--  Verify (expect one row, data_type text, is_nullable YES).
-- ----------------------------------------------------------------------------
-- select column_name, data_type, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'dm_defect_list_items'
--    and column_name = 'location';
