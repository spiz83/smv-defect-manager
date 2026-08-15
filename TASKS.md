# Tasks

## Current sprint
- [ ] Deploy build `2026-08-15a` (change password). Built and green on
      `claude/password-change-review-4egsv5`, waiting on the go-ahead.

## Backlog (prioritised, top = next)
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
