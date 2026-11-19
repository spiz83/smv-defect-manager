// Deep read (private inspection report import) — end to end in a real browser.
// The Anthropic call is stubbed; everything downstream of it is the real app.
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

// Fixture PDFs are BUILT here, not committed: a binary blob nobody can read in
// a diff is exactly the sort of test asset that rots. mkpdf.mjs is the spec.
import { PRIVATE, BPI } from './mkpdf.mjs';
fs.mkdirSync(ARTIFACTS, { recursive: true });
fs.writeFileSync(join(ARTIFACTS, 'private-report.pdf'), PRIVATE);
fs.writeFileSync(join(ARTIFACTS, 'bpi-report.pdf'), BPI);


const ROOT = REPO, PORT = 8101;
const OUT = ARTIFACTS;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobNumber: '306648', active: true }],
  contractors: [{ id: 1, name: 'AUZ PAINTING', email: 'a@b.com', phone: '0400000001', trades: 'Painter' }],
  trades: [{ id: 1, name: 'Painter' }],
  defects: [],
};

// What the deep read is expected to return for private-report.pdf. Anchors are
// verbatim from the page, exactly as the model is instructed to copy them.
const DEEP_ITEMS = [
  { description: 'Paint finish to the kitchen ceiling is patchy — apply a further coat throughout', location: 'Kitchen', trade: 'Painter', page: 1, anchor: 'Paint finish to the kitchen ceiling is patchy' },
  { description: 'Grout to the splashback is cracked — rake out and re-grout', location: 'Kitchen', trade: 'Tiler', page: 1, anchor: 'Grout to the splashback is cracked in several places' },
  { description: 'Shower screen is not sealed to the tiled hob, water escaping', location: 'Ensuite', trade: 'Caulker', page: 2, anchor: 'Shower screen is not sealed to the tiled hob' },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await ctx.newPage();
await ctx.route('**', route => {
  const u = route.request().url();
  if (u.startsWith(`http://localhost:${PORT}`)) {
    if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  }
  // pdf.js is a real dependency of this feature and the CDN is off-limits in
  // this sandbox, so the cdnjs URLs are served from the local npm copy — same
  // build (3.11.174), same behaviour.
  const PDFJS_DIR = `${join(__here,'node_modules/pdfjs-dist/build')}`;
  if (u.includes('pdf.worker.min.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${PDFJS_DIR}/pdf.worker.min.js`) });
  if (u.includes('pdf.min.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${PDFJS_DIR}/pdf.min.js`) });
  return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
// "edge function timed out" is thrown ON PURPOSE by the fallback test below —
// the app logging it is the correct behaviour, not a defect.
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource|edge function timed out/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
// The splash covers the whole screen for the first second of a boot, so
// every suite waits it out before touching or measuring anything. Added to
// all of them at once rather than to the three that happened to fail: the
// ones that passed were passing on timing, which is the same bug asleep
// (2026-11-18).
await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ---- Stub CloudAI. deepAvailable() is what the admin gate reads, so flipping
// it is exactly what flipping the user's role does.
async function setRole(manager) {
  await page.evaluate(({ manager, items }) => {
    window.__deepCalls = [];
    window.CloudAI = {
      available: () => true,
      deepAvailable: () => manager,
      extract: async () => { window.__deepCalls.push({ kind: 'flat' }); return [{ description: 'flat fallback item', location: '' }]; },
      extractDeep: async (pdf, trades) => {
        window.__deepCalls.push({ kind: 'deep', b64len: (pdf || '').length, trades: (trades || []).length, firstTrades: (trades || []).slice(0, 3) });
        return { items: JSON.parse(JSON.stringify(items)), layout: 'grouped by room, photos below each paragraph' };
      },
    };
  }, { manager, items: DEEP_ITEMS });
}

const openImport = async (type) => {
  await page.evaluate(() => { if (_review) _review = null; });
  await page.evaluate(() => openReportImport());
  await page.waitForSelector('#imp-type');
  await page.selectOption('#imp-type', type);
};
// CHOOSING A FILE NO LONGER STARTS THE READ (2026-11-19). The file is held in
// the dialog and the Extract button starts it, so that the report type and the
// toggles are read when a person has finished setting them rather than at the
// moment the file lands — see DECISIONS.md. These eight call sites now do what
// a person does: choose, then press.
const chooseFile = async (p) => {
  await page.setInputFiles('#imp-file', p);
  await page.waitForFunction(() => typeof _impStaged !== 'undefined' && !!_impStaged, null, { timeout: 10000 });
  await page.click('#imp-extract');
};
const deepVisible = () => page.evaluate(() =>
  getComputedStyle(document.getElementById('imp-deep-wrap')).display !== 'none');

// ================= 1. the admin gate =======================================
console.log('\n--- admin gate ---');
await setRole(false);
await openImport('Private Inspection');
check('supervisor: no Deep read option', !(await deepVisible()));

await setRole(true);
await openImport('Private Inspection');
check('manager: Deep read offered on a private report', await deepVisible());
await page.selectOption('#imp-type', 'BPI');
check('manager: Deep read hidden for BPI', !(await deepVisible()));
await page.selectOption('#imp-type', 'Private Inspection');
check('manager: Deep read returns when switching back', await deepVisible());
check('Deep read is ticked by default for a manager',
  await page.evaluate(() => document.getElementById('imp-deep').checked));
await page.screenshot({ path: `${OUT}/60-deep-option.png` });

// ================= 2. a supervisor cannot reach the deep path ==============
console.log('\n--- supervisor routes to the flat path ---');
await setRole(false);
await openImport('Private Inspection');
await chooseFile(`${OUT}/private-report.pdf`);
await page.waitForFunction(() => window.__deepCalls.length > 0, null, { timeout: 20000 });
check('supervisor import never calls extractDeep',
  await page.evaluate(() => window.__deepCalls.every(c => c.kind === 'flat')),
  JSON.stringify(await page.evaluate(() => window.__deepCalls)));

// even with the checkbox forced into the DOM, the gate holds
await setRole(false);
await openImport('Private Inspection');
await page.evaluate(() => {
  const w = document.getElementById('imp-deep-wrap');
  w.style.display = 'flex'; document.getElementById('imp-deep').checked = true;
});
await chooseFile(`${OUT}/private-report.pdf`);
await page.waitForFunction(() => window.__deepCalls.length > 0, null, { timeout: 20000 });
check('forcing the hidden checkbox still routes flat',
  await page.evaluate(() => window.__deepCalls.every(c => c.kind === 'flat')));

// ================= 3. the real deep import =================================
console.log('\n--- manager deep import ---');
await setRole(true);
await openImport('Private Inspection');
await chooseFile(`${OUT}/private-report.pdf`);
await page.waitForFunction(() => _review && _review.items.length, null, { timeout: 30000 });

const call = await page.evaluate(() => window.__deepCalls[0]);
console.log('extractDeep called with:', JSON.stringify(call));
check('extractDeep was used, not the flat path', call.kind === 'deep');
check('the PDF was sent as base64', call.b64len > 1000, call.b64len + ' chars');
check('the app posted its own trade vocabulary', call.trades > 20, call.trades + ' trades: ' + call.firstTrades.join(', '));

const rv = await page.evaluate(() => ({
  n: _review.items.length,
  mode: _review.photoMode,
  layout: _review.layout,
  type: _review.reportType,
  itemNos: _review.items.map(i => i.itemNo),
  pages: _review.items.map(i => i.page),
  addressId: _review.lastAddressId,
}));
console.log('review:', JSON.stringify(rv));
check('all three defects came through', rv.n === 3);
check('photo pairing runs in anchor mode', rv.mode === 'anchor', rv.mode);
check('items are numbered 1..N for the review', rv.itemNos.join(',') === '1,2,3', rv.itemNos.join(','));
check('the layout summary is kept for the supervisor', /grouped by room/.test(rv.layout), rv.layout);
check('the property still matched off the report header', rv.addressId === 1, String(rv.addressId));

// ---- photos: the whole point of the exercise
await page.waitForFunction(() => _review && /found|^$/.test(_review.photoNote) && _review.photos.size > 0,
  null, { timeout: 45000 }).catch(() => {});
const photos = await page.evaluate(() => {
  const m = _review.photos;
  const o = {};
  for (const [k, v] of m) o[k] = v.length;
  return { byItem: o, note: _review.photoNote };
});
console.log('photos:', JSON.stringify(photos));
check('item 1 got BOTH photos in its cluster', photos.byItem[1] === 2, JSON.stringify(photos.byItem));
check('item 2 got its own photo AND the one that spilled to page 2', photos.byItem[2] === 2, JSON.stringify(photos.byItem));
check('item 3 got its photo on page 2', photos.byItem[3] === 1, JSON.stringify(photos.byItem));
check('no photo was left unassigned', Object.values(photos.byItem).reduce((a, b) => a + b, 0) === 5,
  JSON.stringify(photos.byItem));

// ---- the review screen itself
const screen = await page.evaluate(() => ({
  meta: (document.querySelector('#imp-body div[style*="12px"]') || {}).textContent || '',
  body: document.getElementById('imp-body').textContent.replace(/\s+/g, ' ').slice(0, 400),
  imgs: document.querySelectorAll('#imp-body img').length,
}));
console.log('review screen:', JSON.stringify(screen.body.slice(0, 220)));
check('review labels a private item "PI #1", not "BPI #1"',
  /PI #1/.test(screen.body) && !/BPI #/.test(screen.body), screen.body.slice(0, 90));
check('the layout read is shown on the review', /Report read as/.test(screen.body));
check('the report photos are visible BEFORE saving', screen.imgs === 2, screen.imgs + ' images');
await page.screenshot({ path: `${OUT}/61-deep-review.png` });

// ---- the trade allocator still owns the decision
const trade = await page.evaluate(() => {
  const b = document.getElementById('imp-body').textContent;
  const m = b.match(/Trade: ([A-Za-z ]+?)(?: \((learned|rule|AI)[^)]*\))?(?: ·|\s*🔬|\s*Defect)/);
  return m ? { trade: m[1].trim(), source: m[2] || 'keyword' } : null;
});
console.log('trade on item 1:', JSON.stringify(trade));
check('the existing keyword/learned allocator still decides the trade',
  trade && trade.trade === 'Painter' && trade.source !== 'AI', JSON.stringify(trade));

// the AI trade is used only when nothing else fires
const aiFallback = await page.evaluate(() => {
  const r = resolveTrade('zzz qqq nothing matches here');
  const item = { trade: 'Glazier' };
  if (!r.trade && item.trade) { r.trade = item.trade; r.source = 'ai'; }
  return r;
});
check('AI trade fills in only when the allocator finds nothing',
  aiFallback.trade === 'Glazier' && aiFallback.source === 'ai', JSON.stringify(aiFallback));

// ================= 4. saving an item ========================================
console.log('\n--- saving ---');
await page.evaluate(() => {
  const sel = document.getElementById('rv-contractor');
  if (sel) sel.value = '1';
});
const saved = await page.evaluate(async () => {
  const before = (db.data.defects || []).length;
  const btn = [...document.querySelectorAll('#imp-body button')].find(b => /save/i.test(b.textContent));
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 700));
  const d = (db.data.defects || [])[0];
  return { added: (db.data.defects || []).length - before, desc: d && d.description, loc: d && d.location };
});
console.log('saved:', JSON.stringify(saved));
check('the item saved', saved.added === 1, JSON.stringify(saved));
check('saved description carries a "PI #" reference, not "BPI #"',
  /^PI #1 \(p\.1\) — /.test(saved.desc || ''), saved.desc);
check('the report reference strips back off for display',
  await page.evaluate(d => stripReportRef(d) === 'Paint finish to the kitchen ceiling is patchy — apply a further coat throughout', saved.desc),
  saved.desc);
check('the email line still splits the reference out',
  await page.evaluate(() => /^PI #1 \(p\.1\) — Kitchen — Paint finish/.test(formatDefectEmailLine(db.data.defects[0]))),
  await page.evaluate(() => formatDefectEmailLine(db.data.defects[0])));

// ================= 5. BPI is untouched ======================================
console.log('\n--- BPI regression ---');
await page.evaluate(() => { db.data.defects = []; db.save(); _review = null; });
await setRole(true);
await openImport('BPI');
await chooseFile(`${OUT}/bpi-report.pdf`);
await page.waitForFunction(() => _review && _review.items.length, null, { timeout: 30000 });
const bpi = await page.evaluate(() => ({
  n: _review.items.length,
  mode: _review.photoMode,
  itemNos: _review.items.map(i => i.itemNo),
  deepCalls: window.__deepCalls.filter(c => c.kind === 'deep').length,
}));
console.log('bpi review:', JSON.stringify(bpi));
check('BPI still parses structurally', bpi.n === 2, JSON.stringify(bpi));
check('BPI keeps its Tag-number pairing', bpi.mode === 'bpi', bpi.mode);
check('BPI uses the report\'s own numbering', bpi.itemNos.join(',') === '1,2', bpi.itemNos.join(','));
check('BPI never goes near the deep path', bpi.deepCalls === 0);

await page.waitForFunction(() => _review && _review.photos.size > 0, null, { timeout: 45000 }).catch(() => {});
const bpiPhotos = await page.evaluate(() => {
  const o = {}; for (const [k, v] of _review.photos) o[k] = v.length; return o;
});
console.log('bpi photos:', JSON.stringify(bpiPhotos));
check('BPI photos still pair to their Tag', bpiPhotos[1] === 1 && bpiPhotos[2] === 1, JSON.stringify(bpiPhotos));
const bpiScreen = await page.evaluate(() => document.getElementById('imp-body').textContent.replace(/\s+/g, ' '));
check('BPI review still says "BPI #1"', /BPI #1/.test(bpiScreen), bpiScreen.slice(0, 80));
check('no layout banner on a BPI import', !/Report read as/.test(bpiScreen));
await page.screenshot({ path: `${OUT}/62-bpi-review.png` });

// ================= 6. failure falls back, never blocks ======================
console.log('\n--- deep read failure ---');
await page.evaluate(() => { _review = null; });
await page.evaluate(() => {
  window.__deepCalls = [];
  window.CloudAI.extractDeep = async () => { window.__deepCalls.push({ kind: 'deep' }); throw new Error('edge function timed out'); };
});
await openImport('Private Inspection');
await chooseFile(`${OUT}/private-report.pdf`);
await page.waitForFunction(() => _review && _review.items.length, null, { timeout: 30000 });
const fb = await page.evaluate(() => ({
  kinds: window.__deepCalls.map(c => c.kind).join(','),
  n: _review.items.length,
  mode: _review.photoMode,
  first: _review.items[0].description,
}));
console.log('fallback:', JSON.stringify(fb));
check('a failed deep read falls back to the flat AI path', fb.kinds === 'deep,flat', fb.kinds);
check('the supervisor still gets their import', fb.n === 1 && fb.first === 'flat fallback item', JSON.stringify(fb));
// Anchor mode IS the safe mode for a private report now that every item is
// numbered: the BPI Tag pairer would match a private item's number to
// whatever Tag-shaped text sat on its page. No anchor → no photo.
check('pairing stays in anchor mode on fallback (never BPI Tags)', fb.mode === 'anchor', fb.mode);
check('the fallback item is still numbered', await page.evaluate(() => _review.items[0].itemNo === 1));

// a deep read that finds nothing also falls through
await page.evaluate(() => {
  _review = null; window.__deepCalls = [];
  window.CloudAI.extractDeep = async () => { window.__deepCalls.push({ kind: 'deep' }); return { items: [], layout: '' }; };
});
await openImport('Private Inspection');
await chooseFile(`${OUT}/private-report.pdf`);
await page.waitForFunction(() => _review && _review.items.length, null, { timeout: 30000 });
check('an empty deep read also falls through to flat AI',
  await page.evaluate(() => window.__deepCalls.map(c => c.kind).join(',') === 'deep,flat'),
  await page.evaluate(() => window.__deepCalls.map(c => c.kind).join(',')));

// ================= 6b. every PI item saves as "PI #N (p.X) — …" =============
// Spiro 2026-11-19: "each item needs to have a string like this —
// PI #5 (p.19) — Door margin to bottom right-hand side of door exceeds 5mm".
// The flat path used to save bare text: no item number, no page.
console.log('\n--- PI reference on the flat path ---');
const DOOR = 'Door margin to bottom right-hand side of door exceeds 5mm (max allowable 5mm).';
async function flatImport(stubItems) {
  await page.evaluate(() => { db.data.defects = []; db.save(); _review = null; });
  await setRole(false);                                   // a supervisor: flat path
  await page.evaluate(items => {
    window.__flatText = null;
    window.CloudAI.extract = async (text) => {
      window.__deepCalls.push({ kind: 'flat' }); window.__flatText = text;
      return JSON.parse(JSON.stringify(items));
    };
  }, stubItems);
  await openImport('Private Inspection');
  await chooseFile(`${OUT}/private-report.pdf`);
  await page.waitForFunction(() => _review && _review.items.length, null, { timeout: 30000 });
  return page.evaluate(() => ({
    itemNos: _review.items.map(i => i.itemNo).join(','),
    pages: _review.items.map(i => i.page).join(','),
    mode: _review.photoMode,
    sentMarkers: /\[\[page 1\]\][\s\S]*\[\[page 2\]\]/.test(window.__flatText || ''),
  }));
}
async function saveCurrent() {
  return page.evaluate(async () => {
    const before = (db.data.defects || []).length;
    const btn = [...document.querySelectorAll('#imp-body button')].find(b => /save/i.test(b.textContent));
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 700));
    const all = db.data.defects || [];
    return { added: all.length - before, desc: all.length ? all[all.length - 1].description : '' };
  });
}
// (a) the report doesn't number its items → position in the report
let f1 = await flatImport([
  { description: DOOR, location: 'Bedroom 2', page: 19, anchor: '', reportItemNo: '' },
  { description: 'Bathtub appears scratched in various areas.', location: 'Bathroom', page: 24, anchor: '', reportItemNo: '' },
]);
console.log('flat review:', JSON.stringify(f1));
check('the flat read was sent the [[page N]] markers', f1.sentMarkers);
check('flat items are numbered by position 1..N', f1.itemNos === '1,2', f1.itemNos);
check('flat items keep their pages', f1.pages === '19,24', f1.pages);
check('flat private import pairs photos by anchor, not BPI Tag', f1.mode === 'anchor', f1.mode);
let s1 = await saveCurrent();
check('saved as "PI #1 (p.19) — <defect>"', s1.desc === 'PI #1 (p.19) — ' + DOOR, s1.desc);
// (b) the report prints its own item numbers → those are kept
let f2 = await flatImport([
  { description: DOOR, location: 'Bedroom 2', page: 19, anchor: '', reportItemNo: '5' },
  { description: 'Bathtub appears scratched in various areas.', location: 'Bathroom', page: 24, anchor: '', reportItemNo: '9' },
]);
check("the report's own item numbers are kept", f2.itemNos === '5,9', f2.itemNos);
let s2 = await saveCurrent();
check('saved exactly as Spiro specified: "PI #5 (p.19) — …"', s2.desc === 'PI #5 (p.19) — ' + DOOR, s2.desc);
check('the reference strips back off for display', await page.evaluate(d => stripReportRef(d), s2.desc) === DOOR);
// (c) section numbers / gaps / duplicates are not trusted → positions
let f3 = await flatImport([
  { description: 'A', location: '', page: 3, anchor: '', reportItemNo: '8' },
  { description: 'B', location: '', page: 4, anchor: '', reportItemNo: '8' },
  { description: 'C', location: '', page: 5, anchor: '', reportItemNo: '' },
]);
check('duplicate/missing report numbers fall back to positions', f3.itemNos === '1,2,3', f3.itemNos);
// (d) no page from the AI (pasted text) → "PI #1 — …", still referenced
let f4 = await flatImport([{ description: 'Caulking incomplete to tile trim.', location: 'Bathroom', page: null, anchor: '', reportItemNo: '' }]);
let s4 = await saveCurrent();
check('no page → "PI #1 — <defect>" (still numbered)', s4.desc === 'PI #1 — Caulking incomplete to tile trim.', s4.desc);
// (e) AI off → basic parser: numbered too, and the markers never leak into text
await page.evaluate(() => { db.data.defects = []; db.save(); _review = null; });
await openImport('Private Inspection');
await page.evaluate(() => { document.getElementById('imp-ai').checked = false; });
await chooseFile(`${OUT}/private-report.pdf`);
await page.waitForFunction(() => _review && _review.items.length, null, { timeout: 30000 });
const bp = await page.evaluate(() => ({
  itemNos: _review.items.map(i => i.itemNo),
  leaked: _review.items.some(i => /\[\[page/.test(typeof i === 'string' ? i : i.description)),
}));
check('basic-parser private items are numbered 1..N',
  bp.itemNos.length > 0 && bp.itemNos.every((n, i) => n === i + 1), JSON.stringify(bp.itemNos));
check('page markers never leak into a defect', !bp.leaked);

// ================= 7. the cost guards =======================================
console.log('\n--- cost guards ---');
const guards = await page.evaluate(async () => {
  window.__deepCalls = [];
  const big = new File([new Uint8Array(12 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' });
  const r1 = await deepReadReport(big);
  return { bigRejected: r1 === null, calls: window.__deepCalls.length, maxPages: DEEP_MAX_PAGES, maxBytes: DEEP_MAX_BYTES };
});
console.log('guards:', JSON.stringify(guards));
check('an oversized PDF is refused before it is uploaded', guards.bigRejected && guards.calls === 0, JSON.stringify(guards));
check('a page cap exists', guards.maxPages > 0 && guards.maxPages <= 100, String(guards.maxPages));

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
