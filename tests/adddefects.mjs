// "Add 5 items, only 2 show in the report" — reported by several supervisors.
// Drives the real Add Defects screen and counts what survives at every step:
// saved to the database, shown in the list, and included in the PDF.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ARTIFACTS = join(__here, 'artifacts');

const ROOT = REPO, PORT = 8112;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobStatus: 'active', active: true }],
  contractors: [
    { id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber', tradeIds: [1] },
    { id: 2, name: 'AUZ PAINTING', trades: 'Painter', tradeIds: [2] },
  ],
  trades: [{ id: 1, name: 'Plumber' }, { id: 2, name: 'Painter' }],
  defects: [],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
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
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  window.__pdf = null;
  window.generateDefectPDF = async (list, o) => { window.__pdf = list.map(d => d.description); };
  render();
});

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

const reset = () => page.evaluate(() => { db.data.defects = []; db.save(); startDefectsForJob(1); });

// Fill blocks the way the screen actually works: 3 defect rows per supplier
// block, five blocks. `entries` is [[supplierName, [d1, d2, ...]], ...].
async function fillAndSave(entries) {
  await reset();
  await page.waitForTimeout(250);
  const toasts = await page.evaluate(async (entries) => {
    const seen = [];
    const real = window.showToast;
    window.showToast = (m, bad) => { seen.push(String(m)); return real(m, bad); };
    entries.forEach(([supplier, defects], bi) => {
      const i = bi + 1;
      const inp = document.getElementById(`add-contractor-${i}-input`);
      inp.value = supplier;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      // Pick the supplier from the dropdown, as a supervisor must.
      const item = document.querySelector(`#add-contractor-${i}-dropdown .autocomplete-item`);
      if (item) item.click();
      const rows = [...document.querySelectorAll(`.add-defect-${i}`)];
      defects.forEach((t, ri) => { if (rows[ri]) rows[ri].value = t; });
    });
    saveAddDefectsAddress();
    await new Promise(r => setTimeout(r, 400));
    window.showToast = real;
    return seen;
  }, entries);
  const saved = await page.evaluate(() => (db.data.defects || []).map(d => d.description));
  return { toasts, saved };
}

const inReport = () => page.evaluate(async () => {
  window.__pdf = null;
  generateContextReport({ addressId: 1 });
  await new Promise(r => setTimeout(r, 250));
  document.getElementById('cr-go').click();
  await new Promise(r => setTimeout(r, 500));
  return window.__pdf;
});
const inList = () => page.evaluate(async () => {
  viewDefectsForAddress(1);
  await new Promise(r => setTimeout(r, 250));
  return [...document.querySelectorAll('.defect-item .defect-text')].map(e => e.textContent.trim());
});

// ================= A. five DISTINCT items, one supplier =====================
// Only 3 rows exist per block, so five items for one trade means two blocks.
console.log('\n--- A · five distinct items for ONE supplier (3 + 2 across two blocks) ---');
{
  const { toasts, saved } = await fillAndSave([
    ['COSTAS PLUMBING', ['Downpipe missing behind garage', 'Repair wall at cistern stop tap', 'Seal oversized hole at conduit']],
    ['COSTAS PLUMBING', ['Rework downpipe', 'Punch in downpipe pins']],
  ]);
  console.log('toast:', JSON.stringify(toasts));
  console.log('saved:', saved.length, JSON.stringify(saved));
  check('all 5 reach the database', saved.length === 5, `${saved.length} of 5`);
  const list = await inList();
  check('all 5 appear in the list', list.length === 5, `${list.length} of 5`);
  const pdf = await inReport();
  console.log('report:', pdf && pdf.length, JSON.stringify(pdf));
  check('all 5 appear in the report', pdf && pdf.length === 5, `${pdf && pdf.length} of 5`);
}

// ================= B. five items across five suppliers ======================
console.log('\n--- B · five items, one per block, two suppliers repeated ---');
{
  const { toasts, saved } = await fillAndSave([
    ['COSTAS PLUMBING', ['Tap washer']],
    ['AUZ PAINTING', ['Touch up hallway']],
    ['COSTAS PLUMBING', ['Shower rose']],
    ['AUZ PAINTING', ['Touch up bed 2']],
    ['COSTAS PLUMBING', ['Gas fitting check']],
  ]);
  console.log('toast:', JSON.stringify(toasts));
  console.log('saved:', saved.length, JSON.stringify(saved));
  check('all 5 reach the database', saved.length === 5, `${saved.length} of 5`);
  const pdf = await inReport();
  check('all 5 appear in the report', pdf && pdf.length === 5, `${pdf && pdf.length} of 5`);
}

// ================= C. repeated wording — the duplicate guard ================
// Site defects repeat: "Touch up paint" on five walls is one phrase five times.
console.log('\n--- C · five items where the WORDING repeats ---');
{
  const { toasts, saved } = await fillAndSave([
    ['AUZ PAINTING', ['Touch up paint', 'Touch up paint', 'Touch up paint']],
    ['AUZ PAINTING', ['Touch up paint', 'Touch up paint']],
  ]);
  console.log('toast:', JSON.stringify(toasts));
  console.log('saved:', saved.length, JSON.stringify(saved));
  console.log(`  >> typed 5 identical descriptions, database holds ${saved.length}`);
  const pdf = await inReport();
  console.log(`  >> report contains ${pdf && pdf.length}`);
  check('the toast TELLS the user the rest were duplicates',
    toasts.some(t => /already on the list/i.test(t)), JSON.stringify(toasts));
}

// ================= D. same wording, DIFFERENT suppliers =====================
console.log('\n--- D · same wording, different suppliers (must NOT be merged) ---');
{
  const { saved } = await fillAndSave([
    ['COSTAS PLUMBING', ['Touch up paint']],
    ['AUZ PAINTING', ['Touch up paint']],
  ]);
  check('same wording for two different suppliers stays as two defects',
    saved.length === 2, `${saved.length} of 2`);
}

// ================= E. more than three items in ONE block ====================
console.log('\n--- E · can a supervisor even type 5 items for one supplier in one block? ---');
{
  await reset();
  await page.waitForTimeout(250);
  const rows = await page.evaluate(() => ({
    perBlock: document.querySelectorAll('.add-defect-1').length,
    blocks: [1, 2, 3, 4, 5].filter(i => document.getElementById(`add-contractor-${i}-input`)).length,
    addRowButton: !!document.querySelector('[onclick*="addDefectRow"], .add-row, [title*="Add row" i]'),
  }));
  console.log('form shape:', JSON.stringify(rows));
  check('there are only 3 rows per supplier block', rows.perBlock === 3, String(rows.perBlock));
  check('…and no way to add a 4th row to a block', !rows.addRowButton);
  console.log(`  >> a supervisor wanting 5 items for one supplier MUST use a second block`);
}

// ================= F. the report's own status filter =========================
console.log('\n--- F · does the report drop anything by status? ---');
{
  await fillAndSave([['COSTAS PLUMBING', ['Item one', 'Item two', 'Item three']]]);
  await page.evaluate(() => { const d = db.data.defects; db.setDefectStatus(d[0].id, 'pending'); db.setDefectStatus(d[1].id, 'completed'); });
  const pdf = await inReport();
  console.log('report with 1 open / 1 pending / 1 completed:', JSON.stringify(pdf));
  check('open + pending are included by default', pdf && pdf.length === 2, `${pdf && pdf.length} of 3`);
  check('the completed one is excluded (by design — the dialog can tick it back on)',
    pdf && !pdf.some(d => /Item two/.test(d)), JSON.stringify(pdf));
}

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
