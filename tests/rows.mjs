import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Paths resolve from this file, so the suite runs from any checkout.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ARTIFACTS = join(__here, 'artifacts');


const ROOT = REPO, PORT = 8099;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Descriptions taken from the supervisor's screenshot — the long ones are the
// whole point: they used to push the icons onto their own line.
const TEXTS = [
  'Install garage house sill',
  'Install manhole cover',
  '8.1.1 Laundry',
  'Missing screws to the laundry door hinge need to be fixed.',
  'Replace hinges to external door',
  'Incomplete Works',
  'MISSING SCREWS',
  'The brick and plaster edges need to be sealed for aesthetics. in garage. at top each side of garage door opening',
  'Missing screws to door hinges need to be fixed',
  'Adjust door rattle',
];
let id = 1;
const defects = TEXTS.map(t => ({ id: id++, addressId: 1, contractorId: 1, description: t,
  completed: false, status: 'open', location: 'Laundry' }));
const SEED = {
  addresses: [{ id: 1, lot: '1', street: '14 Skylark Road', suburb: 'Greenvale', jobNumber: '306634', active: true }],
  contractors: [{ id: 1, name: 'HTEE KLEEH', email: 'a@b.com', phone: '0400000000', trades: ['Plumber'] }],
  trades: [{ id: 1, name: 'Plumber' }],
  defects,
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
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
page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('supabase-js')) errs.push('console: ' + m.text().slice(0, 160)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const shot = async n => page.screenshot({ path: `/tmp/claude-0/-home-user-smv-defect-manager/2ef86133-2a08-5486-ab00-e436549df5d8/scratchpad/${n}.png` });
const rowState = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.defects-container .defect-item')];
  return {
    rows: rows.length,
    open: rows.filter(r => r.classList.contains('row-open')).length,
    actionsVisible: rows.filter(r => {
      const a = r.querySelector('.defect-actions');
      return a && getComputedStyle(a).display !== 'none';
    }).length,
    heights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
    totalH: Math.round(rows.reduce((s, r) => s + r.getBoundingClientRect().height, 0)),
    // how many rows fit in the viewport below the frozen header
    fitsOnScreen: (() => {
      const top = document.querySelector('.defects-header').getBoundingClientRect().bottom;
      return rows.filter(r => r.getBoundingClientRect().bottom <= window.innerHeight).length
        + '/' + rows.length + ' (list starts at y=' + Math.round(top) + ')';
    })(),
  };
});

const fail = [];
const check = (label, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  ' + detail : '')); if (!cond) fail.push(label); };

await page.evaluate(() => viewDefectsForAddress(1));
await page.waitForTimeout(250);

const collapsed = await rowState();
console.log('\nADDRESS, collapsed:', JSON.stringify(collapsed));
await shot('20-rows-collapsed');
check('actions hidden on every row by default', collapsed.actionsVisible === 0, `${collapsed.actionsVisible} visible`);
check('all 10 defects rendered', collapsed.rows === 10);
check('short rows are one line', Math.min(...collapsed.heights) <= 34, `min ${Math.min(...collapsed.heights)}px`);

// ONE tap on the long one (index 7 — the 3-line brick/plaster description)
await page.click('.defects-container .defect-item:nth-of-type(9) .defect-text');
await page.waitForTimeout(200);
const opened = await rowState();
console.log('after dbl-tap row 8:', JSON.stringify({ open: opened.open, actionsVisible: opened.actionsVisible }));
await shot('21-row-open');
check('single tap opens exactly one row', opened.open === 1 && opened.actionsVisible === 1);
check('opened row got taller', opened.totalH > collapsed.totalH, `${collapsed.totalH} -> ${opened.totalH}px`);
const icons = await page.evaluate(() => {
  const r = document.querySelector('.defect-item.row-open');
  return [...r.querySelectorAll('.defect-actions button')].map(b => ({
    cls: b.className.split(' ')[0],
    size: Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height),
  }));
});
console.log('revealed controls:  ', JSON.stringify(icons));
// ✏️ 📍 📸 plus 🛒 (order / shopping list, added 2026-08-02).
check('all four controls revealed', icons.length === 4, icons.map(i => i.cls).join(','));

// tapping a revealed icon must NOT collapse the row (stopPropagation)
await page.evaluate(() => document.querySelector('.defect-item.row-open .photo-btn').click());
await page.waitForTimeout(250);
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(150);
check('row still open after tapping an icon in it',
  await page.evaluate(() => !!document.querySelector('.defect-item.row-open')));

// opening another row closes the first
await page.evaluate(() => { const o = document.querySelector('#imp-ov'); if (o) o.remove(); });
await page.click('.defects-container .defect-item:nth-of-type(2) .defect-text');
await page.waitForTimeout(200);
const second = await rowState();
check('only one row open at a time', second.open === 1 && second.actionsVisible === 1, `open=${second.open}`);

// an open row closes on a SINGLE tap (what the ✕ promises)
await page.click('.defects-container .defect-item:nth-of-type(2) .defect-text');
await page.waitForTimeout(200);
check('single tap closes an open row', (await rowState()).open === 0);
// ...and a single tap opens it again
await page.click('.defects-container .defect-item:nth-of-type(2) .defect-text');
await page.waitForTimeout(200);
check('single tap re-opens it', (await rowState()).open === 1);
await page.click('.defects-container .defect-item:nth-of-type(2) .defect-text');
await page.waitForTimeout(200);
check('closed again', (await rowState()).open === 0);

// single tap on the status tab still advances status, and does not open the row
const before = await page.evaluate(() => defectStatusOf(db.data.defects.find(d => d.id === 1)));
await page.click('.defects-container .defect-item:nth-of-type(2) .status-tab');
await page.waitForTimeout(250);
const after = await page.evaluate(() => defectStatusOf(db.data.defects.find(d => d.id === 1)));
check('one tap on the status tab still advances', before === 'open' && after === 'pending', `${before} -> ${after}`);
check('status tap did not open the row', (await rowState()).open === 0);

// ── contractor / supplier view ───────────────────────────────────────────
await page.evaluate(() => viewDefectsForContractor(1));
await page.waitForTimeout(250);
const sup = await rowState();
console.log('\nSUPPLIER, collapsed:', JSON.stringify({ rows: sup.rows, actionsVisible: sup.actionsVisible, fits: sup.fitsOnScreen }));
await shot('22-supplier-collapsed');
check('supplier rows hide actions too', sup.actionsVisible === 0);
await page.click('.defects-container .defect-item:nth-of-type(3) .defect-text');
await page.waitForTimeout(200);
check('supplier row opens on single tap', (await rowState()).open === 1);
await shot('23-supplier-open');

console.log('\nfits on one screen:', collapsed.fitsOnScreen);
console.log('errors:', errs.length ? errs : 'none');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
