# Tests

This repo has **no `package.json` and no build step**, on purpose — it is a static PWA that
Vercel deploys as files. So there is no `npm test`. These four gates stand in for
typecheck / lint / build / test.

```bash
./tests/setup.sh        # once — installs into tests/node_modules, --no-save
./tests/run.sh          # all four gates (~4 min, drives a real Chromium)
./tests/run.sh quick    # gates 1, 2 and 4 only (~5 s, no browser)
```

Run `./tests/run.sh` before any push to `main`. **Pushing `main` deploys**, and a
supervisor is on site with the result within ten minutes.

---

## The four gates

**1 · Parse** — every inline `<script>` block plus `cloud-sync.js`.
Proves the file parses. **Proves nothing else.**

**2 · `no-undef`** — ESLint across the whole app, forgiving cross-block declarations and
known browser/CDN globals.

> This gate exists because of a specific incident. On 2026-08-02 a refactor replaced a
> helper `clean()` and deleted its declaration while three later calls survived. Save on
> the Edit Defect screen threw `ReferenceError: clean is not defined`. It shipped, and it
> reached a supervisor on site. Gate 1 was green throughout — a file that parses can still
> reference a name that does not exist. In a single 8,700-line scope with no modules,
> nothing else catches that. **Never remove this gate.**

**3 · Behaviour** — ten Playwright suites against real Chromium. See below.

**4 · Version stamps** — `sw.js` CACHE, `sw.js` CORE `?v=`, `index.html` `APP_VERSION`, and
`index.html`'s script tag must be identical. Bumping three of four ships to Vercel and
never reaches a phone, because the service worker only refetches the shell when CACHE
changes. That has happened twice.

---

## The suites

| Suite | Covers |
|---|---|
| `addrcopy` | 📋 Copy address on a top-search row: the string, and three icons fitting a phone row |
| `combo` | Supplier picker ranking (Reassign all / Edit defect / review); Edit defect → Save |
| `deep` | Deep-read private-report import: admin gate, photo anchoring, fallbacks |
| `fixes` | Search matching; the unsaved-changes guard; report re-import and re-opening |
| `hdr` | Supplier heading on one line; booking button; send-group expansion |
| `loc` | Location leads the defect row: abbreviation table, the four line shapes, text exports |
| `pass` | Changing your password from all three entrances; the refusals; offline; reset email; recovery link |
| `pdfname` | Report filenames from every screen; the name survives the upload; `go.html` |
| `pvgallery` | Preview photo carousel: counter, arrows, paging, adding a photo |
| `pvphoto` | Preview photos are never cropped |
| `rows` | Tap-to-open row actions |
| `shop` | Shopping list: row flag, toolbar, both entry points, three states, scoping |
| `sync` | `cloud-sync.js` pull/push against a stubbed Supabase; contractor sharing |
| `tradepdf` | Generate PDF Report on the trade and multi-contractor views |

Run one on its own with `node tests/shop.mjs`. Each prints `PASS`/`FAIL` per check and
`ALL CHECKS PASSED` at the end; the exit code follows.

---

## Writing a new suite — things this codebase punishes

- **Assert on rendered pixels, not source state, for anything visual.** `pvphoto.mjs`'s
  first version drew the `<img>` into a canvas and sampled that — and it passed against
  the *broken* build, because `drawImage` redraws the source and ignores the CSS crop. It
  now screenshots the element and samples that. A test that cannot fail is worse than none.
- **Break the code and watch the check go red before you keep it.** `pass.mjs` first
  proved "db.save wasn't wrapped twice" by counting `defectTrackerDB` writes — which
  stays at 1 either way, because the second wrapper calls the first, which calls the
  real save. Deleting the guard it was protecting changed nothing; only counting
  `cs_dirty`, written by the wrapper's own body, actually fails.
- **`addInitScript` re-runs on every navigation, and Sign out reloads the page.** Any
  state the app is supposed to change — `pass.mjs`'s stored account password is the
  example — must live in `localStorage` and be seeded only when absent. Hold it in the
  stub's closure and it silently reverts on reload, so "the new password works" passes
  against a build that never changed it.
- **`_review`, `db`, `state` are top-level `let`/`const`, not on `window`.** Use the bare
  identifier inside `page.evaluate`; `window._review` is `undefined`.
- **Stub `window.CloudJobs`.** supabase-js can't load in the harness, so it never mounts,
  and every job-scoped screen renders empty without it.
- **`db.getAddresses()` sorts `db.data.addresses` in place.** Index order is not seed
  order after the first call. Address rows by id.
- **Block service workers** (`serviceWorkers: 'block'`) or a `controllerchange` reloads the
  page mid-test.
- **Fulfil off-origin requests with an empty 200**, don't abort them: aborting leaves the
  Google Fonts stylesheet pending, which blocks the parser-blocking inline script and the
  app never boots.
- `deep.mjs` and `pvphoto.mjs` need `pdfjs-dist` pinned to **3.11.174**, the version
  `index.html` loads from the CDN. Installing anything else with `--no-save` prunes it;
  reinstall, don't debug.

## Static scanners

- `undef.mjs` — gate 2.
- `unused.mjs` — candidate finder for dead code. **Not a licence to delete.** It prints
  `attr?` and `str?` columns because most top-level functions here are reached only from
  HTML `onclick="foo()"` strings, which no analyser can see: it flags 142 symbols and
  roughly 121 of them are live. A `YES` in either column is a stop sign.
- `locals.mjs` — the narrow, trustworthy subset: names occurring exactly once in the app
  source and in no HTML handler.
- `mkpdf.mjs` — builds the fixture PDFs. `deep.mjs` calls it at startup, so no binary test
  assets are committed.

`tests/node_modules/` and `tests/artifacts/` are generated and git-ignored.
