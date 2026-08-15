# Next Steps / Handover

STATUS: Active — mid-incident
LAST UPDATED: 2026-08-15

## Change your password (2026-08-15) — build `2026-08-15a`, branch `claude/password-change-review-4egsv5`
**NOT DEPLOYED.** Built, all four gates green (18 suites), pushed to the branch.
Deploying is a stop-and-ask per AGENT_INSTRUCTIONS, and this one has two
dashboard settings to make first (below).

**The feature did not exist.** Not broken — absent. `cloud-sync.js` could sign
in, sign up and sign out, and that was all. A supervisor who forgot or leaked a
password had to have Spiro reset it with `scripts/setup-manager.mjs`.

Now there are **three entrances to one card**, plus the reset email:

| From | Mode | Fields | Session needed |
|---|---|---|---|
| 🔑 status bar, Settings → Your login | `change` | current, new, confirm | yes |
| Sign-in screen → "Change password" | `signin` | **email**, current, new, confirm | no |
| The link in a reset email | `recover` | new, confirm | the link is the session |

Reasoning in DECISIONS.md. What will bite a later change:

- **The sign-in-screen entrance is the one to be careful with.** It sits in
  front of the app with no session behind it. Take away its current-password
  step and it stops being a way to change a password and becomes a way IN —
  a complete authentication bypass reachable from the login screen. It signs in
  with the old password *first*; that sign-in is the proof. `tests/pass.mjs`
  fires a valid email with a wrong password at it and asserts nothing changed
  and the app did not open. Never weaken that check.
- **One message for a wrong email and a wrong password**, deliberately —
  otherwise the screen is an account checker for anyone with the URL.
- **`enterApp()` is shared by the `signin` and `recover` paths.** Both finish
  holding a real session with no app running. It does the login screen's
  housekeeping and calls `onAuthed()` — which is why `installSaveHook()` needs
  its guard (below).

- **The recovery fragment is read SYNCHRONOUSLY, right after `createClient`,
  and nothing may move it later.** supabase-js's `detectSessionInUrl` exchanges
  the token and rewrites the address bar on its own schedule. Read it after
  that and a reset link is indistinguishable from a normal signed-in boot — the
  user lands in the app and the password they came to change is untouched, with
  no error anywhere. `boot()` checks `recoveryUrl` **before** it checks the
  session, in that order, deliberately. `tests/pass.mjs` fails if that flips.
- **`updateUser` is never called without re-authenticating first.** Supabase
  does not ask for the old password. Drop the `signInWithPassword` step and an
  unlocked phone is enough to lock a supervisor out of their own jobs.
- **All five refusals resolve before the network** and the suite asserts zero
  `updateUser` calls across them. Auth endpoints rate-limit; spending the
  allowance on requests that cannot succeed is how someone gets locked out for
  an hour.
- **`installSaveHook()` now has an idempotency guard and needs it.** Finishing
  a reset re-enters `onAuthed()`, so it can run twice in one page life. Without
  the guard `db.save` gets wrapped twice and every later edit pushes twice.
  The check that catches this counts `cs_dirty` writes, NOT `defectTrackerDB`
  ones — the second wrapper calls the first, so the underlying save still runs
  once and a count of those stays at 1 either way.
- **`ALIAS_USER` / `ALIAS_EMAIL` / `ALIAS_PASS` are the `qwqw` shortcut, in one
  place now.** Change that account's password and the shortcut stops working;
  the card warns when that account is signed in.

### TWO DASHBOARD STEPS BEFORE THE RESET EMAIL WORKS
The in-app change (🔑 / Settings) needs **neither** and works as soon as this
ships. Only "Forgot your password?" depends on these:

1. **Redirect allow-list** — Supabase → Authentication → URL Configuration →
   Redirect URLs. Add `https://smv-defect-manager.vercel.app/index.html` and the
   GitHub Pages URL. The app sends `location.origin + location.pathname` as
   `redirectTo`; anything not on that list is refused and the link bounces to
   the site root with an error.
2. **SMTP** — the built-in free-tier sender is rate-limited to a handful of
   messages an hour and lands in spam. Until a real SMTP provider is configured
   under Authentication → Emails, treat the reset email as best-effort. The
   card's failure message already tells the user to ask their manager instead.

### ONE THING FOR SPIRO TO DECIDE
A working manager password (`ALIAS_PASS`) ships in `cloud-sync.js`, which is
public static JavaScript — anyone who opens the file has the manager login. It
predates this change and was left exactly as it was, because removing the
`qwqw` shortcut uninvited would take away a login Spiro uses daily. Worth a
decision, not a quiet fix.

## 📋 Copy address on the job header (2026-08-12) — build `2026-08-12c`
**DEPLOYED 2026-08-12** — Vercel verified serving `deffixer-shell-2026-08-12c`,
`APP_VERSION 2026-08-12c`, `lotCopyBtn` and the lower-case code table. Shipped
together with the location-label second pass and NOTHING else: `cloud-sync.js`
was untouched, so the contractor-approval fix is still unshipped (below).
The frozen View Defects header carries the same 📋 at the end of the address
line.

- **Not in the toolbar, on purpose.** The toolbar's 📋 copies the DEFECT LIST;
  this one copies the ADDRESS. Each sits on the thing it copies. The toolbar is
  also full at eight icons on one pinned row.
- **`.lot-copy` is `flex: 0 0 auto` with its own font-size** so `fitLotTitle()`
  shrinks the address text, never the tap target.
- **The click must `stopPropagation()`** — the whole title is a tap target for
  Add Defects. `tests/addrcopy.mjs` fails if that is dropped.

## 📋 Copy address on the search rows (2026-08-12) — build `2026-08-12b`
**DEPLOYED 2026-08-12** — merged to `main`; Vercel verified serving
`deffixer-shell-2026-08-12b`, `APP_VERSION 2026-08-12b` and
`copyAddressToClipboard`.
An address row in the top search gained a 📋 beside 👁️ ✚. It copies
`formatAddress()` — `Lot 1023, Coollegrean Road, Wollert - 306725` — the same
string every heading and report already uses, so a pasted address matches what
is on screen. Address rows only; a contractor or trade row has no address.

- **The row is now text + THREE 40px icons at 390px.** `tests/addrcopy.mjs`
  measures it: nothing off the right edge, no wrap, and >=150px left for the
  address. Adding a fourth icon there without re-running that suite is how the
  leftmost control goes off-screen again (see the `.toolbar` comment).
- **Trade-off:** the street line ellipsises sooner than it did. The lot number,
  suburb and job number all still show in full, which is what identifies a job.

## Location on the defect row (2026-08-12) — build `2026-08-12a`, branch `claude/defect-location-display-uqef29`
Every defect row reads `BPI #18 (p.7) — GAR INT PA — Seal gap…`: reference,
location code, item. **DEPLOYED 2026-08-12** — merged to `main`, and
`smv-defect-manager.vercel.app` verified serving `deffixer-shell-2026-08-12a`,
`APP_VERSION 2026-08-12a` and the code table. A supervisor mid-edit gets the new
shell on the next background/reopen (the SW waits on `isBusyEditing`).
Full reasoning in DECISIONS.md. The parts that will bite a later change:

- **The line is composed in ONE place** — `defectLineHtml()` in `index.html`,
  beside `DEFECT_LOCATIONS`. All seven defect-list screens call it. Its text
  twin is `formatDefectEmailLine()`, which every non-visual output now uses
  (supplier email, both Copy to Clipboard paths, `db.exportToText`, the PDF
  card). Same order in both; the on-screen one abbreviates, the text one does
  not. Don't add a third.
- **`formatDefectEmailLine` is misnamed now** — it is every text rendering of a
  defect, not just the email. Left alone deliberately: `tests/deep.mjs`,
  `REFACTOR_LOG.md` and `CLEANUP_REPORT.md` all name it, and the rename buys
  nothing the doc comment doesn't.
- **The saved description must stay bare.** `description` still begins with
  `BPI #N (p.P) — ` and nothing else. The re-import duplicate guard,
  `matchCompleted`, and trade learning all match on that text — writing the
  location into it would double every item on the next import of the same
  report. `tests/loc.mjs` fails if anyone does.
- **The line is `ref - code: item`** — hyphen, then colon. Em dashes were tried
  and are too wide; three of them read as fragments, not a sentence. Each
  separator only appears when the piece before it does.
- **`LOCATION_ABBR` must cover every entry in `DEFECT_LOCATIONS`.** Add a
  location to the picker and you add a code, or gate 3 fails. They are
  lower-case floor-plan codes (`bth`, `b4`, `ens`, `ldry`, `kit`) — set
  lower-case in the DATA, not by CSS, so the DOM matches the glass. Bold upper
  case was tried first and read as a warning label on every row.
  `LOCATION_WORD_ABBR` only catches locations someone TYPED rather than picked.
- **Master Bedroom and Bedroom 1 BOTH map to `b1`** — same room on an AU
  project-home plan, asked for by name. It is the only allowed collision and it
  is declared in `LOCATION_ABBR_SHARED`, which `tests/loc.mjs` reads. Adding a
  second pair there needs a reason in DECISIONS.md, not just a green test.
- **Living is `liv`, Lounge is `lng`.** Spiro named `LIV` for both. They are
  separate rooms in the picker, so they keep separate codes — collapsing them
  sends a trade to whichever of the two the plan has. Change it only if he says
  so knowing that.
- **`.defect-loc` was already taken** by a location-dropdown pill lower in the
  stylesheet. These spans are `.defect-line-ref` / `.defect-line-loc`. Reusing
  the old name renders them grey and clipped at 104px, which is how the first
  attempt failed.
- **Covered by `tests/loc.mjs`** (gate 3, 16 suites now).

## PDF filenames (2026-08-07) — build `2026-08-07a`, branch `claude/pdf-report-filename-cleanup-plff0r`
Every generated report is now `<Who>_<dd.mm>_Items.pdf` — `Bayhill_12.06_Items.pdf`.
Full reasoning in DECISIONS.md; the parts that will bite a later change:

- **The name is built in ONE place** — `buildReportFilename` in `index.html`.
  Job screen, supplier screen, trade screen, report builder and both email
  buttons all reach it. Don't add a second namer.
- **The name lives or dies in `uploadTempPdf`** (`cloud-sync.js`). The object
  path is `<random>/<report name>.pdf`. The random folder is the unguessable
  part; the LAST segment is what a phone names the saved file. Flattening it
  back is exactly the bug that was fixed — the app named the PDF properly and
  the upload replaced it with `k3j9x2m1abcd.pdf`. Dropping the random folder is
  just as wrong: with `upsert: true`, two supervisors' same-day reports for the
  same supplier would overwrite each other.
- **`CloudShare.lastKey()` now contains a `/`.** The `email-supplier-defects`
  edge function (not in this repo) takes that key and downloads it —
  `storage.from(bucket).download('<folder>/<file>.pdf')` is fine, but if that
  function ever validates the key shape, it needs to allow one slash.
- **Deploy note:** nothing to run in Supabase. The `shared-pdfs` bucket takes a
  foldered path with no policy change (it has never keyed off `foldername`).
  If an upload ever IS refused, the private-bucket + signed-URL fallback already
  carries the report name, so it degrades readably rather than breaking.
- **Covered by `tests/pdfname.mjs`** (gate 3, 15 suites now). Reverting either
  half — the namer or the upload path — fails it.

## ⚠️ TWO MANUAL STEPS OUTSTANDING
Neither blocks the app — both features degrade cleanly until they're done — but
neither is finished without them. There is no CI for `supabase/**`; it has
always been hand-run (see REFACTOR_LOG.md, same note against the 100k cap).

**1. The shopping-list column** (build `2026-08-02m`). One nullable column.
Paste `supabase/migrations/2026-08-02_defect_order_status.sql` into the SQL
editor for project `cubwwnvzmeydyixhetfb`, or:

```
alter table public.dm_defects add column if not exists order_status text;
```

Until it runs, the app probes for the column, finds it missing, and keeps
shopping-list flags on the phone that set them (console says so). Everything
else syncs normally — the probe exists precisely so a missing column can't
break every defect write.

**2. The deep-read edge function** (build `2026-08-02l`, still outstanding).

```
supabase functions deploy extract-defects --project-ref cubwwnvzmeydyixhetfb
```

Until it runs, a manager ticking Deep read gets an error back and the app falls
back to the flat AI read.

## Shopping list (2026-08-02) — build `2026-08-02m`
What the SUPERVISOR has to order, as opposed to what a trade has to fix.

- **Where it is.** 🛒 is the fourth control on an expanded defect row (after
  ✏️ 📍 📸). 🛒 in the job toolbar beside the list/preview toggle opens that
  job's list. A **Shopping List** row on the home screen, directly under the job
  list, opens every job the supervisor holds — that's the one that matters, a
  hardware run is planned across jobs.
- **Preview cards carry a photo carousel** (2026-08-02): `1/3` counter top-right,
  `‹`/`›` arrows, and `📷` to add from camera or gallery. `CloudPhotos.thumbsAll()`
  fetches every photo for every visible card in TWO round trips — don't replace it
  with a per-card `getLinks()` call, that's 24 cards × 2 requests in a driveway.
  Paging and adding both update the card IN PLACE; a `render()` here throws the
  supervisor back to the top of the job.
- **Preview mode has it too** (`pvOrderBtn` / `pvToggleOrder`), added
  2026-08-02 — walking the house is exactly when you notice a part is needed.
  It updates the card IN PLACE, like `pvToggleDone`: a full `render()` throws
  you back to the top of a long job. `pvUpdateCartBadge()` keeps the toolbar
  count honest without one. The card's three icons live in `.pv-minis` so they
  wrap as a group — loose, they broke mid-set at 320px ("MARK DONE ✏️" / "📍 🛒").
- **States:** `''` → `needed` (To order) → `ordered` → `done` (Got it, leaves
  the list). The row 🛒 is a plain on/off switch; the tri-state advance happens
  on the list itself, which is where the supervisor is standing when it changes.
- **"Got it" does not complete the defect** — the trade still has to fit the
  part. Don't "simplify" that later; read the DECISIONS entry first.
- **Completing the defect clears the item** with no extra step, because the flag
  lives on the defect (`orderStatus`), not in a parallel list.
- **Adding a synced field? Guard BOTH directions.** The write side is
  `ensureOrderColumn()` — `defectRow()` feeds every defect write, so naming a
  column that doesn't exist yet 400s the lot. The READ side matters just as
  much and is easy to miss: `select('*')` can't error on a missing column, it
  just omits it, so a naive `x: row.new_col || ''` resolves to empty and the
  wholesale `db.data = newData` wipes the local value on the next pull. That
  shipped as a bug on 2026-08-02 (🛒 "shows up then vanishes") and is fixed by
  `prevOrder` in `pullAll`. Probe, degrade, preserve — never assume.
- **Regression test:** `sync.mjs` in the scratchpad drives the real
  `cloud-sync.js` pull against a stubbed Supabase whose `dm_defects` rows have
  no `order_status` key (and whose `select('order_status')` 42703s), exactly
  like the live database today. It covers both the un-migrated and migrated
  worlds. Reverting the `prevOrder` line makes it fail — verified.
  It also covers **sharing a contractor**: a row with a legacy_id, a row with
  `legacy_id = NULL` (the duplicate-insert case), and an RLS refusal.

## Search, re-import and the unsaved guard (2026-08-02) — build `2026-08-02s`
- **Search is one matcher now.** `matchesSearch(haystack, query)` /
  `searchRank()` — every word you type must prefix some word in the target, any
  order, supplier trade included in the haystack. Used by the contractor, trade
  and address autocompletes and the Add Defects supplier box. **Don't add a
  fourth hand-rolled `startsWith` filter** — that's what made every two-word
  search return nothing.
- **A report import always ends with a summary** (`finishReview`) when anything
  was skipped or re-opened, and a completed defect the report raises again is
  RE-OPENED rather than silently left closed. `addDefect(..., {quiet:true})`
  suppresses its own duplicate toast so the review can report the real outcome.
- **`leaveAddDefects(go)` guards every exit** from Add Defects. If you add
  another way off that screen, route it through this or you reintroduce the
  silent data loss.
- Covered by `fixes.mjs` in the scratchpad.

## Pushing a row whose cloud `legacy_id` is NULL (2026-08-02)
`upsert(row, { onConflict: 'legacy_id' })` **cannot** match a row whose
`legacy_id` is NULL — NULL never conflicts in Postgres — so it inserts a
duplicate and leaves the original alone. Rows created in CH Tracker are exactly
that shape. `commitDefect` has guarded this since June; `diffEntity` did not,
which is what made an approved contractor reappear in "Contractors to review"
with a second copy piling up behind it each time.
Both now UPDATE by uuid first and only upsert as a fallback. **If you add
another entity to the diff engine, it inherits the fix — don't reintroduce a
bare upsert-by-legacy_id.**

Related: `diffEntity` swallows permanent (RLS/constraint) errors on purpose so
one un-pushable row can't freeze the device. That means **a button must not
report success off the back of it**. Share now goes through
`CloudSync.commitContractor()`, which waits for the answer and rolls the local
change back if the database refused. Copy that pattern for any other
user-initiated write whose failure the user needs to know about.

## Deep read — third-party private inspection reports (2026-08-02) — build `2026-08-02l`
Manager-only. Report type **Private Inspection** + a PDF + the 🔬 Deep read
checkbox sends the actual PDF to Claude instead of flattened text, so it sees
headings, tables, columns and the photos printed between them.

- **Why it was needed:** the AI path was never missing; it was reading a
  flattened wall of text. Private reports keep their structure in the layout,
  and flattening threw it away before the model saw it. Full reasoning in
  DECISIONS.md — read that before changing any of this.
- **Photos now attach.** `extractBpiPhotos` → `extractReportPhotos(file, items,
  onProgress, mode)`. `mode: 'bpi'` is the old Tag-number pairing, untouched.
  `mode: 'anchor'` locates each defect by a verbatim snippet the model copied
  off the page. Both feed the same `bpiPairPhotosToTags`.
- **Where the guards are** (`index.html`, the DEEP READ block):
  `DEEP_MAX_PAGES = 60`, `DEEP_MAX_BYTES = 11 MB`, `ANCHOR_CARRY_PAGES = 2`,
  and `MAX_PDF_B64` server-side. Every one of them falls back to the flat read
  rather than failing the import. Raising them raises the bill — ~2,300 tokens
  a page against ~350 as text, so about 15c → 40c on a 25-page report.
- **Report references:** imported defects are saved as `BPI #7 (p.3) — ...` or
  `Item #7 (p.3) — ...` for a private report. `REPORT_REF_RE` /
  `stripReportRef()` / `reportRefWord()` are the ONE place that label is written
  and stripped — it used to be a hand-copied regex in four spots. Keep it that
  way.
- **Not yet exercised on a real report.** Everything here was verified against
  synthetic PDFs built to reproduce the shapes Spiro described (grouped by room,
  photo clusters under a paragraph, a cluster spilling onto the next page). The
  first real private report is the actual test — particularly whether the model
  copies anchors verbatim enough to be found in the text layer. If photos come
  back light, log the anchor miss rate first; that's the number that matters.

## View Defects screens reworked (2026-08-02) — build `2026-08-02k`
Merged to `main`. Build stamp `2026-08-02k` in all four places (index.html
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
- **Icons are emoji, deliberately.** A full drawn line-SVG set was built and
  shipped as `h`, then reverted the same day — Spiro's call, and the reason was
  COLOUR, not craft. Four consistency fixes stayed: one plus (`＋`, takes the
  app's blue), one envelope (`✉️`), Add Report is `📥` so it isn't a second pale
  page next to `📑`, and `🙈` is gone. Don't propose drawn icons again without
  reading the DECISIONS entry first.
  Ten more glyphs picked 2026-08-02: `🚦` filter (its three statuses ARE red /
  amber / green), `☰` list, preview, `📧` email, `✚` add, `🎞️` photo dump,
  `📨` send, `📸` photos, `📱` import contact, `☎️` call. No drawn SVGs remain —
  the set is one medium now. Watch `📨` next to `📧` in an expanded send group.
  Preview is `📺` as of `2026-08-02n` — it was `🖼️`, which read as a framed
  picture on a wall rather than a way of viewing the list.
- **Copy to clipboard is per-supplier too** (`copySupplierDefects`), a fourth
  option in the send group. Whole-screen copy was never removed — it's in all
  five toolbars; only the per-supplier version was missing.
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

- **Row actions are hidden until you tap a row** (single tap — it was a double
  tap for a few hours on 2026-08-02 and Spiro changed it after using it on site) — the pencil, pin and
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
`main` = the source of truth. **Deploys are automatic — pushing `main` ships to
Vercel** (corrected 2026-08-02; this line used to say they were manual and cost
a session). Bump the stamp, push, done.

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
| l | **"I add 5 items and only 2 show."** Re-raising a defect that had been completed collided with the unique index on `(job_id, description, contractor_id)`; adopt-on-conflict claimed the old COMPLETED row, so the raise vanished on the next pull and the item reappeared ticked off. The collided row is now RE-OPENED before it is adopted (`tests/recur.mjs`) |
| m | **"My Plumber report was missing an item."** A trade filter matches through the contractor's trade LINKS; a sub with none was dropped silently, and when it was the only match the dialog said "No defects match those filters" about defects that did. The report now names the unlinked suppliers and offers to include them (`tests/tradefilter.mjs`) |

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
