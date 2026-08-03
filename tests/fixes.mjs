// Four issues reported from site 2026-08-02:
//   1. re-importing a BPI report appears to do nothing
//   2. search can't find multi-word suppliers/trades
//   3. leaving Add Defects no longer asks to save
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


const ROOT = REPO, PORT = 8107;
const OUT = ARTIFACTS;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [
    { id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', active: true },
    { id: 2, lot: '218', street: 'Lot 218, (14) Red Fruit St', suburb: 'Clyde North', propertyNumber: '305942', active: true },
  ],
  contractors: [
    { id: 1, name: 'HaR', trades: 'Painter' },
    { id: 2, name: 'Vic Plaster Adam', trades: 'Plasterer' },
    { id: 3, name: 'Victoria Fencing', trades: 'Fencing' },
    { id: 4, name: 'AUZ PAINTING & DECORATING PTY LTD', trades: 'Painter' },
    { id: 5, name: 'COSTAS PLUMBING', trades: 'Plumber' },
  ],
  trades: [
    { id: 1, name: 'Painter' }, { id: 2, name: 'Plasterer' },
    { id: 3, name: 'Roof Plumber' }, { id: 4, name: 'Shower Screen' },
    { id: 5, name: 'Brick Cleaner' },
  ],
  defects: [],
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

// ================= 1. SEARCH ===============================================
console.log('\n--- search ---');
const q = (type, v) => page.evaluate(({ type, v }) => {
  const inp = document.createElement('input');
  inp.id = 'probe-x'; inp.value = v;
  const dd = document.createElement('div'); dd.id = 'probe-x-dropdown'; dd.className = 'autocomplete-dropdown';
  document.body.append(inp, dd);
  handleAutocomplete(inp, type, 'probe-x');
  const out = [...dd.querySelectorAll('.autocomplete-item')].map(e => e.textContent.trim());
  inp.remove(); dd.remove();
  return out;
}, { type, v });

// Each row: [type, query, must-contain]. Every one of these returned an EMPTY
// dropdown before the fix — the whole query had to prefix a single word.
const CASES = [
  ['contractor', 'har',              'HaR'],
  ['contractor', 'har painter',      'HaR'],
  ['contractor', 'painter har',      'HaR'],          // order must not matter
  ['contractor', 'vic plaster',      'Vic Plaster Adam'],
  ['contractor', 'plaster vic',      'Vic Plaster Adam'],
  ['contractor', 'victoria fencing', 'Victoria Fencing'],
  ['contractor', 'auz painting',     'AUZ PAINTING'],
  ['contractor', 'auz decorating',   'AUZ PAINTING'],  // skips a word in between
  ['contractor', 'costas plumbing',  'COSTAS PLUMBING'],
  ['trade',      'painter',          'Painter'],
  ['trade',      'roof plumb',       'Roof Plumber'],
  ['trade',      'shower screen',    'Shower Screen'],
  ['trade',      'brick clean',      'Brick Cleaner'],
  ['trade',      'plumber roof',     'Roof Plumber'],
  ['address',    'red fruit',        'Red Fruit'],
  ['address',    'woodlawn wollert', 'Woodlawn'],
];
for (const [type, query, want] of CASES) {
  const res = await q(type, query);
  check(`${type} "${query}" finds ${want}`,
    res.some(r => r.toLowerCase().includes(want.toLowerCase())),
    JSON.stringify(res.slice(0, 3)));
}
// …and it must not become a match-everything box.
const noise = await q('contractor', 'zzz');
check('a nonsense query still returns nothing', noise.length === 0, JSON.stringify(noise));
const partial = await q('contractor', 'ain');
check('mid-word text does NOT match (prefix search, not substring)',
  !partial.some(r => /PAINTING|Painter/i.test(r)), JSON.stringify(partial.slice(0, 3)));
// ranking: an exact word beats a longer partial
const ranked = await q('trade', 'painter');
check('an exact word ranks first', (ranked[0] || '').toLowerCase().includes('painter'), JSON.stringify(ranked));

// the Add Defects contractor box uses the same matcher
await page.evaluate(() => startDefectsForJob(1));
await page.waitForTimeout(300);
const addBox = await page.evaluate(() => {
  const inp = document.getElementById('add-contractor-1-input');
  inp.value = 'vic plaster';
  handleAddDefectsContractorAutocomplete(inp, 1);
  return [...document.querySelectorAll('#add-contractor-1-dropdown .autocomplete-item')].map(e => e.textContent.trim());
});
console.log('add-defects box:', JSON.stringify(addBox));
check('the Add Defects supplier box searches the same way',
  addBox.some(r => /Vic Plaster Adam/.test(r)), JSON.stringify(addBox));

// ================= 2. UNSAVED CHANGES ======================================
console.log('\n--- leaving Add Defects with unsaved work ---');
const guard = await page.evaluate(async () => {
  const out = {};
  const real = window.confirm;
  const type = () => { document.querySelector('.add-defect-1').value = 'Downpipe missing behind garage'; };

  // exit A: the Back link
  type();
  let asked = 0; window.confirm = () => { asked++; return false; };
  document.querySelector('.back-link').click();
  await new Promise(r => setTimeout(r, 150));
  out.back = { asked, stayed: state.currentView === 'add-defects-address' };

  // exit B: tapping the job title above the form
  asked = 0;
  document.querySelector('.defects-header .lot-title').click();
  await new Promise(r => setTimeout(r, 200));
  out.title = { asked, stayed: state.currentView === 'add-defects-address' };

  // saying YES must actually leave
  asked = 0; window.confirm = () => { asked++; return true; };
  document.querySelector('.defects-header .lot-title').click();
  await new Promise(r => setTimeout(r, 250));
  out.confirmed = { asked, view: state.currentView };

  window.confirm = real;
  return out;
});
console.log('guard:', JSON.stringify(guard));
check('Back asks before discarding typed work', guard.back.asked === 1 && guard.back.stayed, JSON.stringify(guard.back));
check('tapping the job title asks too (this was the leak)', guard.title.asked === 1 && guard.title.stayed, JSON.stringify(guard.title));
check('confirming actually leaves', guard.confirmed.asked === 1 && guard.confirmed.view === 'view-defects-address', JSON.stringify(guard.confirmed));

// an EMPTY form must not nag
const clean = await page.evaluate(async () => {
  startDefectsForJob(1);
  await new Promise(r => setTimeout(r, 250));
  let asked = 0; const real = window.confirm; window.confirm = () => { asked++; return true; };
  document.querySelector('.back-link').click();
  await new Promise(r => setTimeout(r, 200));
  window.confirm = real;
  return { asked, view: state.currentView };
});
check('an empty form leaves without nagging', clean.asked === 0 && clean.view === 'home', JSON.stringify(clean));

// ================= 3. RE-IMPORTING A REPORT ================================
console.log('\n--- re-importing a report ---');
const ITEMS = [
  { description: 'Paint touch ups to hallway', location: 'Hallway', page: 1, itemNo: 1 },
  { description: 'Downpipe missing behind garage', location: 'Garage', page: 1, itemNo: 2 },
  { description: 'Grout cracked to ensuite', location: 'Ensuite', page: 2, itemNo: 3 },
];
// Drive the review screen the way a supervisor does: Save on each item.
const runImport = () => page.evaluate(async (items) => {
  startReportReview(JSON.parse(JSON.stringify(items)), 'BPI report.pdf', 'BPI', 1, null);
  const alerts = [];
  const realAlert = window.alert; window.alert = (m) => { alerts.push(String(m)); };
  for (let i = 0; i < items.length; i++) {
    const sel = document.getElementById('rv-address');
    if (sel) sel.value = '1';
    const btn = [...document.querySelectorAll('#imp-body button')].find(b => /save/i.test(b.textContent));
    if (!btn) break;
    btn.click();
    await new Promise(r => setTimeout(r, 220));
  }
  // finish if the review didn't close itself
  if (window._review) { try { await finishReview(); } catch (e) {} }
  await new Promise(r => setTimeout(r, 250));
  window.alert = realAlert;
  return { alerts, defects: (db.data.defects || []).map(d => ({ desc: d.description, st: defectStatusOf(d) })) };
}, ITEMS);

const first = await runImport();
console.log('first import:', JSON.stringify(first.defects, null, 1));
check('a first import creates every item', first.defects.length === 3, String(first.defects.length));
check('…and says nothing alarming', first.alerts.length === 0, JSON.stringify(first.alerts));

// Work the job: complete two of them.
await page.evaluate(() => {
  const ds = db.data.defects;
  db.setDefectStatus(ds[0].id, 'completed');
  db.setDefectStatus(ds[1].id, 'completed');
});
check('two are now completed',
  await page.evaluate(() => db.data.defects.filter(d => defectStatusOf(d) === 'completed').length) === 2);

// Re-import the SAME report — Spiro's case.
const second = await runImport();
console.log('second import:', JSON.stringify(second.defects, null, 1));
console.log('summary shown:', JSON.stringify(second.alerts));
check('re-importing does NOT double the list', second.defects.length === 3, String(second.defects.length));
check('the completed items the report raised again are RE-OPENED',
  second.defects.filter(d => d.st === 'completed').length === 0,
  JSON.stringify(second.defects.map(d => d.st)));
check('the import reports what it did, rather than looking broken',
  second.alerts.length === 1 && /re-opened/i.test(second.alerts[0]), JSON.stringify(second.alerts));
check('…and names the counts',
  /2 RE-OPENED/i.test(second.alerts[0] || '') && /1 already on the list/i.test(second.alerts[0] || ''),
  JSON.stringify(second.alerts));

// A third import with nothing completed: all duplicates, still no doubling.
const third = await runImport();
check('a third import still adds nothing', third.defects.length === 3, String(third.defects.length));
check('…and says so plainly',
  /Nothing new was added/i.test(third.alerts[0] || ''), JSON.stringify(third.alerts));

// A genuinely NEW item in a later report must still come through.
const fourth = await page.evaluate(async () => {
  const items = [{ description: 'NEW — render patch to front elevation', location: 'Facade / External', page: 3, itemNo: 4 }];
  startReportReview(items, 'BPI report 2.pdf', 'BPI', 1, null);
  const alerts = []; const realAlert = window.alert; window.alert = (m) => alerts.push(String(m));
  const sel = document.getElementById('rv-address'); if (sel) sel.value = '1';
  const btn = [...document.querySelectorAll('#imp-body button')].find(b => /save/i.test(b.textContent));
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 300));
  if (window._review) { try { await finishReview(); } catch (e) {} }
  await new Promise(r => setTimeout(r, 200));
  window.alert = realAlert;
  return { alerts, n: (db.data.defects || []).length };
});
console.log('new item import:', JSON.stringify(fourth));
check('a genuinely new item is still added', fourth.n === 4, String(fourth.n));

// ================= 4. MARK DONE IN PREVIEW ASKS FIRST ======================
console.log('\n--- Mark done in preview mode ---');
await page.evaluate(() => {
  db.data.defects.forEach(d => db.setDefectStatus(d.id, 'open'));
  localStorage.setItem('dm_preview', '1');
  viewDefectsForAddress(1);
});
await page.waitForTimeout(400);
const pvDone = await page.evaluate(async () => {
  const out = {};
  const real = window.confirm;
  const card = () => document.querySelector('.pv-card');
  const id = Number(card().getAttribute('data-pv'));
  const st = () => defectStatusOf(db.data.defects.find(d => d.id === id));

  // Cancelling must leave it alone.
  let asked = 0, msg = '';
  window.confirm = (m) => { asked++; msg = String(m); return false; };
  card().querySelector('.pv-tick').click();
  await new Promise(r => setTimeout(r, 200));
  out.cancelled = { asked, msg, status: st(), label: card().querySelector('.pv-tick').textContent.trim(),
                    greyed: card().classList.contains('pv-done') };

  // Confirming completes it.
  asked = 0; window.confirm = () => { asked++; return true; };
  const node = card();
  card().querySelector('.pv-tick').click();
  await new Promise(r => setTimeout(r, 250));
  out.confirmed = { asked, status: st(), label: card().querySelector('.pv-tick').textContent.trim(),
                    greyed: card().classList.contains('pv-done'), sameNode: card() === node };

  // Un-completing is the undo — no prompt.
  asked = 0;
  card().querySelector('.pv-tick').click();
  await new Promise(r => setTimeout(r, 250));
  out.undo = { asked, status: st(), label: card().querySelector('.pv-tick').textContent.trim() };

  window.confirm = real;
  return out;
});
console.log('preview Mark done:', JSON.stringify(pvDone, null, 1));
check('Mark done asks before completing', pvDone.cancelled.asked === 1, JSON.stringify(pvDone.cancelled));
check('…with the same wording as list mode',
  /removed from the active list/i.test(pvDone.cancelled.msg), pvDone.cancelled.msg);
check('cancelling leaves the item untouched',
  pvDone.cancelled.status === 'open' && !pvDone.cancelled.greyed && /Mark done/i.test(pvDone.cancelled.label),
  JSON.stringify(pvDone.cancelled));
check('confirming completes it', pvDone.confirmed.asked === 1 && pvDone.confirmed.status === 'completed',
  JSON.stringify(pvDone.confirmed));
check('…and the card updates in place, keeping your scroll position',
  pvDone.confirmed.sameNode && pvDone.confirmed.greyed && /Done/i.test(pvDone.confirmed.label),
  JSON.stringify(pvDone.confirmed));
check('un-completing needs NO prompt (it is the undo)',
  pvDone.undo.asked === 0 && pvDone.undo.status === 'open', JSON.stringify(pvDone.undo));
await page.evaluate(() => { localStorage.setItem('dm_preview', '0'); render(); });

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
