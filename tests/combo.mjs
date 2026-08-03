// The "Reassign all" / "Edit defect" supplier picker: the one you want must be
// at the TOP, and you must be able to see more than two of them.
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


const ROOT = REPO, PORT = 8110;
const OUT = ARTIFACTS;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// A realistic book: several names contain "har" somewhere, only one STARTS a
// word with it. Alphabetically "HAR Painters" lands mid-pack, which is exactly
// how it ended up a long scroll down.
const NAMES = [
  ['Ace Hardware Supplies', 'Carpenter'],
  ['Bharat Tiling', 'Tiler'],
  ['Charlie Bricklaying', 'Bricklayer'],
  ['Deakin Shariff Plumbing', 'Plumber'],
  ['Eastern Charter Electrical', 'Electrician'],
  ['Farhan Concreting', 'Concreter'],
  ['Gharial Waterproofing', 'Waterproofer'],
  ['HAR Painters', 'Painter - Labour and Materials'],
  ['Iron Harbour Fencing', 'Fencing'],
  ['Jharkhand Rendering', 'Renderer'],
  ['Kharis Cleaning', 'Cleaner'],
  ['Lockhart Roofing', 'Roof Plumber'],
  ['Maharaj Glazing', 'Glazier'],
  ['Nathaniel Flooring', 'Flooring'],
  ['Oharu Cabinets', 'Cabinet Maker'],
  ['Prahran Landscapes', 'Landscaper'],
  ['Quharton Paving', 'Paving'],
  ['Richardson Insulation', 'Insulation'],
  ['Shariq Drainage', 'Drainer'],
  ['Tharun Caulking', 'Caulker'],
];
const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', active: true }],
  contractors: NAMES.map(([name, trades], i) => ({ id: i + 1, name, trades })),
  trades: [{ id: 1, name: 'Painter' }],
  defects: [{ id: 1, addressId: 1, contractorId: 1, description: 'Paint touch ups to hallway', status: 'open', completed: false }],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
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
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= open Reassign all =======================================
await page.evaluate(() => { viewDefectsForAddress(1); });
await page.waitForTimeout(300);
await page.evaluate(() => openReassignGroup(1, 1));
await page.waitForSelector('#de-contractor-input');
await page.waitForTimeout(200);

const type = async (q) => {
  await page.evaluate((v) => {
    const i = document.getElementById('de-contractor-input');
    i.focus(); i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, q);
  await page.waitForTimeout(220);
  return page.evaluate(() => [...document.querySelectorAll('#de-contractor-list .rv-combo-item')].map(e => e.textContent.trim()));
};

// ================= 1. ranking ==============================================
console.log('\n--- ranking ---');
const har = await type('Har');
console.log('"Har" ->', JSON.stringify(har, null, 1));
check('the word-prefix match is FIRST, not buried', /^HAR Painters/.test(har[0] || ''), JSON.stringify(har.slice(0, 3)));
check('no scrolling needed to reach it', har.indexOf(har.find(h => /^HAR Painters/.test(h))) === 0);
check('substring matches are still offered, just below',
  har.length > 1 && har.some(h => /Bharat|Charlie|Ace Hardware/.test(h)), String(har.length) + ' results');
check('irrelevant contractors are excluded',
  !har.some(h => /Nathaniel Flooring|Prahran Landscapes/.test(h)), JSON.stringify(har.filter(h => /Nathaniel|Prahran/.test(h))));

// the trade is searchable too, and ranks properly
const painter = await type('painter');
console.log('"painter" ->', JSON.stringify(painter.slice(0, 3)));
check('searching the TRADE finds the supplier', painter.some(h => /HAR Painters/.test(h)), JSON.stringify(painter.slice(0, 3)));

// two words, in either order
const twoWords = await type('har painters');
check('a two-word search works', /^HAR Painters/.test(twoWords[0] || ''), JSON.stringify(twoWords.slice(0, 2)));
const reversed = await type('painters har');
check('…in either order', /^HAR Painters/.test(reversed[0] || ''), JSON.stringify(reversed.slice(0, 2)));

// an exact full name beats a longer one that contains it
const lock = await type('lockhart');
check('an exact name match is first', /^Lockhart Roofing/.test(lock[0] || ''), JSON.stringify(lock.slice(0, 2)));

const none = await type('zzzz');
check('a nonsense search says so', none.length === 0, JSON.stringify(none));
check('…with a "No matches" row',
  await page.evaluate(() => !!document.querySelector('#de-contractor-list .rv-combo-empty')));

// ================= 2. how many are visible =================================
console.log('\n--- dropdown size ---');
await type('');
await page.waitForTimeout(250);
const size = await page.evaluate(() => {
  const list = document.getElementById('de-contractor-list');
  const card = document.getElementById('imp-card');
  const lb = list.getBoundingClientRect();
  const cb = card.getBoundingClientRect();
  const items = [...list.querySelectorAll('.rv-combo-item')];
  // How many rows are actually VISIBLE inside both the list and the card?
  const visible = items.filter(it => {
    const b = it.getBoundingClientRect();
    return b.top >= lb.top - 1 && b.bottom <= lb.bottom + 1 && b.bottom <= cb.bottom + 1 && b.top >= cb.top - 1;
  }).length;
  return {
    total: items.length,
    visible,
    listH: Math.round(lb.height),
    clippedByCard: Math.round(lb.bottom - cb.bottom),
    bodyHasRoom: document.getElementById('imp-body').classList.contains('combo-open'),
  };
});
console.log('dropdown:', JSON.stringify(size));
check('the dropdown reserves room in the modal', size.bodyHasRoom);
check('it is not clipped by the modal card', size.clippedByCard <= 0, size.clippedByCard + 'px past the card');
check('you can see a useful number of suppliers at once', size.visible >= 6, size.visible + ' of ' + size.total + ' rows visible');
check('the list itself is taller than before (was 240px)', size.listH > 240, size.listH + 'px');
await page.screenshot({ path: `${OUT}/84-combo-open.png` });

// closing puts the room back
await page.evaluate(() => {
  document.getElementById('de-contractor-input').dispatchEvent(new Event('blur', { bubbles: true }));
});
await page.waitForTimeout(300);
check('closing the list releases the reserved room',
  await page.evaluate(() => !document.getElementById('imp-body').classList.contains('combo-open')));

// ================= 3. picking still works ==================================
console.log('\n--- picking ---');
await type('Har');
const picked = await page.evaluate(async () => {
  const it = document.querySelector('#de-contractor-list .rv-combo-item');
  it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  return {
    input: document.getElementById('de-contractor-input').value,
    hidden: document.getElementById('de-contractor').value,
    listOpen: document.getElementById('de-contractor-list').classList.contains('open'),
    room: document.getElementById('imp-body').classList.contains('combo-open'),
  };
});
console.log('picked:', JSON.stringify(picked));
check('tapping a row selects it', /^HAR Painters/.test(picked.input) && picked.hidden === '8', JSON.stringify(picked));
check('…and closes the list', !picked.listOpen && !picked.room);

const saved = await page.evaluate(async () => {
  document.getElementById('rg-save').click();
  await new Promise(r => setTimeout(r, 300));
  return db.data.defects[0].contractorId;
});
check('the reassignment actually saves', saved === 8, String(saved));

// ================= 4. the BPI review picker shares the fix =================
console.log('\n--- the review screen uses the same picker ---');
const review = await page.evaluate(async () => {
  startReportReview([{ description: 'Paint touch ups', location: 'Hallway', page: 1, itemNo: 1 }], 'r.pdf', 'BPI', 1, null);
  await new Promise(r => setTimeout(r, 300));
  const i = document.getElementById('rv-contractor-input');
  if (!i) return { missing: true };
  i.focus(); i.value = 'Har';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  return {
    rows: [...document.querySelectorAll('#rv-contractor-list .rv-combo-item')].map(e => e.textContent.trim()).slice(0, 3),
    room: document.getElementById('imp-body').classList.contains('combo-open'),
  };
});
console.log('review picker:', JSON.stringify(review));
check('the review supplier picker ranks the same way',
  !review.missing && /^HAR Painters/.test(review.rows[0] || ''), JSON.stringify(review.rows));
check('…and reserves the same room', !review.missing && review.room);
await page.evaluate(() => { try { impClose(); } catch (e) {} window._review = null; });

// ================= 5. Edit defect → Save changes ===========================
// This shipped BROKEN: openDefectEdit's save handler still called clean(), a
// helper deleted in the report-reference refactor, so the click threw a
// ReferenceError and the modal just sat there. "Can't save — nothing happens."
console.log('\n--- Edit defect: Save changes ---');
await page.evaluate(() => {
  // Two defects of the same trade, both on a REAL sub — the branch that threw.
  db.data.defects = [
    { id: 1, addressId: 1, contractorId: 8, description: 'BPI #12 (p.6) — Seal oversized hole at electrical conduit', location: 'Kitchen', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: null, description: 'Paint touch ups to hallway', location: 'Hallway', status: 'open', completed: false },
  ];
  db.save();
  viewDefectsForAddress(1);
});
await page.waitForTimeout(300);

const beforeErrs = errs.length;
const edit = await page.evaluate(async () => {
  openDefectEdit(1);
  await new Promise(r => setTimeout(r, 250));
  const opened = !!document.getElementById('de-save');
  document.getElementById('de-desc').value = 'BPI #12 (p.6) — Seal oversized hole EDITED';
  // The supplier is already filled in and untouched, exactly as reported.
  const realConfirm = window.confirm; let asked = 0;
  window.confirm = () => { asked++; return false; };   // decline the bulk prompt
  let threw = null;
  try { document.getElementById('de-save').click(); } catch (e) { threw = String(e); }
  await new Promise(r => setTimeout(r, 400));
  window.confirm = realConfirm;
  return {
    opened, threw, asked,
    modalStillOpen: !!document.getElementById('de-save'),
    desc: (db.data.defects.find(d => d.id === 1) || {}).description,
    contractorId: (db.data.defects.find(d => d.id === 1) || {}).contractorId,
    otherUntouched: (db.data.defects.find(d => d.id === 2) || {}).contractorId,
  };
});
console.log('edit result:', JSON.stringify(edit));
check('the edit modal opens', edit.opened);
check('Save changes does not throw', !edit.threw, String(edit.threw));
check('…and no ReferenceError reached the console',
  errs.length === beforeErrs, JSON.stringify(errs.slice(beforeErrs)));
check('the modal CLOSES on save (the visible symptom)', !edit.modalStillOpen);
check('the description is actually saved', /EDITED$/.test(edit.desc || ''), edit.desc);
check('the supplier is kept', edit.contractorId === 8, String(edit.contractorId));
check('declining the bulk prompt leaves other defects alone',
  edit.otherUntouched == null, String(edit.otherUntouched));

// accepting the bulk prompt still works
const bulk = await page.evaluate(async () => {
  openDefectEdit(2);
  await new Promise(r => setTimeout(r, 250));
  const input = document.getElementById('de-contractor-input');
  input.focus(); input.value = 'Har';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  document.querySelector('#de-contractor-list .rv-combo-item')
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const realConfirm = window.confirm; window.confirm = () => true;
  let threw = null;
  try { document.getElementById('de-save').click(); } catch (e) { threw = String(e); }
  await new Promise(r => setTimeout(r, 400));
  window.confirm = realConfirm;
  return { threw, closed: !document.getElementById('de-save'), cid: db.data.defects.find(d => d.id === 2).contractorId };
});
console.log('bulk assign:', JSON.stringify(bulk));
check('picking a supplier and saving works', !bulk.threw && bulk.closed, JSON.stringify(bulk));
check('the new supplier is stored', bulk.cid === 8, String(bulk.cid));

// an empty description is still refused
const empty = await page.evaluate(async () => {
  openDefectEdit(1);
  await new Promise(r => setTimeout(r, 250));
  document.getElementById('de-desc').value = '   ';
  document.getElementById('de-save').click();
  await new Promise(r => setTimeout(r, 250));
  const open = !!document.getElementById('de-save');
  if (open) impClose();
  return open;
});
check('an empty description is refused, modal stays open', empty === true);

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
