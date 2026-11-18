# One photo the storage bucket refuses — a self-contained brief

Written 2026-11-18 to be carried into a fresh session. Everything needed is
here; nothing depends on an earlier conversation.

## The app

**EZ Defect Manager** (`spiz83/smv-defect-manager`) — an offline-first PWA used
by Creation Homes site supervisors. No build step: `index.html`, `cloud-sync.js`,
`sw.js`. Backend is **Supabase, shared with a second product, CH Tracker**.
Photos go in a private Storage bucket, `defect-photos`.

## The symptom

One photo, on **Lot 5, 22 Skylark Rd**, will not leave the phone. The app's own
photo diagnostic reports:

```
POLICY — the job is yours but the photo bucket refused it
```

That string is not a guess. `cloud-sync.js` classifies it (around line 2262):
when `storage.upload()` comes back with *row-level security / not authorized /
permission denied*, the app asks one follow-up question —
`select id from jobs where id = <job uuid>` — and reports:

- **ACCESS** if that select returns nothing → the login has lost the job.
- **POLICY** if that select SUCCEEDS → the job is readable and the bucket still
  refused the write. **This is the case we have.**

So the job's read policy and the bucket's write policy disagree, and the
disagreement is in the database, not in the app.

## What the app writes

```
bucket:  defect-photos
path:    <job uuid>/<defect uuid>/<name>.jpg
call:    sb.storage.from('defect-photos').upload(path, blob, {contentType:'image/jpeg'})
```

The first folder is the **job** uuid when the app can resolve one, otherwise the
defect uuid (`cloud-sync.js` ~line 2239-2248).

## Already ruled out — do not re-investigate

1. **It is not the orphan bug.** Six other stuck photos had a different cause
   (their defects live inside `dm_temp_jobs.defects` as JSON, invisible to any
   search of `dm_defects`). Fixed and shipped in build `2026-11-18k`. This
   seventh photo is not one of them — it reports POLICY, not ORPHAN.
2. **It is not a missing temp-job table.** `supabase/migrations/2026-09-04_temp_jobs.sql`
   has been run; all five verification columns came back true. That migration
   also created a storage policy of its own, `dm_temp_photos_rw`, which is why
   temp-job photos upload while this one does not.
3. **`supabase/storage.sql` in the repo is NOT what is running.** It builds all
   three `defect-photos` policies on `public.is_workspace_member(...)`. Asked
   directly, the database said:
   ```
   ERROR 42883: function public.is_workspace_member(uuid) does not exist
   ```
   If those policies were live, **every** photo read and write would fail with
   that error — not one photo. So the live policies came from somewhere else
   and that repo file is historical. A theory built on it was wrong; don't
   rebuild it.

## The next step

Run **BLOCK 1 of `INSPECT_photo_policy.sql`** (in the repo root) on its own in
the Supabase SQL editor. Read-only:

```sql
select policyname, cmd, roles,
       qual       as using_condition,
       with_check as insert_condition
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
 order by policyname;
```

**One block per run.** The Supabase SQL editor returns only the LAST result of
a script and abandons the whole run on the first error — an earlier version of
this file paired that query with one that failed, and threw the answer away.

That grid shows the condition the bucket actually enforces on an insert. Read
it against the path above (`<job uuid>/<defect uuid>/<file>`) and the mismatch
should be visible: whatever the policy checks the first folder against, a job
uuid is not satisfying it.

## Worth establishing early

- **Has ANY photo on a normal (non-temp) job uploaded recently?** If none have,
  this is not one stuck photo — it is every defect photo on every real job,
  silently, and the 47 that cleared earlier did so only because they were on a
  temp job with its own policy. Check `dm_defect_photos` (or equivalent) for
  recent rows whose job is not a temp job.
- The failing login is a supervisor account, not a service role. Whatever the
  policy keys off (workspace membership, job ownership, a claim on the JWT),
  check it for THAT user and THAT job rather than in the abstract.

## Constraints — these matter

- **Production database, shared with CH Tracker.** A policy change affects both
  products.
- **Do not write a storage policy from a guess.** Precedent: the note on
  migration 072 in `supabase/migrations/2026-09-04_temp_jobs.sql` records a
  supervisor-scoping policy that froze devices mid-push.
- `AGENT_INSTRUCTIONS.md` requires asking before any schema change here, and an
  agent session has no DB credentials — Spiro runs the SQL himself. Hand him
  read-only queries to run, and propose any change as a reviewable statement
  rather than applying it.

## Useful file map

| What | Where |
|---|---|
| Upload + the POLICY/ACCESS classification | `cloud-sync.js` ~2235-2315 |
| The diagnostic panel the message came from | `cloud-sync.js`, `photoDiagnostic()` / `openPhotoHelp()` |
| Temp-job recovery (the six that were fixed) | `cloud-sync.js`, `recoverOrphanToTempJob()` |
| Repo's storage policies (historical, not live) | `supabase/storage.sql` |
| Temp-job migration (run; created `dm_temp_photos_rw`) | `supabase/migrations/2026-09-04_temp_jobs.sql` |
| The read-only inspection queries | `INSPECT_photo_policy.sql` |
