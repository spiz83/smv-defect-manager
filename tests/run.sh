#!/usr/bin/env bash
# The four gates. This repo has no package.json and no build step on purpose —
# these stand in for typecheck/lint/build/test.
#
#   ./tests/run.sh          all four gates
#   ./tests/run.sh quick    gates 1, 2 and 4 only (seconds, no browser)
#
# First run: ./tests/setup.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$HERE")"
cd "$HERE" || exit 1
QUICK="${1:-}"
fail=0

if [ ! -d node_modules/playwright ] && [ "$QUICK" != "quick" ]; then
  echo "Dependencies missing — run ./tests/setup.sh first." >&2
  exit 2
fi

echo "GATE 1 — parse"
node -e "
const fs=require('fs'),p='$REPO';let bad=0;
const h=fs.readFileSync(p+'/index.html','utf8');
(h.match(/<script>([\s\S]*?)<\/script>/g)||[]).forEach((s,i)=>{
  try{new Function(s.replace(/^<script>/,'').replace(/<\/script>\$/,''));}
  catch(e){console.log('  block '+i+' FAIL '+e.message);bad++;}});
try{new Function(fs.readFileSync(p+'/cloud-sync.js','utf8'));}
catch(e){console.log('  cloud-sync FAIL '+e.message);bad++;}
console.log(bad?'  FAIL':'  ok');process.exit(bad?1:0);" || fail=1

# Gate 2 is the one that would have caught the clean() ReferenceError that
# reached a supervisor on 2026-08-02. Gate 1 proves the file PARSES; this proves
# every identifier RESOLVES.
echo "GATE 2 — no-undef"
if [ -d node_modules/eslint ]; then
  node undef.mjs > /tmp/dm-undef.out 2>&1 && echo "  ok" || { echo "  FAIL"; cat /tmp/dm-undef.out; fail=1; }
else
  echo "  skipped (no eslint — run ./tests/setup.sh)"
fi

if [ "$QUICK" != "quick" ]; then
  echo "GATE 3 — behaviour (19 suites, real Chromium)"
  for f in addrcopy adddefects bulkphoto combo deep fixes hdr loc pass pdfname pvgallery pvphoto recur rows shop sync tradefilter tradepdf tradereassign; do
    out=$(timeout 300 node "$f.mjs" 2>&1 | grep -E "^ALL CHECKS|^FAILED" | head -1)
    printf '  %-10s %s\n' "$f" "${out:-NO RESULT}"
    [ "$out" = "ALL CHECKS PASSED" ] || fail=1
  done
else
  echo "GATE 3 — behaviour: skipped (quick)"
fi

# A version stamp that is bumped in three of four places ships to Vercel and
# never reaches a phone, because the service worker only refetches the shell
# when CACHE changes. That has happened twice.
echo "GATE 4 — version stamps match in all four places"
node -e "
const fs=require('fs'),p='$REPO';
const sw=fs.readFileSync(p+'/sw.js','utf8'),ix=fs.readFileSync(p+'/index.html','utf8');
const g=(s,re)=>{const m=s.match(re);return m?m[1]:null;};
const v=[g(sw,/deffixer-shell-([0-9a-z-]+)'/),g(sw,/cloud-sync\.js\?v=([0-9a-z-]+)'/),
         g(ix,/APP_VERSION = '([0-9a-z-]+)'/),g(ix,/cloud-sync\.js\?v=([0-9a-z-]+)\"/)];
const ok=v.every(x=>x&&x===v[0]);
console.log('  '+(ok?'ok ('+v[0]+')':'FAIL '+JSON.stringify(v)));process.exit(ok?0:1);" || fail=1

echo
[ $fail -eq 0 ] && echo "ALL GATES GREEN" || echo "GATES FAILED"
exit $fail
