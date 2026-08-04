// "I exported a Plumber report and the Costas Plumbing waterhammer item wasn't in it."
//
// A trade filter resolves a defect's trade through its CONTRACTOR'S TRADE LINKS
// (dm_contractor_trades). Plenty of real subs have none — the sync gives them
// tradeIds: [] and trades: 'No Trade Assigned'. Their defects are then dropped
// from any trade-filtered report, and nothing on screen says a thing: the PDF is
// generated, the toast says "PDF report ready", and the items are simply absent.
//
// This suite pins the drop, and pins that the supervisor is now TOLD about it.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8114;
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
    { id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobStatus: 'active', active: true },
    { id: 2, lot: '904', street: 'Lot 904, (9) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306649', jobStatus: 'active', active: true },
  ],
  contractors: [
    // The real-world shape: a plumber with NO row in dm_contractor_trades.
    { id: 1, name: 'COSTAS PLUMBING', trades: 'No Trade Assigned', tradeIds: [] },
    { id: 2, name: 'AUZ PAINTING', trades: 'Painter', tradeIds: [2] },
    { id: 3, name: 'TECH FLOW', trades: 'No Trade Assigned', tradeIds: [] },
  ],
  trades: [{ id: 1, name: 'Plumber' }, { id: 2, name: 'Painter' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Waterhammer to kitchen mixer', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: 1, description: 'Downpipe missing behind garage', status: 'open', completed: false },
    { id: 3, addressId: 1, contractorId: 2, description: 'Touch up hallway', status: 'open', completed: false },
    { id: 4, addressId: 2, contractorId: 3, description: 'Rework exhaust duct to ensuite', status: 'open', completed: false },
    { id: 5, addressId: 2, contractorId: 3, description: 'Seal penetration at riser', status: 'open', completed: false },
  ],
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
  window.generateDefectPDF = async (list) => { window.__pdf = list.map(d => d.description); };
  render();
});

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Generate a job report with ONLY the given trades ticked, capturing every
// toast and confirm the supervisor would see. `includeAnyway` answers the
// "include them?" prompt when one appears.
async function tradeReport(addressId, tradeNames, includeAnyway) {
  return page.evaluate(async ({ addressId, tradeNames, includeAnyway }) => {
    const toasts = [], confirms = [];
    const realToast = window.showToast, realConfirm = window.confirm;
    window.showToast = (m, bad) => { toasts.push(String(m)); return realToast(m, bad); };
    window.confirm = (m) => { confirms.push(String(m)); return !!includeAnyway; };
    window.__pdf = null;
    try {
      generateContextReport({ addressId });
      await new Promise(r => setTimeout(r, 250));
      // Trade mode, only the named trades ticked.
      crSetFilterMode('trade');
      document.querySelectorAll('.cr-trade').forEach(cb => {
        const name = (cb.parentElement.textContent || '').trim();
        cb.checked = tradeNames.includes(name);
      });
      document.getElementById('cr-go').click();
      await new Promise(r => setTimeout(r, 600));
    } finally {
      window.showToast = realToast; window.confirm = realConfirm;
    }
    return { pdf: window.__pdf, toasts, confirms };
  }, { addressId, tradeNames, includeAnyway });
}

// ================= A. the reported case ====================================
console.log('\n--- A · Plumber report on a job whose plumber has no trade link ---');
{
  const r = await tradeReport(1, ['Plumber'], false);
  console.log('pdf     :', JSON.stringify(r.pdf));
  console.log('toasts  :', JSON.stringify(r.toasts));
  console.log('prompts :', JSON.stringify(r.confirms));

  check('the supervisor is TOLD that items were left out',
    r.confirms.length > 0 || r.toasts.some(t => /left out|no trade link|not linked/i.test(t)),
    'nothing said — ' + JSON.stringify(r.toasts));
  check('the message names the supplier responsible',
    (r.confirms.concat(r.toasts)).some(t => /COSTAS PLUMBING/i.test(t)),
    JSON.stringify(r.confirms.concat(r.toasts)));
}

// ================= B. answering "include them" ==============================
console.log('\n--- B · answering YES to "include them anyway" ---');
{
  const r = await tradeReport(1, ['Plumber'], true);
  console.log('pdf     :', JSON.stringify(r.pdf));
  check('the waterhammer item is in the PDF',
    !!r.pdf && r.pdf.some(d => /Waterhammer/i.test(d)), JSON.stringify(r.pdf));
  check('both Costas items are in the PDF',
    !!r.pdf && r.pdf.filter(d => /Waterhammer|Downpipe/i.test(d)).length === 2, JSON.stringify(r.pdf));
  check('the painter item is NOT dragged in',
    !!r.pdf && !r.pdf.some(d => /Touch up hallway/i.test(d)), JSON.stringify(r.pdf));
}

// ================= C. declining leaves the old behaviour ====================
console.log('\n--- C · answering NO keeps the strict trade filter ---');
{
  const r = await tradeReport(1, ['Plumber'], false);
  console.log('pdf     :', JSON.stringify(r.pdf), 'toasts:', JSON.stringify(r.toasts));
  check('nothing unlinked is included when the supervisor says no',
    !r.pdf || !r.pdf.some(d => /Waterhammer/i.test(d)), JSON.stringify(r.pdf));
}

// ================= D. a linked trade is untouched ===========================
console.log('\n--- D · a properly linked trade behaves exactly as before ---');
{
  const r = await tradeReport(1, ['Painter'], false);
  console.log('pdf     :', JSON.stringify(r.pdf), 'prompts:', r.confirms.length);
  check('the painter report still contains the painter item',
    !!r.pdf && r.pdf.some(d => /Touch up hallway/i.test(d)), JSON.stringify(r.pdf));
}

// ================= E. all trades ticked = no filter at all ==================
console.log('\n--- E · all trades ticked — no filter, so nothing is excluded ---');
{
  const r = await tradeReport(2, ['Plumber', 'Painter'], false);
  console.log('pdf     :', JSON.stringify(r.pdf), 'prompts:', r.confirms.length);
  check('both TECH FLOW items appear with no filter applied',
    !!r.pdf && r.pdf.length === 2, JSON.stringify(r.pdf));
  check('and the supervisor is not prompted about anything',
    r.confirms.length === 0, JSON.stringify(r.confirms));
}

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
