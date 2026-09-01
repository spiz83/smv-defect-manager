// Report numbering, trade grouping, and the contents rows.
//
// Spiro 2026-08-16: "it doesn't actually list a number that you can tie the
// report item to… I don't understand how this would work in a database setting
// — you don't want to create a way that information is all over the shop." And:
// "you'll have Carpenter on the first page and then another trade will follow
// and then Carpenter will reappear again."
//
// The decision this suite pins down: the number belongs to the JOB, not to the
// report. Item 7 is item 7 on the whole-job report, on the carpenter's own
// list, and on a reprint next month. Anything per-report (1..N, or 1.1/1.2 per
// trade) makes the same item two different numbers on two documents, which is
// the mess the question was about.
//
// The PDF drawing itself is NOT covered here and cannot be: jsPDF loads from a
// CDN this harness blocks. So the decisions live in pure functions and those
// are what is asserted — the drawing reads them.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8197;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
server.unref();

// Two jobs. Job 1's defects are deliberately INTERLEAVED by trade — carpenter,
// painter, carpenter — which is exactly the input that produced "Carpenter …
// then another trade … then Carpenter again".
const SEED = {
  addresses: [
    { id: 1, lot: '931', street: 'Lot 931, (32) Coollegrean Rd', suburb: 'Wollert', propertyNumber: '306724', active: true },
    { id: 2, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', active: true },
  ],
  contractors: [
    { id: 1, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    { id: 2, name: 'AUZ PAINTING', trades: 'Painter', tradeIds: [] },
    { id: 3, name: 'Tiler', trades: 'Tiler', tradeIds: [], isTradePlaceholder: true, isActive: true },
  ],
  trades: [{ id: 1, name: 'Carpenter' }, { id: 2, name: 'Painter' }],
  defects: [
    { id: 101, addressId: 1, contractorId: 1, description: 'Paint inside striker plate, raw timber visible', location: 'Front Door', status: 'open', completed: false },
    { id: 102, addressId: 1, contractorId: 2, description: 'Remove paint from top of overhead cupboard doors.', location: 'Kitchen', status: 'open', completed: false },
    { id: 103, addressId: 1, contractorId: 1, description: 'The striker side door stop has a gap to the jamb.', location: 'Front Door', status: 'open', completed: false },
    { id: 104, addressId: 1, contractorId: 3, description: 'The skirting tile left side of entry is out of square.', location: 'Ensuite', status: 'open', completed: false },
    { id: 105, addressId: 1, contractorId: 1, description: 'Adjust the left robe door to close evenly with jamb.', location: 'Bedroom 4', status: 'open', completed: false },
    { id: 106, addressId: 2, contractorId: 2, description: 'Touch up paint to hallway architrave', location: 'Hallway', status: 'open', completed: false },
  ],
};

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
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 220)));
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= A. the number belongs to the job =========================
console.log('\n--- A · one number per item, per job, in every report ---');
{
  const nums = await page.evaluate(() => jobItemNumbers(1));
  console.log('job 1 numbers:', JSON.stringify(nums));
  check('every defect on the job is numbered 1..N', JSON.stringify(nums) === JSON.stringify({ 101: 1, 102: 2, 103: 3, 104: 4, 105: 5 }), JSON.stringify(nums));

  const other = await page.evaluate(() => jobItemNumbers(2));
  check('numbering restarts on the next job — it is scoped to the job', other['106'] === 1, JSON.stringify(other));

  // The whole point: a carpenter-only report must NOT renumber to 1,2,3.
  const full = await page.evaluate(() => {
    const n = jobItemNumberer();
    return db.getDefects({ addressId: 1 }).map(d => n(d));
  });
  const trade = await page.evaluate(() => {
    const n = jobItemNumberer();
    return db.getDefects({ addressId: 1, contractorId: 1 }).map(d => n(d));
  });
  console.log('full job:', JSON.stringify(full), ' carpenter only:', JSON.stringify(trade));
  check('a per-trade report keeps the job numbers, it does not restart at 1',
    JSON.stringify(trade) === JSON.stringify([1, 3, 5]), JSON.stringify(trade));
  check('…and they are the SAME numbers the full report used',
    trade.every(t => full.includes(t)), JSON.stringify({ full, trade }));
}

// ================= B. completing an item renumbers nothing =================
console.log('\n--- B · ticking an item off must not move everyone else ---');
{
  const before = await page.evaluate(() => jobItemNumbers(1));
  const after = await page.evaluate(() => { db.setDefectStatus(102, 'completed'); db.save(); return jobItemNumbers(1); });
  console.log('after completing item 2:', JSON.stringify(after));
  check('the numbers are untouched — a printed list stays true',
    JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));
  check('…and the completed item keeps its own number', after['102'] === 2, JSON.stringify(after));
  await page.evaluate(() => { db.setDefectStatus(102, 'open'); db.save(); });
}

// ================= C. a trade appears ONCE ==================================
console.log('\n--- C · trades grouped, not scattered ---');
{
  const secs = await page.evaluate(() => {
    const list = db.getDefects({ addressId: 1 });
    return reportSections(list, { groupBy: 'address' }).map(s => ({
      label: s.label,
      subs: s.subs.map(x => ({ trade: x.trade, n: x.items.length })),
    }));
  });
  console.log('sections:', JSON.stringify(secs));
  check('one section for the job', secs.length === 1, JSON.stringify(secs));
  const trades = secs[0].subs.map(s => s.trade);
  check('…each trade appears exactly once', new Set(trades).size === trades.length, JSON.stringify(trades));
  check('…with all of that trade\'s items together', secs[0].subs.find(s => s.trade === 'Carpenter').n === 3, JSON.stringify(secs[0].subs));
  check('…in A-Z order', JSON.stringify(trades) === JSON.stringify(['Carpenter', 'Painter', 'Tiler']), JSON.stringify(trades));

  // Unassigned is a gap to fill, so it sorts last rather than under "U".
  const withNone = await page.evaluate(() => {
    db.data.defects.push({ id: 199, addressId: 1, contractorId: null, description: 'Builder to assess', location: 'Garage', status: 'open', completed: false });
    const list = db.getDefects({ addressId: 1 });
    const out = reportSections(list, { groupBy: 'address' })[0].subs.map(s => s.trade);
    db.data.defects = db.data.defects.filter(d => d.id !== 199);
    return out;
  });
  check('…and Unassigned sorts last, not alphabetically', withNone[withNone.length - 1] === 'Unassigned', JSON.stringify(withNone));

  // Grouped BY trade (the cross-job mode) still works and does not double-nest.
  const byTrade = await page.evaluate(() => reportSections(db.getDefects(), {}).map(s => ({ label: s.label, subs: s.subs.length })));
  console.log('by trade:', JSON.stringify(byTrade));
  check('the trade-grouped mode is unchanged, one sub-group per section',
    byTrade.every(s => s.subs === 1), JSON.stringify(byTrade));
}

// ================= D. the contents rows carry the columns asked for ========
console.log('\n--- D · contents rows: item, location, description, trade ---');
{
  const rows = await page.evaluate(() => {
    const n = jobItemNumberer();
    return db.getDefects({ addressId: 1 }).map(d => tocRowFor(d, n(d)));
  });
  console.log('rows:', JSON.stringify(rows.slice(0, 2)));
  check('a row per item', rows.length === 5, String(rows.length));
  check('…carrying the item number', rows[0].no === 1 && rows[2].no === 3, JSON.stringify(rows.map(r => r.no)));
  check('…the location', rows[0].location === 'Front Door', rows[0].location);
  check('…the description', /striker plate/.test(rows[0].desc), rows[0].desc);
  check('…and the trade responsible', rows[0].trade === 'Carpenter' && rows[1].trade === 'Painter',
    JSON.stringify(rows.map(r => r.trade)));
  // Page and Rectified are the drawing's business: Page is only known once the
  // photos have pushed the cards around, Rectified is a box to tick by hand.
  check('page is left to the drawing pass', rows[0].page === undefined);
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
