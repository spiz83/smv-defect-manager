// The offline photo queue, as it LOOKS (Spiro 2026-11-16, before a demo):
// "the 7 photos uploading... they've been uploading for ages, it seems like it
// could be a bit of a glitch... I'm gonna demo this soon so I just want to make
// sure this doesn't look like there's a glitch with the software."
//
// The queue itself was fine — photos land in IndexedDB before any upload is
// attempted and are only deleted once the server confirms. What was wrong was
// everything the screen said about it:
//   · the header said a green "Synced" while 7 photos were NOT synced
//   · the pill and the sync banner overlapped at the bottom of the screen
//   · the pill said "uploading when you have signal" on full wifi
//   · the "upload failed" warning fired again on every single app open
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
await page.waitForFunction(() => !!(window.CloudSync && window.CloudSync.indicator), { timeout: 15000 });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// cloud-sync keeps its state in a closure, so drive it the way the app does:
// through the functions the sync layer puts on the page.
check('cloud-sync exposes its indicator so this can be driven without a network',
  await page.evaluate(() => typeof (window.CloudSync && window.CloudSync.indicator) === 'object'), '');

// ================= 1. the header must not claim "Synced" ==================
console.log('\n--- the status line with photos still queued ---');
const status = await page.evaluate(() => {
  const h = window.CloudSync.indicator;
  h.setStatus('Synced');
  const clean = (document.getElementById('cs-status') || {}).textContent;
  h.updatePendingBanner(7);
  const withPhotos = (document.getElementById('cs-status') || {}).textContent;
  const dot = (document.getElementById('cs-dot') || {}).className;
  h.updatePendingBanner(0);
  const after = (document.getElementById('cs-status') || {}).textContent;
  return { clean, withPhotos, dot, after };
});
console.log('status:', JSON.stringify(status));
check('with nothing queued the header says Synced', status.clean === 'Synced', status.clean);
check('with 7 photos queued it does NOT just say Synced',
  status.withPhotos !== 'Synced', status.withPhotos);
check('…it says how many are still to go',
  /7 photos to upload/.test(status.withPhotos || ''), status.withPhotos);
check('…and the dot stops being the all-clear green',
  /syncing/.test(status.dot || ''), status.dot);
check('once they are all up it goes back to plain Synced', status.after === 'Synced', status.after);

// ================= 2. the pill and the banner must not overlap ============
console.log('\n--- pill vs sync banner ---');
const overlap = await page.evaluate(() => {
  const h = window.CloudSync.indicator;
  h.updatePendingBanner(7);
  const pill = document.getElementById('cs-photo-pending');
  const alone = pill.getBoundingClientRect();
  h.setBanner('Uploading 3 change(s)…', 'syncing');
  const b = document.getElementById('cs-banner');
  // force the transition to its end state for measurement
  b.style.transition = 'none';
  const raised = pill.getBoundingClientRect();
  const bannerBox = b.getBoundingClientRect();
  const clash = !(raised.bottom <= bannerBox.top + 1 || raised.top >= bannerBox.bottom - 1);
  h.hideBanner();
  const dropped = pill.getBoundingClientRect();
  h.updatePendingBanner(0);
  return { aloneBottom: Math.round(alone.bottom), raisedBottom: Math.round(raised.bottom),
           bannerTop: Math.round(bannerBox.top), clash, droppedBottom: Math.round(dropped.bottom) };
});
console.log('geometry:', JSON.stringify(overlap));
check('when the sync banner comes up, the pill steps above it',
  overlap.raisedBottom < overlap.aloneBottom, JSON.stringify(overlap));
check('…so the two never sit on top of each other', overlap.clash === false, JSON.stringify(overlap));
check('…and the pill drops back once the banner goes',
  overlap.droppedBottom === overlap.aloneBottom, JSON.stringify(overlap));

// ================= 3. the pill must not blame the signal on wifi ==========
console.log('\n--- what the pill actually says ---');
const wording = await page.evaluate(() => {
  const h = window.CloudSync.indicator;
  const read = () => (document.getElementById('cs-photo-pending') || {}).textContent;
  h.setPhotoError('');
  h.updatePendingBanner(7);
  const online = read();
  h.setPhotoError('new row violates row-level security policy');
  h.updatePendingBanner(7);
  const failing = read();
  const reason = h.photoWaitingReason();
  h.updatePendingBanner(0);
  return { online, failing, reason };
});
console.log('wording:', JSON.stringify(wording, null, 1));
check('online and moving, it does NOT claim to be waiting for signal',
  !/when you have signal/.test(wording.online || ''), wording.online);
check('…it says it is uploading', /uploading/.test(wording.online || ''), wording.online);
check('online and failing, it offers a reason rather than blaming the signal',
  /tap to see why/.test(wording.failing || '') && !/when you have signal/.test(wording.failing || ''),
  wording.failing);
check('…and the reason quotes what the server actually said',
  /row-level security/.test(wording.reason || ''), wording.reason);
check('…while still saying the photos are safe',
  /safe|nothing is lost/i.test(wording.reason || ''), wording.reason);

// ================= 4. offline still says the reassuring thing =============
const offlineText = await page.evaluate(() => {
  const h = window.CloudSync.indicator;
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  h.updatePendingBanner(7);
  const t = (document.getElementById('cs-photo-pending') || {}).textContent;
  const r = h.photoWaitingReason();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  h.updatePendingBanner(0);
  return { t, r };
});
console.log('offline:', JSON.stringify(offlineText));
check('genuinely offline, it DOES say it is waiting for signal',
  /when you have signal/.test(offlineText.t || ''), offlineText.t);
check('…and promises the photos survive the app being closed',
  /nothing is lost if you close the app/.test(offlineText.r || ''), offlineText.r);

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
