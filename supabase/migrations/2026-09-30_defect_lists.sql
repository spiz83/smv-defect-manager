-- ============================================================================
--  Defect lists  —  2026-09-30
-- ----------------------------------------------------------------------------
--  WHY (Spiro, 2026-09-30): "Create defect lists for inspections anticipating
--  that I will need to get filled out, to save a heap of the filling out… there
--  are certain things that will appear on every single report so rather than
--  entering it in you're pretty much taking photos and matching the photos to
--  that item." Plus: "the ability to also create pre loaded defect lists, edit
--  and add and remove items… like be able to create a bank of them."
--
--  So: a named list of defect items, imported onto a job in one go. The
--  supervisor then walks the house photographing against rows that are already
--  there, instead of typing the same twenty items on every inspection.
--
--  BUILT ON THE WORDINGS BANK, NOT BESIDE IT. The 62 curated wordings in
--  dm_defect_wordings are already the house vocabulary; a list is a saved
--  SELECTION of that kind of item. Items carry their own text rather than a
--  foreign key to a wording, on purpose: editing a wording later must not
--  silently rewrite every list that used it, and a list needs to be able to
--  hold a one-off line that was never a wording.
--
--  SAME ADMIN AS WORDINGS, deliberately. profiles.is_wordings_admin already
--  means "may edit the shared defect content", and it is the same person doing
--  the same job. A second flag would be a second thing to grant, a second thing
--  to forget, and a second thing to get out of step.
--
--  SAFE TO RUN ANY TIME. It only CREATEs and INSERTs into its own new tables.
--  It alters nothing existing, drops no policy, and touches nothing CH Tracker
--  reads. Re-running is a no-op — the seed is guarded on the list name.
--
--  REQUIRES 2026-09-02_defect_wordings_admin.sql to have been run first (for
--  profiles.is_wordings_admin). The preflight below says so rather than
--  creating policies that reference a column that isn't there.
--
--  HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================================

do $$
begin
    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_wordings_admin'
    ) then
        raise exception 'profiles.is_wordings_admin not found — run 2026-09-02_defect_wordings_admin.sql first; this migration reuses that same admin flag.';
    end if;
end $$;

-- ----------------------------------------------------------------------------
--  The lists
-- ----------------------------------------------------------------------------
create table if not exists public.dm_defect_lists (
    id          uuid primary key default gen_random_uuid(),
    name        text        not null,
    sort_n      integer     not null default 1,
    active      boolean     not null default true,
    updated_at  timestamptz not null default now(),
    updated_by  uuid        references auth.users (id)
);

comment on table public.dm_defect_lists is
    'Named, pre-loaded defect lists ("Standard PCI"). Imported onto a job to create its items as defects in one go. Editable from Settings -> Defect lists by profiles.is_wordings_admin only.';
comment on column public.dm_defect_lists.active is
    'Soft delete, same as dm_defect_wordings — a list deleted by mistake can be brought back.';

-- ----------------------------------------------------------------------------
--  The items in them
-- ----------------------------------------------------------------------------
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

comment on column public.dm_defect_list_items.trade is
    'MUST match a contractor / trade-placeholder name EXACTLY ("Carpenter", not "Carpentry"), same rule as dm_defect_wordings.trade — an imported item files against this, and a name that matches nothing lands unassigned.';
comment on column public.dm_defect_list_items.text is
    'The defect wording itself, copied rather than referenced: editing a wording in dm_defect_wordings must not silently rewrite lists built earlier.';

create index if not exists dm_defect_list_items_list_idx
    on public.dm_defect_list_items (list_id, sort_n)
    where active;

alter table public.dm_defect_lists      enable row level security;
alter table public.dm_defect_list_items enable row level security;

-- ----------------------------------------------------------------------------
--  Policies — read for everyone signed in, write for the content admin only.
--  Mirrors dm_defect_wordings exactly.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
--  Seed: one starter list, from wordings that already exist in the bank.
-- ----------------------------------------------------------------------------
--  These are the items Spiro named as appearing on every report — mortar
--  smears, blowouts, caulking, painter overspray — plus the rest of the
--  walk-through regulars. Deliberately the EXISTING curated wordings rather
--  than new prose, so a list reads the same as a typed defect does.
--
--  Guarded on the name: re-running adds nothing, and an edited copy is never
--  overwritten.
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
        (v_list, 'Clean brick smears.',                                          'Brick Cleaner', 10),
        (v_list, 'Clean out weepholes.',                                         'Brick Cleaner', 20),
        (v_list, 'Repair brickwork blow outs.',                                  'Bricklayer',    30),
        (v_list, 'Complete outstanding caulking.',                               'Caulker',       40),
        (v_list, 'Caulk gaps to window, top and bottom.',                        'Caulker',       50),
        (v_list, 'Seal service penetrations.',                                   'Caulker',       60),
        (v_list, 'Clean overpaint from hinges and striker plates.',              'Painter',       70),
        (v_list, 'Clean overpaint from window frames.',                          'Painter',       80),
        (v_list, 'Clean overpaint from splashback tiles.',                       'Painter',       90),
        (v_list, 'Adjust door margins to 3mm-4mm.',                              'Carpenter',    100),
        (v_list, 'Adjust striker plate to remove latch binding.',                'Carpenter',    110),
        (v_list, 'Install cushion stop to door.',                                'Carpenter',    120),
        (v_list, 'Install downpipe brackets correctly.',                         'Plumber',      130),
        (v_list, 'Punch in downpipe pins.',                                      'Plumber',      140),
        (v_list, 'Clean carpet.',                                                'Cleaner',      150),
        (v_list, 'Sweep out garage and remove building materials.',              'Cleaner',      160),
        (v_list, 'Repair dented window frame.',                                  'Supervisor',   170),
        (v_list, 'Touch up window frame with correct paint colour.',             'Supervisor',   180);
end $$;

-- ----------------------------------------------------------------------------
--  Verify (expect: one list, 18 items, and four policies).
-- ----------------------------------------------------------------------------
-- select l.name, count(i.*) as items
--   from public.dm_defect_lists l
--   left join public.dm_defect_list_items i on i.list_id = l.id and i.active
--  where l.active group by l.name;
-- select tablename, policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename in ('dm_defect_lists', 'dm_defect_list_items')
--  order by tablename, policyname;
