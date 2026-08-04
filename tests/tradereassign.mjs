// Reassign a whole supplier group from the TRADE view.
//
// The situation from site: the Plumber trade view shows two groups on one job —
// COSTAS PLUMBING (the real sub) and PLUMBER (the trade placeholder the BPI
// import filed items against). The waterhammer item sits under the placeholder,
// so a report for COSTAS PLUMBING never contains it. The trade view had no way
// to move them: the ✏️ "Reassign all" button existed only on the job view.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8115;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const TRADE = 'Plumber (Material & Labour)';
const SEED = {
  addresses: [
    { id: 1, lot: '1401', street: 'Lot 1401, (24) Kobi St', suburb: 'Tarneit', propertyNumber: '306665', jobStatus: 'active', active: true },
    { id: 2, lot: '1023', street: 'Lot 1023, Coollegrean Road', suburb: 'Wollert', propertyNumber: '306725', jobStatus: 'active', active: true },
  ],
  contractors: [
    { id: 1, name: 'COSTAS PLUMBING', trades: TRADE, tradeIds: [1] },
    // The trade placeholder the import files against when it can't name a sub.
    { id: 2, name: 'PLUMBER', trades: TRADE, tradeIds: [1], isTradePlaceholder: true, isActive: true },
    { id: 3, name: 'AUZ PAINTING', trades: 'Painter', tradeIds: [2] },
  ],
  trades: [{ id: 1, name: TRADE }, { id: 2, name: 'Painter' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'BPI #10 (p.5) — Adjust down pipe boots', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: 1, description: 'BPI #11 (p.5) — Bottom downpipe clip not even', status: 'open', completed: false },
    { id: 3, addressId: 1, contractorId: 2, description: 'BPI #6 (p.4) — There is water hammer at the basin', status: 'open', completed: false },
    { id: 4, addressId: 1, contractorId: 2, description: 'BPI #11 (p.5) — Bottom downpipe clip not even (dup)', status: 'open', completed: false },
    { id: 5, addressId: 1, contractorId: 2, description: 'BPI #10 (p.5) — Adjust down pipe boots (dup)', status: 'open', completed: false },
    // A second job, to prove the reassign is scoped to ONE job's group.
    { id: 6, addressId: 2, contractorId: 2, description: 'BPI #2 (p.2) — Tap set loose', status: 'open', completed: false },
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
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

const openTradeView = () => page.evaluate(() => { showDefectsForTrade(1); });
await openTradeView();
await page.waitForTimeout(300);

// ================= A. the button is there ===================================
console.log('\n--- A · the trade view offers Reassign all on each supplier group ---');
{
  const groups = await page.evaluate(() => [...document.querySelectorAll('.contractor-section')].map(sec => ({
    name: (sec.querySelector('.supplier-name-txt') || {}).textContent || '',
    reassign: !!sec.querySelector('button[onclick*="openReassignGroup"]'),
    items: sec.querySelectorAll('.defect-item').length,
  })));
  console.log('groups:', JSON.stringify(groups));
  check('both supplier groups are on screen', groups.length >= 2, String(groups.length));
  check('the PLUMBER placeholder group has a Reassign all button',
    groups.some(g => /PLUMBER/.test(g.name) && !/COSTAS/.test(g.name) && g.reassign),
    JSON.stringify(groups));
  check('the real sub group has one too',
    groups.some(g => /COSTAS/.test(g.name) && g.reassign), JSON.stringify(groups));
}

// ================= B. moving the placeholder group to the real sub ==========
console.log('\n--- B · move the PLUMBER group to COSTAS PLUMBING ---');
{
  const toast = await page.evaluate(async () => {
    const seen = [];
    const real = window.showToast;
    window.showToast = (m, bad) => { seen.push(String(m)); return real(m, bad); };
    // Tap the ✏️ on the placeholder group at Lot 1401.
    const sec = [...document.querySelectorAll('.contractor-section')].find(s => {
      const n = (s.querySelector('.supplier-name-txt') || {}).textContent || '';
      return /PLUMBER/.test(n) && !/COSTAS/.test(n);
    });
    sec.querySelector('button[onclick*="openReassignGroup"]').click();
    await new Promise(r => setTimeout(r, 300));
    // Pick COSTAS PLUMBING from the predictive picker, as a supervisor would.
    const inp = document.getElementById('de-contractor-input');
    inp.focus(); inp.value = 'COSTAS';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    // The picker commits on MOUSEDOWN (so it beats the input's blur), not click.
    const opt = [...document.querySelectorAll('#de-contractor-list .rv-combo-item')]
      .find(el => /COSTAS/i.test(el.textContent));
    if (opt) opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('rg-save').click();
    await new Promise(r => setTimeout(r, 400));
    window.showToast = real;
    return seen;
  });
  console.log('toast:', JSON.stringify(toast));

  const after = await page.evaluate(() => ({
    onCostasAtKobi: db.data.defects.filter(d => d.addressId === 1 && d.contractorId === 1).length,
    stillPlaceholderAtKobi: db.data.defects.filter(d => d.addressId === 1 && d.contractorId === 2).length,
    otherJobUntouched: db.data.defects.filter(d => d.addressId === 2 && d.contractorId === 2).length,
  }));
  console.log('after:', JSON.stringify(after));
  check('all 5 Kobi St items now sit under COSTAS PLUMBING', after.onCostasAtKobi === 5, `${after.onCostasAtKobi} of 5`);
  check('nothing is left on the placeholder at that job', after.stillPlaceholderAtKobi === 0, String(after.stillPlaceholderAtKobi));
  check('the OTHER job\'s placeholder item is untouched', after.otherJobUntouched === 1, String(after.otherJobUntouched));
  check('the toast confirms the move', toast.some(t => /Moved 3 defect/.test(t)), JSON.stringify(toast));
}

// ================= C. the waterhammer item now reaches a Costas report ======
console.log('\n--- C · a COSTAS PLUMBING report now contains the waterhammer item ---');
{
  const pdf = await page.evaluate(async () => {
    window.__pdf = null;
    window.generateDefectPDF = async (list) => { window.__pdf = list.map(d => d.description); };
    generateContextReport({ contractorId: 1 });
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('cr-go').click();
    await new Promise(r => setTimeout(r, 500));
    return window.__pdf;
  });
  console.log('pdf:', JSON.stringify(pdf));
  check('the water hammer item is in the supplier report',
    !!pdf && pdf.some(d => /water hammer/i.test(d)), JSON.stringify(pdf));
}

// ================= D. moving OUT of the trade says so ========================
console.log('\n--- D · moving a group to a sub without this trade warns instead of vanishing ---');
{
  await page.evaluate(() => { showDefectsForTrade(1); });
  await page.waitForTimeout(300);
  const toast = await page.evaluate(async () => {
    const seen = [];
    const real = window.showToast;
    window.showToast = (m, bad) => { seen.push(String(m)); return real(m, bad); };
    const sec = [...document.querySelectorAll('.contractor-section')].find(s =>
      /COSTAS/.test((s.querySelector('.supplier-name-txt') || {}).textContent || ''));
    sec.querySelector('button[onclick*="openReassignGroup"]').click();
    await new Promise(r => setTimeout(r, 300));
    const inp = document.getElementById('de-contractor-input');
    inp.focus(); inp.value = 'AUZ';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    // The picker commits on MOUSEDOWN (so it beats the input's blur), not click.
    const opt = [...document.querySelectorAll('#de-contractor-list .rv-combo-item')]
      .find(el => /AUZ/i.test(el.textContent));
    if (opt) opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('rg-save').click();
    await new Promise(r => setTimeout(r, 400));
    window.showToast = real;
    return seen;
  });
  console.log('toast:', JSON.stringify(toast));
  check('the supervisor is told the items left this trade list',
    toast.some(t => /no longer on the/i.test(t)), JSON.stringify(toast));
}

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
