-- ============================================================================
--  Did the defect-list migrations actually take?  — paste the whole thing into
--  Supabase -> SQL Editor -> Run.  Read-only: it changes nothing.
--  Five rows come back. Every one should say OK.
-- ============================================================================

select '1. lists table'  as check,
       case when to_regclass('public.dm_defect_lists') is not null
            then 'OK' else 'MISSING — run 2026-09-30_defect_lists.sql' end as result

union all
select '2. items table',
       case when to_regclass('public.dm_defect_list_items') is not null
            then 'OK' else 'MISSING — run 2026-09-30_defect_lists.sql' end

union all
select '3. location column',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public'
                            and table_name  = 'dm_defect_list_items'
                            and column_name = 'location')
            then 'OK — rooms will carry across'
            else 'MISSING — run 2026-10-15_defect_list_locations.sql' end

union all
-- THE ONE THAT USUALLY BITES. The grant in 2026-09-02 quietly updates zero
-- rows if the profile row did not exist yet, which looks identical to success
-- from the SQL editor. Without this flag the Defect lists screen stays
-- read-only and the export button never appears.
select '4. you can edit',
       coalesce((select 'OK — ' || u.email
                   from public.profiles p
                   join auth.users u on u.id = p.id
                  where p.is_wordings_admin
                  limit 1),
                'NOBODY HAS THE ADMIN FLAG — see the fix below')

union all
select '5. seeded list',
       coalesce((select 'OK — ' || l.name || ', ' || count(i.id) || ' items'
                   from public.dm_defect_lists l
                   left join public.dm_defect_list_items i
                          on i.list_id = l.id and i.active
                  where l.active
                  group by l.id, l.name
                  order by l.sort_n
                  limit 1),
                'no lists yet — not fatal, you can create one in the app');

-- ----------------------------------------------------------------------------
--  FIX FOR 4, if it came back "NOBODY HAS THE ADMIN FLAG".
--  Sign in on the phone at least once first — the profile row is created on
--  first sign-in, and this updates nothing until it exists.
--  Uncomment, check the address, run it, then re-run the check above.
-- ----------------------------------------------------------------------------
-- update public.profiles p
--    set is_wordings_admin = true
--   from auth.users u
--  where u.id = p.id
--    and lower(u.email) = lower('svladimiroski@hotmail.com');
