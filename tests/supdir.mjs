// Supplier emails come from CH Tracker's Look Up directory.
//
// Spiro, 2026-11-16: the Look Up page in CH Tracker holds every supplier's
// email, refreshed daily from Framework — "I'd like to utilise them so that
// when I click on the email … it's preloaded". On 16 Nov, 194 of 323 real
// suppliers here had no email saved, and at least 9 saved ones disagreed with
// the directory (one was a Creation Homes staff address).
//
// The rules (Spiro, 2026-11-16):
//  * The directory is the source of truth; our short names stay. A supplier
//    PINNED to a Framework code reads that code (codes survive the daily
//    reload); unpinned, an exact-name match. A TRADE is never looked up.
//  * General business email first, then call-up, then what was saved here.
//    Any accounts@ address is dropped.
//  * 🔗 with several addresses: tick boxes, #1 ticked, "Open email".
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8221;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
server.unref();

const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobStatus: 'active', active: true }],
  contractors: [
    // Name match. Saved address is kept but goes LAST.
    { id: 1, name: 'Quick Fit Glass', trades: 'Glazier', tradeIds: [], email: 'info@quickfitglass.com' },
    // Name match (case/spacing). General cell leads with accounts@ — dropped.
    { id: 2, name: 'BAYSIDE  JOINERY', trades: 'Carpenter', tradeIds: [] },
    // A TRADE — never looked up, even though the directory has a "Carpenter".
    { id: 3, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    // Not in the directory at all — keeps its saved address.
    { id: 4, name: 'Dean Rawle', trades: 'Painter', tradeIds: [], email: 'deanrawle@yahoo.com' },
    // Not in the directory, nothing saved — still gets the ask.
    { id: 5, name: 'Nowhere Roofing', trades: 'Roof Plumber', tradeIds: [] },
    // PINNED by code: its short name matches nothing in the directory.
    { id: 6, name: 'Vic Plaster Adam', trades: 'Plasterer', tradeIds: [], email: 'adam.o@vicplaster.com.au', supplierCode: 'VICPLA' },
    // PINNED to a code the directory no longer has — no name guess, saved only.
    { id: 7, name: 'Quick Fit Glass', trades: 'Glazier', tradeIds: [], email: 'kept@qfg.com', supplierCode: 'GONE01' },
    // Only accounts@ anywhere — nothing usable.
    { id: 8, name: 'Bills Only', trades: 'Cleaner', tradeIds: [], email: 'accounts@billsonly.com.au' },
  ],
  trades: [],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Replace cracked pane to laundry.', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: 2, description: 'Refit robe shelf.', status: 'open', completed: false },
    { id: 3, addressId: 1, contractorId: 4, description: 'Touch up skirting.', status: 'open', completed: false },
    { id: 4, addressId: 1, contractorId: 5, description: 'Reseal valley gutter.', status: 'open', completed: false },
    { id: 5, addressId: 1, contractorId: 6, description: 'Patch ceiling at manhole.', status: 'open', completed: false },
  ],
};

// Shaped like supplier_directory rows as cloud-sync pulls them.
const DIR = [
  { id: 'a', code: 'QFG001', name: 'Quick Fit Glass', callup_email: null, email: 'suzz@quickfitglass.com', active: true },
  { id: 'b', code: 'BAY001', name: 'Bayside Joinery', callup_email: 'callups@bayside.com.au', email: 'accounts@bayside.com.au, office@bayside.com.au; callups@bayside.com.au', active: true },
  { id: 'c', code: 'CARP01', name: 'Carpenter', callup_email: 'someone@carpenter.com.au', email: null, active: true },
  { id: 'd', code: 'PIN001', name: 'Rybalko Holdings Pty Ltd T/A Pinnacle Plumbing Group', callup_email: null, email: 'jobs@pinnacle.com.au; office@pinnacle.com.au', active: true },
  // One code, two rows (Framework does this) — the ACTIVE one must win.
  { id: 'e', code: 'VICPLA', name: 'VIC Plaster Pty Ltd', callup_email: null, email: 'old@vicplaster.com.au', active: false },
  { id: 'f', code: 'VICPLA', name: 'VIC Plaster Pty Ltd', callup_email: 'callups@vicplaster.com.au', email: 'accountsadmin@vicplaster.com.au; admin@vicplaster.com.au, Accounts.Payable@vicplaster.com.au', active: true },
  { id: 'g', code: 'ABSN01', name: 'Australian Building Services North', callup_email: null, email: 'n@abs.com', active: true },
  { id: 'h', code: 'ABSS01', name: 'Australian Building Services South', callup_email: null, email: 's@abs.com', active: true },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', hasTouch: true });
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
page.on('dialog', async d => { errs.push('dialog: ' + d.message().slice(0, 80)); await d.dismiss().catch(() => {}); });
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 220)));
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource|jspdf|pdf/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
// Seed ONCE (first load only) so the reload in section H sees what the app
// itself persisted, not a fresh seed.
await page.addInitScript(seed => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.clear();
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };
const J = JSON.stringify;

// What a pull does: hand the rows over with the contractor list.
await page.evaluate((dir) => window.SupplierDirectory.setRows(dir, db.data.contractors), DIR);
const addrsOf = () => page.evaluate(() => Object.fromEntries(db.data.contractors.map(c => [c.id, contractorAddresses(c).map(a => a.email + ' [' + a.src + ']')])));

// ================= A. order, and accounts@ dropped ===========================
console.log('\n--- A · which addresses, in which order ---');
{
  const r = await addrsOf();
  console.log(J(r, null, 1));
  check('general email FIRST, then the saved one last',
    J(r[1]) === J(['suzz@quickfitglass.com [Look Up]', 'info@quickfitglass.com [saved]']), J(r[1]));
  check('accounts@ dropped; rest of the general cell, then call-up; no duplicate of callups@',
    J(r[2]) === J(['office@bayside.com.au [Look Up]', 'callups@bayside.com.au [Look Up]']), J(r[2]));
  check('a TRADE is never looked up', J(r[3]) === '[]', J(r[3]));
  check('a supplier the directory lacks keeps its saved address', J(r[4]) === J(['deanrawle@yahoo.com [saved]']), J(r[4]));
  check('…and one with neither has none', J(r[5]) === '[]', J(r[5]));
  check('an accounts@ address saved by hand is dropped too', J(r[8]) === '[]', J(r[8]));
}

// ================= B. pinned by Framework code ================================
console.log('\n--- B · a pinned supplier reads its code, not its name ---');
{
  const r = await addrsOf();
  check('pinned short name → the code\'s ACTIVE entry; accountsadmin@ and Accounts.Payable@ dropped; saved address kept last',
    J(r[6]) === J(['admin@vicplaster.com.au [Look Up]', 'callups@vicplaster.com.au [Look Up · call-up]', 'adam.o@vicplaster.com.au [saved]']), J(r[6]));
  check('pinned to a code no longer in the directory → saved only, NO fall-back to a name guess',
    J(r[7]) === J(['kept@qfg.com [saved]']), J(r[7]));
  const cut = await page.evaluate(() => contractorAddresses({ name: 'Rybalko Holdings Pty Ltd T/A Pinnacle Plumbing Gro' }).map(a => a.email));
  check('unpinned: a name Framework cut off still finds its entry', J(cut) === J(['jobs@pinnacle.com.au', 'office@pinnacle.com.au']), J(cut));
  const amb = await page.evaluate(() => contractorAddresses({ name: 'Australian Building Services' }).length);
  check('unpinned: a cut-off fitting two names matches neither', amb === 0, String(amb));
}

// ================= C. 📧 falls through to #1 only ============================
async function arm() {
  await page.evaluate(() => {
    window.__sent = []; window.__mailto = []; window.__toasts = [];
    window.CloudShare = { uploadTempPdf: async () => 'https://example.test/go.html?f=x/R.pdf', lastKey: () => 'x/R.pdf' };
    window.CloudMail = { sendSupplierDefects: async (a) => { window.__sent.push(a); return { ok: true }; } };
    window.goMailto = (h) => window.__mailto.push(h);
    navigator.canShare = () => false;
    navigator.share = undefined;
    window.generateDefectPDF = async () => new File([new Blob(['%PDF-1.4'])], 'D.pdf', { type: 'application/pdf' });
    render();
  });
}
const toLine = (h) => decodeURIComponent(String(h || '').replace(/^mailto:/, '').split('?')[0]);
console.log('\n--- C · 📧 (attach) falling through to the server sends to #1 only ---');
{
  await arm();
  await page.evaluate(() => emailSupplier(6, 1));
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ sent: window.__sent.map(s => s.to), chooser: !!document.getElementById('rcp-go') }));
  check('no tick boxes on 📧', !r.chooser);
  check('…sent to the general email only', J(r.sent) === J([['admin@vicplaster.com.au']]), J(r.sent));
}

// ================= D. 🔗 tick boxes ===========================================
console.log('\n--- D · 🔗 with several addresses: tick boxes, #1 ticked ---');
{
  await arm();
  await page.evaluate(() => { emailSupplier(6, 1, true); });
  await page.waitForSelector('#rcp-go', { timeout: 3000 }).catch(() => {});
  const boxes = await page.evaluate(() => [...document.querySelectorAll('#imp-ov .rcp-cb')].map(b => b.checked));
  check('one tick box per address', boxes.length === 3, J(boxes));
  check('…only #1 (the general email) ticked to start', J(boxes) === J([true, false, false]), J(boxes));
  await page.evaluate(() => document.querySelectorAll('#imp-ov .rcp-cb')[2].click());   // add Adam
  await page.evaluate(() => document.getElementById('rcp-go').click());
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => window.__mailto);
  check('"Open email" opens the mail app with exactly the ticked addresses',
    m.length === 1 && toLine(m[0]) === 'admin@vicplaster.com.au,adam.o@vicplaster.com.au', toLine(m[0]));
  check('…subject still filled in', /subject=Defects%20-%20/.test(m[0] || ''), (m[0] || '').slice(0, 120));

  await arm();
  await page.evaluate(() => { emailSupplier(6, 1, true); });
  await page.waitForSelector('#rcp-go', { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => document.getElementById('imp-close').click());
  await page.waitForTimeout(500);
  check('✕ cancels — no email opened', (await page.evaluate(() => window.__mailto.length)) === 0);
}

// ================= E/F. one address / none ===================================
console.log('\n--- E · one address goes straight through; F · none still asks ---');
{
  await arm();
  await page.evaluate(() => { emailSupplier(4, 1, true); });
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({ chooser: !!document.getElementById('rcp-go'), m: window.__mailto }));
  check('a single address: no tick boxes, mail opens to it', !r.chooser && r.m.length === 1 && toLine(r.m[0]) === 'deanrawle@yahoo.com', J(r));

  await arm();
  await page.evaluate(() => { emailSupplier(5, 1, true); });
  await page.waitForSelector('#ask-email', { timeout: 3000 }).catch(() => {});
  check('no address anywhere: the "No email saved" ask', await page.evaluate(() => !!document.getElementById('ask-email')));
  await page.evaluate(() => { const x = document.getElementById('imp-close'); if (x) x.click(); });
}

// ================= G. the contractor screen ===================================
console.log('\n--- G · contractor screen lists every address and its source ---');
{
  await page.evaluate(() => { viewDefectsForContractor(6); });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    a: [...document.querySelectorAll('a[href^="mailto:"]')].map(x => x.textContent),
    tags: [...document.querySelectorAll('.supdir-tag')].map(x => x.textContent.replace(/^·\s*/, '')),
  }));
  console.log(J(r));
  check('all three addresses, best first', J(r.a) === J(['admin@vicplaster.com.au', 'callups@vicplaster.com.au', 'adam.o@vicplaster.com.au']), J(r.a));
  check('…each says where it came from', J(r.tags) === J(['Look Up', 'Look Up · call-up', 'saved']), J(r.tags));
}

// ================= H. offline =================================================
console.log('\n--- H · a phone that boots offline keeps the addresses ---');
{
  const stored = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('dm_supdir_v2') || '{}')).sort());
  check('only what our contractors use is stored, the pin under its code',
    J(stored) === J(['#vicpla', 'bayside joinery', 'quick fit glass']), J(stored));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  const r = await page.evaluate(() => ({
    pinned: contractorAddresses(db.getContractor(6)).map(a => a.email),
    gone: contractorAddresses(db.getContractor(7)).map(a => a.email),
    trade: contractorAddresses(db.getContractor(3)).length,
  }));
  check('after a reload with no pull, the pinned supplier still has its addresses',
    J(r.pinned) === J(['admin@vicplaster.com.au', 'callups@vicplaster.com.au', 'adam.o@vicplaster.com.au']), J(r.pinned));
  check('…a pin to a vanished code still gets no name guess', J(r.gone) === J(['kept@qfg.com']), J(r.gone));
  check('…and a trade is still never looked up', r.trade === 0);
}

check('no page errors or browser dialogs', errs.length === 0, JSON.stringify(errs));
await browser.close();
console.log(fail.length ? `\nFAILED: ${fail.length}\n  - ${fail.join('\n  - ')}` : '\nALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
