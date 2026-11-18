-- =====================================================================
--  Why one photo is refused while its job IS readable.
--  Lot 5, 22 Skylark Rd — the app reported:
--     POLICY — the job is yours but the photo bucket refused it
--
--  READ-ONLY. Nothing here changes anything.
--
--  RUN ONE BLOCK AT A TIME. The Supabase SQL editor shows only the LAST
--  result of a script and abandons the whole run on the first error, so
--  the previous version of this file threw away the answer it was asking
--  for. Select a block, run it, send the grid back, then do the next.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCK 1 — THE ONE THAT MATTERS. Every policy on the photo bucket, with
-- the condition it actually enforces. This is the question: the app can
-- read the job and cannot write its photo, so the bucket's write rule and
-- the job's read rule disagree, and this is the only thing that can say
-- how.
-- ---------------------------------------------------------------------
select policyname,
       cmd,
       roles,
       qual        as using_condition,
       with_check  as insert_condition
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
 order by policyname;


-- ---------------------------------------------------------------------
-- BLOCK 2 — run this one separately.
--
-- 2026-11-18: the previous version of this file CALLED
-- public.is_workspace_member(uuid) and the database answered:
--     ERROR 42883: function public.is_workspace_member(uuid) does not exist
--
-- That is an answer, not a failure. The repo's own supabase/storage.sql
-- builds all three defect-photos policies on that function. If those were
-- the live policies, every photo read and write in the app would fail
-- with that same error — not one photo. So the live bucket policies are
-- NOT the ones in storage.sql, and the file in the repo does not describe
-- what is running. Block 1 is what shows what IS.
--
-- This version asks whether the function exists instead of calling it, so
-- it cannot error whatever the answer is.
-- ---------------------------------------------------------------------
select to_regprocedure('public.is_workspace_member(uuid)') as fn_workspace_member,
       to_regprocedure('public.is_workspace_member(text)') as fn_workspace_member_text,
       (select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects') as storage_policies,
       (select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and (coalesce(qual, '') || coalesce(with_check, '')) ilike '%defect-photos%')
         as defect_photo_policies;
