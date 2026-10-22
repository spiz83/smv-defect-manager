// Copy the report as plain text (Spiro 2026-10-22): "also have a feature to
// copy to clipboard without the photos as a text (no pdf) based on the
// selections in this screen… whole purpose is that it can allow you to extract
// more."
//
// The contract: it is the SAME report as the PDF — same filters, same grouping,
// same item numbers — rendered as text. If the two can disagree, the feature is
// worse than useless, because a trade is reading one and the supervisor the
// other.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8134;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [
    { id: 1, lot: '1', street: 'Lot 1, 14 Skylark Road', streetName: 'Skylark Road', lotNo: 1, suburb: 'GREENVALE', propertyNumber: '306634', active: true },
    { id: 2, lot: '2', street: 'Lot 2, 16 Skylark Road', streetName: 'Skylark Road', lotNo: 2, suburb: 'GREENVALE', propertyNumber: '306635', active: true },
  ],
  contractors: [
    { id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' },
    { id: 2, name: 'Carpenter', isTradePlaceholder: true, isActive: true, trades: 'Carpenter' },
  ],
  trades: [{ id: 1, name: 'Painter' }, { id: 2, name: 'Carpenter' }],
  defects: [
    { id: 11, addressId: 1, contractorId: 2, description: 'Complete skirting to kitchen area', location: 'Kitchen', status: 'open', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 12, addressId: 1, contractorId: 2, description: 'Align door with jamb and adjust margin', location: 'Bedroom 2', status: 'open', createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 13, addressId: 1, contractorId: 1, description: 'PI #3.27 (p.53-54) — Defective external paint finish', location: 'Throughout', status: 'pending', createdAt: '2026-10-02T00:00:00.000Z' },
    { id: 14, addressId: 1, contractorId: 1, description: 'Touch up architraves', location: '', status: 'completed', completed: true, createdAt: '2026-10-03T00:00:00.000Z' },
    { id: 21, addressId: 2, contractorId: 1, description: 'Paint run to door frame', location: 'Entry', status: 'open', createdAt: '2026-10-04T00:00:00.000Z' },
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
  return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
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

// ================= 1. the button is there, beside the PDF one ==============
console.log('\n--- the Generate Report sheet ---');
const ui = await page.evaluate(() => {
  openReportBuilder();
  return {
    pdf: !!document.getElementById('rb-go'),
    copy: !!document.getElementById('rb-copy'),
    label: (document.getElementById('rb-copy') || {}).textContent,
    note: (document.querySelector('#imp-body') || {}).textContent.includes('no photos'),
  };
});
console.log('ui:', JSON.stringify(ui));
check('the sheet offers a text copy alongside the PDF', ui.copy === true && ui.pdf === true, JSON.stringify(ui));
check('…labelled for what it does', /Copy as text/.test(ui.label || ''), (ui.label || '').trim());
check('…and says photos are not coming', ui.note === true, String(ui.note));

// ================= 2. it honours the SAME selections ======================
console.log('\n--- one job, open only ---');
const one = await page.evaluate(() => {
  document.getElementById('rb-st-open').checked = true;
  document.getElementById('rb-st-pending').checked = false;
  document.getElementById('rb-st-completed').checked = false;
  document.querySelectorAll('.rb-addr').forEach(c => { c.checked = (c.value === '1'); });
  const o = readReportBuilderOptions();
  const list = reportFilteredDefects(o);
  return { text: reportPlainText(list, o), n: list.length };
});
console.log('--- text ---\n' + one.text + '--- end ---');
check('the status ticks filter it — only the 2 open items', one.n === 2, String(one.n));
check('…and the address tick keeps lot 2 out',
  !/16 Skylark/.test(one.text), 'lot 2 leaked');
check('the header says how many', /DEFECT REPORT — 2 items/.test(one.text), one.text.split('\n')[0]);
check('…and names the single job', /Lot 1, 14 Skylark Road/.test(one.text), one.text.split('\n')[1]);
check('…and the statuses chosen', /Status: Open/.test(one.text), '');
check('one job groups by trade', /CARPENTER/.test(one.text), '');
check('items carry their job item number', /#1\b/.test(one.text) && /#2\b/.test(one.text), '');
check('…and their room', /Kitchen/.test(one.text) && /Bedroom 2/.test(one.text), '');
check('a single-status report does not repeat the status on every line',
  !/\(Open\)/.test(one.text), 'status noise on every row');
check('no photo data anywhere in it', !/data:image|base64/.test(one.text), 'binary leaked into the text');

// ================= 3. report references survive ===========================
console.log('\n--- with the PI item included ---');
const withRef = await page.evaluate(() => {
  document.getElementById('rb-st-pending').checked = true;
  const o = readReportBuilderOptions();
  const list = reportFilteredDefects(o);
  return { text: reportPlainText(list, o), n: list.length };
});
console.log('--- text ---\n' + withRef.text + '--- end ---');
check('the PI reference is kept — it is how the trade finds the page',
  /PI #3\.27 \(p\.53-54\)/.test(withRef.text), '');
check('mixing statuses DOES label each line',
  /\(Pending\)/.test(withRef.text) && /\(Open\)/.test(withRef.text), '');
// The reference must stay whole and sit with the text it refers to, not get
// cut in half by the room.
check('the room precedes the reference, which stays intact',
  /Throughout · PI #3\.27 \(p\.53-54\) — Defective external paint finish/.test(withRef.text),
  (withRef.text.split('\n').find(l => /3\.27/.test(l)) || '').trim());

// ================= 4. several jobs group by job ===========================
console.log('\n--- both jobs ---');
const multi = await page.evaluate(() => {
  document.querySelectorAll('.rb-addr').forEach(c => { c.checked = false; });
  document.getElementById('rb-st-completed').checked = true;
  const o = readReportBuilderOptions();
  const list = reportFilteredDefects(o);
  return { text: reportPlainText(list, o), n: list.length };
});
console.log('--- text ---\n' + multi.text + '--- end ---');
check('no address ticked means every job', multi.n === 5, String(multi.n));
check('a multi-job report headers each JOB — otherwise you cannot tell which house',
  /LOT 1, 14 SKYLARK ROAD/.test(multi.text) && /LOT 2, 16 SKYLARK ROAD/.test(multi.text), '');
check('…with the trade under it', /\n {2}Painter/.test(multi.text) || /\n {2}Carpenter/.test(multi.text), '');
check('…and says how many jobs it spans', /2 jobs/.test(multi.text), '');
check('item numbers are per JOB, so lot 2 starts at #1 again',
  (multi.text.match(/#1\b/g) || []).length === 2, JSON.stringify(multi.text.match(/#\d+/g)));

// ================= 5. same filters as the PDF would use ===================
// The two renderings must never disagree about WHICH defects are in the report.
const agree = await page.evaluate(() => {
  const o = readReportBuilderOptions();
  const list = reportFilteredDefects(o);
  const text = reportPlainText(list, o);
  // Every defect in the filtered list must appear in the text.
  const missing = list.filter(d => {
    const body = (splitReportRef(d.description || '').body || d.description || '').trim();
    return text.indexOf(body) === -1;
  }).map(d => d.id);
  return { listed: list.length, missing };
});
console.log('agreement:', JSON.stringify(agree));
check('every defect the PDF would include appears in the text — no silent drops',
  agree.missing.length === 0, JSON.stringify(agree.missing));

// ================= 6. nothing selected / nothing matching =================
const guards = await page.evaluate(() => {
  document.getElementById('rb-st-open').checked = false;
  document.getElementById('rb-st-pending').checked = false;
  document.getElementById('rb-st-completed').checked = false;
  const none = readReportBuilderOptions();
  document.getElementById('rb-st-open').checked = true;
  const back = readReportBuilderOptions();
  return { noneIsNull: none === null, backIsObject: !!back };
});
check('no status ticked is refused rather than producing an empty paste',
  guards.noneIsNull === true, String(guards.noneIsNull));
check('…and ticking one again works', guards.backIsObject === true, String(guards.backIsObject));

// ================= 7. the clipboard fallback ==============================
console.log('\n--- when the device refuses the clipboard ---');
const fallback = await page.evaluate(async () => {
  openReportBuilder();
  document.getElementById('rb-st-open').checked = true;
  const realClip = navigator.clipboard;
  try { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); } catch (e) {}
  await copyReportText();
  const ta = document.getElementById('rb-text-out');
  const res = {
    shown: !!ta,
    hasText: !!ta && ta.value.indexOf('DEFECT REPORT') === 0,
    readonly: !!ta && ta.readOnly,
  };
  try { Object.defineProperty(navigator, 'clipboard', { value: realClip, configurable: true }); } catch (e) {}
  impClose();
  return res;
});
console.log('fallback:', JSON.stringify(fallback));
check('a refused clipboard is never a dead end — the text is shown instead',
  fallback.shown === true, String(fallback.shown));
check('…with the report actually in it', fallback.hasText === true, String(fallback.hasText));

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
