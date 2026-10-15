-- ============================================================================
--  ONE PASTE TO MAKE DEFECT LISTS WORK  —  2026-10-15
-- ----------------------------------------------------------------------------
--  WHY THIS EXISTS. The app reported, in its own words:
--
--      "Could not find the table 'public.dm_defect_lists' in the schema cache"
--
--  So 2026-09-30_defect_lists.sql did not complete. Almost certainly because
--  it opens with a preflight that RAISES when profiles.is_wordings_admin is
--  missing — and a raised exception rolls the whole file back, creating
--  nothing. The SQL editor shows one red line; it does not say "and therefore
--  none of the 120 lines below ran".
--
--  Rather than three files in the right order, this is all of it, in order,
--  in one paste. EVERY STATEMENT IS IDEMPOTENT: re-running changes nothing,
--  the Standard PCI seed is guarded on its name, and an edited list is never
--  overwritten. Safe to run whether you did none, some or all of them.
--
--  Nothing here is altered or dropped, and nothing CH Tracker reads is
--  touched — two new tables, one new column on each of profiles and
--  dm_defect_list_items, and policies on the new tables only.
--
--  HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste the whole file -> Run.
--  The last statement prints five rows. They should all say OK.
-- ============================================================================

-- ---- 1. the admin flag the lists policies hang off -------------------------
--  From 2026-09-02_defect_wordings_admin.sql. This is the one whose absence
--  aborted everything else.
alter table public.profiles
    add column if not exists is_wordings_admin boolean not null default false;

-- ---- 2. the lists --------------------------------------------------------
create table if not exists public.dm_defect_lists (
    id          uuid primary key default gen_random_uuid(),
    name        text        not null,
    sort_n      integer     not null default 1,
    active      boolean     not null default true,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users (id)
);

-- ---- 3. the items in them -------------------------------------------------
create table if not exists public.dm_defect_list_items (
    id          uuid primary key default gen_random_uuid(),
    list_id     uuid        not null references public.dm_defect_lists (id) on delete cascade,
    text        text        not null,
    trade       text        not null default 'Supervisor',
    sort_n      integer     not null default 1,
    active      boolean     not null default true,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users (id)
);

-- ---- 4. the room on an item (2026-10-15_defect_list_locations.sql) --------
--  Nullable. Blank on a generic template; set on a list exported from a real
--  job, so ten identical houses keep their rooms.
alter table public.dm_defect_list_items
    add column if not exists location text;

create index if not exists dm_defect_list_items_list_idx
    on public.dm_defect_list_items (list_id, sort_n)
    where active;

-- ---- 5. policies: read for anyone signed in, write for the admin only -----
alter table public.dm_defect_lists      enable row level security;
alter table public.dm_defect_list_items enable row level security;

drop policy if exists dm_defect_lists_read on public.dm_defect_lists;
create policy dm_defect_lists_read on public.dm_defect_lists
    for select to authenticated using (true);

drop policy if exists dm_defect_lists_write on public.dm_defect_lists;
create policy dm_defect_lists_write on public.dm_defect_lists
    for all to authenticated
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_wordings_admin))
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_wordings_admin));

drop policy if exists dm_defect_list_items_read on public.dm_defect_list_items;
create policy dm_defect_list_items_read on public.dm_defect_list_items
    for select to authenticated using (true);

drop policy if exists dm_defect_list_items_write on public.dm_defect_list_items;
create policy dm_defect_list_items_write on public.dm_defect_list_items
    for all to authenticated
    using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_wordings_admin))
    with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_wordings_admin));

-- ---- 6. make YOU the content admin ---------------------------------------
--  Matched against auth.users, where the address actually lives. If this
--  updates zero rows the profile does not exist yet — sign in on the phone
--  once and re-run. Row 4 of the check below is what tells you.
update public.profiles p
   set is_wordings_admin = true
  from auth.users u
 where u.id = p.id
   and lower(u.email) = lower('svladimiroski@hotmail.com');

-- ---- 7. the starter list, guarded on its name ----------------------------
do $$
declare
    v_list uuid;
begin
    if exists (select 1 from public.dm_defect_lists where name = 'Standard PCI') then
        return;
    end if;

    insert into public.dm_defect_lists (name, sort_n) values ('Standard PCI', 100)
    returning id into v_list;

    insert into public.dm_defect_list_items (list_id, text, trade, sort_n) values
        (v_list, 'Clean brick smears.',                             'Brick Cleaner', 10),
        (v_list, 'Clean out weepholes.',                            'Brick Cleaner', 20),
        (v_list, 'Repair brickwork blow outs.',                     'Bricklayer',    30),
        (v_list, 'Complete outstanding caulking.',                  'Caulker',       40),
        (v_list, 'Caulk gaps to window, top and bottom.',           'Caulker',       50),
        (v_list, 'Seal service penetrations.',                      'Caulker',       60),
        (v_list, 'Clean overpaint from hinges and striker plates.', 'Painter',       70),
        (v_list, 'Clean overpaint from window frames.',             'Painter',       80),
        (v_list, 'Clean overpaint from splashback tiles.',          'Painter',       90),
        (v_list, 'Adjust door margins to 3mm-4mm.',                 'Carpenter',    100),
        (v_list, 'Adjust striker plate to remove latch binding.',   'Carpenter',    110),
        (v_list, 'Install cushion stop to door.',                   'Carpenter',    120),
        (v_list, 'Install downpipe brackets correctly.',            'Plumber',      130),
        (v_list, 'Punch in downpipe pins.',                         'Plumber',      140),
        (v_list, 'Clean carpet.',                                   'Cleaner',      150),
        (v_list, 'Sweep out garage and remove building materials.', 'Cleaner',      160),
        (v_list, 'Repair dented window frame.',                     'Supervisor',   170),
        (v_list, 'Touch up window frame with correct paint colour.','Supervisor',   180);
end $$;

-- ---- 8. tell PostgREST the schema changed --------------------------------
--  The app's error named the SCHEMA CACHE. Supabase usually reloads it on its
--  own, but it is one line and it removes the doubt.
notify pgrst, 'reload schema';

-- ---- 9. check it took -----------------------------------------------------
select '1. lists table'  as check,
       case when to_regclass('public.dm_defect_lists') is not null then 'OK' else 'STILL MISSING' end as result
union all
select '2. items table',
       case when to_regclass('public.dm_defect_list_items') is not null then 'OK' else 'STILL MISSING' end
union all
select '3. location column',
       case when exists (select 1 from information_schema.columns
                          where table_schema='public' and table_name='dm_defect_list_items'
                            and column_name='location')
            then 'OK — rooms will carry across' else 'STILL MISSING' end
union all
select '4. you can edit',
       coalesce((select 'OK — ' || u.email from public.profiles p join auth.users u on u.id=p.id
                  where p.is_wordings_admin limit 1),
                'NOBODY HAS IT — sign in on the phone once, then re-run this file')
union all
select '5. seeded list',
       coalesce((select 'OK — ' || l.name || ', ' || count(i.id) || ' items'
                   from public.dm_defect_lists l
                   left join public.dm_defect_list_items i on i.list_id=l.id and i.active
                  where l.active group by l.id, l.name order by l.sort_n limit 1),
                'no lists yet');
