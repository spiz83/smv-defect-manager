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
2. **Bump it in THREE places — they must all match:**
   - `sw.js`: the `const CACHE = 'deffixer-shell-…'` line.
   - `sw.js`: the `./cloud-sync.js?v=…` entry in the `CORE` precache array
     (THIS ONE IS EASY TO FORGET — twice it lagged and the fix looked unshipped).
   - `index.html`: the `<script src="cloud-sync.js?v=…">` tag.
   Use sed for all at once, e.g.:
   ```bash
   sed -i "s/deffixer-shell-OLD/deffixer-shell-NEW/" sw.js
   sed -i "s|cloud-sync.js?v=OLD|cloud-sync.js?v=NEW|g" sw.js index.html
   ```
3. **Sanity-check JS** (if cloud-sync.js or the inline app script changed):
   `node --check cloud-sync.js`. For inline index.html script, extract it and
   `new Function(body)` to confirm it parses.
4. **Commit + push** (push auto-deploys GitHub Pages):
   `git add -A && git commit -m "…" && git push`
   End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
5. **Deploy to Vercel** (what supervisors actually use):
   `npx vercel deploy --prod --yes --scope spiro-vladimiroskis-projects`
6. **Verify live** (always — don't trust the deploy log alone):
   ```bash
   curl -s "https://smv-defect-manager.vercel.app/sw.js?nc=$(date +%s)" | grep -o "deffixer-shell-NEW"
   curl -s "https://smv-defect-manager.vercel.app/cloud-sync.js?nc=$(date +%s)" | grep -o "<a unique string from your change>"
   ```
   Both must return a hit. The `?nc=timestamp` busts any CDN/browser cache.

## Notes
- Vercel scope: `spiro-vladimiroskis-projects`. Project: `smv-defect-manager`.
- If `npx vercel` prompts to link, run with the `--scope` flag (already above).
- The SW auto-applies updates but waits while the user is mid-edit (isBusyEditing),
  so a supervisor may need to background/reopen the app once to get the new shell.
