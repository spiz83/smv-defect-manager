// The location leads the defect row: "BPI #18 (p.7) — Garage Int PA — Seal gap…"
//
// Before this, a defect list said WHAT but never WHERE — the location was
// captured on import and hidden behind the 📍 button, so going through a job
// meant re-opening the BPI report to find the room. These checks pin the four
// shapes a line can take (ref+loc, loc only, ref only, neither), the
// abbreviation table, and the one thing that must NOT change: the saved
// description. This is a display change; the stored text is what dedupe,
// re-import matching and trade learning all key off.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ARTIFACTS = join(__here, 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });

const ROOT = REPO, PORT = 8103;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// The four shapes, in row order. Descriptions are real BPI wording from the
// supervisor's screenshot — imported ones carry the saved "BPI #N (p.P) — "
// reference, typed ones carry nothing.
const SEED_DEFECTS = [
  { id: 1, description: 'BPI #18 (p.7) — Seal gap between garage boundary wall flashing and brick',
    location: 'Garage Internal PA Door' },                                   // ref + long location
  { id: 2, description: 'Flyscreen missing both laundry and kitchen', location: 'Laundry' }, // typed + location
  { id: 3, description: 'BPI #16 (p.6) — See above the bathroom window, roof sheet sitting up',
    location: '' },                                                          // ref, no location
  { id: 4, description: 'Levels - issue with retaining soil', location: '' },// neither
  { id: 5, description: 'BPI #14 (p.6) — Internal PA Door Caulk junction between the bottom of jamb and threshold',
    location: 'Master Bedroom' },                                            // ref + abbreviated location
].map(d => ({ ...d, addressId: 1, contractorId: 1, completed: false, status: 'open' }));

const SEED = {
  addresses: [{ id: 1, lot: '245', street: '(4) Spinosa Road', suburb: 'Wollert', jobNumber: '306640', active: true }],
  contractors: [{ id: 1, name: 'CAULKER', email: 'a@b.com', phone: '0400000000', trades: ['Caulker'] }],
  trades: [{ id: 1, name: 'Caulker' }],
  defects: SEED_DEFECTS,
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
  localStorage.setItem('dm_preview', '0');   // list rows, not preview cards
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (label, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  ' + detail : '')); if (!cond) fail.push(label); };
const shot = async n => page.screenshot({ path: join(ARTIFACTS, n + '.png') });

// ── abbreviateLocation ───────────────────────────────────────────────────
const abbr = await page.evaluate(() => ({
  long:      abbreviateLocation('Garage Internal PA Door'),
  master:    abbreviateLocation('Master Bedroom'),
  wir:       abbreviateLocation('Walk In Robe'),
  elevation: abbreviateLocation('Rear Elevation'),
  short:     abbreviateLocation('Kitchen'),
  lower:     abbreviateLocation('walk in robe'),
  spaced:    abbreviateLocation('  Powder   Room '),
  unknown:   abbreviateLocation('Bedroom 6'),
  freeText:  abbreviateLocation('Store Cupboard'),
  empty:     abbreviateLocation(''),
  nullish:   abbreviateLocation(null),
}));
console.log('\nabbreviateLocation:', JSON.stringify(abbr));
check('long name shortens', abbr.long === 'Garage Int PA', abbr.long);
check('Master Bedroom → Master Bed', abbr.master === 'Master Bed', abbr.master);
check('Walk In Robe → WIR', abbr.wir === 'WIR', abbr.wir);
check('Rear Elevation → Rear Elev', abbr.elevation === 'Rear Elev', abbr.elevation);
check('short name passes through', abbr.short === 'Kitchen', abbr.short);
check('lookup is case-insensitive', abbr.lower === 'WIR', abbr.lower);
check('lookup tolerates stray spaces', abbr.spaced === 'Powder', abbr.spaced);
check('unlisted location still shortens', abbr.unknown === 'Bed 6', abbr.unknown);
check('free-typed location shortens by word', abbr.freeText === 'Store Cpd', abbr.freeText);
check('no location → empty, never "undefined"', abbr.empty === '' && abbr.nullish === '', `${abbr.empty}|${abbr.nullish}`);

// ── the composed line ────────────────────────────────────────────────────
await page.evaluate(() => viewDefectsForAddress(1));
await page.waitForTimeout(250);
await shot('30-loc-rows');

const rows = await page.evaluate(() => [...document.querySelectorAll('.defects-container .defect-item')].map(r => {
  const t = r.querySelector('.defect-text');
  return {
    text: t ? t.textContent.trim() : '',
    ref: t && t.querySelector('.defect-line-ref') ? t.querySelector('.defect-line-ref').textContent : null,
    loc: t && t.querySelector('.defect-line-loc') ? t.querySelector('.defect-line-loc').textContent : null,
    h: Math.round(r.getBoundingClientRect().height),
  };
}));
console.log('\nrows:');
rows.forEach(r => console.log('  ' + JSON.stringify(r)));

check('all five defects rendered', rows.length === 5, `${rows.length}`);
check('ref then location then item',
  rows[0].text === 'BPI #18 (p.7) — Garage Int PA — Seal gap between garage boundary wall flashing and brick',
  rows[0].text);
check('BPI number and page survive as the prefix', rows[0].ref === 'BPI #18 (p.7)', String(rows[0].ref));
check('location is abbreviated on the row', rows[0].loc === 'Garage Int PA', String(rows[0].loc));
check('typed defect leads with the location, no stray dash',
  rows[1].text === 'Laundry — Flyscreen missing both laundry and kitchen' && rows[1].ref === null,
  rows[1].text);
check('no location → ref then item, no stray dash',
  rows[2].text === 'BPI #16 (p.6) — See above the bathroom window, roof sheet sitting up' && rows[2].loc === null,
  rows[2].text);
check('neither → the item alone',
  rows[3].text === 'Levels - issue with retaining soil' && rows[3].ref === null && rows[3].loc === null,
  rows[3].text);
check('Master Bedroom shortens on the row', rows[4].loc === 'Master Bed', String(rows[4].loc));

// The location has to be FINDABLE, not just present — that is the whole ask.
const colours = await page.evaluate(() => {
  const t = document.querySelector('.defects-container .defect-item .defect-text');
  const loc = t.querySelector('.defect-line-loc'), ref = t.querySelector('.defect-line-ref');
  return { body: getComputedStyle(t).color, loc: getComputedStyle(loc).color, ref: getComputedStyle(ref).color,
           locWeight: getComputedStyle(loc).fontWeight };
});
console.log('\ncolours:', JSON.stringify(colours));
check('location is set apart from the item wording',
  colours.loc !== colours.body && colours.locWeight >= '600', JSON.stringify(colours));
check('reference is muted, not competing with the location',
  colours.ref !== colours.loc && colours.ref !== colours.body, JSON.stringify(colours));

// A row that grows is a row that scrolls — the reason the location is
// abbreviated at all. The two short items must still be single-line.
const oneLine = Math.min(rows[1].h, rows[3].h);
check('short items are still one line', oneLine <= 40, `min ${oneLine}px`);

// ── the stored description is untouched ──────────────────────────────────
const stored = await page.evaluate(() => db.data.defects.map(d => d.description));
check('saved description unchanged — display only',
  stored[0] === 'BPI #18 (p.7) — Seal gap between garage boundary wall flashing and brick'
  && stored[1] === 'Flyscreen missing both laundry and kitchen',
  stored[0]);

// ── text outputs use the same order, location in full ────────────────────
const txt = await page.evaluate(() => generateDefectText());
console.log('\nCopy to Clipboard:\n' + txt.split('\n').filter(Boolean).slice(0, 8).map(l => '  ' + l).join('\n'));
check('copied text puts the ref first, then the FULL location',
  txt.includes('• BPI #18 (p.7) — Garage Internal PA Door — Seal gap between garage boundary wall flashing and brick'));
check('copied text has no location for an item without one',
  txt.includes('• Levels - issue with retaining soil'));
const emailLine = await page.evaluate(() => formatDefectEmailLine(db.data.defects[0]));
check('the supplier email line matches the copied line',
  emailLine === 'BPI #18 (p.7) — Garage Internal PA Door — Seal gap between garage boundary wall flashing and brick',
  emailLine);

// ── the supplier view gets it too ────────────────────────────────────────
await page.evaluate(() => viewDefectsForContractor(1));
await page.waitForTimeout(250);
await shot('31-loc-supplier');
const supLoc = await page.evaluate(() =>
  [...document.querySelectorAll('.defects-container .defect-item .defect-line-loc')].map(e => e.textContent));
check('supplier view shows locations as well', supLoc.length === 3 && supLoc[0] === 'Garage Int PA', JSON.stringify(supLoc));

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
