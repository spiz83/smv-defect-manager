// Settings → 🔎 Contractors to review (2026-08-15).
//
// Supervisors can add a contractor mid-job so they are never stuck; it is
// private to them (isShared === false) until a manager checks the details and
// taps ✓ Share. This card is that queue — a to-do list, not a record. Sharing
// removes a row from it for good.
//
// Spiro had six waiting, which pushed every other Settings card off the
// screen: "they don't need to be brought up as a list. It can just be a
// header and when I click into it you can show a complete list." So the card
// is collapsed by default with the count in the header.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8142;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Six pending + two already shared — the shape of Spiro's screenshot.
const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobStatus: 'active', active: true }],
  contractors: [
    { id: 1, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true, isShared: true },
    { id: 2, name: 'HAR Painters', trades: 'Painter', tradeIds: [], isShared: true },
    { id: 10, name: 'Auz painting & decorating', email: 'auzpainting06@gmail.com', trades: 'Painter', tradeIds: [], isShared: false, addedBy: 'sup1' },
    { id: 11, name: 'badwaltilinggroup', email: 'badwaltilinggroup@gmail.com', trades: 'Tiler', tradeIds: [], isShared: false, addedBy: 'sup1' },
    { id: 12, name: 'Dilan Gamage', email: 'info@donmyercivil.com.au', trades: 'Landscaper', tradeIds: [], isShared: false, addedBy: 'sup1' },
    { id: 13, name: 'Solid Construction', email: 'soliddconstruction@gmail.com', trades: 'Carpenter', tradeIds: [], isShared: false, addedBy: 'sup2' },
    { id: 14, name: 'TMG Carpentry', phone: '0401 354 936', trades: 'Carpenter', tradeIds: [], isShared: false, addedBy: 'sup2' },
    { id: 15, name: 'Vic Plaster Adam', email: 'adam.o@vicplaster.com.au', trades: 'Plasterer', tradeIds: [], isShared: false, addedBy: 'sup2' },
  ],
  trades: [{ id: 1, name: 'Carpenter' }],
  defects: [],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
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
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 220)));
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
page.on('dialog', d => d.accept());
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };
const asManager = (yes) => page.evaluate((yes) => {
  window.CloudJobs = { isManager: () => yes, currentUserId: () => 'me' };
  state.currentView = 'manage'; render();
}, yes);
const settings = () => page.evaluate(() => (document.querySelector('.manage-container') || {}).innerText || '');

// ===========================================================================
//  A. Collapsed by default — the card is a header, not a list.
// ===========================================================================
console.log('\n--- A · collapsed by default ---');
{
  await asManager(true);
  const t = await settings();
  check('the card is there', /Contractors to review/.test(t), t.split('\n').slice(0, 3).join(' | '));
  check('…with the count in the header, so "is anything waiting" is readable shut',
    /Contractors to review \(6\)/.test(t), t.split('\n')[0]);
  check('…and not one contractor listed until it is opened',
    !/Auz painting/.test(t) && !/TMG Carpentry/.test(t), t.replace(/\n/g, ' | ').slice(0, 200));
  check('…no Edit / Share / 🗑 buttons either', !/✓ Share/.test(t));
  check('…and it says what Share does, since that is the whole job',
    /Share/.test(t) && /whole team/.test(t), t.split('\n').slice(0, 3).join(' | '));

  // The point of collapsing: the cards below it are reachable without scrolling
  // past six contractors.
  const y = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(d => /Assignable Trades/.test(d.textContent) && d.children.length === 0);
    return el ? Math.round(el.getBoundingClientRect().top) : -1;
  });
  console.log('  Assignable Trades sits at y =', y, 'in an 844px viewport');
  check('the next Settings card is on screen without scrolling', y > 0 && y < 844, String(y));
}

// ===========================================================================
//  B. Opening it shows the complete list.
// ===========================================================================
console.log('\n--- B · tapping the header opens it ---');
{
  await page.evaluate(() => togglePendingExpanded());
  const t = await settings();
  check('every pending contractor is listed',
    ['Auz painting', 'badwaltilinggroup', 'Dilan Gamage', 'Solid Construction', 'TMG Carpentry', 'Vic Plaster Adam'].every(n => t.includes(n)),
    t.replace(/\n/g, ' | ').slice(0, 300));
  check('…with the details a manager needs to clean up', /auzpainting06@gmail.com/.test(t) && /0401 354 936/.test(t));
  check('…and Edit / Share / delete on each', (t.match(/✓ Share/g) || []).length === 6, String((t.match(/✓ Share/g) || []).length));
  check('contractors already shared are NOT in the queue',
    !t.includes('HAR Painters'), t.replace(/\n/g, ' | ').slice(0, 300));
  await page.evaluate(() => togglePendingExpanded());
  check('tapping again closes it', !(await settings()).includes('Auz painting'));
}

// ===========================================================================
//  C. Share is what empties the queue.
// ===========================================================================
console.log('\n--- C · sharing removes a row for good ---');
{
  await page.evaluate(() => togglePendingExpanded());
  await page.evaluate(() => { window.CloudSync = { commitContractor: async () => ({ ok: true }) }; });
  await page.evaluate(() => shareContractor(14));
  const t = await settings();
  check('the shared contractor drops out of the queue', !t.includes('TMG Carpentry'), t.replace(/\n/g, ' | ').slice(0, 250));
  check('…the count follows it down', /Contractors to review \(5\)/.test(t), t.split('\n')[0]);
  check('…and it is now visible to the whole team',
    await page.evaluate(() => db.getContractor(14).isShared === true));
  check('…the section stays open, so the next one can be dealt with',
    (await settings()).includes('Solid Construction'));

  // A refused write must put the row back — the manager has to see the truth.
  await page.evaluate(() => { window.CloudSync = { commitContractor: async () => ({ ok: false, error: 'denied' }) }; });
  await page.evaluate(() => shareContractor(13));
  const t2 = await settings();
  check('a share the database refuses is rolled back, not silently kept',
    t2.includes('Solid Construction') && /Contractors to review \(5\)/.test(t2), t2.split('\n')[0]);
  check('…and locally too', await page.evaluate(() => db.getContractor(13).isShared === false));
}

// ===========================================================================
//  D. Empty, and not a manager.
// ===========================================================================
console.log('\n--- D · nothing to review / not a manager ---');
{
  await page.evaluate(() => {
    db.data.contractors.forEach(c => { c.isShared = true; c.addedBy = null; });
    db.save(); render();
  });
  const t = await settings();
  check('with nothing waiting the header says so', /Nothing to review right now/.test(t), t.split('\n').slice(0, 3).join(' | '));
  check('…with no count', !/Contractors to review \(/.test(t), t.split('\n')[0]);
  check('…and no chevron to tap on an empty card', !/▾|▴/.test(t.split('\n').slice(0, 3).join(' ')));

  await asManager(false);
  check('a supervisor never sees the review queue at all',
    !/Contractors to review/.test(await settings()));
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
