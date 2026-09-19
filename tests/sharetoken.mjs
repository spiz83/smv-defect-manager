// The share-link token — the ONLY thing between a stranger and a supplier's
// report, because the shared-pdfs bucket is public and /object/public/… bypasses
// RLS by design (that is what makes the link work in a trade's email).
//
// It used to be built as:
//   (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(-12)
// which looks like 12 random characters and is not. slice(-12) keeps the TAIL of
// a 14-char string, so 6 of the 12 are the low digits of the timestamp and only
// 6 come from Math.random(). Two links made in the same second shared a long
// leading prefix, and the whole thing had ~2.2 billion real combinations rather
// than the 36^12 the length implies.
//
// The PREFIX check below is the one that matters: it goes red against the old
// implementation and green against crypto.getRandomValues. A pure "is it 12
// characters" test passes against the broken version and proves nothing.
//
// This drives the REAL CloudShare.uploadTempPdf against a stubbed Supabase, so
// the thing under test is the shipped code path, not a copy of it — the token
// generator itself lives inside cloud-sync.js's closure and can't be called
// directly from page.evaluate.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');

const ROOT = REPO, PORT = 8122;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await ctx.route('**', route => {
  const u = route.request().url();
  if (u.startsWith(`http://localhost:${PORT}`)) {
    if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  }
  return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));

// Stub installed BEFORE cloud-sync.js runs, so the real module boots on top of
// it — same approach as tests/sync.mjs. Every uploaded path is recorded so the
// token can be read from the object path as well as the returned link.
await page.addInitScript(() => {
  try {
    localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
    localStorage.setItem('dm_preview', '0');
    localStorage.setItem('cs_heal', 'snap-2026-06-17');
  } catch (e) {}
  window.__uploadedPaths = [];
  // Any method chains; awaiting the result gives an empty PostgREST-shaped row
  // set. Enough for cloud-sync to boot without a real backend.
  const chain = () => {
    const p = Promise.resolve({ data: [], error: null });
    const o = new Proxy(p, {
      get(t, k) {
        if (k === 'then' || k === 'catch' || k === 'finally') return p[k].bind(p);
        return () => o;
      },
    });
    return o;
  };
  const UID = '11111111-1111-1111-1111-111111111111';
  window.supabase = {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: UID, email: 'sup@example.com' } } }),
        getSession: async () => ({ data: { session: { user: { id: UID, email: 'sup@example.com' } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({}),
      },
      from: () => chain(),
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel() {},
      functions: { invoke: async () => ({ data: null, error: null }) },
      storage: {
        from: () => ({
          upload: async (name) => { window.__uploadedPaths.push(name); return { data: {}, error: null }; },
          list: async () => ({ data: [] }),
          remove: async () => ({}),
          createSignedUrl: async () => ({ data: null }),
          createSignedUrls: async () => ({ data: [] }),
        }),
      },
    }),
  };
});
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.CloudShare && typeof window.CloudShare.uploadTempPdf === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// 60 links back to back — the worst case for the old implementation, where
// every token in the same millisecond shared its whole timestamp half.
const N = 60;
const res = await page.evaluate(async (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const blob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
    out.push(await window.CloudShare.uploadTempPdf(blob, 'Lot 12 Example St - Defects.pdf'));
  }
  return { links: out, paths: window.__uploadedPaths.slice() };
}, N);

const links = res.links.filter(Boolean);
check('every share attempt returned a link', links.length === N, links.length + '/' + N);

const tokens = links.map(u => (u.split('go.html?f=')[1] || '').split('/')[0]);
console.log('sample tokens:', tokens.slice(0, 5).join(' '));

check('the token is 12 characters', tokens.every(t => t.length === 12),
  JSON.stringify([...new Set(tokens.map(t => t.length))]));
check('…of lower-case base36 only', tokens.every(t => /^[a-z0-9]{12}$/.test(t)),
  tokens.find(t => !/^[a-z0-9]{12}$/.test(t)) || '');
check('every token is unique', new Set(tokens).size === tokens.length,
  new Set(tokens).size + ' unique of ' + tokens.length);

// THE REAL CHECK. A timestamp-derived token makes consecutive links share a
// long leading run; crypto-random ones collide on a 5-char prefix with
// probability ~1 in 60 million per pair.
const prefixes = tokens.map(t => t.slice(0, 5));
const dupPrefix = prefixes.filter((p, i) => prefixes.indexOf(p) !== i);
check('no two tokens share a 5-character prefix (i.e. no timestamp in it)',
  dupPrefix.length === 0, dupPrefix.length ? 'shared: ' + [...new Set(dupPrefix)].join(',') : '');

// Position-by-position: with a timestamp in the first half, the early columns
// take very few distinct values across 60 samples. Random ones spread out.
const distinctAt = i => new Set(tokens.map(t => t[i])).size;
const firstHalf = [0, 1, 2, 3, 4, 5].map(distinctAt);
console.log('distinct characters per position (first 6):', firstHalf.join(','));
check('the early positions vary as much as the late ones',
  Math.min(...firstHalf) >= 10, 'min distinct in first 6 positions: ' + Math.min(...firstHalf));

// The report name has to survive — it is what Mail/Files save the PDF as, and
// a bare token was the original bug that put the folder there in the first place.
check('the object path keeps <token>/<report name>.pdf',
  res.paths.every(p => /^[a-z0-9]{12}\/Lot-12-Example-St---Defects\.pdf$/.test(p)),
  res.paths[0] || '');

check('no page errors', errs.length === 0, JSON.stringify(errs));

console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
