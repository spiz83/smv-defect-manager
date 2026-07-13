# Defect Manager — Engineering Report

_Audit date: 2026-07-13. Auditor: automated principal-engineer pass._
_Scope: `index.html`, `cloud-sync.js`, `sw.js`, `supabase/functions/extract-defects`, `scripts/`._

## 1. What this app is (mental model)

A **single-file, no-build, vanilla-JS PWA** used by ~5 site supervisors on
phones to log building defects, allocate them to trades/contractors, and
email/SMS them out. It is the field companion to CH Tracker and **shares the
same Supabase database** (`cubwwnvzmeydyixhetfb`).

| File | Lines | Role |
|------|------:|------|
| `index.html` | 8,847 | Entire UI + app logic in one inline `<script>`; `db` object-literal is both data layer and state; `render()` rebuilds `document.body` on every action |
| `cloud-sync.js` | 2,107 | Supabase sync engine: pull/push, dirty-flag, durable outbox, idMap, photo capture/compress/upload, gallery |
| `sw.js` | 111 | Service worker: offline shell, network-first for app code, 3.5 s dead-zone race |
| `supabase/functions/extract-defects` | ~120 | Deno edge fn: report text → Claude → `{defects[]}`; keeps `ANTHROPIC_API_KEY` server-side |
| `scripts/*.mjs` | — | One-off admin tooling (manager bootstrap, user confirm) using the Management PAT / service_role from env |

**Stack:** no framework, no bundler, no test runner. State = a global `state`
object + `db.data`, persisted to `localStorage` and synced to Supabase. Auth =
Supabase Auth; row access = RLS (mostly `authenticated`-scoped). Deploys to
Vercel **and** GitHub Pages on push to `main`.

## 2. Data flow

```
UI event → mutate db.data → db.save() (localStorage + mark cs_dirty)
        → render() (full body innerHTML rebuild)
        → cloud-sync pushes dirty rows to Supabase (outbox if offline)
Supabase → cloud-sync pull → reconcile by legacy_id/uuid → db.data → render()
Photos   → compress ≤250 KB → Storage upload → durable IndexedDB outbox until acked
```

## 3. Strengths (do not "refactor away")

- **Hard-won offline/sync resilience.** The dirty-flag + durable outbox +
  persisted idMap + pull-wins concurrency were each added after a real
  field incident (duplicates, reverts, contractor wipe, lost photos). This is
  the most valuable and most fragile code in the repo. Treat it as load-bearing.
- **Secrets are handled correctly.** `ANTHROPIC_API_KEY` lives only in the edge
  function's env; the browser only holds the Supabase **anon** key (public by
  design). No service_role or provider key is hardcoded in shipped files.
- **Cache/version discipline** (added 2026-07-13): visible build stamp +
  cache-nuking refresh button, so "is the phone updated?" is now answerable.

## 4. Top issues (ranked; full detail in the specialised reports)

| # | Issue | Severity | Report |
|---|-------|----------|--------|
| 1 | No automated tests anywhere; correctness lives in one person's head | High | TECH_DEBT |
| 2 | `render()` re-serialises the whole `<body>` on every action | Med (latent) | PERFORMANCE |
| 3 | 30 `innerHTML` sinks, inconsistent HTML-escaping of user text | Med (5 trusted users) | SECURITY |
| 4 | `extract-defects` has no input-size cap → per-call cost abuse | Med | SECURITY |
| 5 | 8,847-line single file; no module boundaries | Med | TECH_DEBT |
| 6 | In-place `.sort()` in `getAddresses()`/`getContractors()` on every call | Low | PERFORMANCE |
| 7 | 12 bare `console.*` in shipped code; no error reporting | Low | ENGINEERING (below) |
| 8 | Possible dead functions (needs per-function verification) | Low | TECH_DEBT |

## 5. Bugs & correctness observations

- **No confirmed live bugs found in this pass.** The recent incident history
  (duplicate defects, completion reverts, photo loss, contractor wipe, blob:
  share leak) has all been addressed and is documented in project memory.
- **`render()` full rebuild + `isBusyEditing()` guard** is the correct pattern
  given the architecture, but it means any future async work must re-check
  `isBusyEditing()` before mutating the DOM (already respected in cloud-sync).
- **Logging:** 12 `console.*` calls ship to production with no gating and no
  remote error capture. A supervisor hitting an error in the field leaves no
  trace. Recommend a tiny `logError()` that (a) no-ops `console` in prod and
  (b) optionally writes to a `client_error_log` table. Low risk, high
  diagnostic value. (Documented, not yet applied — needs a table + product ok.)

## 6. What was changed in this pass

See `REFACTOR_LOG.md`. Summary: **audit + documentation only for risky items.**
Behaviour-preserving fixes were limited to what can be verified without a device
(this is an untestable-in-CI phone app), consistent with the "never break
working features" mandate. The single highest-value safe code fix identified —
an input-size cap on the edge function — is written up with a ready diff in
`SECURITY_REPORT.md` but not deployed (edge deploys need the Supabase CLI + a
go-ahead).

## 7. Per-area scores (/10)

| Area | Score | Note |
|------|------:|------|
| Architecture | 5 | Single-file, no modules; but coherent and deliberately dependency-free |
| Readability | 6 | Long but well-commented; consistent style; giant file hurts navigation |
| Performance | 6 | Fine at current scale; full-rebuild render caps the ceiling |
| Security | 6 | Secrets correct; RLS-backed; XSS-escaping inconsistent; edge fn uncapped |
| Maintainability | 5 | No tests; 11 k lines across 2 files; sync engine is subtle |
| Reliability | 8 | Offline/sync resilience is genuinely strong and battle-tested |

**Overall: production-adequate for 5 trusted users; not yet "reviewed by senior
engineers at a top lab" grade.** The gap is almost entirely **tests** and
**module structure**, both of which are large, behaviour-risky changes that
belong in a planned effort, not an overnight blind refactor.
