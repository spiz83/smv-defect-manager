#!/usr/bin/env bash
# Installs the test-only dependencies INSIDE tests/, with --no-save and no
# package.json.
#
# Deliberate: a package.json at the repo root could make Vercel treat this
# static site as a Node project and try to build it. The app itself has no
# dependencies and must keep it that way.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# pdfjs-dist must be pinned to the version index.html loads from the CDN, or
# deep.mjs and pvphoto.mjs are testing a different PDF engine than the app uses.
npm i --no-save --silent \
  playwright@1 \
  eslint@9 \
  globals \
  pdfjs-dist@3.11.174

echo "Installed. Chromium is expected at /opt/pw-browsers/chromium"
echo "(set PLAYWRIGHT_BROWSERS_PATH, or edit executablePath in the suites)."
echo
echo "Run:  ./tests/run.sh        (all four gates)"
echo "      ./tests/run.sh quick  (seconds, no browser)"
