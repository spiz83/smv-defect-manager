// 📑 Generate PDF Report on the trade view (and the multi-contractor view),
// scoped to exactly what the screen is showing.
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


const ROOT = REPO, PORT = 8111;
const OUT = ARTIFACTS;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Two plumbers on three jobs, plus a painter that must NOT appear in a plumbing
// report. COSTAS has a trade link; BALCA deliberately has NONE — a sub with no
// trade link is on screen but a tradeIds filter would silently drop it, which is
// exactly why the report is scoped by contractor instead.
const SEED = {
  addresses: [
    { id: 1, lot: '1933', street: 'Lot 1933, 19 Lahar Road', suburb: 'Tarneit', propertyNumber: '306363', active: true },
    { id: 2, lot: '1258', street: 'Lot 1258, Balbi Rd', suburb: 'Truganina', propertyNumber: '306587', active: true },
    { id: 3, lot: '1118', street: 'Lot 1118, 60 Rainbow Street', suburb: 'Wollert', propertyNumber: '306548', active: true },
  ],
  contractors: [
    { id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber', tradeIds: [1] },
    { id: 2, name: 'BALCA PLUMBING', trades: 'Plumber' },          // no tradeIds link
    { id: 3, name: 'AUZ PAINTING', trades: 'Painter', tradeIds: [2] },
  ],
  trades: [{ id: 1, name: 'Plumber' }, { id: 2, name: 'Painter' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'BPI #7 (p.4) — WC Repair wall at cistern stop tap', status: 'open', completed: false },
    { id: 2, addressId: 2, contractorId: 1, description: 'BPI #12 (p.6) — Seal oversized hole at conduit', status: 'open', completed: false },
    { id: 3, addressId: 3, contractorId: 2, description: 'Bracket to be fixed', status: 'pending', completed: false },
    { id: 4, addressId: 3, contractorId: 2, description: 'Rework downpipe', status: 'open', completed: false },
    { id: 5, addressId: 1, contractorId: 3, description: 'Paint touch ups — should NOT be in a plumbing report', status: 'open', completed: false },
    { id: 6, addressId: 2, contractorId: 1, description: 'Already done', status: 'completed', completed: true },
  ],
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
await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  // Capture what the PDF WOULD contain instead of rendering one (jsPDF is a CDN
  // dependency and blocked here). Everything up to that call is the real path.
  window.__pdf = null;
  window.generateDefectPDF = async (list, o) => {
    window.__pdf = { descs: list.map(d => d.description), opts: JSON.parse(JSON.stringify(o)) };
  };
  render();
});

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= 1. the button exists ====================================
console.log('\n--- the trade view toolbar ---');
await page.evaluate(() => {
  state.currentView = 'view-defects-trade';
  state.filters = { tradeName: 'Plumber', contractorIds: [1, 2] };
  render();
});
await page.waitForTimeout(300);
const bar = await page.evaluate(() => {
  const kids = [...document.querySelectorAll('.defects-header .toolbar > *')];
  const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
  const pdf = kids.find(k => (k.title || '') === 'Generate PDF Report');
  return {
    titles: kids.map(k => k.title || k.className),
    hasPdf: !!pdf,
    glyph: pdf && pdf.textContent.trim(),
    rows: new Set(kids.map(mid)).size,
    overflow: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - document.querySelector('.defects-header .toolbar').getBoundingClientRect().right),
  };
});
console.log('toolbar:', JSON.stringify(bar.titles));
check('the trade view now has a Generate PDF Report button', bar.hasPdf);
check('…and it is the 📑 used everywhere else', bar.glyph === '📑', String(bar.glyph));
check('the toolbar is still one line', bar.rows === 1, String(bar.rows));
check('nothing overflows', bar.overflow <= 0, bar.overflow + 'px');

await page.setViewportSize({ width: 320, height: 720 });
await page.waitForTimeout(250);
const narrow = await page.evaluate(() => {
  const kids = [...document.querySelectorAll('.defects-header .toolbar > *')];
  const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
  const t = document.querySelector('.defects-header .toolbar').getBoundingClientRect();
  return {
    rows: new Set(kids.map(mid)).size,
    overflow: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - t.right),
    left: Math.round(Math.min(...kids.map(k => k.getBoundingClientRect().left)) - t.left),
  };
});
check('still one line at 320px with the extra icon', narrow.rows === 1 && narrow.overflow <= 0 && narrow.left >= 0, JSON.stringify(narrow));
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/85-trade-toolbar.png` });

// ================= 2. the dialog is scoped to the trade ====================
console.log('\n--- the report dialog ---');
await page.evaluate(() => document.querySelector('[title="Generate PDF Report"]').click());
await page.waitForSelector('#cr-go');
await page.waitForTimeout(200);
const dlg = await page.evaluate(() => ({
  forLabel: document.querySelector('#imp-body .imp-field div[style*="font-weight:600"]').textContent.trim(),
  mode: document.getElementById('cr-mode-contr').style.background.includes('rgb') || document.getElementById('cr-mode-contr').style.cssText.includes('2563eb'),
  contrVisible: getComputedStyle(document.getElementById('cr-contr-wrap')).display !== 'none',
  ticked: [...document.querySelectorAll('.cr-contr:checked')].map(x => Number(x.value)).sort(),
  jobsShown: [...document.querySelectorAll('.cr-job')].map(x => Number(x.value)).sort(),
  jobsTicked: [...document.querySelectorAll('.cr-job:checked')].length,
}));
console.log('dialog:', JSON.stringify(dlg));
check('the dialog names the TRADE it came from', dlg.forLabel === 'Plumber', dlg.forLabel);
check('it opens in Contractor mode', dlg.mode && dlg.contrVisible, JSON.stringify({ mode: dlg.mode, vis: dlg.contrVisible }));
check('the trade\'s subs are pre-ticked', dlg.ticked.join(',') === '1,2', JSON.stringify(dlg.ticked));
check('the painter is NOT pre-ticked', !dlg.ticked.includes(3), JSON.stringify(dlg.ticked));
check('a job picker appears, listing only jobs this trade is on',
  dlg.jobsShown.join(',') === '1,2,3', JSON.stringify(dlg.jobsShown));
check('…all ticked by default', dlg.jobsTicked === 3, String(dlg.jobsTicked));
await page.screenshot({ path: `${OUT}/86-trade-report-dialog.png` });

// ================= 3. what the PDF actually contains =======================
console.log('\n--- generating ---');
const gen = await page.evaluate(async () => {
  window.__pdf = null;
  document.getElementById('cr-go').click();
  await new Promise(r => setTimeout(r, 600));
  return { pdf: window.__pdf, closed: !document.getElementById('cr-go') };
});
console.log('pdf:', JSON.stringify(gen.pdf, null, 1));
check('the PDF is generated', !!gen.pdf && gen.closed);
check('it contains BOTH plumbers\' open/pending items',
  gen.pdf.descs.length === 4, String(gen.pdf.descs.length) + ' items');
check('including the sub with NO trade link (BALCA)',
  gen.pdf.descs.some(d => /Bracket to be fixed/.test(d)) && gen.pdf.descs.some(d => /Rework downpipe/.test(d)),
  JSON.stringify(gen.pdf.descs));
check('the painter is excluded', !gen.pdf.descs.some(d => /Paint touch ups/.test(d)), JSON.stringify(gen.pdf.descs));
check('completed items are excluded by default', !gen.pdf.descs.some(d => /Already done/.test(d)));
check('it spans every job the trade is on', gen.pdf.opts.addressIds.length === 0, JSON.stringify(gen.pdf.opts.addressIds));
check('scoped by contractor, not by trade links', gen.pdf.opts.contractorIds.slice().sort().join(',') === '1,2', JSON.stringify(gen.pdf.opts.contractorIds));

// narrowing to one job
const oneJob = await page.evaluate(async () => {
  generateContextReport({ contractorIds: [1, 2], label: 'Plumber' });
  await new Promise(r => setTimeout(r, 250));
  document.querySelectorAll('.cr-job').forEach(cb => { cb.checked = Number(cb.value) === 3; });
  window.__pdf = null;
  document.getElementById('cr-go').click();
  await new Promise(r => setTimeout(r, 600));
  return window.__pdf;
});
console.log('one job:', JSON.stringify(oneJob && oneJob.descs));
check('unticking jobs narrows the report',
  oneJob && oneJob.descs.length === 2 && oneJob.descs.every(d => /Bracket|downpipe/.test(d)),
  JSON.stringify(oneJob && oneJob.descs));

// unticking a contractor
const oneSub = await page.evaluate(async () => {
  generateContextReport({ contractorIds: [1, 2], label: 'Plumber' });
  await new Promise(r => setTimeout(r, 250));
  document.querySelectorAll('.cr-contr').forEach(cb => { if (Number(cb.value) === 2) cb.checked = false; });
  window.__pdf = null;
  document.getElementById('cr-go').click();
  await new Promise(r => setTimeout(r, 600));
  return window.__pdf;
});
check('unticking a sub narrows it too',
  oneSub && oneSub.descs.length === 2 && oneSub.descs.every(d => /WC Repair|Seal oversized/.test(d)),
  JSON.stringify(oneSub && oneSub.descs));

// including completed
const withDone = await page.evaluate(async () => {
  generateContextReport({ contractorIds: [1, 2], label: 'Plumber' });
  await new Promise(r => setTimeout(r, 250));
  document.getElementById('cr-st-completed').checked = true;
  window.__pdf = null;
  document.getElementById('cr-go').click();
  await new Promise(r => setTimeout(r, 600));
  return window.__pdf;
});
check('ticking Completed brings the done item in',
  withDone && withDone.descs.some(d => /Already done/.test(d)), JSON.stringify(withDone && withDone.descs));

// ================= 4. the other views are unchanged ========================
console.log('\n--- the existing report entry points still work ---');
const addr = await page.evaluate(async () => {
  generateContextReport({ addressId: 1 });
  await new Promise(r => setTimeout(r, 250));
  const label = document.querySelector('#imp-body .imp-field div[style*="font-weight:600"]').textContent.trim();
  const jobs = document.querySelectorAll('.cr-job').length;
  const tradeMode = getComputedStyle(document.getElementById('cr-trade-wrap')).display !== 'none';
  window.__pdf = null;
  document.getElementById('cr-go').click();
  await new Promise(r => setTimeout(r, 600));
  return { label, jobs, tradeMode, pdf: window.__pdf };
});
console.log('address report:', JSON.stringify({ label: addr.label, jobs: addr.jobs, tradeMode: addr.tradeMode, n: addr.pdf.descs.length }));
check('an ADDRESS report still names the job', /Lahar/.test(addr.label), addr.label);
check('…still opens in Trade mode', addr.tradeMode);
check('…still has no job picker', addr.jobs === 0, String(addr.jobs));
check('…and is scoped to that job', addr.pdf.opts.addressIds.join(',') === '1', JSON.stringify(addr.pdf.opts.addressIds));

const contr = await page.evaluate(async () => {
  generateContextReport({ contractorId: 1 });
  await new Promise(r => setTimeout(r, 250));
  const label = document.querySelector('#imp-body .imp-field div[style*="font-weight:600"]').textContent.trim();
  const jobs = [...document.querySelectorAll('.cr-job')].map(x => Number(x.value)).sort();
  window.__pdf = null;
  document.getElementById('cr-go').click();
  await new Promise(r => setTimeout(r, 600));
  return { label, jobs, pdf: window.__pdf };
});
console.log('contractor report:', JSON.stringify({ label: contr.label, jobs: contr.jobs, n: contr.pdf.descs.length }));
check('a CONTRACTOR report still names the sub', contr.label === 'COSTAS PLUMBING', contr.label);
check('…still lists only that sub\'s jobs', contr.jobs.join(',') === '1,2', JSON.stringify(contr.jobs));
check('…and contains only their items', contr.pdf.descs.length === 2, JSON.stringify(contr.pdf.descs));

// ================= 5. the multi-contractor screen too ======================
console.log('\n--- multiple contractors view ---');
await page.evaluate(() => {
  state.currentView = 'view-multiple-contractors';
  state.filters = { contractorIds: [1, 3] };
  render();
});
await page.waitForTimeout(300);
const multi = await page.evaluate(async () => {
  const btn = document.querySelector('.defects-header [title="Generate PDF Report"]');
  if (!btn) return { hasPdf: false };
  btn.click();
  await new Promise(r => setTimeout(r, 250));
  const ticked = [...document.querySelectorAll('.cr-contr:checked')].map(x => Number(x.value)).sort();
  window.__pdf = null;
  document.getElementById('cr-go').click();
  await new Promise(r => setTimeout(r, 600));
  return { hasPdf: true, ticked, pdf: window.__pdf };
});
console.log('multi:', JSON.stringify({ ticked: multi.ticked, descs: multi.pdf && multi.pdf.descs }));
check('the multi-contractor view has 📑 too', multi.hasPdf);
check('…pre-ticked with the contractors on screen', multi.ticked.join(',') === '1,3', JSON.stringify(multi.ticked));
check('…and reports exactly those', multi.pdf.descs.length === 3 && multi.pdf.descs.some(d => /Paint touch ups/.test(d)),
  JSON.stringify(multi.pdf.descs));

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
