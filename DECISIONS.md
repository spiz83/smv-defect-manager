# Decisions Log

Newest at top. Format: date — decision — why — trade-off accepted.

## 2026-08-02 — Preview's MARK DONE confirms, like the status tab does
- **Decision:** `pvToggleDone` asks "Mark this item as completed? It will be
  removed from the active list." before completing — the same wording the list
  view's status tab has always used. Un-completing stays instant; that's the
  undo.
- **Why:** Spiro, from site. It was the only route to `completed` in the app
  with no confirmation, and the easiest one to hit by accident: preview is
  walked one-handed at arm's length and MARK DONE is the biggest target on the
  card. The item then drops off the list on the next render, so a mis-tap reads
  as "it vanished" with nothing to undo from.
- **Trade-off:** a tap more per item when working through a job in preview. Both
  modes now cost the same, and the list mode has carried that prompt for months
  without complaint.

## 2026-08-02 — Search: every word you type, not the whole phrase
- **Decision:** one matcher (`matchesSearch` / `searchRank`) behind every search
  box. **Each word you type must prefix-match some word in the target, in any
  order**, across a haystack that includes the supplier's TRADE as well as the
  name. Splitting on non-alphanumerics, so `&`, hyphens and double spaces stop
  hiding names.
- **Why:** every box used `word.startsWith(query)` — the WHOLE query had to
  prefix a SINGLE word, so **any two-word search returned an empty dropdown**.
  Verified before fixing: "vic plaster", "victoria fencing", "auz painting",
  "har painter", "roof plumb", "shower screen" — all nothing. That is the whole
  of "the search function sucks in general"; it wasn't ranking, it was a filter
  that couldn't match a phrase.
- **Trade-off:** still a prefix match per word, NOT a substring one. Typing
  "ain" won't surface every painter. Prefixes are what people expect of a name
  field and they keep the list short on a phone — a substring match turns three
  letters into forty rows.

## 2026-08-02 — Re-importing a report accounts for itself, and re-opens
- **Report:** the whole BPI report was uploaded a second time and "only the
  items outstanding last time" appeared.
- **What was happening:** the duplicate guard was doing its job (`matchCompleted`
  stops a re-import doubling the list — the Band Street fix, 2026-07-30) but
  said nothing. Nothing was added, so the import looked broken.
- **Decision 1 — re-open.** A completed defect that the report raises AGAIN is
  re-opened. The inspector has listed it a second time; that means it isn't
  fixed. Leaving it closed silently loses a live defect, which is the worse
  failure by a distance: a duplicate is visible and deletable, a missing defect
  is neither. The duplicate guard still holds, so no second row is created.
- **Decision 2 — always report.** An import that skipped or re-opened anything
  ends with a summary: N added, N re-opened, N already present, and plainly
  "Nothing new was added" when that's the case. A report imported twice by
  mistake is now one glance to spot.
- **Trade-off:** re-importing an OLD report by mistake will re-open items that
  were genuinely finished. Accepted — it's visible in the summary and one tap
  each to re-complete, against the alternative of silently dropping items a
  re-inspection has failed.

## 2026-08-02 — Every exit from Add Defects is guarded
- **Decision:** `leaveAddDefects(go)` wraps every route off the screen; the Back
  link and the job-title heading both go through it.
- **Why:** Spiro reported the unsaved-changes prompt had "stopped working". It
  hadn't — it had only ever covered the Back link. The job title above the form
  (`viewDefectsForAddress`) is a full-width tappable heading directly under the
  header, and tapping it discarded everything typed with no warning at all.
- **Trade-off:** none. An empty form still leaves without nagging.

## 2026-08-02 — "Shared contractor keeps coming back" — two bugs, not one
- **Report:** approving a supervisor-added contractor under the admin login
  didn't stick; the review list refreshed and they reappeared.
- **Bug 1 — a NULL legacy_id can't conflict.** `diffEntity` pushed every update
  as `upsert(row, { onConflict: 'legacy_id' })`. A contractor row created in CH
  Tracker has `legacy_id = NULL`, and NULL never conflicts with anything in
  Postgres — so ON CONFLICT matched nothing, **INSERTED A DUPLICATE**, and left
  the original row untouched. The next pull returned the untouched original and
  the contractor was back in the list, with a second copy quietly accumulating
  behind it on every tap of Share. `commitDefect` fixed exactly this for
  `dm_defects` back in June; it was never carried across to the entities still
  going through the diff engine.
- **Decision:** `diffEntity` now UPDATEs by uuid when the id map has one, and
  only falls back to upsert-by-legacy_id for a genuinely new row. It also keys
  the map off the LOCAL id when the cloud row's `legacy_id` is NULL — otherwise
  the mapping is lost on the next pass and it duplicates all over again. This is
  generic, so trades get the fix too.
- **Bug 2 — the diff engine swallows a refused write, by design.** A permanent
  error (RLS, constraint) is caught and logged so one bad row can't abort the
  batch or freeze the device. Correct for a background push; wrong for a button
  a manager just tapped. "Contractor shared with the team" followed by it
  reappearing is worse than an honest failure.
- **Decision:** Share goes through a new `CloudSync.commitContractor()` that
  writes and WAITS for the answer. On failure the local change is rolled back so
  the screen matches the database, and the real error is shown.
- **Trade-off:** Share is now as slow as the network. Worth it — the whole
  complaint was that it appeared instant and wasn't real. The background diff
  engine keeps swallowing errors; only this one user-initiated action doesn't.
- **The general rule:** if a button tells the user something is done, something
  has to have confirmed it. A fire-and-forget write behind a success toast is a
  lie whenever the write can be refused.

## 2026-08-02 — Sign out was under the notch
- **Decision:** `#cs-statusbar` takes `env(safe-area-inset-top)`, and its button
  goes from an 11px chip to a 12px/600 one with real padding.
- **Why:** Spiro asked how to log off. It was there — behind the iPhone's own
  clock and battery. The page declares `viewport-fit=cover` +
  `black-translucent`, so content runs under the system status bar, and nothing
  applied the inset. `body.cs-authed` picks up the same inset so the app header
  isn't pushed under it, and `syncStickyHeader()` already measures the bar's
  real height, so the frozen headers re-offset themselves.

## 2026-08-02 — The pull must PRESERVE a field the cloud can't carry yet
- **Bug:** flagging a defect with 🛒 put it on the shopping list, then it
  vanished seconds later. Reported from site the day the feature shipped.
- **Cause:** the write guard was only half the problem. `ensureOrderColumn()`
  correctly stopped the app sending a column that doesn't exist — but the PULL
  read `orderStatus: d.order_status || ''` unconditionally, and `select('*')`
  can't error on a missing column, it just doesn't return one. So every flag
  resolved to `''`, and since `db.data = newData` replaces every defect
  wholesale, the next pull (realtime nudge, tab focus, or the periodic one)
  wiped it. Hence "shows up, then vanishes".
- **Decision:** capture the device's existing flags before the rebuild and keep
  them for any row the cloud returns **without** an `order_status` key. The test
  is per ROW (`'order_status' in d`), not the session-wide capability flag, so
  the cloud wins the instant it can carry the value — including clearing a flag
  someone removed on another device.
- **Also fixed:** `commitDefect` claimed its outbox slot AFTER `await
  ensureOrderColumn()`. `pullAll()` bails while the outbox is non-empty, so a
  pull landing during that probe — a real round-trip on the first write of a
  session — would have rebuilt `db.data` with the edit unguarded. The slot is
  now claimed before the first await.
- **The general rule:** a write guard is not enough for a field the schema
  doesn't have yet. Guard BOTH directions — the write must not send it, and the
  read must not erase it. `select('*')` failing silent is what makes the read
  side easy to miss.
- **Trade-off:** while the column is missing, a flag cleared on another device
  can't propagate (there's nowhere for it to travel). Both devices keep their
  own view until the migration runs. Accepted: that state is temporary and one
  SQL statement from over.

## 2026-08-02 — Preview toggle is `📺`, not `🖼️`
- **Decision:** `ICON_CARDS` = `📺`. Preview mode is now a small television.
- **Why:** Spiro, on site — the picture frame "looks weird". It reads as a
  framed picture hanging on a wall, which is a THING, not a way of looking at
  the list. `📺` reads as a screen/display, so it says "show me this differently"
  the way the paired `☰` says "show me the compact rows".
- **Trade-off:** none worth the name. `📺` isn't used anywhere else in the set,
  it carries its own colour like every other glyph, and it's the same width, so
  the one-line toolbar is unaffected (re-verified at 320px).

## 2026-08-02 — Shopping list: what the SUPERVISOR has to order
- **Decision:** A fourth control (`🛒`) on an expanded defect row flags that the
  item is blocked on the supervisor sourcing a part or materials. Flagged items
  appear on a **shopping list** — per job (🛒 in the job toolbar, beside the
  list/preview toggle) and **across every job the supervisor holds** (a
  Shopping List row on the home screen, directly under the job list). Three
  states on the list: **To order → Ordered → Got it**, advanced by tapping the
  state chip. "Got it" takes it off the list.
- **Why:** a defect can be assigned to a trade and still be waiting on the
  supervisor. Those parts lived in emails, texts and phone notes and got lost.
  The global list is the load-bearing half: a hardware run is planned across
  jobs, not one job at a time, so "everything I need to pick up today" has to be
  one screen.
- **The flag lives ON the defect, not in a separate list.** A parallel
  shopping-list table would need its own lifecycle, its own sync, and its own
  bugs — and would drift the first time a defect was completed or deleted
  somewhere else. On the defect, completing the work removes the item for free,
  and re-opening it brings the item back.
- **"Got it" does NOT complete the defect.** The part being in hand and the work
  being done are different facts: the trade still has to fit it. Conflating them
  would have marked work complete that nobody had done. `done` is remembered
  rather than cleared, so a defect that has already been sourced still says so.
- **Trade-off — an eighth icon on the job toolbar.** It's a VIEW control, so it
  joins the left group with the list/preview toggle rather than the actions on
  the right; the `margin-left: auto` selector had to learn about `.cart-btn` or
  the cart itself would have taken the auto margin and floated into the middle.
  Verified one line, nothing clipped, at 320px.
- **Trade-off — a fourth icon on the open row strip.** The strip is full width
  and doesn't compete with the description, so this costs nothing the row
  actions didn't already cost. Four at 22px gap still fit a 320px phone.
- **Needs a manual migration** — `supabase/migrations/2026-08-02_defect_order_status.sql`
  (one nullable column). See the capability probe below for why the app is safe
  to ship before it runs.

## 2026-08-02 — A new sync column is probed for, never assumed
- **Decision:** `cloud-sync.js` probes `dm_defects.order_status` once per
  session (`ensureOrderColumn`) and includes the column in a write **only** when
  it is genuinely there.
- **Why:** the browser half of a feature ships on a push; a database column
  doesn't. PostgREST rejects a write naming an unknown column with a 400 — and
  `defectRow()` builds **every** defect write. Shipping the client first without
  a guard wouldn't have lost the order flag, it would have broken saving a
  description, a supplier, a status, a photo — everything — for every user until
  someone ran the SQL. That is a whole-app outage caused by a shopping-list
  feature.
- **Trade-off:** one extra round-trip per session, and until the migration runs
  the flag is device-local (it still works; it just doesn't reach the
  supervisor's other phone). Both are cheap next to the alternative. Apply the
  same pattern to any future column: probe, degrade, never assume.

## 2026-08-02 — Deep read: private inspection reports are read as PAGES, not text
- **Decision:** A third report path, **Deep read**, sends the actual PDF to
  Claude as a base64 `document` block instead of flattened text. It is
  **manager-only** (`CloudAI.deepAvailable()` → `role === 'manager'`) and only
  offered for a **Private Inspection PDF** — BPI and pasted text never see it.
  The model returns `{description, location, trade, page, anchor}` plus a
  one-line `layout` summary of how that report was organised.
- **Why:** BPI reports carry their structure in the WORDS (`1 Kitchen Painter
  ...`), so flattened text is enough. Private inspection reports carry it in the
  LAYOUT — a room heading, a defect-type heading, a cluster of four photos
  sitting under a paragraph. `extract-defects` received `{ text }` and nothing
  else, so every one of those cues was destroyed before the model saw it, and
  we were asking it to work out how the report was organised from the one
  representation that no longer said. Spiro's own framing — "analyse it start to
  finish and almost reformat that report to work with this app" — is exactly the
  job; it just needed the right input, not a better prompt.
- **The photo problem this actually fixes.** `extractBpiPhotos` opened with
  `if (!wantByPage.size) return out;`, which needs `page` and `itemNo` on every
  item. The AI path returned neither, so that line returned empty **every single
  time** — zero photos on every private report ever imported. The cropping
  machinery was fine; it had nothing to hang photos off. `anchor` is the hook:
  a verbatim snippet located in the page's text layer yields the same
  `{itemNo, y}` the BPI Tag finder produces, so **one** pairing routine now
  serves both (`bpiPairPhotosToTags` is unchanged).
- **Learnings carry over for free — nothing was ported.** `resolveTrade()` runs
  on the review screen, downstream of extraction, for every item whatever
  produced it. Learned history, curated overrides, the admin-editable DB rules
  and the keyword classifier were already shared. The model's `trade` is used
  **only** when all of those return nothing, and is labelled `(AI)` when it is —
  a cold read must never outrank what this team's own assignments have taught.
- **Trade-off — cost, which is why it's gated.** A page costs ~2,300 tokens as
  an image+text pair against ~350 as text: roughly **15c → 40c on a 25-page
  report**. Three guards: manager-only, ≤60 pages, ≤11 MB, each falling back to
  the flat read with a toast rather than quietly spending the money. Deep read
  is also SLOWER (adaptive thinking on a 40-page PDF is a real wait), so it is a
  checkbox, not the default for everyone.
- **Trade-off — precision over recall on photos.** An anchor that can't be found
  on its page gets NO photos, rather than a guess. A photo attached to the wrong
  defect is worse than one not attached, because it goes to a supplier. The one
  exception is a page holding exactly one defect, where a top-of-page fallback
  can't mis-attach. Cross-page carry is capped at `ANCHOR_CARRY_PAGES = 2` so a
  photo appendix 15 pages later can't pile onto the last item.
- **Also:** both paths moved to `claude-opus-5` (the function was on
  `claude-opus-4-8`, same price) and both now **stream** — a non-streaming
  request long enough to read 40 pages is refused by the API outright.
- **Needs a manual deploy:** `supabase functions deploy extract-defects`. Until
  that runs, `extractDeep` gets an error back and the app falls back to the flat
  AI read — degraded, not broken.

## 2026-08-02 — View Defects header: one line of icons, and frozen
- **Decision:** The View Defects toolbar is now a **single row that never
  wraps**, on every screen that has one (address/job, supplier, trade, multiple
  suppliers, All Defects). Two controls were collapsed to make it fit: the
  `Filter ●●● ▾` pill became one **funnel icon**, and the `LIST | PREVIEW`
  segmented control became **one toggle icon** showing the view you'll get when
  you tap it. The whole `.defects-header` (job title + toolbar) is now
  `position: sticky`, frozen under the blue app header, which is itself frozen
  under the cloud-sync status bar.
- **Why:** Spiro, from site: the header was taking two lines and the controls
  scrolled away, so filtering or refreshing meant scrolling back to the top of a
  long job. The wrap was added on 2026-08-01 because a no-wrap row pushed the
  Filter button off the left edge — but the real problem was that the two
  labelled controls cost more width than all six action icons combined. Removing
  the labels fixes the width properly instead of spending a second line on it.
- **Trade-off:** The three status dots no longer show the filter at a glance.
  Mitigated: the funnel carries a **red dot whenever Open or Pending is hidden**
  — i.e. whenever the filter could make a job look finished when it isn't — and
  the button's tooltip/aria-label names exactly which statuses are showing. A
  dot for "Completed hidden" was deliberately NOT used: that is the default, so
  the warning would be on permanently and mean nothing. Toolbar icons also
  shrink with the viewport (`clamp(18px, 5.8vw, 26px)`), so on a 320px phone the
  seven-control supplier toolbar is smaller than it was — still a comfortable
  tap target, and verified fully inside the screen edge.

## 2026-08-02 — Spiro's emoji picks
- **Decision:** Ten glyph changes chosen from a five-option-per-icon comparison:
  filter `🚦`, list view `☰`, preview view `🖼️`, email `📧`, add `✚`,
  photo dump `🎞️`, send `📨`, photos `📸`, import contact `📱`, call `☎️`.
- **Why:** worth recording two of them. **`🚦` for the filter** is the best idea
  in the set — the three statuses it selects ARE red, amber and green, so the
  glyph states what the control does rather than gesturing at "filtering". And
  the filter, list and preview toggles were the last drawn SVGs in the app; with
  these they're gone, so the whole set is now one medium.
- **Trade-off / watch item:** `📨` (send) and `📧` (email) are both envelopes and
  sit **adjacent** once a supplier's send group is expanded. The chooser only
  ever showed the group collapsed, so that pairing wasn't visible when it was
  picked. On Apple's set they differ by an arrow vs an @; on Google's they're
  closer. If it reads badly on site, `📤` for send separates them cleanly and is
  a one-line change.
- Also note `🖼️` moved from photo dump to the preview toggle, and photo dump
  took `🎞️` — deliberate, avoiding a collision.

## 2026-08-02 — Emoji icons stay. The drawn set was built, shipped, rejected.
- **Decision:** Reverted `2026-08-02h`, which replaced all 32 emoji controls with
  a one-family line-SVG set. The app is back on emoji, with four consistency
  fixes applied on top:
  1. **One plus.** The toolbar's `➕` (a dark, heavy glyph) became `＋`, which is
     plain text and so inherits `.icon-btn`'s blue — matching the home job rows
     and the blue funnel sitting beside it. Two buttons doing the same thing no
     longer look different.
  2. **One envelope.** `📧` in toolbars and `✉️` on supplier headings both meant
     "email this". Now `✉️` everywhere — the simpler shape, better at 19px.
  3. **Add Report is `📥`, not `📄`.** It sat directly above `📑 Generate PDF
     Report` in the reports list as a second pale page; on iOS they were near
     indistinguishable. A tray says "bring one in", which is the action.
  4. **`🙈` is gone.** The see-no-evil monkey was the "hide completed" state. One
     `👁️` for both states — the button already goes solid blue when completed
     are showing, which was always the clearer signal.
- **Why:** Spiro, on seeing it live: *"These icons suck."* The drawn set was
  technically the better system — one grid, one weight, theme-aware, no vendor
  drift — and it was still wrong. Emoji carry **colour**, and on a list of four
  near-identical actions colour is doing more work than stroke consistency ever
  could: a yellow card index, a red-arrow tray, a blue-tabbed document and a
  grey bin are told apart in peripheral vision. A monochrome set threw that away
  and asked shape alone to carry it at 19px.
- **Trade-off accepted:** emoji render as a different typeface on every platform
  and can't take the app's accent. That inconsistency is real and is being
  **kept on purpose**, because it buys colour.
- **Don't redo this.** The full five-way comparison was built, rendered at true
  phone size, chosen from, implemented across ~142 call sites and shipped. It
  lost on the phone. If someone proposes drawn icons again, the answer is that
  it was tried on 2026-08-02 and reverted the same day — and the reason was
  colour, not craft.

## 2026-08-02 — Job heading: own line, one line, auto-fitted
- **Decision:** On the job and supplier screens the heading keeps its **own
  row**, with the toolbar on the row below, at **17px**. The title renders in
  parts — street (ellipsises), job number (never shrinks) — the **suburb is left
  out**, and `fitLotTitle()` steps the size down 17px → 14px if a very long
  address would otherwise wrap or clip. The duplicate `＋` came off the title;
  the toolbar's ➕ does the same thing.
- **Why:** the heading and the toolbar were tried on ONE shared line first
  (115px → 44px), and on paper it won. On a real job it didn't: it squeezed the
  address to 13px and *still* clipped it — "Lot 1207, (28) Mimo… - 303719".
  Spiro called it, and he was right. The address is the one thing on this screen
  you cannot reconstruct from context; the toolbar is six icons you already know.
  So the address gets the full width and a readable size, and the toolbar pays
  the second row.
- **Trade-off:** the header is **78px, not 44px** — 37px per screen given back to
  keep the address whole and legible. Still 37px better than the 115px it
  started at, because dropping the suburb and pinning the job number mean the
  address no longer wraps to two lines. Measured un-clipped at 17px from 320px
  to 430px.
- **The general lesson:** the shared line optimised the measurable thing (pixels)
  at the cost of the thing that mattered (reading the address). Check a layout
  win against the worst real record, not the tidy one.

## 2026-08-02 — Job + supplier screen headings drop the italic caps
- **Decision:** On the View Defects and View Supplier screens, the screen title
  and the `.lot-title` now use **Titillium Web 700, upright, as-typed** — the
  same three properties an index job row uses — instead of 900 italic uppercase.
  The home hero keeps its italic caps.
- **Why:** Spiro: the defects screen "seemed like a different font" to the index.
  It wasn't — computed styles confirm the index job rows, the defect rows and
  these headings were all already Titillium Web. The difference was weight,
  slant and case, so that's what changed. (Same finding as 2026-07-30 on the
  supplier headings, one level up: check the computed style before swapping a
  family.) The hero is the app's masthead, not a page heading, and isn't part of
  what changes underfoot.
- **Trade-off:** The screens read quieter — the italic caps were doing the work
  of signalling "you are inside a job". The frozen header carries that now, and
  it's a better signal because it stays on screen. Sentence case is narrower
  than caps, so the lot title fell from **56px to 28px** — one line instead of
  two — and on a frozen block every one of those pixels goes back to the list.

## 2026-08-02 — Supplier heading on one line
- **Decision:** The supplier heading inside a job is now a single non-wrapping
  line. Three changes bought the width: the name takes every pixel the actions
  don't and **ellipsises** instead of wrapping; the booking date shows **DD/MM**,
  no year; and the three send icons (✉️ 🔗 📑) collapsed into **one 📤 that
  expands into all three when tapped**, one heading at a time.
- **Why:** Spiro, with a screenshot: "AUZ PAINTING & DECORATING PTY LTD" was
  taking three lines, because the name couldn't shrink (no `min-width: 0`) and
  the five actions wouldn't. Three lines of heading per supplier on a job with
  eight suppliers is most of a screen spent on names you already know.
- **Trade-off:** A long trading name is now truncated — "AUZ PAINTING &
  DECORA… ›". The full name is in the element's `title` and one tap away on the
  supplier's own screen, and the `›` is a separate element so it survives the
  truncation and the heading still reads as tappable. The year leaving the
  booking button is display-only: `fmtDateNice` and its year still drive every
  report and email, `fmtDateShort` is used for the button alone, and that
  button's tooltip reads "Attending 07/08/2026 — tap to change".
- **Follow-up the same day:** once a date is set the 📅 goes too — the date
  itself is the button. The icon was only ever saying "this is a date", which
  the date says on its own; with no date there's nothing to show, so the icon
  stays as the thing you tap to add one. Tapping the date opens the same picker,
  so it stays editable. 11px of blue text is a small target on site, so
  `.date-only` pads it to 42×29 and cancels that padding with an equal negative
  margin — the tap area grows, the heading stays 22px.

## 2026-08-02 (later) — Make it a SINGLE tap
- **Decision:** One tap on a defect row opens its pencil / pin / camera. Tap
  again, or open another row, to close. The double-tap detector and its 450ms
  window are deleted.
- **Why:** Spiro used it on site. Double tap is a gesture you have to be *told*
  about; a single tap is the one every thumb tries first. The timing window also
  had a quiet failure mode — a second tap that arrived at 500ms did nothing at
  all, which reads as the app ignoring you.
- **Trade-off:** a mis-tap now opens a row rather than doing nothing, so the
  list shifts under your thumb more often. Cheap to undo (tap again) and worth
  it against a gesture nobody discovers. `user-select: none` stays on rows —
  without it a stray double tap selects a word and raises the iOS callout menu
  over the strip you just opened.

## 2026-08-02 — Row actions on demand: double-tap to open a defect row
- **Decision:** The pencil / pin / camera no longer sit on every list row. A
  **double-tap** on a row opens them as a full-width strip underneath it, at
  19px instead of 13px; a **single tap** on an open row closes it again. Only
  one row is open at a time. A faint `⋯` at the right edge is the affordance,
  becoming `✕` when open. Applies to every screen that renders `.defect-item`,
  since it is one delegated listener plus CSS on the shared row.
- **Why:** Spiro, with a screenshot: any description longer than about four
  words pushed the icons onto a second line, so a three-word defect and a full
  sentence cost the same two lines — the wording was what got squeezed. Measured
  on his own ten Htee Kleeh items at 390×700: list height **528px → 436px**, and
  **8/10 rows visible on one screen → 10/10**. "Replace hinges to external door"
  went from two lines to one.
- **Trade-off:** The location text and the photo count are no longer visible at
  a glance — you have to open the row to see them. Accepted as asked for; if the
  photo count turns out to be worth its width, a 6px dot on the row is the
  cheap version. Text selection is also off on rows (`user-select: none`), which
  is what stops iOS answering a double-tap by selecting a word and raising the
  callout menu instead of opening the row; copying a single description is lost,
  and Copy to Clipboard still exports the whole list.

## 2026-08-02 — Preview mode reaches the supplier screen
- **Decision:** `renderViewDefectsContractor` now honours preview mode and
  carries the toggle icon, rendering walk-the-house cards grouped by address
  with a per-address "N of M outstanding" count. Trade, multiple-suppliers and
  All Defects stay list-only and carry no toggle.
- **Why:** `dm_preview` is one global flag but only the address screen read it,
  so a supervisor who turned Preview on and then opened a supplier silently got
  compact rows back — the setting looked broken. The supplier screen is a
  walk-the-house screen too: one trade's outstanding items across their jobs.
- **Trade-off:** The supplier toolbar is now eight controls on one line. At
  320px they shrink to ~18px, the floor of the `clamp()`. Verified as still one
  row inside both screen edges; anything further would need the row to scroll.
  Completed items stay as compact rows underneath the cards on both screens —
  they're a record, not something you tick off on site.

## 2026-08-02 — `overflow-x: clip` on body, never `hidden`
- **Decision:** The three `html, body { overflow-x: hidden }` rules now set
  `hidden` on `html` only; `body` gets `overflow-x: clip`.
- **Why:** `overflow: hidden` makes body a **scroll container**, and every
  `position: sticky` descendant then anchors to a box that never scrolls. The
  app header has been declared `position: sticky` for a long time and has never
  actually stuck because of this — it scrolled away with the list. `clip` clips
  identically without creating a scroll container.
- **Trade-off:** `overflow: clip` needs Safari 16+ / Chrome 90+. Older browsers
  drop the declaration, leaving body at `visible` — but `html` keeps `hidden`,
  which propagates to the viewport, so sideways drag is still impossible. The
  degradation is "sticky doesn't stick", i.e. exactly today's behaviour.

## 2026-07-27 (b) — ROOT CAUSE of "says it saves but it's not there"
- **Decision:** Defect ids are no longer recycled (persisted high-water mark in
  `dm_defect_id_hw`, raised on every load/save), and `isTombstoned()` only trusts
  a **legacy-id** tombstone match for a defect that actually came from the cloud
  (has a uuid, or a snapshot baseline entry).
- **Why:** `addDefect()` allocated `max(existing id) + 1`, so deleting the
  highest defect handed its id to the next brand-new one. That id is the
  `legacy_id` the cloud upserts on, and CH Tracker's delete-archive keeps
  tombstones for 60 days. So a new defect could inherit a deleted defect's id,
  match its tombstone in `commitDefect()`, and be `purgeLocalDefect()`d
  milliseconds after the "✓ saved successfully" toast — the defect saved, then
  vanished. Because it never reached the cloud, any attached photo stayed in the
  IndexedDB outbox forever, which is the "📸 1 photo saved on this phone ·
  uploading when you have signal" banner in the original bug report. One root
  cause, both symptoms.
- **Trade-off:** If a previously-synced defect loses BOTH its uuid and its
  snapshot baseline (e.g. `healStaleBaseline()` clears a poisoned baseline), a
  genuinely deleted defect could be re-created instead of purged. Accepted
  deliberately: resurrecting a deleted defect is visible and recoverable,
  silently deleting a just-logged one is neither. The uuid match still covers the
  normal case.

## 2026-07-27
- **Decision:** A supplier name **typed in full** is now accepted on the Add
  Defects screens, not only one tapped from the suggestion list. If the name
  can't be resolved (unknown, or ambiguous across two suppliers) the save is
  **refused with a message naming the block**, and nothing is written.
- **Why:** `saveAddDefectsAddress()` only ever read the id set by tapping a
  suggestion. Typing the name in full and going straight to the defect rows —
  normal on a phone, where the keyboard covers the dropdown — left that id
  unset, so the whole block was skipped. If another block *did* save, the
  supervisor got "✓ 1 defect(s) added successfully" while the other supplier's
  defects were silently discarded. This is the "can't save defects" report.
- **Trade-off:** Saving is now all-or-nothing per tap: one unresolvable block
  blocks the whole save rather than partially writing. Chosen deliberately —
  the typed text stays on screen to correct, and a partial save that looks
  complete is what caused the lost work in the first place.

- **Decision:** The duplicate guard in `db.addDefect()` now matches on
  **address + description + supplier**, instead of address + description.
- **Why:** The same wording legitimately applies to two trades on one job
  ("Touch up paint to hallway" for the painter and the plasterer). The old
  guard swallowed the second one and handed back the first supplier's defect,
  so that work never reached the trade it was raised against.
- **Trade-off:** Two suppliers can now hold identically-worded defects on one
  job. The double-tap protection still holds because the supervisor fallback
  now resolves *before* the comparison, so both sides carry the same supplier.

- **Decision:** `initializeAddressDefectForm()` / `initializeContractorDefectForm()`
  now return early when their container is absent; `db.save()` catches a failed
  `localStorage` write and warns instead of throwing silently.
- **Why:** Both containers were deleted when the five-block form landed, so
  every "＋ Add defects" tap threw a TypeError. A full/blocked localStorage
  (private browsing, iOS evicting the origin) discarded the write with no
  indication — indistinguishable from "I saved it and it disappeared".
- **Trade-off:** The two legacy functions are left in place behind the guard
  rather than deleted, to keep this change small; they are dead code and can go
  in a separate tidy-up.

## 2026-07-23
- **Decision:** Added a multi-select **status filter** (Open / Pending / Completed)
  to the View Defects toolbar on both the address and contractor screens. A pill
  at the left of the toolbar shows coloured dots for the active statuses and opens
  a small modal where each status toggles independently.
- **Why:** Supervisors asked to filter the list by status and show/hide any
  combination — e.g. just outstanding (pending), or reveal completed inline.
- **Trade-off:** The old per-job "Show N completed" expand button was removed;
  Completed visibility is now driven by the filter (default hides it, so the
  everyday list is unchanged). Filter state is session-only (not persisted).
