-- ============================================================================
--  Job-level scoping for dm_defects / dm_defect_photos  —  2026-09-19
-- ----------------------------------------------------------------------------
--  ⚠️  THIS CHANGES WHAT PEOPLE CAN SEE. Read the whole header before running.
--
--  WHY: both tables are USING(true) for all authenticated users, so every
--  logged-in user can read every defect and every photo row across every
--  supervisor and every job. That is not a break-in — it is the app working as
--  configured for anyone with an account — and it contradicts the job-level
--  isolation the tracker introduced in 120/121 for
--  v_jobs_with_current_supervisor.
--
--  This brings the two tables in line with that same rule:
--      manager  OR  cert team  OR  the supervisor assigned to the job.
--
--  ---------------------------------------------------------------------------
--  RESTRICTIVE, NOT A REPLACEMENT — and that is the whole safety story
--  ---------------------------------------------------------------------------
--  It would be normal to DROP the USING(true) policies and write new ones. That
--  needs their exact names, and this repo cannot see the live database: its
--  schema.sql still describes a workspace_id model the live tables no longer
--  use, and migrations 120-124 were applied from the tracker side and exist
--  nowhere here.
--
--  So instead these are RESTRICTIVE policies, which PostgreSQL ANDs with
--  whatever is already there:  permissive(true) AND restrictive(job check)
--  collapses to exactly the job check. Nothing existing is dropped, renamed or
--  depended upon, so this cannot clash with a policy this file has never seen.
--
--  Rollback is therefore total, instant, and needs no backup:
--      drop policy if exists dm_defects_job_scope       on public.dm_defects;
--      drop policy if exists dm_defect_photos_job_scope on public.dm_defect_photos;
--
--  ---------------------------------------------------------------------------
--  BEFORE YOU RUN IT
--  ---------------------------------------------------------------------------
--  1. Run supabase/inspect_defect_rls.sql first. Query 6 is the one that
--     matters: it counts defects with job_id IS NULL. Under this rule those
--     stay visible to managers and the cert team but become invisible to
--     supervisors, because there is no job to be assigned to. If that count is
--     anything but ~0, fix the data before running this, not after.
--  2. Query 8 lists any view that selects from dm_defects. A tracker view that
--     is security_invoker=true inherits this restriction — which is the point,
--     but the tracker side should know.
--  3. Run it when someone can watch and roll back, not at 6am before site.
--     service_role bypasses RLS entirely, so server-side tracker jobs are
--     unaffected either way.
--
--  The preflight below RAISEs rather than half-applying: the SQL editor wraps
--  this in a transaction, so a failed check leaves the database untouched.
--
--  HOW TO RUN: Supabase Dashboard -> SQL Editor -> paste -> Run.
--  Idempotent — re-running replaces the two policies with themselves.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Preflight: every assumption this file makes, checked out loud.
-- ----------------------------------------------------------------------------
do $$
begin
    if to_regclass('public.dm_defects') is null then
        raise exception 'dm_defects does not exist — wrong database?';
    end if;

    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'dm_defects' and column_name = 'job_id'
    ) then
        raise exception 'dm_defects has no job_id column. The live shape is not what this migration assumes — run supabase/inspect_defect_rls.sql and re-check.';
    end if;

    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'dm_defect_photos' and column_name = 'defect_id'
    ) then
        raise exception 'dm_defect_photos has no defect_id column. Run supabase/inspect_defect_rls.sql and re-check.';
    end if;

    if not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_assigned_to_job'
    ) then
        raise exception 'public.is_assigned_to_job() not found. It is what the defect-photos bucket RLS uses; if it has been renamed, update dm_can_see_job below to match.';
    end if;

    if not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_cert_team'
    ) then
        raise exception 'public.is_cert_team() not found — expected from tracker migration 120/121. Has it been applied to THIS database?';
    end if;

    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
    ) then
        raise exception 'profiles.role not found — the manager check has moved. See 2026-08-15_defect_wordings.sql, which gates on it.';
    end if;
end $$;

-- ----------------------------------------------------------------------------
--  The rule, in one place.
-- ----------------------------------------------------------------------------
--  Deliberately the same three-way test as tracker migration 120 so the two
--  cannot drift: manager, cert team, or assigned to that job.
--
--  SECURITY DEFINER so it can read profiles without tripping profiles' own
--  RLS (profiles_self restricts a user to their OWN row, which is exactly the
--  row being checked here — but a definer function keeps that true even if
--  that policy is tightened later).
--
--  A NULL job_id stays visible to managers and the cert team and to nobody
--  else: there is no job to be assigned to, so there is no supervisor it could
--  belong to. See the note about query 6 in the header.
create or replace function public.dm_can_see_job(p_job uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'manager')
        or public.is_cert_team()
        or (p_job is not null and public.is_assigned_to_job(p_job));
$$;

-- Photos hang off a defect, so they inherit that defect's job.
-- SECURITY DEFINER so the lookup doesn't re-enter dm_defects' own RLS on every
-- photo row — same answer, one evaluation instead of two.
create or replace function public.dm_can_see_defect(p_defect uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.dm_defects d
         where d.id = p_defect and public.dm_can_see_job(d.job_id)
    );
$$;

grant execute on function public.dm_can_see_job(uuid)    to authenticated;
grant execute on function public.dm_can_see_defect(uuid) to authenticated;

-- ----------------------------------------------------------------------------
--  The policies.
-- ----------------------------------------------------------------------------
--  TO authenticated only: anon holds no grant anywhere since tracker migration
--  123, and service_role bypasses RLS altogether, so naming the role keeps the
--  blast radius exactly where it is meant to be.
--
--  WITH CHECK mirrors USING so a user cannot write a row into a job they
--  cannot see. cloud-sync.js already skips pushing defects whose job didn't
--  map, noting they "would fail the job_id-based RLS check anyway" — this makes
--  that comment true for reads as well as writes.
drop policy if exists dm_defects_job_scope on public.dm_defects;
create policy dm_defects_job_scope on public.dm_defects
    as restrictive
    for all
    to authenticated
    using (public.dm_can_see_job(job_id))
    with check (public.dm_can_see_job(job_id));

drop policy if exists dm_defect_photos_job_scope on public.dm_defect_photos;
create policy dm_defect_photos_job_scope on public.dm_defect_photos
    as restrictive
    for all
    to authenticated
    using (public.dm_can_see_defect(defect_id))
    with check (public.dm_can_see_defect(defect_id));

-- ----------------------------------------------------------------------------
--  Verify (run as a SUPERVISOR, not as the service role — the SQL editor runs
--  as a superuser that bypasses RLS, so a count there proves nothing).
-- ----------------------------------------------------------------------------
--  The honest check is from the app: sign in as one supervisor, confirm their
--  own jobs' defects and photos are all still there, then confirm a defect on
--  another supervisor's job is not. Query 1 of inspect_defect_rls.sql should
--  now show the two policies above with permissive = 'RESTRICTIVE'.
--
--  The photo FILES were already job-scoped by the defect-photos bucket policy
--  (is_assigned_to_job on the first path segment); this closes the metadata
--  rows that sat beside them.
