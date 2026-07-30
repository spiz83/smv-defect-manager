# Next Steps / Handover

STATUS: Active — mid-incident
LAST UPDATED: 2026-07-29

## READ THIS FIRST (for a fresh session)
A long debugging session on 2026-07-27..29 found and fixed **six** faults plus
**two regressions I introduced myself**. Versions `2026-07-27a` → `k`.
`main` = the source of truth. Deploys are manual: `npx vercel deploy --prod
--yes --scope spiro-vladimiroskis-projects`.

Supabase project: **Homes Dashboard**, ref `cubwwnvzmeydyixhetfb` (NOT the
paused "DefectFlow"). Shared with CH Tracker — one database, two apps.

## THE OPEN QUESTION — start here
Supervisors mark a defect **Complete** and it comes back. Confirmed on
**(7) Band Street, Sunbury**, job `306646`,
job_id `0827a580-ba51-4018-9130-793a1f898b80`, and also seen on
**(4) Spinosa Road, Sunbury**, job `306640`.

Evidence from a dump of that job: nearly every defect appears TWICE — one row
with `legacy_id` NULL (the CH Tracker original) and one with a large number
(e.g. `434677600`), which is this app's `hashId(uuid)` written back as a
legacy_id. Both map to the same local id, so one list item is backed by two
rows: completing marks one, its twin stays open, the item never leaves.

**BUT** a cleanup query matching on `dup.description = orig.description`
returned **0 rows**, which contradicts that dump. Either the full descriptions
differ (the dump was truncated to 45 chars) or something else is going on.
**This is unresolved.** Next step is to look at the real rows:

```sql
select id, legacy_id, status, length(description), description
from dm_defects
where job_id = '0827a580-ba51-4018-9130-793a1f898b80'
order by description;
```

Then work out the correct pairing rule before deleting ANYTHING. A previous
draft of the delete was too broad — it would have removed legitimately distinct
defects that share wording (which is now allowed, see 2026-07-27a). Always show
a SELECT of exactly what a DELETE would remove first.

Photos: `dm_defect_photos.defect_id` — move photos to the survivor BEFORE
deleting a duplicate, or they are lost.
Tombstones: deleting a row archives it, and the app treats archived
`legacy_id`s as deliberately-deleted for 60 days. A duplicate's legacy_id is
the hash of the ORIGINAL's uuid, so deleting it naively makes phones purge the
originals. NULL the legacy_id before deleting.

## Fixed and deployed
| ver | fault |
|-----|-------|
| a | Add Defects silently binned a supplier block when the name was typed but not tapped; dead `initializeAddressDefectForm()` threw on every ＋ tap; duplicate guard ignored the supplier |
| b | Defect ids were recycled (`max+1`), so a new defect inherited a deleted one's id, matched its 60-day tombstone and was purged seconds after saving. Fixed with a persisted high-water mark (`dm_defect_id_hw`) |
| c | `pullAll` aborted whenever the outbox was non-empty; an entry that could never commit froze that device's pulls permanently |
| d | Same freeze via the `dirty` flag (only cleared by a successful push, persisted across restarts). Now bypassed after 3 consecutive push failures |
| e | **The big one.** PostgREST caps responses at 1000 rows and truncates SILENTLY. `pullAll` used bare `select()`, so once `dm_defects` passed 1000 rows every device got an arbitrary slice — jobs showed partial lists while the status bar said "Synced". All large reads now page via `selectAllRows()` |
| f | Report import fetched pdf.js from a CDN at import time, cached the FAILED promise (so retrying in good signal still failed until force-close), had no timeout, and was not precached |
| g | BPI parser swallowed the trailing management checklist into the last defect of every report |
| h | `reconcileLocalDefectsUp` pushed stale local copies over the cloud via upsert, reopening completed defects. Now verifies against the cloud first and adopts rather than pushes |
| i | Any unrelated edit pushed the whole row incl. a stale status. Status may now only leave `completed` on explicit intent (`statusIntent`) |
| j | **My regression from c.** Carry-over only filled gaps, so completing an existing defect let the cloud's open copy win ~800ms later. Un-pushed rows now OVERLAY the pull |
| k | `commitDefect` inserted a duplicate when it had no uuid (upsert can't match CH Tracker's NULL legacy_id). Now defers instead of inserting |

## Test harness — rebuild if missing
Serve the repo on :8099, drive real Chromium via Playwright.
**Service workers MUST be blocked** or you get a stale cached app.
**Any localStorage seed MUST be idempotent** — an unguarded seed re-runs on
reload and fakes a "data disappeared" result. That wasted time twice.
Suites: 17 save assertions, 9 view smoke checks, save→view→reload visibility,
id-recycling regression, 11 paging boundary checks, BPI checklist stripping.

## Known-good facts (don't re-derive)
- RLS on `dm_defects` is `using (true)` — not a permissions problem
- All Sunbury jobs are `active = true`
- 398 BPI defects all have `job_id` populated
- No duplicate non-null `legacy_id`s anywhere

## Still open
1. The Band St duplicates above — **highest priority**
2. Defects lost to bug `b` before it was fixed are gone (deleted locally, never
   reached the cloud). Not recoverable
3. Orphan photos: a phone may show "photo saved on this phone" for a photo whose
   defect was destroyed. Safe but unreachable; re-log and re-attach. No auto
   cleanup written — "defect missing" can also mean "not synced yet"
4. CH Tracker needs the same BPI parser fix (separate repo)
5. Vercel git auto-deploy still not firing. GitHub app access and the project's
   Git link are both confirmed healthy; unchecked: `Environments → Production →
   Branch Tracking` should be `main`, and `Build and Deployment → Ignored Build
   Step` should be empty
6. Supervisors must be told: saving is now all-or-nothing per tap. An
   unrecognised supplier refuses the whole save and names the block

## BPI supporting photos (2026-07-30) — awaiting deploy approval

Ported from CH Tracker (`src/lib/bpiPhotos.ts`) so the phone and desktop
imports behave identically: a BPI PDF dropped here now has each defect's
supporting photo cut out of the report and attached to that defect.

- Extraction is local — pdf.js placement rectangles + a canvas crop. No AI
  call, no cost, nothing extra leaves the phone.
- A photo belongs to the nearest Tag line at or ABOVE its centre. Only pages
  the parser placed a defect on are searched, so the cover logo is ignored.
- Photos go through `CloudPhotos.savePhoto`, the durable path, so an import
  with no reception still lands them once back online.
- The current item's photo shows on the review screen before you save it, so
  a mis-pairing is visible while it's still fixable.
- Verified against 204/9 Grass Tree Road: pairing is byte-identical to the
  tracker's on all 3 photo pages, 12/12 defects.

Not deployed — `AGENT_INSTRUCTIONS.md` says stop and ask before anything goes
live. On branch `claude/bpi-photo-extraction`.

**Retention: settled at 60 days** (Spiro 2026-07-30). Both apps stamp BPI
photos with `expires_at = now + 60 days` — longer than the 42-day default for
site photos because the BPI shot is the defect's evidence, but bounded.
`CloudPhotos.savePhoto(legacyId, blob, keepDays)` takes an optional retention;
omitting it keeps the column default, so every existing photo path is
unchanged. The duration rides in the IndexedDB queue and is applied when the
photo LANDS, so a phone offline for a week doesn't lose a week.

## Defects missing from the phone — fixed (2026-07-30)

Band Street showed items in CH Tracker and nothing here. Cause: the job
visibility filter in `pullAll` read the LEGACY `jobs.active` boolean. CH
Tracker moved to the v7 `status` enum and its CLAUDE.md is explicit that
`active` is legacy and only `status` governs the lifecycle — so `active` can
sit stale at `false` on a live job. That hid the job, and a defect whose job
isn't visible is dropped by the loop below it, so every defect on that job
vanished from the phone without a word.

Now driven by `status` (hidden only when `completed`), falling back to
`active` only when status is unreadable. Applied in both places that build
`idMap.addresses` — the main pull and the cold-boot map used by
`commitDefect`. `jobs` select now includes `status`.

Dropped defects also log a warning naming the job_ids, so this can never be
silent again. No data was ever lost — the rows were always in `dm_defects`;
they just had nowhere to land on the phone.


## Backups
Free plan has no automatic backups. A `backup.snapshot_defects()` function +
pg_cron daily snapshot (14-day retention) was drafted — confirm it exists via
`select jobname, schedule, active from cron.job;` and take one manually before
any destructive change.
