# Defect Manager — Refactor Log

_All changes 2026-07-13. Philosophy: on an untestable, live, auto-deploying field
app, ship only behaviour-preserving changes verified by static analysis; document
the rest._

## Applied (shipped)

| File | Change | Why | Safety |
|------|--------|-----|--------|
| `index.html` | Removed dead `handleBackupImport()` | 0 callers (JSON backup-import UI was retired) | Verified 0 in-file + 0 cross-file refs; parses clean |
| `index.html` | Removed dead `setTheme()` | 0 callers (light/dark mode retired; `loadTheme()` comment confirms) | Same |
| `index.html` | Removed dead `renderThemePicker()` | 0 callers (club-theme picker not rendered anywhere) | Same |
| `index.html` | Removed dead `setShowInactiveJobs()` | 0 callers (manager toggle retired) | Same |
| `index.html` | Removed dead `filterMyJobs()` | 0 callers | Same — see note below |
| `supabase/functions/extract-defects/index.ts` | Added 100k-char input cap (413) | Prevent Anthropic cost-abuse via the public anon key | Behaviour-preserving for real reports; **needs `supabase functions deploy` to go live** |
| `index.html` + `sw.js` | Version bump → `2026-07-13f` | Keep the on-screen build stamp / SW cache in step | n/a |

Net: ~90 lines of dead code removed from `index.html`; syntax verified with the
inline-script `node --check` harness.

## Notes / follow-ups surfaced
- **`filterMyJobs` had 0 callers** — the "My Jobs" list still renders
  `data-job-search` attributes, so a search box may exist in the UI without its
  `oninput` wired. Removing the function doesn't change behaviour (it was never
  called), but **the job-search box may be silently inert** — verify on device
  and either wire it back or drop the attributes. Logged in `TECH_DEBT.md`.
- **Cascade dead code (documented, NOT removed):** the removals above orphaned
  `setClubTheme`, `currentClubTheme`; the earlier email-template refactor
  orphaned `formatDefectEmailLine`. A follow-up scan also flags `exportAllData`,
  `resetDatabase`, `handleExcelImport`, `reloadContractorTrades`,
  `addDefectsByContractor` as 0-caller candidates. These need per-function
  verification (some may be `onclick`-wired in ways worth double-checking on a
  device) before a second safe removal pass. Left in place deliberately.

## Explicitly NOT done (too risky without tests + a device)
- Splitting `index.html` into modules.
- Replacing the full-body `render()` with targeted re-render.
- Routing all 30 `innerHTML` sinks through a single `escHtml()`.
- Removing the cascade dead-code candidates above.

These are the right long-term moves but are behaviour-risky changes to the
least-tested code; they belong behind a test suite + device verification, per the
"never break working features" mandate.
