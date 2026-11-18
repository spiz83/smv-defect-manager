-- Why one photo is refused while the job IS readable.
--
-- The app reported, for Lot 5, 22 Skylark Rd:
--   POLICY — the job is yours but the photo bucket refused it
--
-- Meaning: `select` on that job succeeds, and `insert` into storage.objects
-- for the path <job uuid>/<defect uuid>/<file>.jpg does not. So the bucket's
-- write policy and the job's read policy disagree, and only the first query
-- below can say how.
--
-- Nothing here changes anything. Run it and send back both results.

-- 1. Every policy on the photo bucket, with its actual condition.
select policyname,
       cmd,
       roles,
       qual        as using_condition,
       with_check  as insert_condition
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
 order by policyname;

-- 2. The repo's own storage.sql checks is_workspace_member(<first folder>),
--    and the first folder the app writes is a JOB uuid, not a workspace id.
--    If that is still the live policy, this returns false for every job and
--    no defect photo can ever be written — which would match exactly one
--    photo failing here only because the rest were on a temp job, and temp
--    jobs got their own policy when 2026-09-04_temp_jobs.sql ran today.
--
--    Replace the uuid below with the job id the app reported if you have it;
--    otherwise this takes any job you can see.
select j.id                                   as job_id,
       public.is_workspace_member(j.id)       as passes_storage_sql_policy
  from public.jobs j
 limit 5;
