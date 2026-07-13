# Defect Manager — Performance Report

_Audit date: 2026-07-13. Data scale today: ~17 jobs, low-hundreds of defects,
~300 contractors, ~100 trades. All timings are architectural, not measured on a
device (no CI/device access)._

## Headline
The app is **fast enough at current scale** and the real cost is **client-side
render + bundle parse**, not the database. Nothing here is urgent; everything is
a *ceiling* that will bite as data grows, not a present-day defect.

## Bottlenecks (ranked)

### P1 — `render()` re-serialises the entire `<body>` on every action
Every status toggle, nav, add, and sync calls `render()`, which rebuilds the
whole document's `innerHTML`. Cost is O(total app), not O(changed item). At
today's counts it is sub-frame; at 10× defects it will feel sluggish and it
discards/rebuilds DOM (and scroll/focus, guarded by `isBusyEditing()`).
**Recommendation (large, deferred):** move to targeted view re-render (rebuild
only the current view container) or a lightweight keyed diff. High value, high
risk — belongs in a planned refactor with device testing, not overnight.

### P2 — `getAddresses()` / `getContractors()` sort in place on every call
Both accessors `.sort()` the underlying array **each call**, and they are called
many times per render. Micro-cost now; also a subtle mutation smell.
**Safe fix (deferred pending a device pass):** sort once on load / on mutation,
or return a memoised sorted view keyed by array length + a dirty flag.

### P3 — 536 KB single `index.html` parsed on every cold load
No code-splitting is possible without a build step (a deliberate constraint).
The service worker caches it, so warm loads are fine; cold field loads on poor
reception pay the full parse. **Recommendation:** if a build step is ever
adopted, split the report/PDF/AI code (jsPDF is already lazy-loaded from CDN).
Otherwise accept it — it is the cost of the zero-dependency choice.

### P4 — Photo pipeline is already well-optimised (PASS)
`cloud-sync.js` compresses to ≤250 KB (dimension + quality backoff) before
upload, persists originals to IndexedDB first, and self-heals on reconnect.
This is good work; leave it.

## Before / after
No performance changes were shipped in this pass (all candidates are
behaviour-risky on an untestable app). Baseline recorded above for a future
measured effort.

## Recommendations, in priority order
1. Instrument first: add a dev-only `performance.now()` around `render()` to get
   real numbers before optimising (cheap, non-shipping).
2. Targeted view re-render (P1) — the single biggest lever, when there's time to
   test on a device.
3. Memoise the sorted accessor lists (P2).
4. Only consider a build step (P3) if/when the app converges with CH Tracker.
