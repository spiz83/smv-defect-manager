// Supplier emails come from CH Tracker's Look Up directory.
//
// Spiro, 2026-11-16: the Look Up page in CH Tracker holds every supplier's
// email, refreshed daily from Framework — "I'd like to utilise them so that
// when I click on the email … it's preloaded". On 16 Nov, 194 of 323 real
// suppliers here had no email saved, and at least 9 saved ones disagreed with
// the directory (one was a Creation Homes staff address).
//
// The rule (Spiro's call): THE DIRECTORY WINS. A supplier the directory has
// gets its address; one it doesn't keeps the saved email and the existing
// "No email saved" ask. A TRADE is never looked up.
//
// Matching mirrors CH Tracker's src/lib/supplierDirectory.ts so both apps
// choose the same inbox.
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
    // Saved address is stale — the directory has a different one.
    { id: 1, name: 'Quick Fit Glass', trades: 'Glazier', tradeIds: [], email: 'info@quickfitglass.com' },
    // Nothing saved; the directory has it (with different case/spacing).
    { id: 2, name: 'BAYSIDE  JOINERY', trades: 'Carpenter', tradeIds: [] },
    // A TRADE — never looked up, even though the directory has a "Carpenter".
    { id: 3, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    // Not in the directory at all — keeps its saved address.
    { id: 4, name: 'Dean Rawle', trades: 'Painter', tradeIds: [], email: 'deanrawle@yahoo.com' },
    // Not in the directory, nothing saved — still gets the ask.
    { id: 5, name: 'Nowhere Roofing', trades: 'Roof Plumber', tradeIds: [] },
    // Framework cut this name off; the directory has the full one.
    { id: 6, name: 'Rybalko Holdings Pty Ltd T/A Pinnacle Plumbing Gro', trades: 'Plumber', tradeIds: [] },
  ],
  trades: [],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Replace cracked pane to laundry.', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: 2, description: 'Refit robe shelf.', status: 'open', completed: false },
    { id: 3, addressId: 1, contractorId: 4, description: 'Touch up skirting.', status: 'open', completed: false },
    { id: 4, addressId: 1, contractorId: 5, description: 'Reseal valley gutter.', status: 'open', completed: false },
  ],
};

// Shaped like supplier_directory rows as cloud-sync pulls them.
const DIR = [
  { id: 'a', name: 'Quick Fit Glass', callup_email: null, email: 'suzz@quickfitglass.com', active: true },
  { id: 'b', name: 'Bayside Joinery', callup_email: 'callups@bayside.com.au', email: 'accounts@bayside.com.au, callups@bayside.com.au', active: true },
  { id: 'c', name: 'Carpenter', callup_email: 'someone@carpenter.com.au', email: null, active: true },
  { id: 'd', name: 'Rybalko Holdings Pty Ltd T/A Pinnacle Plumbing Group', callup_email: 'jobs@pinnacle.com.au; office@pinnacle.com.au', email: null, active: true },
  // Two entries of one name — the ACTIVE one must win.
  { id: 'e', name: 'Envy Electrical', callup_email: 'old@envy.com', email: null, active: false },
  { id: 'f', name: 'Envy Electrical', callup_email: 'scheduling@envyelec.com', email: null, active: true },
  // Two directory names start with the same short cut — ambiguous, match none.
  { id: 'g', name: 'Australian Building Services North', callup_email: 'n@abs.com', email: null, active: true },
  { id: 'h', name: 'Australian Building Services South', callup_email: 's@abs.com', email: null, active: true },
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
// Seed ONCE (first load only) so the reload in section E sees what the app
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

// What a pull does: hand the rows over with the contractor list.
await page.evaluate((dir) => window.SupplierDirectory.setRows(dir, db.data.contractors), DIR);

// ================= A. matching and choosing ==================================
console.log('\n--- A · which directory entry, which address ---');
{
  const r = await page.evaluate(() => {
    const f = (n) => window.SupplierDirectory.emailsFor(n);
    return {
      exact: f('Quick Fit Glass'),
      loose: f('  bayside   JOINERY '),
      cut: f('Rybalko Holdings Pty Ltd T/A Pinnacle Plumbing Gro'),
      active: f('Envy Electrical'),
      ambiguous: f('Australian Building Services'),
      short: f('Quick Fit'),
      none: f('Nowhere Roofing'),
    };
  });
  console.log(JSON.stringify(r));
  check('exact name → its address', JSON.stringify(r.exact) === '["suzz@quickfitglass.com"]', JSON.stringify(r.exact));
  check('case and spacing ignored; call-up email chosen over the general one',
    JSON.stringify(r.loose) === '["callups@bayside.com.au"]', JSON.stringify(r.loose));
  check('a name Framework cut off still finds the full entry, every address in the cell',
    JSON.stringify(r.cut) === '["jobs@pinnacle.com.au","office@pinnacle.com.au"]', JSON.stringify(r.cut));
  check('the ACTIVE entry wins over an inactive one of the same name',
    JSON.stringify(r.active) === '["scheduling@envyelec.com"]', JSON.stringify(r.active));
  check('a cut-off that fits two names matches neither (no guessing)', r.ambiguous.length === 0, JSON.stringify(r.ambiguous));
  check('a SHORT name never prefix-matches', r.short.length === 0, JSON.stringify(r.short));
  check('a name not in the directory → nothing', r.none.length === 0, JSON.stringify(r.none));
}

// ================= B. directory wins; saved and trade rules ==================
console.log('\n--- B · which address each contractor gets ---');
{
  const r = await page.evaluate(() => Object.fromEntries(db.data.contractors.map(c => [c.id, contractorEmails(c)])));
  console.log(JSON.stringify(r));
  check('directory WINS over a stale saved address',
    r[1].fromDirectory && r[1].to.join() === 'suzz@quickfitglass.com', JSON.stringify(r[1]));
  check('a supplier with nothing saved gets the directory address',
    r[2].fromDirectory && r[2].to.join() === 'callups@bayside.com.au', JSON.stringify(r[2]));
  check('a TRADE is never looked up', !r[3].fromDirectory && r[3].to.length === 0, JSON.stringify(r[3]));
  check('a supplier the directory lacks keeps its saved address',
    !r[4].fromDirectory && r[4].to.join() === 'deanrawle@yahoo.com', JSON.stringify(r[4]));
  check('…and one with neither has none', r[5].to.length === 0, JSON.stringify(r[5]));
}

// ================= C/D. the ✉ on a supplier group ============================
// The server route is the one place the recipient can be read back — mailto
// navigation can't be stubbed in a real browser. Share is refused so the flow
// reaches it.
async function arm() {
  await page.evaluate(() => {
    window.__sent = []; window.__toasts = [];
    window.CloudShare = { uploadTempPdf: async () => 'https://example.test/go.html?f=x/R.pdf', lastKey: () => 'x/R.pdf' };
    window.CloudMail = { sendSupplierDefects: async (a) => { window.__sent.push(a); return { ok: true }; } };
    navigator.canShare = () => false;
    navigator.share = undefined;
    window.generateDefectPDF = async () => new File([new Blob(['%PDF-1.4'])], 'D.pdf', { type: 'application/pdf' });
    render();
  });
}
console.log('\n--- C · ✉ sends to the directory address ---');
{
  await arm();
  await page.evaluate(() => emailSupplier(1, 1));
  await page.waitForTimeout(300);
  const sent = await page.evaluate(() => window.__sent);
  console.log(JSON.stringify(sent.map(s => s.to)));
  check('Quick Fit Glass goes to the directory address, not the stale saved one',
    sent.length === 1 && JSON.stringify(sent[0].to) === '["suzz@quickfitglass.com"]', JSON.stringify(sent));
}
console.log('\n--- D · the "No email saved" ask ---');
{
  await arm();
  await page.evaluate(() => { emailSupplier(2, 1); });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ ask: !!document.getElementById('ask-email'), sent: window.__sent.map(s => s.to) }));
  check('NOT asked when the directory has the supplier', !r.ask, JSON.stringify(r));
  check('…and it sends straight to that address', JSON.stringify(r.sent) === '[["callups@bayside.com.au"]]', JSON.stringify(r.sent));

  await arm();
  await page.evaluate(() => { emailSupplier(5, 1); });
  await page.waitForSelector('#ask-email', { timeout: 3000 }).catch(() => {});
  const asked = await page.evaluate(() => !!document.getElementById('ask-email'));
  check('still asked for a supplier with no address anywhere', asked);
  await page.evaluate(() => { const x = document.getElementById('imp-close'); if (x) x.click(); });
}

// ================= F. the contractor screen says where it came from ==========
console.log('\n--- F · contractor screen ---');
{
  await page.evaluate(() => { viewDefectsForContractor(1); });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="mailto:"]')].map(x => ({ href: x.getAttribute('href'), text: x.textContent }));
    return { a, tag: !!document.querySelector('.supdir-tag') };
  });
  console.log(JSON.stringify(r));
  check('the header mailto is the directory address',
    r.a.some(x => x.text === 'suzz@quickfitglass.com' && x.href === 'mailto:suzz%40quickfitglass.com'), JSON.stringify(r.a));
  check('…marked "from Look Up"', r.tag);
}

// ================= E. offline: the copy survives a reload ====================
console.log('\n--- E · a phone that boots offline keeps the addresses ---');
{
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dm_supdir_v1') || '{}'));
  console.log('stored:', JSON.stringify(stored));
  check('only the names matching a contractor are stored (not the whole directory)',
    Object.keys(stored).sort().join('|') === ['bayside joinery', 'quick fit glass', 'rybalko holdings pty ltd t/a pinnacle plumbing gro'].join('|'),
    JSON.stringify(Object.keys(stored)));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  const r = await page.evaluate(() => ({
    qfg: contractorEmails(db.getContractor(1)),
    trade: contractorEmails(db.getContractor(3)),
  }));
  console.log(JSON.stringify(r));
  check('after a reload with no pull, the directory address is still used',
    r.qfg.fromDirectory && r.qfg.to.join() === 'suzz@quickfitglass.com', JSON.stringify(r.qfg));
  check('…and a trade is still never looked up', !r.trade.fromDirectory, JSON.stringify(r.trade));
}

check('no page errors or browser dialogs', errs.length === 0, JSON.stringify(errs));
await browser.close();
console.log(fail.length ? `\nFAILED: ${fail.length}\n  - ${fail.join('\n  - ')}` : '\nALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
