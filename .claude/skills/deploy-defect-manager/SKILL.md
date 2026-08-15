---
name: deploy-defect-manager
description: Ship a change to the Defect Manager PWA (smv-defect-manager) — bump the service-worker cache, deploy to GitHub Pages + Vercel, and verify it's live. Use whenever you've edited index.html, cloud-sync.js, or sw.js and need supervisors to receive it.
---

# Deploy the Defect Manager

The Defect Manager is a static PWA. Supervisors use the **Vercel** copy
(`smv-defect-manager.vercel.app`); it also publishes to GitHub Pages. App code
(index.html, cloud-sync.js) is served network-first via a `?v=` query, but the
service-worker cache must be bumped on every change or phones keep the old shell
for up to ~10 minutes and the fix "looks like it didn't apply".

## Version scheme

The cache id is `deffixer-shell-YYYY-MM-DD<letter>` (e.g. `2026-06-21d`).
- Same day as the last deploy → increment the letter (`d` → `e`).
- New day → reset to `a` with today's date.
The `cloud-sync.js?v=` query string uses the **same date+letter** (without the
`deffixer-shell-` prefix), e.g. `cloud-sync.js?v=2026-06-21e`.

## Steps (do these in order)

1. **Find the current version:** `grep -n "deffixer-shell" sw.js`.
2. **Bump it in FOUR places — they must all match.** This said THREE until
   2026-08-15 and was wrong: `tests/run.sh` gate 4 checks four, and following
   the old list left `APP_VERSION` behind on the previous build.
   - `sw.js`: the `const CACHE = 'deffixer-shell-…'` line.
   - `sw.js`: the `./cloud-sync.js?v=…` entry in the `CORE` precache array
     (THIS ONE IS EASY TO FORGET — twice it lagged and the fix looked unshipped).
   - `index.html`: the `const APP_VERSION = '…'` line.
   - `index.html`: the `<script src="cloud-sync.js?v=…">` tag.
   Use sed for all at once, e.g.:
   ```bash
   sed -i "s/deffixer-shell-OLD/deffixer-shell-NEW/" sw.js
   sed -i "s/APP_VERSION = 'OLD'/APP_VERSION = 'NEW'/" index.html
   sed -i "s|cloud-sync.js?v=OLD|cloud-sync.js?v=NEW|g" sw.js index.html
   ```
3. **Run the gates — all four, not `quick`:** `./tests/run.sh` (~4 min). This
   supersedes a bare `node --check`: gate 1 parses every inline block AND
   cloud-sync.js, gate 2 catches identifiers that resolve to nothing, gate 3 is
   18 behaviour suites, and gate 4 confirms step 2 hit all four stamps. Do not
   push `main` on red — a supervisor is on site with the result in ten minutes.
4. **Merge to `main` and push.** Pushing `main` is what deploys — **Vercel is
   git-linked and builds on the push**, and GitHub Pages publishes from the
   branch. Work done on a feature branch has to land on `main` to ship.
   `git checkout main && git merge --no-ff <branch> && git push -u origin main`
5. **The Vercel CLI is usually unnecessary — check before reaching for it.**
   Poll the live URL first (step 6); the git-linked build normally lands within
   a minute. Only if it has not:
   `npx vercel deploy --prod --yes --token "$VERCEL_TOKEN" --scope spiro-vladimiroskis-projects`
   On 2026-08-15 the CLI failed with `Not able to load user … (404)` — a stale
   `VERCEL_TOKEN` — while the git-linked deploy had already shipped. A CLI
   failure is NOT evidence the deploy failed. Verify before believing it.
6. **Verify live** (always — don't trust the deploy log alone). Check all four
   stamps plus something unique to THIS change:
   ```bash
   B=https://smv-defect-manager.vercel.app; N=$(date +%s%N)
   curl -s "$B/sw.js?nc=$N"    | grep -o "deffixer-shell-NEW"
   curl -s "$B/sw.js?nc=$N"    | grep -o "cloud-sync.js?v=NEW"
   curl -s "$B/index.html?nc=$N" | grep -o "APP_VERSION = 'NEW'"
   curl -s "$B/index.html?nc=$N" | grep -o "cloud-sync.js?v=NEW"
   curl -s "$B/cloud-sync.js?v=NEW&nc=$N" | grep -o "<a unique string from your change>"
   ```
   All must return a hit. `?nc=timestamp` busts any CDN/browser cache.
7. **Prove the live bytes are the tested bytes.** Strongest check available, and
   it takes seconds — download what is being served and hash it against the
   working tree the gates just ran on:
   ```bash
   D=$(mktemp -d); N=$(date +%s%N)
   for f in index.html cloud-sync.js sw.js; do curl -s "$B/$f?nc=$N" -o $D/$f; done
   for f in index.html cloud-sync.js sw.js; do
     [ "$(sha256sum $D/$f|cut -c1-16)" = "$(sha256sum $f|cut -c1-16)" ] \
       && echo "$f IDENTICAL" || echo "$f DIFFERS"; done
   ```
   Driving the live site with Playwright does NOT work from the agent sandbox —
   the proxy resets Chromium's connection. This hash check is the substitute,
   and it is a better one.

## Notes
- Vercel scope: `spiro-vladimiroskis-projects`. Project: `smv-defect-manager`.
- If `npx vercel` prompts to link, run with the `--scope` flag (already above).
- The SW auto-applies updates but waits while the user is mid-edit (isBusyEditing),
  so a supervisor may need to background/reopen the app once to get the new shell.
- **GitHub Pages cannot be verified from the agent sandbox** — the proxy blocks
  `*.github.io` and the Pages API path. There is no `.github/workflows`, so
  Pages is branch-deploy mode and needs nothing beyond the push. Report it as
  unverified rather than assuming either way; Vercel is the copy supervisors use.
