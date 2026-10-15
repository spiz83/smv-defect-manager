// Exporting a job's defects as a reusable defect list (Spiro 2026-10-15):
// "the ability to take a bunch of defects from a property and be able to
// export as a defect list so that I can then re-import it… if you've got a
// group of 10 properties side by side, all the same trades worked on them,
// you can anticipate that all of the defects are going to be similar, so you
// can pretty much import for future homes."
//
// Do lot 5 Skylark properly, save it, and lots 6-15 start from it. The copy is
// only worth having if three things hold, and they are what this suite exists
// to hold down:
//
//   1. The report reference comes OFF. "PI #3.27 (p.53-54) —" is lot 5's
//      inspector's numbering and is a lie on lot 6.
//   2. The TRADE survives, not the company. The painter on lot 5 may not be
//      the painter on lot 6; "Painter" is what repeats.
//   3. The ROOM survives. Ten identical houses repeat their rooms, and
//      re-picking ninety locations by hand would undo the whole saving.
//
// Plus one performance property that is really a correctness property on a
// phone: ninety items go up in ONE call, not ninety.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');

const ROOT = REPO, PORT = 8131;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Lot 5 Skylark is the house that gets done properly; lot 6 is the one that
// inherits it. Lot 7 has no defects at all — it must not appear in the job
// picker, because picking an empty job is the one mistake that screen can make.
//
// Contractors on purpose:
//   1 Painter          — trade placeholder, keeps its own name
//   2 Jameson Bros Painting — a REAL company, must resolve to its trade
//   3 Bricklayer       — trade placeholder
const SEED = {
  addresses: [
    { id: 1, lot: '5', street: 'Lot 5, Skylark Rd', suburb: 'Greenvale', propertyNumber: '401001', active: true },
    { id: 2, lot: '6', street: 'Lot 6, Skylark Rd', suburb: 'Greenvale', propertyNumber: '401002', active: true },
    { id: 3, lot: '7', street: 'Lot 7, Skylark Rd', suburb: 'Greenvale', propertyNumber: '401003', active: true },
    { id: 4, lot: '8', street: 'Lot 8, Skylark Rd', suburb: 'Greenvale', propertyNumber: '401004', active: true },
    { id: 5, lot: '10', street: 'Lot 10, Skylark Rd', suburb: 'Greenvale', propertyNumber: '401010', active: true },
  ],
  contractors: [
    { id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' },
    { id: 2, name: 'Jameson Bros Painting', isActive: true, trades: 'Painting' },
    { id: 3, name: 'Bricklayer', isTradePlaceholder: true, isActive: true, trades: 'Bricklayer' },
  ],
  trades: [{ id: 1, name: 'Painter' }, { id: 2, name: 'Bricklayer' }],
  defects: [
    // The report reference must come off this one.
    { id: 101, addressId: 1, contractorId: 1, description: 'PI #3.27 (p.53-54) — Defective external paint finish.', location: 'Throughout', status: 'open' },
    // A real company — the TRADE is what goes into the list, not the name.
    { id: 102, addressId: 1, contractorId: 2, description: 'Touch up paint to architraves.', location: 'Hallway', status: 'open' },
    // Same wording, two DIFFERENT rooms. Two jobs to go and do on lot 6, so
    // two items — collapsing these would lose a defect.
    { id: 103, addressId: 1, contractorId: 3, description: 'Repair brickwork blow outs.', location: 'Front Elevation', status: 'open' },
    { id: 104, addressId: 1, contractorId: 3, description: 'Repair brickwork blow outs.', location: 'Rear Elevation', status: 'open' },
    // Same wording, same room, same trade, raised twice (two photos on site).
    // That is ONE line on a template.
    { id: 105, addressId: 1, contractorId: 1, description: 'Paint run to door frame.', location: 'Bedroom 2', status: 'open' },
    { id: 106, addressId: 1, contractorId: 1, description: 'Paint run to door frame.', location: 'Bedroom 2', status: 'open' },
    // No contractor at all — Supervisor, the documented catch-all, never dropped.
    { id: 107, addressId: 1, contractorId: null, description: 'Site clean required before handover.', location: '', status: 'open', unassigned: true },
    // A completed defect is still a defect that happened on this house, and on
    // lot 6 it has not happened yet — so it belongs on the template.
    { id: 108, addressId: 1, contractorId: 1, description: 'BPI #12 — Overspray to window glass.', location: 'Kitchen', status: 'completed' },
    // Lot 6's own, pre-existing defect. The export of lot 5 must not pick it up.
    { id: 201, addressId: 2, contractorId: 1, description: 'Scuff to entry wall.', location: 'Entry', status: 'open' },
  ],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
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
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  // Toasts stack and live 3 seconds, so querySelector('.toast') returns
  // whatever was said a moment ago rather than what just happened.
  window._lastToast = () => {
    const all = [...document.querySelectorAll('.toast')];
    return all.length ? all[all.length - 1].textContent : '';
  };
  render();
});

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= 1. what comes off the job ================================
console.log('\n--- reading lot 5 ---');
const cands = await page.evaluate(() => _dlExportCandidates(1));
console.log(JSON.stringify(cands, null, 1));

check('only this job is read — lot 6\'s own defect is not in lot 5\'s list',
  !cands.some(c => /Scuff to entry/.test(c.text)), JSON.stringify(cands.map(c => c.text)));

const paint = cands.find(c => /Defective external paint/.test(c.text));
check('the report reference is stripped — "PI #3.27 (p.53-54) —" means nothing on lot 6',
  !!paint && paint.text === 'Defective external paint finish.', paint ? paint.text : 'missing');
const overspray = cands.find(c => /Overspray/.test(c.text));
check('…a BPI reference too', !!overspray && overspray.text === 'Overspray to window glass.',
  overspray ? overspray.text : 'missing');

check('a trade placeholder keeps its own name', !!paint && paint.trade === 'Painter', paint && paint.trade);
const named = cands.find(c => /architraves/.test(c.text));
check('a real company becomes its TRADE — Jameson Bros may not be on lot 6, a painter will be',
  !!named && named.trade === 'Painter', named && named.trade);
check('…and the company name is nowhere in the list',
  !JSON.stringify(cands).includes('Jameson'), JSON.stringify(cands.map(c => c.trade)));
const nobody = cands.find(c => /Site clean/.test(c.text));
check('an unassigned defect files under Supervisor rather than being dropped',
  !!nobody && nobody.trade === 'Supervisor', nobody && nobody.trade);

const blowouts = cands.filter(c => /blow outs/.test(c.text));
check('the same wording in two rooms stays TWO items — two jobs to go and do',
  blowouts.length === 2 && blowouts.map(b => b.location).sort().join('|') === 'Front Elevation|Rear Elevation',
  JSON.stringify(blowouts.map(b => b.location)));
const runs = cands.filter(c => /Paint run/.test(c.text));
check('…but the same wording in the same room collapses to one', runs.length === 1, String(runs.length));

check('a completed defect still exports — on lot 6 it has not happened yet',
  !!overspray, 'overspray (completed on lot 5)');
check('the room comes across', !!runs[0] && runs[0].location === 'Bedroom 2', runs[0] && runs[0].location);
check('a defect with no room exports blank, not "undefined"',
  !!nobody && nobody.location === '', JSON.stringify(nobody && nobody.location));

check('seven lines off eight defects', cands.length === 7, String(cands.length));
// Rooms together, so the supervisor reading the list walks the house in order.
const locs = cands.map(c => c.location);
const houseOrder = await page.evaluate(() => DEFECT_LOCATIONS);
const ranks = locs.map(l => (l ? houseOrder.indexOf(l) : 99999));
check('rooms come out in HOUSE order, so the list reads the way the house is walked',
  JSON.stringify(ranks) === JSON.stringify(ranks.slice().sort((a, b) => a - b)), JSON.stringify(locs));
check('…and the roomless items are last, not first',
  locs[locs.length - 1] === '' && locs.slice(0, -1).every(Boolean), JSON.stringify(locs));

// ================= 2. no migration, no export ===============================
console.log('\n--- before the migration there is nowhere to save ---');
const noMig = await page.evaluate(() => {
  openDefectListExport(1);
  return { overlay: !!document.getElementById('dlx-overlay'), toast: _lastToast() };
});
console.log('no-migration:', JSON.stringify(noMig));
check('the export says so rather than pretending to save',
  noMig.overlay === false && /migration/i.test(noMig.toast), JSON.stringify(noMig));

// ================= 3. the export overlay ====================================
console.log('\n--- the export overlay ---');
const opened = await page.evaluate(() => {
  const lists = [];
  window.__calls = [];
  window.CloudDefectLists = {
    ready: () => true,
    list: () => lists.map(l => ({ ...l, items: l.items.slice() })),
    canEdit: () => true,
    // A real bank hands out a fresh id per list. The first cut of this stub
    // returned a hardcoded 'L9', so a second export's items were filed onto
    // the FIRST list and the new one came back empty — a stub bug that looked
    // exactly like a product bug.
    addList: async (n) => { const id = 'L' + (lists.length + 1); window.__calls.push(['addList', n, id]); lists.push({ id, name: n, n: 1, items: [] }); return { ok: true, id }; },
    addItem: async (...a) => { window.__calls.push(['addItem', ...a]); return { ok: true, id: 'x' }; },
    addItems: async (listId, items) => {
      window.__calls.push(['addItems', listId, items.length]);
      const l = lists.find(x => x.id === listId);
      if (l) items.forEach((it, i) => l.items.push({ id: 'e' + i, text: it.text, trade: it.trade, location: it.location || '', n: (i + 1) * 10 }));
      return { ok: true, n: items.length };
    },
    updateItem: async () => ({ ok: true }), removeItem: async () => ({ ok: true }),
    renameList: async () => ({ ok: true }), removeList: async () => ({ ok: true }),
  };
  openDefectListExport(1);
  const ov = document.getElementById('dlx-overlay');
  if (!ov) return { error: 'no overlay' };
  return {
    rows: ov.querySelectorAll('div[onclick^="_dlxToggle"]').length,
    ticks: [...ov.querySelectorAll('span')].filter(s => s.textContent.trim() === '✓').length,
    name: (document.getElementById('dlx-name') || {}).value,
    btn: ((ov.querySelector('button[onclick="_dlxSave()"]') || {}).textContent || '').trim(),
  };
});
console.log('overlay:', JSON.stringify(opened));
check('the overlay opens once the bank exists', !opened.error, opened.error || '');
check('one row per exportable line', opened.rows === 7, String(opened.rows));
check('everything starts ticked — the common case is the whole house',
  opened.ticks === 7, String(opened.ticks));
check('the list is pre-named after the lot, so it is findable later',
  opened.name === 'Lot 5', opened.name);
check('the button says how many are going in', /Save 7 items as a list/.test(opened.btn), opened.btn);

const toggled = await page.evaluate(() => {
  const ov = document.getElementById('dlx-overlay');
  const rows = [...ov.querySelectorAll('div[onclick^="_dlxToggle"]')];
  rows[rows.length - 1].click();     // drop the last line
  const after = document.getElementById('dlx-overlay');
  const label = ((after.querySelector('button[onclick="_dlxSave()"]') || {}).textContent || '').trim();
  _dlxSetAll(false);
  const emptyBtn = document.getElementById('dlx-overlay').querySelector('button[onclick="_dlxSave()"]');
  const disabled = emptyBtn.disabled;
  _dlxSetAll(true);
  return { label, disabled, backTo: document.getElementById('dlx-overlay').querySelectorAll('div[onclick^="_dlxToggle"]').length };
});
console.log('toggles:', JSON.stringify(toggled));
check('unticking a line updates the count', /Save 6 items as a list/.test(toggled.label), toggled.label);
check('an empty list cannot be saved', toggled.disabled === true, String(toggled.disabled));
check('Tick all brings them back', toggled.backTo === 7, String(toggled.backTo));

// ================= 4. saving ================================================
console.log('\n--- saving ---');
const saved = await page.evaluate(async () => {
  document.getElementById('dlx-name').value = 'Skylark Rd — standard';
  _dlxName('Skylark Rd — standard');
  await _dlxSave();
  return {
    calls: window.__calls.slice(),
    closed: !document.getElementById('dlx-overlay'),
    bank: defectListBank().map(l => ({ name: l.name, items: l.items.length })),
    items: (defectListBank()[0] || { items: [] }).items.map(i => ({ text: i.text, trade: i.trade, location: i.location })),
  };
});
console.log('saved:', JSON.stringify(saved, null, 1));
check('the list is created under the name typed',
  saved.calls.some(c => c[0] === 'addList' && c[1] === 'Skylark Rd — standard'), JSON.stringify(saved.calls));
// Ninety items down a phone connection: one insert, not ninety round trips.
const batches = saved.calls.filter(c => c[0] === 'addItems');
check('the items go up in ONE call, not one per item',
  batches.length === 1 && batches[0][2] === 7, JSON.stringify(saved.calls));
// The items must land on the list this export just created, not on whichever
// list happens to be first in the bank. (The stub's own hardcoded id hid this
// once already — worth asserting on the real thing.)
const createdId = (saved.calls.find(c => c[0] === 'addList') || [])[2];
check('…addressed to the list that was just created, not another one in the bank',
  createdId != null && batches[0][1] === createdId, `created=${createdId} addItems→${batches[0][1]}`);
check('…and addItem (the per-item path) is never used for an export',
  !saved.calls.some(c => c[0] === 'addItem'), JSON.stringify(saved.calls.map(c => c[0])));
check('the overlay closes', saved.closed === true, String(saved.closed));
check('the bank now holds the list', saved.bank.length === 1 && saved.bank[0].items === 7, JSON.stringify(saved.bank));
check('rooms are stored on the items',
  saved.items.filter(i => i.location).length === 6, JSON.stringify(saved.items.map(i => i.location)));
check('no report references survived into the bank',
  !saved.items.some(i => /#\d|\(p\./.test(i.text)), JSON.stringify(saved.items.map(i => i.text)));

// ================= 5. the round trip: lot 5 → lot 6 =========================
console.log('\n--- importing lot 5\'s list onto lot 6 ---');
const round = await page.evaluate(() => {
  const before = (db.data.defects || []).filter(d => d.addressId === 2).length;
  startDefectsForJob(2);
  const btn = [...document.querySelectorAll('div[onclick]')].find(d => /openDefectListImport/.test(d.getAttribute('onclick') || ''));
  if (!btn) return { error: 'no import button on Add Defects' };
  btn.click();
  const ov = document.getElementById('dl-overlay');
  const shown = ov.innerHTML;
  ov.querySelector('button[onclick="_dlDoImport()"]').click();
  const made = (db.data.defects || []).filter(d => d.addressId === 2);
  return {
    before,
    showsRooms: /Bedroom 2/.test(shown),
    made: made.length,
    rows: made.map(d => ({ t: d.description, loc: d.location || '', cid: d.contractorId, un: !!d.unassigned })),
  };
});
console.log('round trip:', JSON.stringify(round, null, 1));
check('the exported list is importable like any other', !round.error, round.error || '');
check('the import screen shows the rooms it is going to set', round.showsRooms === true, String(round.showsRooms));
check('lot 6 gets the seven lines on top of its own one',
  round.made === round.before + 7, `${round.before} → ${round.made}`);

const br2 = (round.rows || []).find(r => /Paint run/.test(r.t));
check('the room survives the round trip — no re-picking ninety locations',
  !!br2 && br2.loc === 'Bedroom 2', br2 && br2.loc);
check('two rooms of the same wording land as two defects on lot 6',
  (round.rows || []).filter(r => /blow outs/.test(r.t)).length === 2,
  JSON.stringify((round.rows || []).filter(r => /blow outs/.test(r.t)).map(r => r.loc)));
check('the trade files against the placeholder on the new house',
  !!br2 && br2.cid === 1 && br2.un === false, JSON.stringify(br2));
const sup = (round.rows || []).find(r => /Site clean/.test(r.t));
check('a Supervisor line lands unassigned rather than against a random sub',
  !!sup && sup.cid == null && sup.un === true, JSON.stringify(sup));
check('nothing arrives carrying lot 5\'s report numbering',
  !(round.rows || []).some(r => /#\d|\(p\./.test(r.t)), JSON.stringify((round.rows || []).map(r => r.t)));

// Importing lot 5's list onto lot 5 is a no-op, not a doubling.
const back = await page.evaluate(() => {
  const before = (db.data.defects || []).filter(d => d.addressId === 1).length;
  startDefectsForJob(1);
  [...document.querySelectorAll('div[onclick]')].find(d => /openDefectListImport/.test(d.getAttribute('onclick') || '')).click();
  document.getElementById('dl-overlay').querySelector('button[onclick="_dlDoImport()"]').click();
  const after = (db.data.defects || []).filter(d => d.addressId === 1);
  return { before, after: after.length, toast: _lastToast(),
           added: after.slice(before).map(d => d.description) };
});
console.log('re-import onto the source:', JSON.stringify(back));
// Six of the seven match straight back, including the two whose stored
// descriptions still carry "PI #3.27 (p.53-54) —" and "BPI #12 —".
//
// The seventh is "Touch up paint to architraves.", and it is SUPPOSED to come
// back as a new row: on lot 5 it is filed against Jameson Bros Painting, and
// the export deliberately generalised that to "Painter" so it would mean
// something on lot 6. A different supplier is a different row by the app's own
// duplicate rule, and loosening that to call a company and its trade
// placeholder the same thing would start merging two real subs on one job.
// Re-importing onto the source house is not the workflow; this is pinned so a
// change to it is noticed rather than discovered.
check('re-importing onto the source house re-raises only the generalised line',
  back.after === back.before + 1, `${back.before} → ${back.after}`);
check('…the generalised one being the company that became a trade',
  back.added.length === 1 && /architraves/.test(back.added[0]), JSON.stringify(back.added));
check('…and the rest are reported as already there', /6 already on this job/i.test(back.toast), back.toast.trim());

// ================= 5b. the template meets the real report ==================
// The workflow this feature is for: pre-load lot 6 off lot 5's list, then read
// lot 6's own PI report. Every line the report also names would have doubled —
// the list item has no reference, the report line does, and a plain string
// compare calls them two defects.
console.log('\n--- the report lands on a pre-loaded job ---');
const meets = await page.evaluate(() => {
  const before = (db.data.defects || []).filter(d => d.addressId === 2).length;
  // Lot 6's own inspector raises the same defect, with his numbering on it.
  db.addDefect({
    addressId: 2, contractorId: 1,
    description: 'PI #4.12 (p.61) — Paint run to door frame.',
    location: 'Bedroom 2', status: 'open', unassigned: false,
  }, { matchCompleted: true, quiet: true });
  const dupeFlagged = db.lastAddWasDuplicate;
  const rows = (db.data.defects || []).filter(d => d.addressId === 2 && /Paint run/.test(d.description));
  return { before, after: (db.data.defects || []).filter(d => d.addressId === 2).length, dupeFlagged,
           n: rows.length, text: rows.map(r => r.description) };
});
console.log('report over template:', JSON.stringify(meets));
check('a referenced line matches the unreferenced one already on the job',
  meets.dupeFlagged === true && meets.after === meets.before, JSON.stringify(meets));
check('…so the job keeps ONE row, not two', meets.n === 1, JSON.stringify(meets.text));
check('…and that row ADOPTS the page reference, which is what gets emailed',
  meets.text[0] === 'PI #4.12 (p.61) — Paint run to door frame.', JSON.stringify(meets.text));

// The reverse order must not strip it back off.
const reverse = await page.evaluate(() => {
  db.addDefect({
    addressId: 2, contractorId: 1, description: 'Paint run to door frame.',
    location: 'Bedroom 2', status: 'open', unassigned: false,
  }, { matchCompleted: true, quiet: true });
  const rows = (db.data.defects || []).filter(d => d.addressId === 2 && /Paint run/.test(d.description));
  return { n: rows.length, text: rows.map(r => r.description) };
});
console.log('unreferenced over referenced:', JSON.stringify(reverse));
check('an unreferenced re-import never strips a reference back off',
  reverse.n === 1 && reverse.text[0] === 'PI #4.12 (p.61) — Paint run to door frame.',
  JSON.stringify(reverse.text));

// Two rows on one job that differ ONLY by reference can exist from before this
// change. Adopting into the first would collide with the second on the cloud's
// unique index, so it must not happen.
const collide = await page.evaluate(() => {
  db.data.defects.push(
    { id: 9001, addressId: 4, contractorId: 1, description: 'Seal gap to skirting.', location: 'Study', status: 'open' },
    { id: 9002, addressId: 4, contractorId: 1, description: 'PI #9.1 — Seal gap to skirting.', location: 'Study', status: 'open' });
  db.addDefect({
    addressId: 4, contractorId: 1, description: 'PI #9.1 — Seal gap to skirting.',
    location: 'Study', status: 'open', unassigned: false,
  }, { matchCompleted: true, quiet: true });
  return (db.data.defects || []).filter(d => d.addressId === 4).map(d => d.description);
});
console.log('collision guard:', JSON.stringify(collide));
check('adoption stands down when the job already carries that exact wording',
  collide.length === 2 && collide.filter(t => t === 'PI #9.1 — Seal gap to skirting.').length === 1,
  JSON.stringify(collide));

// ================= 6. the job picker ========================================
console.log('\n--- picking the job to copy from ---');
const picker = await page.evaluate(() => {
  showDefectListsEditor();
  const entry = document.querySelector('button[onclick="dlNewFromJob()"]');
  if (!entry) return { error: 'no entry point in the editor' };
  entry.click();
  const ov = document.getElementById('dlj-overlay');
  if (!ov) return { error: 'no job picker' };
  const rows = [...ov.querySelectorAll('div[onclick]')].filter(d => /openDefectListExport/.test(d.getAttribute('onclick') || ''));
  return {
    rows: rows.length,
    text: rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()),
    hasLot7: rows.some(r => /Lot 7/.test(r.textContent)),
  };
});
console.log('picker:', JSON.stringify(picker));
check('the editor offers a list from a job', !picker.error, picker.error || '');
check('only jobs that actually have defects are offered', picker.rows === 3, String(picker.rows));
check('…and the one with none is left out', picker.rows < 4, String(picker.rows));
check('…so the empty lot 7 is not pickable', picker.hasLot7 === false, String(picker.hasLot7));
check('each row carries its defect count', /\d+$/.test(picker.text[0] || ''), JSON.stringify(picker.text));

// ================= 7. hand-building a list with rooms =======================
console.log('\n--- a room on a hand-added item ---');
const handmade = await page.evaluate(async () => {
  document.getElementById('dlj-overlay')?.remove();
  showDefectListsEditor();
  const id = defectListBank()[0].id;
  dlToggleOpen(id);
  dlStartAdd(id);
  const sel = document.getElementById('dl-add-location');
  const blankDefault = !!sel && sel.value === '';
  document.getElementById('dl-add-text').value = 'Adjust sliding door.';
  sel.value = 'Alfresco';
  window.__calls.length = 0;
  await dlSaveNewItem(id);
  return { blankDefault, hasSelect: !!sel, calls: window.__calls.slice() };
});
console.log('handmade:', JSON.stringify(handmade));
check('the add form offers a room', handmade.hasSelect === true, String(handmade.hasSelect));
check('…defaulting to blank — a generic template should not presume a room',
  handmade.blankDefault === true, String(handmade.blankDefault));
check('the room is passed through to the bank',
  handmade.calls.some(c => c[0] === 'addItem' && c[5] === 'Alfresco'), JSON.stringify(handmade.calls));

// ================= 8. imports ACCUMULATE, they never replace ===============
// Asked directly (Spiro 2026-10-15): "confirming that by adding additional
// imports to a job it doesn't delete the previous job, it adds to it."
//
// It adds — db.addDefect only ever pushes — but "only ever pushes" is exactly
// the kind of property that holds until someone writes a tidier importer, so
// it is pinned here rather than left to be re-derived. What must survive a
// second and third import: the hand-raised rows, their PHOTOS, a completed
// row's completed state, and the ids (the cloud keys off them).
console.log('\n--- a second import adds to the job, it does not replace it ---');
const accum = await page.evaluate(() => {
  // Lot 10, worked by hand first: one open defect carrying two photos, one
  // already ticked off.
  db.data.defects.push(
    { id: 9101, addressId: 5, contractorId: 1, description: 'Hand-raised: damage to front door.', location: 'Front Door', status: 'open', photos: ['PHOTO-A', 'PHOTO-B'] },
    { id: 9102, addressId: 5, contractorId: 3, description: 'Hand-raised: cracked brick.', location: 'Left Elevation', status: 'completed', completed: true });
  const LISTS = [
    { id: 'XA', name: 'List A', n: 1, items: [
      { id: 'xa1', text: 'Touch up paint to skirting.', trade: 'Painter', location: 'Hallway', n: 10 },
      { id: 'xa2', text: 'Clean brick smears.', trade: 'Bricklayer', location: 'Front Elevation', n: 20 } ] },
    { id: 'XB', name: 'List B', n: 2, items: [
      { id: 'xb1', text: 'Adjust sliding door.', trade: 'Painter', location: 'Alfresco', n: 10 },
      { id: 'xb2', text: 'Seal gap to architrave.', trade: 'Painter', location: 'Study', n: 20 },
      { id: 'xb3', text: 'Repoint mortar.', trade: 'Bricklayer', location: 'Rear Elevation', n: 30 } ] },
  ];
  const prevBank = window.CloudDefectLists.list;
  window.CloudDefectLists.list = () => LISTS.map(l => ({ ...l, items: l.items.slice() }));
  const snap = () => (db.data.defects || []).filter(d => d.addressId === 5)
    .map(d => ({ id: d.id, t: d.description, photos: (d.photos || []).length, st: d.status }));
  const imp = (listId) => {
    _dlImport = { addressId: 5, listId, ticked: null };
    _dlTickAll(LISTS.find(l => l.id === listId));
    _dlDoImport();
  };
  const start = snap();
  imp('XA'); const afterA = snap();
  imp('XB'); const afterB = snap();
  imp('XA'); const afterAgain = snap();
  window.CloudDefectLists.list = prevBank;
  return { start, afterA, afterB, afterAgain };
});
console.log('counts:', ['start', 'afterA', 'afterB', 'afterAgain'].map(k => `${k}=${accum[k].length}`).join(' '));
console.log('final:', JSON.stringify(accum.afterAgain, null, 1));

check('importing a list onto a job that already has defects ADDS to it',
  accum.start.length === 2 && accum.afterA.length === 4, `2 → ${accum.afterA.length}`);
check('a SECOND, different list adds again — it does not replace the first',
  accum.afterB.length === 7, `${accum.afterA.length} → ${accum.afterB.length}`);
check('…and every item from the first list is still there',
  ['Touch up paint to skirting.', 'Clean brick smears.'].every(t => accum.afterB.some(d => d.t === t)),
  JSON.stringify(accum.afterB.map(d => d.t)));
check('the hand-raised defects survive every import',
  accum.afterAgain.filter(d => /Hand-raised/.test(d.t)).length === 2,
  JSON.stringify(accum.afterAgain.filter(d => /Hand-raised/.test(d.t))));
check('…with their PHOTOS still attached',
  (accum.afterAgain.find(d => d.id === 9101) || {}).photos === 2,
  JSON.stringify(accum.afterAgain.find(d => d.id === 9101)));
check('…and a completed one still completed, not re-opened',
  (accum.afterAgain.find(d => d.id === 9102) || {}).st === 'completed',
  JSON.stringify(accum.afterAgain.find(d => d.id === 9102)));
check('ids are never reassigned — the cloud keys off them',
  accum.afterAgain.filter(d => d.id === 9101 || d.id === 9102).length === 2,
  JSON.stringify(accum.afterAgain.map(d => d.id)));
check('re-importing a list already on the job adds nothing a third time',
  accum.afterAgain.length === accum.afterB.length, `${accum.afterB.length} → ${accum.afterAgain.length}`);
check('nothing is ever removed — the job only grows',
  accum.start.every(a => accum.afterAgain.some(b => b.id === a.id)) &&
  accum.afterA.every(a => accum.afterAgain.some(b => b.id === a.id)) &&
  accum.afterB.every(a => accum.afterAgain.some(b => b.id === a.id)), 'every id from every stage survives');

// ================= 9. the SOURCE job is never touched ======================
// Spiro's worry, and the right one to have (2026-10-15): "there are photos on
// the original Skylark list so I can't let it disturb the job list in its
// current form — replicate it and make it available to import to other jobs."
//
// Exporting is a READ. It copies wordings out into a new list and writes
// nothing back. This pins that: the entire defects table is snapshotted as
// JSON before the export and compared, deep, afterwards. Photos, statuses,
// completion, booking dates, order status, ids — if the export disturbs ANY
// of it, byte for byte, this fails.
console.log('\n--- exporting must not disturb the job it reads ---');
const untouched = await page.evaluate(async () => {
  // Lot 5 as a real worked job: photos on defects, one completed, one booked,
  // one on the shopping list.
  const lot5 = (db.data.defects || []).filter(d => d.addressId === 1);
  lot5[0].photos = ['PHOTO-1', 'PHOTO-2', 'PHOTO-3'];
  lot5[0].lastUpdateAt = '2026-10-01T00:00:00.000Z';
  if (lot5[1]) { lot5[1].photos = ['PHOTO-4']; lot5[1].status = 'completed'; lot5[1].completed = true; }
  if (lot5[2]) { lot5[2].orderStatus = 'ordered'; lot5[2].bookingDate = '2026-10-20'; }
  db.save();

  const snapshot = () => JSON.stringify((db.data.defects || []).filter(d => d.addressId === 1));
  const before = snapshot();
  const photosBefore = (db.data.defects || []).filter(d => d.addressId === 1)
    .reduce((n, d) => n + (d.photos || []).length, 0);

  // The full export, end to end, exactly as the button runs it.
  openDefectListExport(1);
  const opened = !!document.getElementById('dlx-overlay');
  _dlxName('Skylark');
  await _dlxSave();

  const after = snapshot();
  const photosAfter = (db.data.defects || []).filter(d => d.addressId === 1)
    .reduce((n, d) => n + (d.photos || []).length, 0);
  const made = defectListBank().find(l => l.name === 'Skylark');
  return {
    opened, identical: before === after, photosBefore, photosAfter,
    listMade: !!made, listItems: made ? made.items.length : 0,
    sourceCount: (db.data.defects || []).filter(d => d.addressId === 1).length,
  };
});
console.log('untouched:', JSON.stringify(untouched));
check('the export runs end to end', untouched.opened === true && untouched.listMade === true,
  JSON.stringify(untouched));
check('the source job is byte-for-byte IDENTICAL afterwards — nothing is moved or rewritten',
  untouched.identical === true, 'deep JSON compare of every defect on the job');
check('…every photo still attached to the defect it was on',
  untouched.photosBefore === 4 && untouched.photosAfter === 4,
  `${untouched.photosBefore} → ${untouched.photosAfter}`);
check('…and no defect added to or removed from the source job',
  untouched.sourceCount === 9, String(untouched.sourceCount));
check('the copy is a separate thing that can go onto other jobs',
  untouched.listItems > 0, `"Skylark" list holds ${untouched.listItems} items`);

// ================= 10. reachable from the job you are standing on ==========
// Spiro, on lot 6 wanting lot 5's defects: "Still says only 1 list available?"
// The list did not exist yet — but the export that makes it was only reachable
// from Settings -> Defect lists, which is not where the thought occurs, and the
// chip's "1 available" read the same whether the shared bank was live or the
// app was falling back to its one hardcoded list. Both fixed; both pinned.
console.log('\n--- the chips on Add Defects ---');
const chips = await page.evaluate(() => {
  const read = () => {
    startDefectsForJob(1);
    const all = [...document.querySelectorAll('div[onclick]')];
    const imp = all.find(d => /openDefectListImport/.test(d.getAttribute('onclick') || ''));
    const exp = all.find(d => /openDefectListExport/.test(d.getAttribute('onclick') || ''));
    return {
      importText: imp ? imp.textContent.replace(/\s+/g, ' ').trim() : null,
      exportText: exp ? exp.textContent.replace(/\s+/g, ' ').trim() : null,
      sameRow: !!(imp && exp) && imp.parentElement === exp.parentElement,
    };
  };
  const live = read();
  // Now the migration-not-run case: the bank falls back to the built-in list.
  const saved = window.CloudDefectLists;
  window.CloudDefectLists = null;
  const fallback = read();
  // …and a job with no defects yet has nothing worth saving.
  window.CloudDefectLists = saved;
  const emptyJob = (() => {
    startDefectsForJob(3);              // lot 7, deliberately empty
    const all = [...document.querySelectorAll('div[onclick]')];
    return !all.some(d => /openDefectListExport/.test(d.getAttribute('onclick') || ''));
  })();
  return { live, fallback, emptyJob };
});
console.log('chips:', JSON.stringify(chips, null, 1));

check('the job screen offers to save its defects as a list',
  !!chips.live.exportText, chips.live.exportText || 'no save chip');
check('…right beside the import chip, where you went looking',
  chips.live.sameRow === true, String(chips.live.sameRow));
check('…saying how many it would take', /\d+ defects?/.test(chips.live.exportText || ''),
  chips.live.exportText || '');
check('with the shared bank live, the import chip counts it',
  /\d+ available/.test(chips.live.importText || ''), chips.live.importText || '');
check('on the built-in fallback it says SO, instead of a count that looks the same',
  /starter list only/.test(chips.fallback.importText || ''), chips.fallback.importText || '');
check('…and offers no save button it could not honour',
  chips.fallback.exportText === null, String(chips.fallback.exportText));
check('a job with no defects yet is not offered a save',
  chips.emptyJob === true, String(chips.emptyJob));

check('no page errors', errs.length === 0, JSON.stringify(errs));

console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
