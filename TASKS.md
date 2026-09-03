# Tasks

## Current sprint
- [ ] **Confirm a plan actually opens on a phone for a job that has one.**
      Needs CH Tracker migration 101 applied and a plan uploaded against that
      job number.
- [ ] **Check the live `dm_contractors` for damage from the id collision**
      (fixed in `2026-08-15p`). Two phones could allocate the same `legacy_id`,
      and the second push overwrote the first contractor's row. Look for
      contractors supervisors say they added that are not there, and for ones
      a manager shared that went back to private. The fix stops it recurring
      but cannot bring back an overwritten row.
- [x] **The defect-wordings migration is run** — `2026-09-02_defect_wordings_admin.sql`,
      confirmed 2026-09-02 (`svladimiroski@hotmail.com | is_wordings_admin = true`).
      ⚠️ Do NOT run the older `2026-08-15_defect_wordings.sql`; it would put back
      the manager-wide write policy the September file replaced.
- [x] **Temp jobs** — admin-only one-off maintenance jobs at the bottom of the
      home screen, local to the handset, never uploaded, permanently deleted.
      Build `2026-09-03a`, covered by `tests/tempjob.mjs` (suite 27).
- [ ] **Try a temp job on the phone**: add one, dump a few defects with photos
      onto it, mail the report, then delete it — and confirm nothing about it
      appears on a second device after a sync on both.
- [ ] **Confirm Bricklayer, Tiler, Renderer and Landscaper exist as
      contractors / trade placeholders.** 8 of the 62 wordings sit under
      them; if the trades don't exist those wordings can never be reached by
      picking a supplier. The editor flags them amber, so this is visible on
      the screen itself — either add the trades or move the wordings.
- [x] **The curated defect-wording list is live** — 62 items across 12 trades,
      seeded into `dm_defect_wordings` and compiled into index.html as the
      offline/pre-migration fallback.
- [ ] Get a supervisor to confirm on a real phone that the chips are now
      fully visible. Two previous builds claimed this fixed and weren't —
      do not mark it done on the strength of the test suite alone.
- [ ] Decide on the site suggestion: reorder Bulk Import so the fields and
      chips sit at the top and the photo needs scrolling to see. Would make
      the problem structurally impossible instead of scroll-dependent.
- [ ] Ask Spiro to confirm Painter / Carpenter / Cleaner / Caulker /
      Supervisor / Plumber / Electrician / Brick Cleaner / Site Cleaner are
      all live, active contractors/trade placeholders — both the Bulk Import
      chips AND the regular Add Defects sort now depend on it.
- [ ] Get a supervisor to confirm on a real iPhone that Bulk Import no longer
      jumps around while tagging photos. Can't be verified from this
      environment — headless Chromium doesn't open a real keyboard.
- [ ] Watch the first supervisor who changes their password: the other-devices
      warning is the part most likely to be misread on site.

## Backlog (prioritised, top = next)
- [ ] Consider preserving the typed/tapped trade word on an unassigned Bulk
      Import defect (currently discarded, same as typing one today) — needs
      a new field through db.addDefect + cloud-sync + a Supabase migration,
      not a quick edit. See NEXT_STEPS.md.
- [ ] Renew or delete `VERCEL_TOKEN` — it is stale, and a CLI that dies with
      "User not found" during a deploy reads as a failed deploy when the
      git-linked build has already shipped.
- [ ] Add the app URLs to the Supabase redirect allow-list and configure SMTP,
      or "Forgot your password?" cannot deliver — see "TWO DASHBOARD STEPS" in
      NEXT_STEPS.md. The in-app change works without either.
- [ ] Decide what to do about `ALIAS_PASS`: a working manager password sits in
      public JavaScript. See "ONE THING FOR SPIRO TO DECIDE" in NEXT_STEPS.md.
- [ ] Run the two outstanding Supabase migrations by hand — see the
      "TWO MANUAL STEPS OUTSTANDING" section of NEXT_STEPS.md.
- [ ] Watch the first real job list with location codes on the rows: if a
      supervisor reads a code and can't match it to the BPI page, that entry in
      `LOCATION_ABBR` is wrong, not the idea.

## Done
- 2026-08-15 — BPI defect-wording suggestions as you type, narrowed by the
  selected contractor's trade, on BOTH Add Defects and Bulk Import. Sourced
  from `bpi_training_examples` (the readable observations behind CH Tracker's
  Admin → BPI AI → Training tab) — `dm_trade_learning` could NOT be used, its
  `phrase_key` is normalised beyond recovery. `tests/bpidesc.mjs`. Build
  `2026-08-15i`.
- 2026-08-15 — Shipped build `2026-08-15g` (bundles `f` + `g`): trade-first
  sort in the regular Add Defects screen, and the same ranking in Bulk
  Import's typed Supplier search. Vercel verified; live files hashed
  byte-identical to the tested tree.
- 2026-08-15 — Bulk Import's typed Supplier search gets the same trade-first
  ranking as Add Defects (word-prefix `matchesSearch`+`searchRank`, not the
  old plain substring filter) — "speed up entries, minimal finger clicks."
  `tests/bulkphoto.mjs`. Build `2026-08-15g`.
- 2026-08-15 — Trade placeholders (Carpenter, Caulker, Cleaner, …) now sort
  ahead of named companies in the regular Add Defects screen's Supplier
  field too, same reasoning as the Bulk Import chips — a re-sort of real
  contractor rows, not a new mechanism. `tests/adddefects.mjs`. Build
  `2026-08-15f`.
- 2026-08-15 — Fixed the trade chips within the hour: they were only ever a
  thin cut-off sliver above Skip/Save & Next on a real phone with the keyboard
  up. `scrollIntoView` on the chip panel after it renders. Build `2026-08-15e`,
  deployed.
- 2026-08-15 — Bulk Import: nine one-tap generic-trade chips (Painter,
  Carpenter, Cleaner, Caulker, Supervisor, Plumber, Electrician, Brick
  Cleaner, Site Cleaner) on the Supplier/Trade field — a shortcut for typing
  the word, resolved through the existing exact-name match. Also fixed a
  latent stacked-timer bug in bulkComboBlur found while testing it.
  `tests/bulkphoto.mjs`. Build `2026-08-15d`, deployed.
- 2026-08-15 — Bulk Import: removed the unsolicited auto-focus, shrank the
  photo to a thumbnail while a field is focused, and tracked visualViewport so
  the fixed overlay stops getting clipped by the iOS keyboard. `tests/bulkphoto.mjs`.
  Build `2026-08-15c`, shipped as part of `2026-08-15d`.
- 2026-08-15 — Re-stamped to `2026-08-15b` to force every phone to refetch the
  shell. No code change — four stamp lines only.
- 2026-08-15 — Shipped build `2026-08-15a`. Vercel verified; live files hashed
  byte-identical to the tested tree.
- 2026-08-15 — Users can change their own password. Three entrances to one card:
  🔑 in the status bar, Settings → Your login, and "Change password" on the
  sign-in screen itself (no session needed — the current password is the proof).
  Plus "Forgot it?" and the reset link landing back in the app. None of it
  existed before. `tests/pass.mjs`. Build `2026-08-15a`.
- 2026-08-12 — 📋 Copy address on the View Defects job header too. Build `2026-08-12c`.
- 2026-08-12 — 📋 Copy address on the top-search rows. `tests/addrcopy.mjs`.
  Shipped as build `2026-08-12b`.
- 2026-08-12 — Location leads the defect row (`BPI #18 (p.7) — GAR INT PA —
  item`), a floor-plan code on screen and the full room name in every text
  output. `tests/loc.mjs`. Shipped as build `2026-08-12a`.
- 2026-08-07 — Every generated PDF is named after what is in it.
