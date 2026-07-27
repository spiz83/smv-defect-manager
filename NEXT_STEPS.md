# Next Steps / Handover

STATUS: Active
LAST UPDATED: 2026-07-27

## Current state
Investigated a supervisor report of "can't save defects". Reproduced three
separate faults in a headless Chromium harness driving the real UI (iPhone
viewport, local-only mode) and fixed all three on
`claude/defect-save-issue-ie4rg0`:

1. **Typed-but-not-tapped supplier lost the whole block.**
   `saveAddDefectsAddress()` read only the id set by tapping a suggestion, so a
   fully-typed supplier name left it unset and the block was skipped. With a
   second block that *did* resolve, the toast said "✓ 1 defect(s) added
   successfully" while the other supplier's defects were dropped with no
   warning. Now resolved from the typed text; unresolvable blocks refuse the
   save and name the block. Same fix applied to `saveQuickDefectsForAddress()`.
2. **`initializeAddressDefectForm()` threw on every "＋ Add defects" tap.**
   It writes to `#contractor-groups-container`, deleted from the markup when the
   five-block form landed, so the lookup returned null. Same for
   `initializeContractorDefectForm()` / `#address-groups-container`. Both guarded.
3. **Duplicate guard ignored the supplier.** Identical wording for two trades on
   one job silently returned the first supplier's defect. Now scoped to the
   supplier; the supervisor fallback resolves before the comparison so the
   double-tap guard still holds.

Also: `db.save()` now catches a failed `localStorage` write and warns, instead
of discarding the entry silently. sw.js CACHE + APP_VERSION bumped to
`2026-07-27a`.

Verification: 17/17 targeted assertions pass, 9/9 view smoke checks pass, no
page errors. Harness in the session scratchpad (`t6-verify.mjs`, `t7-smoke.mjs`).

## Deploy status — LIVE (2026-07-27c)
All three fixes deployed to Vercel production and verified:
`https://smv-defect-manager.vercel.app/sw.js` serves `deffixer-shell-2026-07-27c`.
`main` is at `aaa1623`. (Deploys are manual — the sandbox cannot reach
`*.vercel.com`/`*.vercel.app`; Spiro runs `npx vercel deploy --prod`.)

Three separate faults were found and fixed today, in order of discovery:
1. **`a`** — Add Defects silently discarded a supplier block when the name was
   typed but not tapped; dead `initializeAddressDefectForm()` threw on every
   "+ Add defects"; duplicate guard ignored the supplier.
2. **`b` — the reported bug.** Defect ids were recycled (`max+1` after a
   delete), so a new defect could inherit a deleted one's id, match its 60-day
   delete-archive tombstone in `commitDefect()`, and be purged milliseconds
   after "saved successfully". Its photo then queued forever — the original
   screenshot's banner. Fixed by a persisted id high-water mark plus an
   `isTombstoned()` that only trusts a legacy-id match for cloud-originated rows.
3. **`c`** — `pullAll()` aborted whenever the outbox was non-empty, and an entry
   whose job was unmapped could never commit → the device stopped pulling
   permanently and drifted from CH Tracker with no error. The pull now carries
   un-pushed rows across the rebuild instead of blocking.

## Verify after any further change
Harness lives in the session scratchpad; re-create if needed. Serve the repo on
:8099 and run against a real Chromium (service workers MUST be blocked, and any
localStorage seed MUST be idempotent or a reload fakes a "data disappeared"
result):
- `t6-verify` 17 save assertions, `t7-smoke` 9 view checks,
  `t8-visible` save→view→reload visibility, `t9-idreuse` id-recycling regression.

## Immediate next actions
1. **Confirm the repair on a real phone.** Lot 1143 (27) Fuchsia St, 306645 was
   the evidence: CH Tracker 26 active / 51 total, phone only 7. After `c`, that
   phone should return to 26 active on its next launch. Not yet confirmed.
2. Tell supervisors: saving is now all-or-nothing per tap — an unrecognised
   supplier refuses the whole save and names the block (text is kept on screen).
   Without warning this reads as a new fault.
3. Leftover orphan photos: a phone may still show "photo saved on this phone"
   for a photo whose defect was destroyed by bug 2. The photo is safe but has
   nothing to attach to; re-log the defect and re-attach. No automatic cleanup
   was written — deleting photos on a "missing defect" heuristic is unsafe,
   since a defect can also just not have synced down yet.

## Blockers / questions for human
- **Not reproducible in this sandbox: the stuck-photo path.** The screenshot
  shows "📸 1 photo saved on this phone · uploading when you have signal", which
  is the IndexedDB outbox in `cloud-sync.js`. A photo only uploads once its
  defect has a cloud uuid, and `commitDefect()` returns early while
  `idMap.addresses[d.addressId]` is unmapped (cloud-sync.js:1986) — if a job
  never maps for that user (RLS scope, or the pull never landed), the defect
  never reaches the cloud and its photo stays queued indefinitely. The sandbox
  network policy blocks `*.supabase.co`, so this could not be exercised here and
  is **diagnosis, not a confirmed finding**. Needs a real signed-in device, or
  someone to read that phone's console for `[CloudSync] commitDefect queued #…`.
