// Pre-loaded defect lists (Spiro 2026-09-30): "there are certain things that
// will appear on every single report so rather than entering it in you're
// pretty much taking photos and matching the photos to that item", plus "the
// ability to also create pre loaded defect lists, edit and add and remove
// items… like be able to create a bank of them".
//
// Two halves, both covered here: importing a list onto a job (the thing that
// saves the typing) and the editor that keeps the bank (the thing that makes it
// yours). The built-in starter list is the fallback until
// 2026-09-30_defect_lists.sql is run, exactly like CURATED_DEFECT_WORDINGS.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');

const ROOT = REPO, PORT = 8124;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Painter and Bricklayer exist as trade placeholders; Brick Cleaner
// deliberately does NOT, so the "trade with no placeholder" path is exercised.
const SEED = {
  addresses: [{ id: 1, lot: '410', street: 'Lot 410, Gelbvieh Rd', suburb: 'Clyde North', propertyNumber: '306166', active: true }],
  contractors: [
    { id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' },
    { id: 2, name: 'Bricklayer', isTradePlaceholder: true, isActive: true, trades: 'Bricklayer' },
    { id: 3, name: 'Carpenter', isTradePlaceholder: true, isActive: true, trades: 'Carpenter' },
  ],
  trades: [{ id: 1, name: 'Painter' }],
  defects: [],
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
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= 1. the built-in fallback =================================
console.log('\n--- built-in starter list (migration not run) ---');
const bank = await page.evaluate(() => defectListBank().map(l => ({ name: l.name, items: l.items.length })));
console.log('bank:', JSON.stringify(bank));
check('a starter list ships with the app', bank.length === 1 && bank[0].name === 'Standard PCI', JSON.stringify(bank));
check('…with the regulars in it', bank[0] && bank[0].items === 18, String(bank[0] && bank[0].items));
check('…and the editor is read-only without the migration',
  await page.evaluate(() => defectListsCanEdit()) === false);

// The items must be REAL wordings from the existing bank, not new prose —
// a list is a saved selection of the house vocabulary.
const overlap = await page.evaluate(() => {
  const words = new Set(defectWordingList().map(w => w.text));
  const items = defectListBank()[0].items;
  return { total: items.length, fromBank: items.filter(i => words.has(i.text)).length };
});
console.log('wording overlap:', JSON.stringify(overlap));
check('every starter item is an existing curated wording',
  overlap.fromBank === overlap.total, JSON.stringify(overlap));

// ================= 2. importing onto a job ==================================
console.log('\n--- importing a list onto a job ---');
const opened = await page.evaluate(() => {
  startDefectsForJob(1);
  const btn = [...document.querySelectorAll('div[onclick]')].find(d => /openDefectListImport/.test(d.getAttribute('onclick') || ''));
  if (!btn) return { error: 'no import button on Add Defects' };
  btn.click();
  const ov = document.getElementById('dl-overlay');
  const ticks = [...ov.querySelectorAll('span')].filter(s => s.textContent.trim() === '✓').length;
  return { rows: ov.querySelectorAll('div[onclick^="_dlToggle"]').length, ticks, btn: (ov.querySelector('button[onclick="_dlDoImport()"]') || {}).textContent };
});
console.log('overlay:', JSON.stringify(opened));
check('the Add Defects screen offers the import', !opened.error, opened.error || '');
check('one row per item', opened.rows === 18, String(opened.rows));
check('everything starts ticked — the common case is all of them',
  opened.ticks === 18, String(opened.ticks));
check('…and the button says how many that is',
  /Add 18 defects/.test(opened.btn || ''), (opened.btn || '').trim());

// Untick two, then import.
const imported = await page.evaluate(() => {
  const ov = document.getElementById('dl-overlay');
  const rows = [...ov.querySelectorAll('div[onclick^="_dlToggle"]')];
  // Untick from the END. The first two rows are the Brick Cleaner items the
  // trade-resolution checks below look for — unticking those would have the
  // test quietly assert against a defect it had just chosen not to create.
  rows[rows.length - 1].click();
  rows[rows.length - 2].click();
  const after = document.getElementById('dl-overlay');
  const label = (after.querySelector('button[onclick="_dlDoImport()"]') || {}).textContent;
  after.querySelector('button[onclick="_dlDoImport()"]').click();
  return {
    label: (label || '').trim(),
    made: (db.data.defects || []).length,
    closed: !document.getElementById('dl-overlay'),
  };
});
console.log('imported:', JSON.stringify(imported));
check('unticking updates the count on the button', /Add 16 defects/.test(imported.label), imported.label);
check('only the ticked items are created', imported.made === 16, String(imported.made));
check('the overlay closes on import', imported.closed === true, String(imported.closed));

// Items file against the trade they name, resolved the same way a typed name
// is — and a trade with no placeholder row lands unassigned rather than
// failing the import.
const filed = await page.evaluate(() => {
  const byDesc = {};
  (db.data.defects || []).forEach(d => { byDesc[d.description] = d; });
  const painter = byDesc['Clean overpaint from window frames.'];
  const brickCleaner = byDesc['Clean out weepholes.'];   // Brick Cleaner has no placeholder in this seed
  return {
    painterCid: painter && painter.contractorId,
    painterUnassigned: painter && !!painter.unassigned,
    brickCleanerCid: brickCleaner && brickCleaner.contractorId,
    brickCleanerUnassigned: brickCleaner && !!brickCleaner.unassigned,
    allOpen: (db.data.defects || []).every(d => (d.status || 'open') === 'open'),
  };
});
console.log('filed:', JSON.stringify(filed));
check('an item files against its trade placeholder', filed.painterCid === 1, String(filed.painterCid));
check('…and is not marked unassigned', filed.painterUnassigned === false, String(filed.painterUnassigned));
check('a trade with no placeholder lands unassigned, not lost',
  filed.brickCleanerCid == null && filed.brickCleanerUnassigned === true, JSON.stringify(filed));
check('every imported defect is open, ready to photograph against', filed.allOpen === true, String(filed.allOpen));

// Importing the same list twice must not double the job.
const twice = await page.evaluate(() => {
  const before = (db.data.defects || []).length;
  startDefectsForJob(1);
  [...document.querySelectorAll('div[onclick]')].find(d => /openDefectListImport/.test(d.getAttribute('onclick') || '')).click();
  document.getElementById('dl-overlay').querySelector('button[onclick="_dlDoImport()"]').click();
  return { before, after: (db.data.defects || []).length };
});
console.log('re-import:', JSON.stringify(twice));
check('re-importing does not double the list',
  twice.after === twice.before + 2, `${twice.before} → ${twice.after} (the 2 unticked first time round are new)`);

// ================= 3. the editor ============================================
console.log('\n--- the editor ---');
const editor = await page.evaluate(() => {
  // Stub the shared bank as present and editable, the way it is once the
  // migration has been run.
  const lists = [{ id: 'L1', name: 'Standard PCI', n: 100, items: [
    { id: 'i1', text: 'Clean brick smears.', trade: 'Brick Cleaner', n: 10 },
    { id: 'i2', text: 'Repair brickwork blow outs.', trade: 'Bricklayer', n: 20 },
  ] }];
  window.__calls = [];
  window.CloudDefectLists = {
    ready: () => true,
    list: () => lists.map(l => ({ ...l, items: l.items.slice() })),
    canEdit: () => true,
    addList: async (n) => { window.__calls.push(['addList', n]); lists.push({ id: 'L2', name: n, n: 1, items: [] }); return { ok: true, id: 'L2' }; },
    renameList: async (id, n) => { window.__calls.push(['renameList', id, n]); return { ok: true }; },
    removeList: async (id) => { window.__calls.push(['removeList', id]); return { ok: true }; },
    addItem: async (l, t, tr) => { window.__calls.push(['addItem', l, t, tr]); return { ok: true, id: 'i3' }; },
    updateItem: async (id, t, tr) => { window.__calls.push(['updateItem', id, t, tr]); return { ok: true }; },
    removeItem: async (id) => { window.__calls.push(['removeItem', id]); return { ok: true }; },
  };
  showDefectListsEditor();
  return {
    editable: defectListsCanEdit(),
    summary: defectListsSummary(),
    hasNew: !!document.querySelector('button[onclick="dlNewList()"]'),
    banner: (document.querySelector('.manage-container') || {}).textContent.includes('read-only'),
  };
});
console.log('editor:', JSON.stringify(editor));
check('with the migration run, the editor is editable', editor.editable === true, String(editor.editable));
check('…offering a New list button', editor.hasNew === true, String(editor.hasNew));
check('…with no read-only banner', editor.banner === false, String(editor.banner));
check('the Settings card counts the bank', /1 list, 2 items\./.test(editor.summary), editor.summary);

const itemEdit = await page.evaluate(async () => {
  dlToggleOpen('L1');
  const beforeRows = document.querySelectorAll('button[onclick^="dlStartEditItem"]').length;
  dlStartAdd('L1');
  const hasPicker = !!document.querySelector('select[onchange^="dlFillFromWording"]');
  // Picking an existing wording must fill BOTH fields — that is the link back
  // to the 62-item bank.
  const w = defectWordingList().find(x => x.trade === 'Carpenter');
  dlFillFromWording('dl-add', w.text);
  const filled = {
    text: document.getElementById('dl-add-text').value,
    trade: document.getElementById('dl-add-trade').value,
  };
  await dlSaveNewItem('L1');
  return { beforeRows, hasPicker, filled, want: { text: w.text, trade: w.trade }, calls: window.__calls.slice() };
});
console.log('item edit:', JSON.stringify(itemEdit));
check('each item offers Edit and remove', itemEdit.beforeRows === 2, String(itemEdit.beforeRows));
check('adding an item offers the existing wordings to pick from', itemEdit.hasPicker === true, String(itemEdit.hasPicker));
check('picking a wording fills the text AND its trade',
  itemEdit.filled.text === itemEdit.want.text && itemEdit.filled.trade === itemEdit.want.trade,
  JSON.stringify(itemEdit.filled));
check('saving calls through to the shared bank',
  itemEdit.calls.some(c => c[0] === 'addItem' && c[1] === 'L1' && c[2] === itemEdit.want.text),
  JSON.stringify(itemEdit.calls));

check('no page errors', errs.length === 0, JSON.stringify(errs));

console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
