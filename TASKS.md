# Tasks

## Current sprint
- [ ] Deploy build `2026-08-10a` (location on the defect row) — merge
      `claude/defect-location-display-uqef29` to `main`; pushing `main` ships it.

## Backlog (prioritised, top = next)
- [ ] Run the two outstanding Supabase migrations by hand — see the
      "TWO MANUAL STEPS OUTSTANDING" section of NEXT_STEPS.md.
- [ ] Watch the first real job list with location codes on the rows: if a
      supervisor reads a code and can't match it to the BPI page, that entry in
      `LOCATION_ABBR` is wrong, not the idea.

## Done
- 2026-08-10 — Location leads the defect row (`BPI #18 (p.7) — GAR INT PA —
  item`), a floor-plan code on screen and the full room name in every text
  output. `tests/loc.mjs`.
- 2026-08-07 — Every generated PDF is named after what is in it.
