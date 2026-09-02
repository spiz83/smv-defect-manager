-- Defect wordings: the shared table, and ONE admin who may change it.
-- (Spiro 2026-09-02)
--
-- RUN THIS ONE FILE. It replaces 2026-08-15_defect_wordings.sql — everything
-- that file did is repeated here, guarded, so running this alone is enough
-- whether or not the older one was ever run. Nothing is dropped and no existing
-- wording is overwritten.
--
-- WHAT CHANGES FROM 2026-08-15: writes were open to every manager. Spiro asked
-- for "only admin email can do this", so writes now need an explicit flag on
-- the person's profile. The flag, not an email in the app's code, is what the
-- database enforces — an email hardcoded in index.html would be a value to keep
-- in step in two places, and index.html is public.
--
-- ============================================================================
--   STEP 1 of 2 — paste this whole file into the Supabase SQL editor
--                (project cubwwnvzmeydyixhetfb) and run it.
--   STEP 2 of 2 — run the GRANT at the very bottom with your own email in it.
--                Until you do, nobody can edit and the app says so on screen.
-- ============================================================================

create table if not exists public.dm_defect_wordings (
    id          uuid primary key default gen_random_uuid(),
    text        text        not null,
    trade       text        not null default 'Supervisor',
    sort_n      integer     not null default 1,
    active      boolean     not null default true,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users (id)
);

comment on table public.dm_defect_wordings is
    'Defect wordings suggested as a supervisor types, grouped by trade. Editable from the phone app (Settings -> Defect wordings) by profiles.is_wordings_admin only.';
comment on column public.dm_defect_wordings.trade is
    'MUST match a contractor / trade-placeholder name EXACTLY ("Carpenter", not "Carpentry") or the wording is unreachable when a supplier is picked. Unassigned wordings go to ''Supervisor''.';
comment on column public.dm_defect_wordings.sort_n is
    'Higher sorts first within a trade. Use for the wordings supervisors reach for most.';
comment on column public.dm_defect_wordings.active is
    'Soft delete. The app hides inactive rows; kept so a wording removed by mistake can be brought back.';

create index if not exists dm_defect_wordings_trade_idx
    on public.dm_defect_wordings (trade, sort_n desc)
    where active;

alter table public.dm_defect_wordings enable row level security;

-- ---------------------------------------------------------------------------
--  Who may edit: a flag on the profile, granted by hand below.
-- ---------------------------------------------------------------------------
-- A column rather than an email in a policy string, so access can be given or
-- taken away with one UPDATE and no deploy. Defaults to false, so adding it
-- takes nothing away from anyone by surprise — it locks editing down until the
-- grant at the bottom is run, which is the point.
alter table public.profiles
    add column if not exists is_wordings_admin boolean not null default false;

comment on column public.profiles.is_wordings_admin is
    'May edit the shared defect-wording list. One list feeds every supervisor''s suggestions, so one person''s edit changes what everyone sees.';

-- Everyone signed in READS the list (every supervisor needs the suggestions).
drop policy if exists dm_defect_wordings_read on public.dm_defect_wordings;
create policy dm_defect_wordings_read on public.dm_defect_wordings
    for select to authenticated
    using (true);

-- Only the flagged admin writes. This replaces the manager-wide policy.
drop policy if exists dm_defect_wordings_write on public.dm_defect_wordings;
create policy dm_defect_wordings_write on public.dm_defect_wordings
    for all to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_wordings_admin
    ))
    with check (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_wordings_admin
    ));

-- The app reads this flag to decide whether to show the edit controls. Reading
-- your OWN profile is what the existing role lookup already does; this only
-- matters if your profiles policies are stricter than that.

-- Seed with the reviewed list (Spiro, 2026-08-15). Guarded so re-running the
-- migration never duplicates the seed or overwrites later edits.
insert into public.dm_defect_wordings (text, trade, sort_n)
select v.text, v.trade, v.sort_n
from (values
    ('Seal external window architraves to comply with NCC energy efficiency requirements.', 'Painter'       , 1),
    ('Complete outstanding internal paint items.'              , 'Painter'       , 1),
    ('Complete outstanding external paint items.'              , 'Painter'       , 1),
    ('Paint raw timber inside striker plate.'                  , 'Painter'       , 1),
    ('Seal tops and bottoms of doors, including wet areas.'    , 'Painter'       , 1),
    ('Apply gloss to robe threshold.'                          , 'Painter'       , 1),
    ('Apply gloss where missed.'                               , 'Painter'       , 1),
    ('Clean overpaint from hinges and striker plates.'         , 'Painter'       , 1),
    ('Clean overpaint from splashback tiles.'                  , 'Painter'       , 1),
    ('Clean overpaint from window frames.'                     , 'Painter'       , 1),
    ('Clean overpaint from entry door glass.'                  , 'Painter'       , 1),
    ('Remove paint from garage floor.'                         , 'Painter'       , 1),
    ('Refit weather strips and seals to doors.'                , 'Painter'       , 1),
    ('Adjust striker plate to remove latch binding.'           , 'Carpenter'     , 1),
    ('Adjust door margins to 3mm-4mm.'                         , 'Carpenter'     , 1),
    ('Align door with jamb.'                                   , 'Carpenter'     , 1),
    ('Fit door handle and check for operation.'                , 'Carpenter'     , 1),
    ('Fit weather seal to door.'                               , 'Carpenter'     , 1),
    ('Install cushion stop to door.'                           , 'Carpenter'     , 1),
    ('Adjust and align cabinet doors.'                         , 'Carpenter'     , 1),
    ('Replace tarnished hinges.'                               , 'Carpenter'     , 1),
    ('Replace incorrect screws - sizes to be consistent throughout.', 'Carpenter'     , 1),
    ('Refit manhole cover.'                                    , 'Carpenter'     , 1),
    ('Knock down hinge pins.'                                  , 'Carpenter'     , 1),
    ('Caulk junction between brickwork and plaster to sides of garage door.', 'Caulker'       , 1),
    ('Caulk gaps between cladding and flashing.'               , 'Caulker'       , 1),
    ('Seal service penetrations.'                              , 'Caulker'       , 1),
    ('Caulk inside of sink.'                                   , 'Caulker'       , 1),
    ('Caulk gaps to window, top and bottom.'                   , 'Caulker'       , 1),
    ('Caulk top of tile to wall where tiling does not reach ceiling.', 'Caulker'       , 1),
    ('Complete outstanding caulking.'                          , 'Caulker'       , 1),
    ('Clean carpet.'                                           , 'Cleaner'       , 1),
    ('Clean flooring.'                                         , 'Cleaner'       , 1),
    ('Sweep out garage and remove building materials.'         , 'Cleaner'       , 1),
    ('Remove paint, plaster and mortar residue from garage.'   , 'Cleaner'       , 1),
    ('Clean brick smears.'                                     , 'Brick Cleaner' , 1),
    ('Clean out weepholes.'                                    , 'Brick Cleaner' , 1),
    ('Repair brickwork blow outs.'                             , 'Bricklayer'    , 1),
    ('Install downpipe level and seat in saddle.'              , 'Plumber'       , 1),
    ('Install downpipe brackets correctly.'                    , 'Plumber'       , 1),
    ('Punch in downpipe pins.'                                 , 'Plumber'       , 1),
    ('Connect downpipe hookup.'                                , 'Plumber'       , 1),
    ('Install plumbing fixture correctly.'                     , 'Plumber'       , 1),
    ('Tighten shower rail - no gaps to wall.'                  , 'Plumber'       , 1),
    ('Install mixer and cover plate level.'                    , 'Plumber'       , 1),
    ('Rectify water hammer.'                                   , 'Plumber'       , 1),
    ('Clear tile and debris from shower waste.'                , 'Plumber'       , 1),
    ('Install toilet level with wall.'                         , 'Plumber'       , 1),
    ('Seal plumbing penetrations in cabinetry.'                , 'Plumber'       , 1),
    ('Seal electrical penetrations in cabinetry.'              , 'Electrician'   , 1),
    ('Check run time switch is functional.'                    , 'Electrician'   , 1),
    ('Grout tiles to wall above shower.'                       , 'Tiler'         , 1),
    ('Rule a horizontal line through render where it breaches the DPC.', 'Renderer'      , 1),
    ('Clear bottom weep holes to comply with VBA Standards and Tolerances.', 'Renderer'      , 1),
    ('Regrade landscaping to fall away from the property.'     , 'Landscaper'    , 1),
    ('Compact landscaping correctly.'                          , 'Landscaper'    , 1),
    ('Repair damaged stormwater riser.'                        , 'Landscaper'    , 1),
    ('Clear debris and excess materials from nature strip.'    , 'Landscaper'    , 1),
    ('Seal hole in oven space to make vermin proof.'           , 'Supervisor'    , 1),
    ('Repair dented window frame.'                             , 'Supervisor'    , 1),
    ('Repair scratched window frame.'                          , 'Supervisor'    , 1),
    ('Touch up window frame with correct paint colour.'        , 'Supervisor'    , 1)
) as v(text, trade, sort_n)
where not exists (select 1 from public.dm_defect_wordings);

-- ============================================================================
--   STEP 2 — THE GRANT.  Put YOUR email between the quotes and run it.
--   Matching on auth.users means you type your own address and nothing is
--   guessed on your behalf. Case is ignored.
-- ============================================================================
--
--   update public.profiles p
--      set is_wordings_admin = true
--     from auth.users u
--    where u.id = p.id
--      and lower(u.email) = lower('YOUR-EMAIL-HERE');
--
-- Check it took — this should list you, and only you:
--
--   select u.email, p.is_wordings_admin
--     from public.profiles p join auth.users u on u.id = p.id
--    where p.is_wordings_admin;
--
-- To take it away later, set is_wordings_admin = false the same way.
