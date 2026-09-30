-- ============================================================================
--  READ-ONLY INSPECTION  —  what actually guards dm_defects today
-- ----------------------------------------------------------------------------
--  NOT A MIGRATION. It is deliberately not in supabase/migrations/ so nobody
--  runs it as one. Every statement is a SELECT; it changes nothing.
--
--  WHY THIS EXISTS: supabase/schema.sql in this repo is STALE. It describes a
--  workspace_id / is_workspace_member() model, but the live dm_defects is keyed
--  on job_id (see cloud-sync.js ~line 1369, which pushes job_id, and its
--  comment about "the job_id-based RLS check"), and the tracker has since added
--  migrations 120-124 that this repo has no copy of. Writing an RLS change from
--  the repo snapshot would be writing it against a database that no longer
--  exists.
--
--  RUN THIS FIRST, then paste the output back, and the accompanying
--  2026-09-19_defect_job_scoping.sql can be confirmed (or corrected) against
--  what is really there rather than what we think is there.
--
--  Dashboard -> SQL Editor -> paste -> Run.
-- ============================================================================

-- 1. Every policy currently on the two tables. THIS IS THE IMPORTANT ONE.
--    Expect to see the USING(true) ones. Note their names and whether any are
--    already RESTRICTIVE (permissive = 'RESTRICTIVE').
select tablename, policyname, permissive, roles, cmd,
       qual        as using_expr,
       with_check  as check_expr
  from pg_policies
 where schemaname = 'public'
   and tablename in ('dm_defects', 'dm_defect_photos')
 order by tablename, permissive, policyname;

-- 2. Is RLS actually enabled (and forced) on them? A policy on a table with
--    RLS disabled protects nothing.
select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('dm_defects', 'dm_defect_photos');

-- 3. Real columns, so the policy references ones that exist. Specifically:
--    does dm_defects have job_id, and does dm_defect_photos have defect_id?
select table_name, column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('dm_defects', 'dm_defect_photos')
 order by table_name, ordinal_position;

-- 4. Do the helper functions the new policy leans on exist, and with what
--    signature? is_assigned_to_job is referenced by the defect-photos bucket
--    RLS (per cloud-sync.js ~line 1920); is_cert_team came in with 120/121.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_function_result(p.oid)             as returns,
       p.prosecdef                               as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('is_assigned_to_job', 'is_cert_team', 'is_workspace_member',
                     'is_manager', 'dm_can_see_job')
 order by p.proname;

-- 5. How is "manager" actually represented? This repo's own
--    2026-08-15_defect_wordings.sql gates on profiles.role = 'manager'; the
--    briefing adds a third role, 'certs'. Confirm the spelling and the spread
--    before a policy depends on it. (Counts only — no emails, no user ids.)
select role, count(*) as users
  from public.profiles
 group by role
 order by users desc;

-- 6. Sanity check on scale: how many defects would the new policy have to let
--    through, and how many rows have no job at all? A defect with job_id null
--    becomes invisible to everyone but a manager/cert under the new rule —
--    worth knowing the number BEFORE, not after.
select count(*)                                            as defects_total,
       count(*) filter (where job_id is null)              as defects_with_no_job,
       count(distinct job_id)                              as distinct_jobs
  from public.dm_defects;

-- 7. Same question for photo metadata rows whose parent defect is missing.
select count(*) as photo_rows_total,
       count(*) filter (
         where not exists (select 1 from public.dm_defects d where d.id = p.defect_id)
       ) as orphan_photo_rows
  from public.dm_defect_photos p;

-- 8. Who else reads dm_defects? Views owned by the tracker that select from it
--    would inherit this restriction (or bypass it, if they are SECURITY
--    DEFINER / not security_invoker). This is the "will I break CH Tracker"
--    question.
select c.relname as view_name,
       c.relkind,
       c.reloptions   as view_options,   -- look for security_invoker=true
       pg_get_userbyid(c.relowner) as owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind in ('v', 'm')
   and pg_get_viewdef(c.oid) ilike '%dm_defect%'
 order by c.relname;

-- 9. And the view the My Jobs list depends on — is it security_invoker? That
--    decides whether it re-applies the caller's RLS or runs as its owner.
select c.relname, c.reloptions, pg_get_userbyid(c.relowner) as owner
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'v_jobs_with_current_supervisor';
