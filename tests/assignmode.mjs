// "ASSIGN TO" FOLLOWS THE TOGGLE, AND A SUPERVISOR MARKUP IS NOT THE TRADE.
//
// Two faults in one box, from Spiro's screenshots (2026-11-19):
//
//  1. With the TRADE toggle selected, the box was pre-filled with the
//     SUPPLIER — "Insulgreen Solutions — Insulation to Ceilings" in a field
//     that only accepts a trade. Not cosmetic: on save, resolveAssignId finds
//     no trade matching that text and falls back to the hidden id, so the
//     defect was filed against the supplier while the screen said Trade.
//  2. A paint defect suggested "Ian Quayle — Supervisor", because the Called
//     For archive row read "Supervisor Paint MarkUp" — the supervisor walking
//     the house and marking paint up, not the painter painting it. It carries
//     the word "paint", so it matched the Painter keywords.
//
// Both are checked here from what is actually IN the box, and the save path is
// followed through to the defect record, because that is where fault 1 did its
// damage. 'Supervisor' is itself a legitimate trade in this app, so the last
// section pins that it is still choosable — the fix excludes an ACTIVITY, not
// a trade.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8193;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Trade placeholders (what Trade mode offers) and real suppliers (what
// Contractor mode offers), as the live book holds them.
const SEED = {
  addresses: [
    { id: 1, lot: '6', street: 'Lot 6, 24 Skylark Rd', streetName: 'Skylark Rd', lotNo: 6,
      suburb: 'Greenvale', propertyNumber: '306640', active: true },
    // Spiro's own case: the report says Lot 7, 26 Skylark Rd … 306629, and the
    // old matcher answered "Lot 1113, 7 Ligar Rise" — the 7 of "Lot 7" against
    // the HOUSE NUMBER of 7 Ligar Rise.
    // LIGAR IS DELIBERATELY FIRST. The old rule took whichever matching row it
    // reached first, so with Skylark earlier in the book it would have passed
    // these checks by luck; sorted A-Z, as the app lists jobs, Ligar comes
    // first and that is the order that produced the bug.
    { id: 2, lot: '1113', street: 'Lot 1113, 7 Ligar Rise', streetName: 'Ligar Rise', lotNo: 1113,
      suburb: 'Nar Nar Goon North', propertyNumber: '301113', active: true },
    { id: 3, lot: '7', street: 'Lot 7, 26 Skylark Rd', streetName: 'Skylark Rd', lotNo: 7,
      suburb: 'Greenvale', propertyNumber: '306629', active: true },
    // "lot 71" contains "lot 7": the same hole from the other side.
    { id: 4, lot: '71', street: 'Lot 71, 3 Rosella Way', streetName: 'Rosella Way', lotNo: 71,
      suburb: 'Clyde North', propertyNumber: '300071', active: true },
    // Two jobs on one street, for the ambiguity rule.
    { id: 5, lot: '201', street: 'Lot 201, 4 Kobi St', streetName: 'Kobi St', lotNo: 201,
      suburb: 'Donnybrook', propertyNumber: '300201', active: true },
    { id: 6, lot: '202', street: 'Lot 202, 6 Kobi St', streetName: 'Kobi St', lotNo: 202,
      suburb: 'Donnybrook', propertyNumber: '300202', active: true },
  ],
  contractors: [
    { id: 1, name: 'Painter',    trades: 'Painter',    isTradePlaceholder: true, isActive: true },
    { id: 2, name: 'Insulation', trades: 'Insulation', isTradePlaceholder: true, isActive: true },
    { id: 3, name: 'Supervisor', trades: 'Supervisor', isTradePlaceholder: true, isActive: true },
    { id: 4, name: 'Caulker',    trades: 'Caulker',    isTradePlaceholder: true, isActive: true },
    { id: 5, name: 'Plumber',    trades: 'Plumber',    isTradePlaceholder: true, isActive: true },
    { id: 6, name: 'Roof Plumber', trades: 'Roof Plumber', isTradePlaceholder: true, isActive: true },
    { id: 7, name: 'Shower Screen', trades: 'Shower Screen', isTradePlaceholder: true, isActive: true },
    { id: 10, name: 'Insulgreen Solutions', trades: 'Insulation to Ceilings', isActive: true },
    { id: 11, name: 'Ian Quayle', trades: 'Supervisor', isActive: true },
    { id: 12, name: 'Brushworks Painting', trades: 'Painter', isActive: true },
  ],
  trades: [], defects: [],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, serviceWorkers: 'block' });
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
await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });

// The Called For archive for this job: the insulation sub really did the
// insulation, and the supervisor marked the paint up.
await page.evaluate(() => {
  window.CloudCallups = {
    calledForForAddress: () => ([
      { activity: 'Wall & Ceiling Insulation', supplier_name: 'Insulgreen Solutions', called_actual: '2026-10-02' },
      { activity: 'Supervisor Paint MarkUp',   supplier_name: 'Ian Quayle',           called_actual: '2026-10-05' },
    ]),
    // The Order Profile side of the same module. Empty on purpose: this suite
    // is about the Called For archive, and leaving it out entirely throws
    // inside suggestCallupForTrade.
    rowsForAddress: () => [],
  };
});

const INSUL = { description: 'The ceiling insulation between roof members has been removed for the installation of services and needs to be reinstated.', location: 'Roof Space', page: 3, itemNo: 1 };
const PAINT = { description: 'Paint edge of skirt tile to left of trough cabinet', location: 'Laundry', page: 3, itemNo: 4 };

const review = (item, byTrade) => page.evaluate(([item, byTrade]) => {
  try { _review = null; } catch (e) {}
  state.assignByTrade = !!byTrade;
  startReportReview([Object.assign({}, item)], 'BPI.pdf', 'BPI', 1, null);
  const inp = document.getElementById('rv-contractor-input');
  const hid = document.getElementById('rv-contractor');
  const cid = parseInt(hid && hid.value);
  const c = cid ? db.getContractor(cid) : null;
  return {
    value: inp ? inp.value : '(no field)',
    id: cid || null,
    isPlaceholder: c ? !!c.isTradePlaceholder : null,
    meta: (document.querySelector('#imp-body div[style*="font-size:12px"]') || {}).textContent || '',
    chips: Array.from(document.querySelectorAll('.rv-chip b')).map(b => b.textContent),
  };
}, [item, byTrade]);

// ── 1. Trade toggle → a TRADE in the box ──────────────────────────────────
{
  const r = await review(INSUL, true);
  check('Trade mode pre-fills the trade, not the supplier',
    r.value === 'Insulation' && r.isPlaceholder === true, JSON.stringify(r).slice(0, 180));
}
// ── 2. Contractor toggle → the SUPPLIER, as before ────────────────────────
{
  const r = await review(INSUL, false);
  check('Contractor mode still pre-fills the supplier who did the work',
    /^Insulgreen Solutions/.test(r.value) && r.isPlaceholder === false, JSON.stringify(r).slice(0, 180));
}
// ── 3. Saving in Trade mode files it against the TRADE ────────────────────
// Where fault 1 actually bit: the box said Insulation, the hidden id said
// Insulgreen, and the hidden id is what resolveAssignId fell back to.
{
  await review(INSUL, true);
  const saved = await page.evaluate(async () => {
    document.getElementById('rv-save').click();
    await new Promise(r => setTimeout(r, 400));
    const d = (db.getDefects() || []).slice(-1)[0];
    const c = d ? db.getContractor(d.contractorId) : null;
    return d ? { to: c ? c.name : null, placeholder: c ? !!c.isTradePlaceholder : null } : null;
  });
  check('a defect saved in Trade mode is filed against the trade',
    saved && saved.to === 'Insulation' && saved.placeholder === true, JSON.stringify(saved));
}
// ── 4. A paint item brings up the PAINTER ─────────────────────────────────
{
  const r = await review(PAINT, true);
  check('a paint defect pre-fills Painter, not the supervisor',
    r.value === 'Painter', JSON.stringify(r).slice(0, 180));
  check('…and "Supervisor Paint MarkUp" is not reported as who did the work',
    !/Ian Quayle/.test(r.meta), r.meta.slice(0, 140));
}
{
  const r = await review(PAINT, false);
  check('…in Contractor mode too: a supervisor markup never auto-fills the box',
    !/Ian Quayle/.test(r.value), JSON.stringify(r).slice(0, 160));
}
// ── 5. The insulation activity is still read as the insulation sub ────────
// The guard above removes supervisor ACTIVITIES. If it were removing anything
// broader, this is what would go quiet.
{
  const r = await review(INSUL, false);
  check('a real trade activity is still read as who did the work',
    /Insulgreen/.test(r.meta) && /did this work here/i.test(r.meta), r.meta.slice(0, 140));
}
// ── 6. 'Supervisor' is a trade in this app, and stays choosable ───────────
{
  const r = await page.evaluate(() => {
    try { _review = null; } catch (e) {}
    state.assignByTrade = true;
    startReportReview([{ description: 'Repair dented window frame.', location: 'Bed 1', page: 2, itemNo: 9 }], 'BPI.pdf', 'BPI', 1, null);
    const ph = db.getContractors().filter(c => c.isTradePlaceholder).map(c => c.name);
    return { ph, value: (document.getElementById('rv-contractor-input') || {}).value };
  });
  check('the Supervisor TRADE is still in the book and choosable',
    r.ph.includes('Supervisor'), JSON.stringify(r).slice(0, 160));
}

// ── 7. Supervisor is always on the end of the chips ──────────────────────
// Not a suggestion — a fixed one-tap target (Spiro: "ALWAYS have the
// supervisor's name last… just needs to be available, quick TRIGGER"). A
// target that moves is one you have to look for, so it is pinned last even
// when it IS the suggested trade.
{
  const r = await review(PAINT, true);
  check('the Supervisor chip is there, and it is last',
    r.chips.length >= 2 && r.chips[r.chips.length - 1] === 'Supervisor' && r.chips[0] === 'Painter',
    JSON.stringify(r.chips));
}
{
  const r = await page.evaluate(() => {
    try { _review = null; } catch (e) {}
    state.assignByTrade = true;
    // A defect whose own suggested trade IS Supervisor.
    startReportReview([{ description: 'Repair dented window frame.', location: 'Bed 1', page: 2, itemNo: 9 }], 'BPI.pdf', 'BPI', 1, null);
    return { chips: Array.from(document.querySelectorAll('.rv-chip b')).map(b => b.textContent),
             hints: Array.from(document.querySelectorAll('.rv-chip i')).map(b => b.textContent) };
  });
  check('…even when Supervisor IS the suggested trade, it stays in that one place',
    r.chips[r.chips.length - 1] === 'Supervisor' && r.chips.filter(c => c === 'Supervisor').length === 1,
    JSON.stringify(r.chips) + ' ' + JSON.stringify(r.hints));
}
{
  const r = await review(PAINT, false);
  check('…and it is a TRADE chip: Contractor mode still shows contractors',
    !r.chips.includes('Supervisor'), JSON.stringify(r.chips));
}

// ── 8. The trade a defect's own words call for ───────────────────────────
const tradeFor = (desc, loc) => page.evaluate(([desc, loc]) => {
  try { _review = null; } catch (e) {}
  state.assignByTrade = true;
  startReportReview([{ description: desc, location: loc || '', page: 4, itemNo: 6 }], 'BPI.pdf', 'BPI', 1, null);
  return { value: (document.getElementById('rv-contractor-input') || {}).value,
           chips: Array.from(document.querySelectorAll('.rv-chip b')).map(b => b.textContent),
           hints: Array.from(document.querySelectorAll('.rv-chip i')).map(b => b.textContent) };
}, [desc, loc]);
{
  // A leaking screen is a failed seal, not a new screen (Spiro 2026-11-19).
  const r = await tradeFor('Bottom corner of shower screen leaking opposite vanity', 'Ensuite');
  check('a leaking shower screen is the Caulker',
    r.value === 'Caulker', JSON.stringify(r).slice(0, 170));
  const r2 = await tradeFor('Shower screen glass is scratched and needs replacing', 'Ensuite');
  check('…but a damaged screen is still the screen installer',
    r2.value === 'Shower Screen', JSON.stringify(r2).slice(0, 170));
}
{
  // Downpipe: Plumber first, Roof Plumber second, both one tap away.
  const r = await tradeFor('Down pipe bracket down pipe to right of slider loose of wall.', 'Rear Elevation');
  check('a downpipe defect suggests the Plumber first',
    r.value === 'Plumber', JSON.stringify(r).slice(0, 170));
  check('…with Roof Plumber offered second, and Supervisor still last',
    r.chips[0] === 'Plumber' && r.chips[1] === 'Roof Plumber'
      && r.chips[r.chips.length - 1] === 'Supervisor', JSON.stringify(r.chips));
}

// ── 9. WHICH JOB IS THIS REPORT FOR ──────────────────────────────────────
const matched = (text, fn) => page.evaluate(([t, f]) => {
  const id = matchAddressFromText(t, f);
  return { id, street: id != null ? (db.getAddress(id) || {}).street : null, dbg: (typeof _amftDbg !== 'undefined' ? _amftDbg : '') };
}, [text, fn || '']);
{
  const r = await matched('BPI Report\nLot 7, 26 Skylark Rd, GREENVALE - 306629\nDefects follow.', 'BPI Lot 7 Skylark.pdf');
  check('Spiro\'s report finds Lot 7, 26 Skylark Rd',
    r.street === 'Lot 7, 26 Skylark Rd', JSON.stringify(r));
}
{
  // The bare number must not reach across to another job's HOUSE number.
  const r = await matched('Lot 7, 26 Skylark Rd\nDefect list', '');
  check('…and the 7 of "Lot 7" never matches 7 Ligar Rise',
    r.street === 'Lot 7, 26 Skylark Rd', JSON.stringify(r));
}
{
  const r = await matched('Property 306629 — practical completion inspection', '');
  check('the property number alone is enough', r.street === 'Lot 7, 26 Skylark Rd', JSON.stringify(r));
}
{
  const r = await matched('Inspection for Lot 71, 3 Rosella Way', '');
  check('"Lot 71" is not "Lot 7"', r.street === 'Lot 71, 3 Rosella Way', JSON.stringify(r));
}
{
  // pdf.js fragments text; the squished form has to still work.
  const r = await matched('L ot 11 13, 7 Li gar Rise inspection', '');
  check('a fragmented "Lot 1113" still finds Ligar Rise',
    r.street === 'Lot 1113, 7 Ligar Rise', JSON.stringify(r));
}
{
  const r = await matched('Defects at Kobi St — see attached', '');
  check('two jobs on one street with no lot is left EMPTY, not guessed',
    r.id === null, JSON.stringify(r));
}
{
  const r = await matched('Kobi St, lot 202 practical completion', '');
  check('…and the lot settles it', r.street === 'Lot 202, 6 Kobi St', JSON.stringify(r));
}

check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
server.close();
console.log(fail.length ? 'FAILED: ' + fail.join('; ') : 'ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
