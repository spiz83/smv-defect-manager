# Overnight Autonomous Cleanup — Safe Mode (SMV Defect Manager)

> Paste everything below into the coding agent as the first message of the session.
> Adapted from the generic Next.js/TypeScript version. **The differences are not cosmetic** —
> this app has no build step, no modules, and deploys to supervisors' phones the moment
> `main` moves. Read the SHAPE OF THIS APP section before anything else.

---

## SHAPE OF THIS APP — read this first, it changes what is safe

This is **not** a Next.js/React/TypeScript repo and the generic cleanup rules do not
transfer. Concretely:

- **`index.html` is ~11,200 lines**, of which one inline `<script>` is roughly 8,700 lines
  of plain JavaScript. `cloud-sync.js` is another ~2,850. There is **no bundler, no
  package.json, no TypeScript, no import graph.**
- **Everything shares one global scope.** There are no modules, so "is this exported and
  unused?" is not a question that can be asked. `knip`, `ts-prune` and `depcheck` — the
  three tools the generic prompt leans on — do nothing useful here. Do not bother running
  them; say so in the report rather than pretending.
- **Handlers are referenced from HTML attribute STRINGS**: `onclick="openDefectEdit(3)"`.
  Every static analyser on earth reports those functions as unused. This single fact would
  let an over-eager pass delete most of the app.
- **`go.html` is reachable only via a URL built in `cloud-sync.js`.** Nothing imports it.
  It is live. It is the shape of trap to expect.
- **Pushing `main` deploys.** Vercel auto-deploys on push. There is no staging. A broken
  `main` is broken on a supervisor's phone in a driveway within ten minutes.

### The incident that set these rules

On 2026-08-02 a refactor replaced a local helper `clean()` with `stripReportRef()` and
deleted the declaration — while **three later calls to it survived**. Save on the Edit
Defect screen threw `ReferenceError: clean is not defined`. It shipped. It reached a
supervisor on site.

Nothing caught it because: the throw was inside `if (real subcontractor selected)`, a
branch that fires constantly in reality and rarely in a fixture; and the only gate at the
time was a syntax check, which proves a file **parses**, not that an identifier
**resolves**. Nine green browser suites, none of which clicked that button.

That is the exact failure mode of an unattended deletion pass in this codebase. Every rule
below exists because of it.

---

## CONFIG

- Project name: `SMV Defect Manager`
- Package manager: **none for the app.** `npm` is used only to pull dev-time tools into the
  scratchpad with `--no-save`. Never create a `package.json` in the repo.
- Typecheck command: **none — the app is plain JS.** Substitute the gates below.
- Lint command: `node <scratch>/undef.mjs` and `node <scratch>/unused.mjs` (see GATES)
- Build command: **none.** The "build" is the files as they sit.
- Test command: the ten Playwright suites in the scratchpad (see GATES)
- Branch to work on: `chore/overnight-cleanup-<DATE>` — **created from `main`, never merged
  by you**
- Files/folders that are OFF LIMITS:
  - `supabase/**` — migrations and the edge function; both need a manual deploy
  - `scripts/**` — one-off admin scripts that write to the live database
  - `sw.js` cache strings and `APP_VERSION` — the four version stamps are a release
    mechanism, not code (see VERSION STAMPS)
  - `DECISIONS.md`, `NEXT_STEPS.md`, `REFACTOR_LOG.md`, `TECH_DEBT.md`,
    `SECURITY_REPORT.md`, `ENGINEERING_REPORT.md` — these carry bug history. **Append
    only. Never tidy, never compress, never "consolidate".**
  - `go.html`, `manifest.webmanifest`, `icon*.png`, `icon.svg`, `favicon-48.png`
  - `CLAUDE.md`, `AGENT_INSTRUCTIONS.md`
- Known-unused-but-keep-anyway:
  - Every function called only from an HTML `on*` attribute — which is most of them
  - `initializeAddressDefectForm` / `initializeContractorDefectForm` — documented as
    effectively dead but still **called**; they are guarded no-ops. Report only.
  - `window.CloudPhotos.queueRowPhoto` — a back-compat alias
  - `CloudPhotos.thumbs` — superseded by `thumbsAll` but kept as the fallback for a phone
    running a cached older `cloud-sync.js`
  - Anything named in `DECISIONS.md` as deliberately retained

---

## ROLE

You are a Staff Engineer doing an **unattended, low-risk cleanup pass**. I am asleep.
Nobody reviews anything until morning. Every decision must be one you'd defend to me with
no chance to ask first.

**Prime directive: it is far better to do less and leave the repo perfectly healthy than to
do more and leave it broken, or leave a diff too large to review.** Cleanup I can't verify
is worse than no cleanup.

Runtime behaviour must be **identical** at the end of this session. This is a
deletion-and-tidying pass, not a rewrite.

---

## HARD RULES — never break these

1. **Never push `main`. Never merge to `main`. Never fast-forward `main`.** Pushing `main`
   deploys to phones. This is the single most important rule in this document.
2. **Do push the cleanup branch** — `git push -u origin chore/overnight-cleanup-<DATE>`.
   This differs from the generic prompt on purpose: the container is ephemeral and
   unpushed work is lost, not preserved. Pushing a side branch deploys nothing.
3. Never `git push --force`, `reset --hard`, `clean`, `rebase`, `commit --amend`, or delete
   or rename a branch.
4. Never touch `.env`, secrets, keys, or deploy config. Note that `VERCEL_TOKEN` currently
   sits in the environment — **do not read it, print it, or use it.**
5. Never run anything against the live database. No migrations, no SQL that writes. All DB
   ideas go in the report as SQL I can run myself.
6. Never add a dependency, a `package.json`, a bundler, or a build step. Tools may be
   pulled into the scratchpad with `npm i --no-save` only.
7. Never move, rename, or restructure files. In a single-file app the "import churn" risk
   is replaced by a worse one: moving code between positions in one giant script changes
   declaration order and can break at runtime with no parse error.
8. **Never reformat.** No Prettier, no `--fix` sweep, no re-indentation. The diff must be
   readable line-by-line.
9. Never modify a test to make it pass. If a suite fails, revert the change.
10. **Do not fix bugs.** Write them up with file, line, repro and suggested fix. The only
    exception is a bug *you* introduced this session.
11. Do not add features, abstractions or new files other than `CLEANUP_REPORT.md`.
12. **Never delete or reword an explanatory comment.** This codebase's comments encode why
    a guard exists and which bug it prevents — they are the most valuable thing in the
    repo. Only genuinely commented-out *code* is in scope, and only with the commit hash
    that preserves it recorded in the report.

---

## GATES — there is no `npm test`, so these ARE the build

All four must pass before any commit. Run them in this order; the cheap ones first.

1. **Parse** — every inline `<script>` block and `cloud-sync.js` must parse:
   `new Function(body)` per block, plus `node --check cloud-sync.js`.
   *Proves the file parses. Proves nothing else — see the incident above.*
2. **`no-undef`** — `node <scratch>/undef.mjs`. ESLint `no-undef` across the inline script
   and `cloud-sync.js`, forgiving cross-block declarations and known browser/CDN globals.
   **This is the gate that would have caught the `clean` incident.** Must report zero.
3. **Behaviour** — the ten Playwright suites. All must print `ALL CHECKS PASSED`:
   `combo` `deep` `fixes` `hdr` `pvgallery` `pvphoto` `rows` `shop` `sync` `tradepdf`
   Note `deep.mjs` and `pvphoto.mjs` need `pdfjs-dist@3.11.174` in the scratchpad
   `node_modules`; installing anything else with `--no-save` prunes it and they fail with
   `ENOENT … pdf.min.js`. Reinstall, don't debug.
4. **Version stamps** — `deffixer-shell-<stamp>` in `sw.js` CACHE, `sw.js` CORE
   `cloud-sync.js?v=`, `index.html` `APP_VERSION`, and `index.html`'s script tag must all
   be **identical**. A cleanup pass must not bump them; it must not desync them either.

If any gate fails or produces a new error vs baseline: **revert that batch entirely**
(`git checkout -- <files>`), log it as "attempted, reverted, reason", move on. Do not
attempt a fix. Do not try a variation.

---

## PROOF REQUIRED BEFORE ANY DELETION

Static "unused" detection is wrong often enough to break apps, and in *this* app it is
wrong by default. Before deleting anything you must have **all** of the following, recorded
in the report:

- ESLint `no-unused-vars` flags it (run read-only from the scratchpad). **Necessary, never
  sufficient.**
- A plain-text search of the **entire repo** — `.html`, `.js`, `.md`, `.json`, `.sql`,
  `.ts`, `.webmanifest` — returns no other reference.
- **A search inside HTML attribute strings**: `onclick=`, `oninput=`, `onchange=`,
  `onfocus=`, `onblur=`, `onsubmit=`. This is the check that matters most here. A function
  called only from `onclick="foo()"` is live and every tool will say it is dead.
- A search for the name as a **string literal** anywhere — `getElementById`, `querySelector`,
  `classList`, dynamic dispatch, `window[name]`, Supabase function names, localStorage keys.
- It is not an entry point: not `index.html`, `sw.js`, `go.html`, `manifest.webmanifest`,
  not a service-worker `CORE` entry, not on `window.*`.
- It is not a **database column, a localStorage key, or a field name** — those are consumed
  by systems no analyser can see. `orderStatus`, `bookingAt`, `legacy_id` and friends look
  like plain properties and are load-bearing across two apps.
- It is not referenced from **CH Tracker**, the sibling app sharing this Supabase project.
  You cannot see that repo. If a symbol looks like shared-schema surface, **report, don't
  delete.**

**If any check is ambiguous, do not delete.** Put it under "Candidates needing your call"
with the evidence both ways. Uncertainty is a reason to stop, never a reason to guess.

---

## WORK ORDER (safest first — stop wherever the budget runs out)

### Tier A — apply (provably safe, reversible, zero behaviour change)

1. Unused local variables and genuinely unreachable code, with ESLint proof.
2. Leftover debug logging: `console.log` / `console.debug` that is clearly ad-hoc.
   **Keep** every `console.error` / `console.warn`, everything inside a `catch`, and
   anything reading like an ops signal — this app's sync layer logs deliberately and those
   messages are how a stuck device gets diagnosed in the field.
3. Commented-out **code** blocks (not explanatory comments — see hard rule 12). Record the
   commit hash that preserves each one.
4. Textually identical duplicate constants — keep one, update references. If they differ at
   all, even in whitespace, report instead.
5. Unused top-level functions — only with the **full** proof above, one per commit.
6. Dead CSS rules — only where the class name appears nowhere in any HTML, template
   literal, or `classList` call. Template literals make this harder than it looks.

Tiers from the generic prompt that **do not apply**, and say so in the report rather than
silently skipping: unused npm packages (no `package.json`), `any` types (no TypeScript),
barrel files, Next.js special files.

### Tier B — REPORT ONLY, do not touch

- Splitting `index.html` into modules. This is the big one and it is not an overnight job.
- Extracting the inline `<script>` to a file.
- The hand-rolled sync engine: id mapping, outbox, tombstones, completion guards.
- **Offline id collisions** — `nextDefectId()` is `max + 1` per device; two supervisors
  offline can allocate the same id and the push upserts on it. Real, latent, data-losing.
- Committing the ten Playwright suites and the two scanners into the repo with a runner.
- Supabase: N+1 queries, indexes, RLS. Give exact SQL, run nothing.
- Accessibility, emoji-icon legend, error boundaries.
- Security findings — **top of the report, prominently, fix nothing.**
- Bugs found.

For each: file + line, what's wrong, the concrete fix, risk, effort. Ranked so I can work
top-down in the morning.

---

## BUDGET & STOP CONDITIONS

Stop and write the report when **any** of these hits:

- Total diff exceeds **~800 changed lines**. (Lower than the generic 1,500: with no type
  system and no module boundaries, review is the only safety net and it is manual.)
- Three consecutive reverted batches.
- Any gate fails in a way you can't cleanly revert.
- The working tree ends up in a state you can't describe precisely.
- Tier A is complete.

Ending early with a handful of clean commits is a **success**. There is no target quantity.

---

## FINAL REPORT — `CLEANUP_REPORT.md`

End with the working tree clean, everything committed, all four gates green, the cleanup
branch pushed, `main` untouched. The report must contain:

1. **Health check** — baseline vs final for all four gates. An explicit statement that
   behaviour is unchanged and `main` was never touched.
2. **Commit list** — hash + one line each, so any single one can be reverted.
3. **Deleted** — every symbol removed with the proof that justified it, including the
   HTML-attribute search.
4. **Attempted and reverted** — what and why. As valuable as the successes.
5. **Candidates needing your call** — evidence both ways.
6. **Security findings** — at the top of this section, however minor.
7. **Bugs found (not fixed)** — file, line, repro, suggested fix.
8. **Tier B backlog** — ranked by value ÷ risk.
9. **Where the real technical debt is** — 3–5 sentences of honest assessment.
10. **The one change to make first** in the morning, and why.

**How to undo everything:**

```
git checkout main
git branch -D chore/overnight-cleanup-<DATE>
git push origin --delete chore/overnight-cleanup-<DATE>
```

`main` and the live app are untouched either way — that is the whole point of the branch.
