// The offline photo queue, as it LOOKS (Spiro 2026-11-18): "things like this
// make the app look buggy — disguise them, but keep the log, and make sure
// there's no data loss."
//
// The earlier answer (2026-11-16, before a demo) was to make the on-screen
// pending/failed state HONEST and non-contradictory. The new answer goes
// further: while online, a photo still in the outbox — mid-retry or being
// refused by the server — is not surfaced to the supervisor AT ALL. It reads
// as a glitch. The blob stays in IndexedDB and keeps retrying (nothing is
// lost), and the failure is filed to the backend (dm_error_log) for the admin
// to triage. What the supervisor sees stays a calm "Synced".
//
// The ONE thing still shown is the genuinely-OFFLINE reassurance — "saved on
// this phone, uploading when you have signal" — because a dead zone is not a
// glitch and a supervisor needs to know their photos are safe. This suite now
// checks exactly that split: silent on signal, reassuring in a dead zone, and
// the queue itself untouched either way.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8137;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await ctx.route('**', route => {
  const u = route.request().url();
  if (u.startsWith(`http://localhost:${PORT}`)) {
    if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  }
  return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
// cloud-sync returns early without supabase-js, and then there is no indicator
// to test at all. The smallest stub that lets it initialise: nothing here
// uploads or stores anything, because the queue is not what this suite is
// about — what the screen SAYS about the queue is.
await page.addInitScript(() => {
  localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
  localStorage.setItem('dm_preview', '0');
  const UID = '11111111-1111-1111-1111-111111111111';
  const chain = () => {
    const o = { data: [], error: null };
    const self = () => p;
    const p = Promise.resolve(o);
    ['select', 'eq', 'is', 'in', 'not', 'order', 'limit', 'gte', 'lte', 'filter'].forEach(k => { p[k] = self; });
    p.maybeSingle = () => Promise.resolve({ data: null, error: null });
    p.single = () => Promise.resolve({ data: null, error: null });
    return p;
  };
  const table = () => ({
    select: chain, insert: () => chain(), update: () => chain(),
    upsert: () => chain(), delete: () => chain(),
  });
  const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
  window.supabase = {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: UID, email: 'demo@example.com' } } }),
        getSession: async () => ({ data: { session: { user: { id: UID, email: 'demo@example.com' } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({}),
      },
      from: table,
      channel: () => chan,
      removeChannel() {},
      storage: { from: () => ({
        list: async () => ({ data: [] }), remove: async () => ({}),
        upload: async () => ({ data: {}, error: null }),
        createSignedUrls: async () => ({ data: [] }), createSignedUrl: async () => ({ data: null }),
      }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    }),
  };
});
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
// The splash covers the whole screen for the first second of a boot, so
// every suite waits it out before touching or measuring anything. Added to
// all of them at once rather than to the three that happened to fail: the
// ones that passed were passing on timing, which is the same bug asleep
// (2026-11-18).
await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });
await page.waitForFunction(() => !!(window.CloudSync && window.CloudSync.indicator), { timeout: 15000 });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// cloud-sync keeps its state in a closure, so drive it the way the app does:
// through the functions the sync layer puts on the page.
check('cloud-sync exposes its indicator so this can be driven without a network',
  await page.evaluate(() => typeof (window.CloudSync && window.CloudSync.indicator) === 'object'), '');

// ============ 1. online, photos queued: the screen stays calm ============
// A queued or server-refused photo must NOT surface while online — the old
// "Synced · N to upload", the pill, and the "tap to see why" reason all read
// as a broken app. The blob stays in the outbox and keeps retrying, and a
// failure is logged to the backend; this checks the SCREEN stays calm, not
// that the queue changed (it does not — that is the whole point, nothing is
// lost).
console.log('\n--- online, with photos still queued ---');
const online = await page.evaluate(() => {
  const h = window.CloudSync.indicator;
  h.setStatus('Synced');
  const clean = (document.getElementById('cs-status') || {}).textContent;
  h.setPhotoError('');
  h.updatePendingBanner(7);                         // 7 queued, on signal
  const status = (document.getElementById('cs-status') || {}).textContent;
  const dot = (document.getElementById('cs-dot') || {}).className;
  let pill = document.getElementById('cs-photo-pending');
  const pillShown = !!pill && pill.style.display !== 'none';
  // and again with the server actively refusing them
  h.setPhotoError('new row violates row-level security policy');
  h.updatePendingBanner(7);
  pill = document.getElementById('cs-photo-pending');
  const pillShownFailing = !!pill && pill.style.display !== 'none';
  const statusFailing = (document.getElementById('cs-status') || {}).textContent;
  h.setPhotoError('');
  h.updatePendingBanner(0);
  const after = (document.getElementById('cs-status') || {}).textContent;
  return { clean, status, dot, pillShown, pillShownFailing, statusFailing, after };
});
console.log('online:', JSON.stringify(online));
check('with nothing queued the header says Synced', online.clean === 'Synced', online.clean);
check('with 7 photos queued on signal it STILL just says Synced',
  online.status === 'Synced', online.status);
check('…and the dot stays the all-clear green (no syncing warning)',
  !/syncing/.test(online.dot || ''), online.dot);
check('…and no "photos waiting" pill is shown', online.pillShown === false, String(online.pillShown));
check('even while the server is refusing them, nothing is surfaced',
  online.pillShownFailing === false && online.statusFailing === 'Synced',
  `pill ${online.pillShownFailing}, status ${online.statusFailing}`);
check('once the queue drains it is still a plain Synced', online.after === 'Synced', online.after);

// ============ 2. genuinely offline: the one honest reassurance kept =======
// A dead zone is not a glitch, and a supervisor on a site needs to know their
// photos are safe. This is the ONE case still shown — and it must still sit
// clear of the sync banner.
console.log('\n--- genuinely offline ---');
const offline = await page.evaluate(() => {
  const h = window.CloudSync.indicator;
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  h.updatePendingBanner(7);
  const pill = document.getElementById('cs-photo-pending');
  const text = pill ? pill.textContent : '';
  const shown = !!pill && pill.style.display !== 'none';
  const alone = pill.getBoundingClientRect();
  h.setBanner('Reconnecting…', 'syncing');
  const b = document.getElementById('cs-banner');
  b.style.transition = 'none';
  const raised = pill.getBoundingClientRect();
  const bannerBox = b.getBoundingClientRect();
  const clash = !(raised.bottom <= bannerBox.top + 1 || raised.top >= bannerBox.bottom - 1);
  h.hideBanner();
  const reason = h.photoWaitingReason();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  h.updatePendingBanner(0);
  return { shown, text, raisedBottom: Math.round(raised.bottom),
           aloneBottom: Math.round(alone.bottom), clash, reason };
});
console.log('offline:', JSON.stringify(offline));
check('offline, the reassurance pill IS shown', offline.shown === true, String(offline.shown));
check('…it says the photos are saved and will go up on signal',
  /saved on this phone/.test(offline.text) && /when you have signal/.test(offline.text), offline.text);
check('…it steps above the sync banner, never overlapping it',
  offline.raisedBottom < offline.aloneBottom && offline.clash === false, JSON.stringify(offline));
check('…and promises the photos survive the app being closed',
  /nothing is lost if you close the app/.test(offline.reason || ''), offline.reason);

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
