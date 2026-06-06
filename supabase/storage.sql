-- ============================================================================
--  DefFixer — Defect photo storage (run ONCE in Supabase SQL Editor)
-- ----------------------------------------------------------------------------
--  Creates a private 'defect-photos' bucket and access policies so each
--  workspace can only read/write its own photos.
--
--  Path convention used by the app:  <workspace_id>/<defect_id>/<file>.jpg
--  The first folder in the path is the workspace id, which the policies below
--  check against workspace membership (public.is_workspace_member).
--
--  HOW TO RUN:  Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--  Safe to re-run.
-- ============================================================================

-- 1. The bucket (private; max 1 file size guard is enforced client-side at 500KB)
insert into storage.buckets (id, name, public)
values ('defect-photos', 'defect-photos', false)
on conflict (id) do nothing;

-- 2. Access policies on storage.objects, scoped to workspace membership.
drop policy if exists "dm_photos_read"   on storage.objects;
drop policy if exists "dm_photos_insert" on storage.objects;
drop policy if exists "dm_photos_delete" on storage.objects;

create policy "dm_photos_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'defect-photos'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

create policy "dm_photos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'defect-photos'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

create policy "dm_photos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'defect-photos'
    and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================================
--  DONE. Photos now upload/compress/delete from the app.
--
--  Auto-delete rules:
--   - 50-day expiry + completed/deleted cleanup run from the app (on login and
--     after each change). For a fully server-side 50-day sweep you can also add
--     a pg_cron job later; the app-side sweep is sufficient for normal use.
-- ============================================================================
