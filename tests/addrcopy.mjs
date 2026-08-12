// 📋 Copy address, on the top-search result rows.
//
// The row is text + three 40px icons on a phone-width dropdown. This app has
// been bitten twice by exactly that shape — a control pushed off the right edge
// where it can't be tapped (see the .toolbar comment in index.html) — so the
// geometry is checked here, not just the string.
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

const ROOT = REPO, PORT = 8104;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// The Wollert jobs from the supervisor's screenshot — long street names on
// purpose, they are what squeezes the icons.
const SEED = {
  addresses: [
    { id: 1, street: 'Lot 1023, Coollegrean Road', suburb: 'Wollert', propertyNumber: '306725', active: true },
    { id: 2, street: 'Lot 1118, 60 Rainbow Street', suburb: 'Wollert', propertyNumber: '306548', active: true },
    { id: 3, street: 'Lot 1143, (27) Fuchsia St', suburb: 'Wollert', propertyNumber: '306645', active: true },
    // The job from the header screenshot — used for the frozen-header check.
    { id: 4, street: 'Lot 245, (4) Spinosa Road', suburb: 'Wollert', propertyNumber: '306640', active: true },
  ],
  contractors: [{ id: 1, name: 'HTEE KLEEH', trades: ['Plumber'] }],
  trades: [{ id: 1, name: 'Plumber' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Adjust door rattle', completed: false, status: 'open', location: 'Entry' },
    { id: 2, addressId: 4, contractorId: 1, description: 'BPI #10 (p.5) — Seal junction between the ceiling and wall', completed: false, status: 'open', location: 'Kitchen' },
  ],
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
  // Capture the copy instead of touching a real clipboard, which headless
  // Chromium will not hand over.
  window.__copied = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: t => { window.__copied = t; return Promise.resolve(); } },
  });
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
// Without CloudJobs, scopeAddressesToUser() returns [] — identity unknown, so
// every job-scoped screen renders empty and the search finds nothing.
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (label, cond, detail) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  ' + detail : '')); if (!cond) fail.push(label); };

// Type "wo" into the top search, exactly as in the screenshot.
await page.evaluate(() => {
  const i = document.getElementById('unified-search');
  i.value = 'wo';
  handleAutocomplete(i, 'address');
});
await page.waitForTimeout(200);
await page.screenshot({ path: join(ARTIFACTS, '40-addr-copy.png') });

const rows = await page.evaluate(() => {
  const dd = document.getElementById('unified-search-dropdown');
  return [...dd.querySelectorAll('.autocomplete-item')].map(r => {
    const icons = [...r.querySelectorAll('div[onclick]')].filter(d => d.getAttribute('onclick').includes('('));
    const acts = [...r.children[1].children];
    return {
      text: (r.children[0].textContent || '').trim(),
      icons: acts.map(a => a.textContent.trim()),
      right: Math.round(r.getBoundingClientRect().right),
      // rightmost pixel of the last icon — must stay inside the row
      lastIconRight: acts.length ? Math.round(acts[acts.length - 1].getBoundingClientRect().right) : 0,
      firstIconLeft: acts.length ? Math.round(acts[0].getBoundingClientRect().left) : 0,
      h: Math.round(r.getBoundingClientRect().height),
      wraps: r.getBoundingClientRect().height > 80,
    };
  });
});
console.log('\nrows:');
rows.forEach(r => console.log('  ' + JSON.stringify(r)));

check('address rows rendered', rows.length === 4, `${rows.length}`);
check('📋 sits before 👁️ and ✚',
  JSON.stringify(rows[0].icons) === JSON.stringify(['📋', '👁️', '✚']),
  JSON.stringify(rows[0].icons));
check('no icon is pushed off the right edge',
  rows.every(r => r.lastIconRight <= r.right), rows.map(r => `${r.lastIconRight}/${r.right}`).join(' '));
check('the row still does not wrap', rows.every(r => !r.wraps), rows.map(r => r.h + 'px').join(' '));
check('the address text still has room',
  rows.every(r => r.firstIconLeft >= 150), rows.map(r => r.firstIconLeft + 'px').join(' '));

// ── the string ───────────────────────────────────────────────────────────
await page.evaluate(() => {
  const dd = document.getElementById('unified-search-dropdown');
  dd.querySelector('.autocomplete-item').children[1].children[0].click();
});
await page.waitForTimeout(200);
const copied = await page.evaluate(() => window.__copied);
console.log('\ncopied: ' + JSON.stringify(copied));
check('copies "Lot, Street, Suburb - JobNo"',
  copied === 'Lot 1023, Coollegrean Road, Wollert - 306725', String(copied));
check('a toast confirms the copy',
  await page.evaluate(() => !!document.querySelector('.toast')));

// Copying must not navigate — the dropdown is still there to pick from.
check('copying does not open the job',
  await page.evaluate(() => !!document.getElementById('unified-search-dropdown')
    && document.getElementById('unified-search-dropdown').classList.contains('active')));

// Contractor and trade rows have no address to copy.
for (const [type, want] of [['contractor', ['👁️', '✚']], ['trade', ['👁️']]]) {
  await page.evaluate(t => {
    setSearchType(t);
    const i = document.getElementById('unified-search');
    i.value = t === 'contractor' ? 'htee' : 'plum';
    handleAutocomplete(i, t);
  }, type);
  await page.waitForTimeout(200);
  const icons = await page.evaluate(() => {
    const r = document.querySelector('#unified-search-dropdown .autocomplete-item');
    return r ? [...r.children[1].children].map(a => a.textContent.trim()) : null;
  });
  check(`${type} rows get no 📋`, JSON.stringify(icons) === JSON.stringify(want), JSON.stringify(icons));
}

// ── the same 📋 on the job header ────────────────────────────────────────
// The header is FROZEN and pinned to one line; a control added here is one
// that can never be scrolled away from, so it has to earn its width.
await page.evaluate(() => { window.__copied = null; viewDefectsForAddress(4); });
await page.waitForTimeout(300);
await page.screenshot({ path: join(ARTIFACTS, '41-addr-copy-header.png') });

const hdr = await page.evaluate(() => {
  const t = document.querySelector('.defects-header.hdr-inline .lot-title');
  const btn = t && t.querySelector('.lot-copy');
  const addr = t && t.querySelector('.lot-addr');
  if (!t || !btn) return null;
  const tb = t.getBoundingClientRect(), bb = btn.getBoundingClientRect();
  return {
    onTitleLine: Math.abs((bb.top + bb.height / 2) - (tb.top + tb.height / 2)) < 14,
    insideHeader: Math.round(bb.right) <= Math.round(tb.right) + 1,
    tap: Math.round(bb.width) + 'x' + Math.round(bb.height),
    titleH: Math.round(tb.height),
    // the address must still be readable, not squeezed to nothing
    addrW: Math.round(addr.getBoundingClientRect().width),
    clipped: addr.scrollWidth > addr.clientWidth + 1,
    jobNo: (t.querySelector('.lot-job') || {}).textContent || '',
  };
});
console.log('\njob header:', JSON.stringify(hdr));
check('📋 is on the job header', !!hdr);
check('it sits on the address line, not a new row', hdr && hdr.onTitleLine && hdr.titleH < 46, JSON.stringify(hdr && { onTitleLine: hdr.onTitleLine, titleH: hdr.titleH }));
check('it stays inside the header', hdr && hdr.insideHeader);
check('the job number is never given up for it', hdr && hdr.jobNo.includes('306640'), hdr && hdr.jobNo);
check('the address is not clipped to make room', hdr && !hdr.clipped && hdr.addrW > 120, hdr && `${hdr.addrW}px clipped=${hdr.clipped}`);

await page.click('.defects-header.hdr-inline .lot-copy');
await page.waitForTimeout(200);
const hdrCopied = await page.evaluate(() => window.__copied);
console.log('copied from header: ' + JSON.stringify(hdrCopied));
check('header 📋 copies the same format',
  hdrCopied === 'Lot 245, (4) Spinosa Road, Wollert - 306640', String(hdrCopied));
// The whole title is a tap target for Add Defects — copying must not fire it.
check('copying does not open Add Defects',
  await page.evaluate(() => state.currentView === 'view-defects-address'),
  await page.evaluate(() => state.currentView));

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
