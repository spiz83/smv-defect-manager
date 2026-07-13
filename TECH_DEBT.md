# Defect Manager — Technical Debt (ranked by impact)

_Audit date: 2026-07-13._

| Rank | Debt | Impact | Effort | Risk to fix |
|-----:|------|--------|--------|-------------|
| 1 | **No automated tests** | Every change is a manual gamble; the sync engine is subtle and has already caused field incidents | High | Low (adding tests can't break prod) |
| 2 | **8,847-line single `index.html`** (UI + logic + data layer) | Hard to navigate/review; merge-conflict prone; onboarding-hostile | High | High (any split can break onclick wiring) |
| 3 | **`db` object is both data layer and global state** | No separation of concerns; mutations are ad-hoc | High | High |
| 4 | **`render()` full-body rebuild** | Perf ceiling + loses DOM state | Med | High |
| 5 | **Inconsistent HTML escaping** (30 `innerHTML` sinks) | Stored-XSS surface; blocks external use | Med | Med (needs device visual check) |
| 6 | **No structured logging / error reporting** | Field errors are invisible; hard to diagnose remotely | Med | Low |
| 7 | **In-place `.sort()` in accessors** | Mutation smell + repeated work | Low | Low |
| 8 | **Possible dead functions** (`handleBackupImport`, `setTheme`, `renderThemePicker`, `setShowInactiveJobs`, `filterMyJobs` flagged) | Bloat | Low | **Med — likely false positives wired via inline `onclick`; verify each before removing** |
| 9 | **Magic numbers** (250 KB, 1280 px, 3.5 s, 42-day expiry) scattered | Minor readability | Low | Low |
| 10 | **Two deploy targets** (Vercel + GitHub Pages) kept in sync by hand | Drift risk | Low | Low |

## Guidance on the top items
- **#1 (tests)** is the highest-leverage, lowest-risk investment. Start with the
  sync engine's reconciliation (legacy_id vs uuid), the trade allocator, and the
  PDF/email body builders — pure functions that can be unit-tested by extracting
  them behind `window.__test` hooks without a build step.
- **#2 / #3 / #4** are genuine but must not be attempted as an unattended
  refactor: they change the highest-risk, least-tested code with no CI net.
  Schedule them behind a test suite (#1) and device verification.
- **#8**: the dead-code scan flags functions that are almost certainly reached
  via `onclick="fn()"` inside HTML template strings. Do **not** bulk-remove;
  verify each individually. Expected true-dead count is small.
