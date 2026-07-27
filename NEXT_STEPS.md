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

## Deploy status — LIVE
Deployed to Vercel production on 2026-07-27 (manual `vercel deploy --prod` from
Spiro's machine; the sandbox can't reach `*.vercel.com`/`*.vercel.app`).
Verified live: `https://smv-defect-manager.vercel.app/sw.js` serves
`deffixer-shell-2026-07-27a`.

`main` is at `29cdfae` and carries the same code, so a git-triggered deploy
can no longer ship an older build over the top of it.

## Immediate next actions
1. Ask the reporting supervisor **which** symptom they hit — the wording of the
   toast they saw tells us whether it was the silent block-drop (fixed here) or
   the stuck-photo path below. Quickest discriminator: log a defect + photo, then
   check another device — if the *defect* doesn't appear either, it's the
   stuck-photo/commit path, not the save bug.
2. Supervisors with the app already open may need one force-close/reopen: the
   service worker defers the swap while `isBusyEditing()` is true.
3. **Vercel git auto-deploy is unresolved.** CLI deploys work; git-triggered ones
   reportedly stopped. Ruled out: GitHub app access (installed, All repositories,
   not suspended) and the project's Git link (`spiz83/smv-defect-manager`,
   connected Jan 18, Commit Status + deployment_status events on). Still to
   check in Vercel: `Environments → Production → Branch Tracking` must be `main`,
   and `Build and Deployment → Ignored Build Step` must be empty. The push of
   `29cdfae` to `main` is a live test — if no Production deployment appeared for
   it, the webhook is stale (Disconnect + reconnect on Settings → Git).

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
