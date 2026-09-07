-- Temp jobs that follow your login onto any device. (Spiro 2026-09-04)
--
-- Spiro: "when I log in using the same details I can't load up the temp job…
-- it's almost like it's just saved to my phone. I need to be able to use it on
-- my desktop — that temp job needs to be tied into my login."
--
-- ============================================================================
--   HOW TO RUN: paste this WHOLE file into the Supabase SQL editor
--   (project cubwwnvzmeydyixhetfb) and press Run. Nothing to fill in.
--   Then reopen the app on both devices.
--
--   Safe to run more than once: every step is guarded and nothing is dropped.
--
--   AFTERWARDS run the check at the bottom. It must print one row saying the
--   table is there and archiving is off.
-- ============================================================================
--
-- WHAT THIS IS, AND WHY IT IS NOT A CHANGE TO dm_defects
--
-- The obvious design is a temp defect in dm_defects with a null job_id. Three
-- things already true of that table make it the wrong place, and all three are
-- shared with CH Tracker, which is live:
--
--   1. Migration 072 deliberately opened dm_defects to `using (true)` after a
--      supervisor-scoping policy silently froze devices mid-push. Supervisor
--      isolation there is a UI concern by decision. A temp job is supposed to
--      be private to one person, so it cannot rely on that table's RLS, and
--      re-tightening the table to get it would risk repeating that incident.
--
--   2. Migration 105 added a UNIQUE index on
--      (job_id, description, contractor_id) NULLS NOT DISTINCT. Temp defects
--      have job_id NULL, so two separate maintenance calls that both say
--      "Reseal shower base" against the same plumber would collide — and
--      cloud-sync's 23505 handler ADOPTS the row it collided with, quietly
--      merging two unrelated jobs. Avoiding that means surgery on an index
--      that exists to stop a doubling bug that has already cost real data.
--
--   3. Migration 080 archives every deleted dm_defects row into
--      deleted_rows_archive. Spiro's requirement is the opposite: "I wouldn't
--      want it in the database once it's been deleted, it can be permanently
--      deleted." Meeting that would mean carving an exception into a safety
--      net that protects real defects.
--
-- So a temp job lives in its OWN table instead, holding its defects as JSON.
-- Nothing above is touched, the blast radius is this one table, and all three
-- properties come out right by construction: private by RLS, no shared unique
-- key to collide with, and no archive trigger, so a delete is a real delete.
--
-- The trade-off, stated plainly: two devices editing the SAME temp job at the
-- same time is last-write-wins on the whole job. That is the right shape for
-- what this is — one person, one maintenance call, a defect dump and a report.
-- ============================================================================

create table if not exists public.dm_temp_jobs (
    id          uuid        primary key default gen_random_uuid(),
    owner_id    uuid        not null references public.profiles (id) on delete cascade,
    -- The id the creating device generated, from the 1.5e9 band that cannot
    -- collide with a CH Tracker job's hashId. Keeps the job's local id stable
    -- across devices so defect ids, photos and reports line up.
    legacy_id   bigint      not null,
    name        text        not null,
    suburb      text,
    reference   text,
    -- The defects, exactly as the app holds them. Whole-job replace on write.
    defects     jsonb       not null default '[]'::jsonb,
    -- [{ defectId, path }] — storage paths under this job's own folder.
    photos      jsonb       not null default '[]'::jsonb,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (owner_id, legacy_id)
);

comment on table public.dm_temp_jobs is
    'One-off maintenance jobs raised in the Defect Manager. Private to owner_id, carries its own defects as JSON, and is HARD deleted — deliberately not in deleted_rows_archive. See 2026-09-04_temp_jobs.sql for why these are not rows in dm_defects.';

create index if not exists dm_temp_jobs_owner_idx on public.dm_temp_jobs (owner_id);

-- updated_at drives which side wins when the same job is edited on two devices.
create or replace function public.dm_temp_jobs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists dm_temp_jobs_touch_trg on public.dm_temp_jobs;
create trigger dm_temp_jobs_touch_trg before update on public.dm_temp_jobs
  for each row execute function public.dm_temp_jobs_touch();

-- ---------------------------------------------------------------------------
-- RLS: yours and nobody else's — including other managers.
--
-- This is the one place in this schema where a manager does NOT see everything,
-- and that is the point of the feature: Spiro asked for a job "only to be seen
-- by admin", and after moving it into the database that promise has to be a
-- policy rather than the fact that it never left the handset.
-- ---------------------------------------------------------------------------
alter table public.dm_temp_jobs enable row level security;

drop policy if exists dm_temp_jobs_rw on public.dm_temp_jobs;
create policy dm_temp_jobs_rw on public.dm_temp_jobs
  for all to authenticated
  using      (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- NO archive trigger, on purpose.
--
-- Migration 080 attaches archive_deleted_row() to a FIXED list of tables, so a
-- new table is not covered and there is nothing to undo. This drop is here so
-- that stays true if anyone ever adds one by hand or widens 080 later: a temp
-- job that survives its own deletion in the graveyard would break the promise
-- the feature is sold on.
-- ---------------------------------------------------------------------------
drop trigger if exists archive_deleted_row_trg on public.dm_temp_jobs;
drop trigger if exists dm_temp_jobs_archive_trg on public.dm_temp_jobs;

-- ---------------------------------------------------------------------------
-- Photos. They go in the SAME bucket as every other defect photo, under the
-- temp job's own uuid as the first folder — '<temp job id>/<defect id>/<file>'.
--
-- The existing bucket policies pass a manager for any path, so this already
-- worked for Spiro's account. It is added anyway so the permission comes from
-- OWNING the job rather than from happening to be a manager: the feature is
-- for one named person, and it should not quietly stop working the day that
-- person's role changes. Policies are OR'd, so this only ever grants.
--
-- id::text rather than a ::uuid cast on the path, because a folder name that
-- is not a uuid would make the cast throw rather than simply not match.
-- ---------------------------------------------------------------------------
drop policy if exists "dm_temp_photos_rw" on storage.objects;
create policy "dm_temp_photos_rw" on storage.objects
  for all to authenticated
  using (bucket_id = 'defect-photos' and exists (
           select 1 from public.dm_temp_jobs t
            where t.id::text = (storage.foldername(name))[1]
              and t.owner_id = auth.uid()))
  with check (bucket_id = 'defect-photos' and exists (
           select 1 from public.dm_temp_jobs t
            where t.id::text = (storage.foldername(name))[1]
              and t.owner_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- CHECK IT TOOK. One row, and every column must read true.
--
--   select
--     to_regclass('public.dm_temp_jobs') is not null                as table_there,
--     (select relrowsecurity from pg_class
--       where oid = 'public.dm_temp_jobs'::regclass)                as rls_on,
--     exists (select 1 from pg_policies
--              where tablename = 'dm_temp_jobs'
--                and policyname = 'dm_temp_jobs_rw')                as policy_there,
--     exists (select 1 from pg_policies
--              where schemaname = 'storage' and tablename = 'objects'
--                and policyname = 'dm_temp_photos_rw')              as storage_policy_there,
--     (select count(*) = 1 from pg_trigger
--       where tgrelid = 'public.dm_temp_jobs'::regclass
--         and not tgisinternal)                                     as only_the_touch_trigger;
--
-- only_the_touch_trigger is the one that matters for "permanently deleted":
-- the single expected trigger is dm_temp_jobs_touch_trg, which just stamps
-- updated_at. If that column is false, something is also firing on DELETE —
-- list them and check nothing writes to deleted_rows_archive:
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.dm_temp_jobs'::regclass and not tgisinternal;
--   -- expect exactly one row: dm_temp_jobs_touch_trg
--
-- TO REMOVE THE FEATURE ENTIRELY (this deletes every temp job for everyone):
--
--   drop policy if exists "dm_temp_photos_rw" on storage.objects;
--   drop table if exists public.dm_temp_jobs;
-- ---------------------------------------------------------------------------
