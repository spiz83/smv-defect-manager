# Defect Manager — Future Recommendations

_Ranked by value-to-effort. 2026-07-13._

## Tier 1 — highest leverage
1. **Add a test harness (no build required).** Expose pure functions on
   `window.__test` (sync reconciliation, trade allocator, PDF/email body
   builders, date/format helpers) and run them with a tiny Node script + the
   existing `node --check` gate in CI (GitHub Action on push). This is the single
   change that unlocks safely doing everything in Tier 2/3.
2. **Structured logging + remote error capture.** A `logError(err, ctx)` that
   no-ops `console` in prod and best-effort writes to a `client_error_log` table
   (address, view, user, message, UA, app version). Field errors are currently
   invisible. Cheap, huge diagnostic payoff.
3. **Close the XSS surface** (`escHtml()` through all 30 `innerHTML` sinks).
   Mandatory before any external/tenant use (DefectFlow).

## Tier 2 — architecture (do behind Tier 1's tests)
4. **Split `index.html`** into `app.js` (logic), `views.js` (render), `db.js`
   (data layer) via `<script>` tags — still no bundler needed. Shrinks the
   review surface and separates concerns.
5. **Targeted view re-render** to replace the full-body `render()` — removes the
   perf ceiling and preserves scroll/focus without the `isBusyEditing()` dance.
6. **Formalise the data layer.** Make `db` mutations go through named methods
   only (no ad-hoc `db.data.x =`), so sync/dirty tracking can't be bypassed.

## Tier 3 — platform / product
7. **Native wrapper (Capacitor/PWA-to-App-Store)** — the only way to get real
   file attachments in email/SMS on iOS (the Web Share `blob:` bug is
   unfixable from a web app; see project memory 2026-07-13).
8. **Consolidate the two deploy targets** (Vercel + GitHub Pages) or drop one, to
   remove hand-sync drift.
9. **Rate-limit / auth-tighten `extract-defects`** beyond the input cap (per-user
   daily quota table).
10. **Converge with CH Tracker** per the standing roadmap — shared DB already;
    a shared component/design layer would end the double-maintenance.

## Tier 4 — polish
- Replace scattered magic numbers (250 KB, 1280 px, 3.5 s, 42 d) with named
  constants at the top of each module.
- Empty/loading/error states audit across views for consistency.
- Accessibility pass (focus order, ARIA on the icon-only action buttons).
