# Tasks

## Current sprint
- [ ] Ask Spiro to confirm Painter / Carpenter / Cleaner / Caulker /
      Supervisor / Plumber / Electrician / Brick Cleaner / Site Cleaner are
      all live, active contractors/trade placeholders — the new Bulk Import
      chips only assign for real if the name matches one. Build `2026-08-15d`.
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
