# Cleanup Report — `chore/overnight-cleanup-2026-08-02`

Branch created from `main` @ `7813923`. **`main` is not touched by this session.**
Method: `OVERNIGHT_CLEANUP.md` (adapted for a no-build, single-file PWA).

---

## 1. Health check

There is no `npm test` in this repo. Four gates stand in for it — see
`OVERNIGHT_CLEANUP.md` § GATES. They run via `gates.sh` in the session scratchpad.

| Gate | Baseline | Final |
|---|---|---|
| 1 · Parse (every `<script>` block + `cloud-sync.js`) | ok | ok |
| 2 · `no-undef` (ESLint, whole app) | 0 undefined | 0 undefined |
| 3 · Behaviour (10 Playwright suites) | 10/10 `ALL CHECKS PASSED` | 10/10 `ALL CHECKS PASSED` |
| 4 · Version stamps (4 sites identical) | ok — `2026-08-02y` | ok — `2026-08-02y` |

Version stamps deliberately **not** bumped: a cleanup pass must not ship a new
service-worker shell.

**Status: baseline recorded, all gates green. Tier A in progress.**

---

## 2. Commits

| Hash | Change |
|---|---|
| _(this file + the plan)_ | `chore(cleanup): adapt the overnight plan and record the baseline` |

---

## 3. Deleted

_Nothing yet._

---

## 4. Attempted and reverted

_Nothing yet._

---

## 5. Candidates needing your call

### The headline finding: static analysis is unusable here without a second check

ESLint `no-unused-vars` reports **142 candidates** across the app. The overwhelming
majority are **live** — functions invoked from HTML attribute strings
(`onclick="advanceStatus(3)"`), which no analyser can resolve.

Sampled from the run:

| Symbol | ESLint says | Reality |
|---|---|---|
| `advanceStatus` | unused | called from every defect row's status tab |
| `advanceOrder` | unused | called from every shopping-list row |
| `clearAllDefects` | unused | the Settings destructive action |
| `confirmDeleteContractor` | unused | Settings |
| `crFilterJobs` | unused | the report dialog's job search |
| `copyShoppingList` | unused | the shopping list toolbar |

Deleting on ESLint's word alone would have removed a large part of the working app
**and every gate would still have passed**, because no Playwright suite clicks every
button. This is why the plan's deletion proof requires an explicit HTML-attribute search.

The scanner (`unused.mjs`) now prints an `attr?` and `str?` column per candidate for
exactly this reason. **A `YES` in either column is a stop sign.**

### Genuinely ambiguous — need your call

These are flagged by ESLint, appear in **no** HTML handler, and their only other
occurrences are inside string literals or documentation. Each needs a human decision;
several look like features reachable from a screen I haven't found, or leftovers from
the pre-cloud era.

| Symbol | Where | Evidence against deleting |
|---|---|---|
| `searchByAddress` / `searchByContractor` / `searchByTrade` | index.html ~3549-3593 | Name appears in a string. Likely the pre-`renderUnifiedSearch` search path. Verify the unified search fully replaced them. |
| `exportAllData` | index.html ~8136 | Backup/export — may be wired from a Settings screen or intended as a manual console tool. |
| `resetDatabase` | index.html ~8116 | Destructive dev utility. Harmless to keep; dangerous to guess about. |
| `handleExcelImport` | index.html ~7925 | Import path — may be dead since the BPI/AI import landed, or may still be reachable. |
| `reloadContractorTrades` | index.html ~8103 | Sounds like an ops/repair tool for a real sync problem. |
| `setClubTheme` / `currentClubTheme` | index.html ~8229-8238 | The F1 theme picker. |
| `addDefectsByAddress` / `addDefectsByContractor` | index.html ~5226-5239 | Superseded by the five-block Add Defects screen? Or still called? |
| `isDarkMode` | index.html ~3430 | Theme helper. |

**None of these were touched.** Confirm each is genuinely unreachable and I'll remove them
in a follow-up — one per commit, gates after each.

---

## 6. Security findings

_None found so far._ One standing note, not a code issue:

- **`VERCEL_TOKEN` is present in this environment's variables.** Auto-deploy makes the
  Vercel CLI redundant, and environment variables here are readable by anyone using the
  environment. Recommend deleting the token at vercel.com/account/tokens. Not read, not
  printed, not used by this session.

---

## 7. Bugs found (not fixed)

_None new this session._ Carried forward from earlier analysis, unchanged and still real:

- **Offline defect-id collisions.** `nextDefectId()` (index.html) is `max(existing, hw) + 1`
  with a per-device localStorage high-water mark. Two supervisors offline simultaneously
  allocate the same id; the push upserts on `legacy_id`, so one row can overwrite the
  other. Mitigated in practice because a pull lifts the counter — but real, latent and
  data-losing. Fix: client-generated UUIDs. **Report only, not an overnight change.**

---

## 8. Tier B backlog

Ranked by value ÷ risk.

1. **Commit the ten Playwright suites and the two scanners into the repo**, with a runner.
   *Value: very high. Risk: none — additive only.* Everything protecting this app currently
   lives in an ephemeral scratchpad and dies with the session. The `clean()` ReferenceError
   that reached a supervisor on 2026-08-02 would have been caught by `undef.mjs` in five
   seconds.
2. **Fix offline id collisions with client-side UUIDs.** *Value: high. Risk: high —
   touches the sync engine.* Needs its own session and a migration plan.
3. **Extract the inline `<script>` from `index.html` to a file.** *Value: high. Risk:
   medium.* One `<script src>` swap, no behaviour change, and it makes every future
   analysis (including the two scanners) simpler. Precondition for any modularisation.
4. **Split the extracted script into modules.** *Value: high. Risk: high.* The real debt.
   Not an overnight job; needs the tests in the repo first (item 1).
5. **Emoji-icon legend / onboarding.** *Value: medium. Risk: none.* A new supervisor has
   no way to learn that 🚦 is the filter.
6. **Accessibility pass.** *Value: medium. Risk: low.* Essentially unaddressed today.
7. **Photo retention (42/60 days).** *Value: medium. Risk: low, but a cost decision.*
   Fine for storage cost; wrong if a photo is needed for a warranty dispute later.

---

## 9. Where the real technical debt is

It is not dead code — the app is unusually tidy for its size, and the comments are the
best-maintained thing in it. The debt is **structural and testing-shaped**: one
8,700-line function-soup scope with no module boundaries, so nothing can be reasoned
about locally and no tool can tell a live handler from a dead one. On top of that sits a
hand-rolled sync engine whose comment history reads as a list of production incidents —
each fix sound, the accumulation telling you it is a hard problem being solved by hand.

The multiplier on both is that the test suites are not in the repo. Every guard in that
sync engine is currently protected by nothing, so the next refactor rediscovers the same
bugs. Fixing the structure without the tests in place would be reckless; adding the tests
is cheap and makes everything after it safe.

---

## 10. The one change to make first

**Commit the test suites and the two scanners into the repo, with a runner.**

Not because tests are virtuous, but because of the specific evidence in this session: a
ReferenceError shipped to a supervisor's phone this week from precisely the class of
change a cleanup pass makes, and the scanner that catches it in five seconds currently
exists only in a temporary directory. Every other item on the Tier B list — the module
split especially — is unsafe until this one is done.

---

## How to undo everything

```
git checkout main
git branch -D chore/overnight-cleanup-2026-08-02
git push origin --delete chore/overnight-cleanup-2026-08-02
```

`main` and the live app are untouched either way — that is the point of the branch.
