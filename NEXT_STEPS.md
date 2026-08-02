# Next Steps / Handover

STATUS: Active — mid-incident
LAST UPDATED: 2026-08-02

## View Defects screens reworked (2026-08-02) — build `2026-08-02g`
Merged to `main`. Build stamp `2026-08-02g` in all four places (index.html
`APP_VERSION` + `cloud-sync.js?v=`, sw.js `CACHE` + the CORE `?v=` entry).
The letter advances on every push to `main`, because Pages publishes from it —
never re-use a stamp that has reached a phone.

**Deploys are AUTOMATIC. Push to `main` and it ships.** Verified 2026-08-02 via
the Vercel API: the last four production deployments all have `source: git`,
`target: production`, `state: READY`, one per push to `main`. Don't run
`npx vercel deploy` — it is redundant, and this repo's docs sent people chasing
it for hours. Just bump the stamp, commit, push `main`, done.

The version letter still matters even though the deploy is automatic: the
service worker only fetches a new shell when the CACHE string changes, so an
un-bumped push ships to Vercel and never reaches a phone.

- **Supplier heading is one line.** The name ellipsises (`min-width: 0` on the
  flex child was the missing piece), and ✉️🔗📑 collapsed into one 📤 that
  expands on tap. Long names truncate; the full name is in `title` and on the
  supplier's own screen.
  The booking button is now **either** a 📅 (no date set) **or** the bare date
  as DD/MM (date set) — never both. `fmtDateShort` is for that button ONLY;
  reports and emails still use `fmtDateNice` with the year, and so does the
  button's tooltip.
- **The job heading keeps its own row** (`.defects-header.hdr-inline`), 17px,
  toolbar on the row below. Header 115px -> 78px. The title is street
  (ellipsises) + job number (pinned), the suburb is dropped, and
  `fitLotTitle()` steps 17px -> 14px so a long address shrinks slightly instead
  of wrapping. Verified un-clipped 320px..430px.
  Sharing ONE line with the toolbar was tried and reverted — it got to 44px but
  squeezed the address to 13px and still clipped it on a real job. Don't
  re-try it without solving that; see DECISIONS.
- **Screen title + lot title are Titillium 700 upright, as-typed**, matching an
  index job row, instead of 900 italic uppercase. The home hero is deliberately
  excluded — it's the masthead. Twice now a "different font" report has turned
  out to be weight/slant/case on a shared family: read the computed style before
  reaching for `font-family`.

- **Row actions are hidden until you double-tap a row** — the pencil, pin and
  camera open as a strip under the description, single tap closes it, one row
  open at a time. `⋯` at the right edge is the affordance. It's one delegated
  click listener near `statusTab()` plus CSS on `.defect-item`, so it covers
  every screen that renders a row. Measured: list height 528px → 436px and
  8/10 → 10/10 rows visible on a 390×700 screen.
  Rows have `user-select: none` — without it iOS answers the double-tap by
  selecting a word and raising the callout menu. Don't remove it.

- Toolbar is one non-wrapping row on all five View Defects screens. Filter is a
  funnel icon; LIST|PREVIEW is one toggle icon showing the view you'll get.
- `.defects-header` is sticky under the app header, which is sticky under the
  cloud-sync status bar. Offsets are MEASURED (`syncStickyHeader()`, called at
  the end of `render()`, on resize/orientationchange, and once when the status
  bar mounts) — the app header's height changes with the design theme and the
  status bar's with the notch, so neither can be a constant.
- **The load-bearing fix:** body had `overflow-x: hidden`, which made it a
  scroll container and silently disabled `position: sticky` app-wide. Now
  `overflow-x: clip` on body, `hidden` on html. Don't put `hidden` back.
- Preview mode now works on the **supplier** screen as well as the address/job
  screen, so the toggle is not a dead setting when you move between them. Its
  cards are grouped by address with a per-address "N of M outstanding" count.
  The trade / multiple-suppliers / All Defects screens stay list-only and have
  no toggle — those are office screens, not walk-the-house ones.
- Verified in real Chromium at 320px and 390px, in all three design modes:
  every toolbar one row, nothing past either edge, header frozen at scroll on
  both the address and supplier screens, filter modal still opens above it.
  Harness lives outside the repo (adding Playwright is a "stop and ask" dep) —
  see "Test harness" below for how to rebuild it, and note
  `serviceWorkers: 'block'` on the context plus fulfilling off-origin requests
  with empty 200s, or the app never boots and then reloads mid-test.

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
5. ~~Vercel git auto-deploy still not firing.~~ **RESOLVED / was stale
   (2026-08-02).** It fires. Confirmed against the Vercel API: four consecutive
   production deployments, all `source: git` off `main`, all READY, and
   `deffixer-shell-2026-08-02g` serving live minutes after the push. This note
   being wrong cost a whole session of hand-running `npx vercel deploy` that
   was never needed. If a deploy ever looks missing, check the API before
   believing a note: `GET /v6/deployments?projectId=…&target=production`
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
