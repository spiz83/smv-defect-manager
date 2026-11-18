// Every screen spells an address the same way (Spiro 2026-11-18):
// "the font is different in the view defects by trade. The addresses seem to
//  be a whole lot bigger and different font. It needs to match the other view
//  screens where the address is in capitals and match size font etc"
//
// He was right, and the cause is the kind that comes back: the trade view
// hand-rolled `style="font-size:17px; color:var(--text-primary)"` on its
// address header instead of using .contractor-name. The theme rule that makes
// an address small accent-coloured CAPS hangs off that class, and an inline
// style is not reached by it — so one screen drifted and nothing failed.
//
// This suite compares the screens against each other rather than against
// hard-coded values. Pinning "15px uppercase" here would just move the
// duplication into the test: the rule is that they MATCH, so that is what is
// asserted, on every palette.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8148;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Two jobs, one contractor, one trade — enough for every grouping to render.
const SEED = {
  addresses: [
    { id: 1, lot: '2', street: 'Lot 2, 16 Skylark Rd', streetName: 'Skylark Rd', lotNo: 2, suburb: 'Greenvale', propertyNumber: '306626', active: true },
    { id: 2, lot: '3', street: 'Lot 3, 18 Skylark Rd', streetName: 'Skylark Rd', lotNo: 3, suburb: 'Greenvale', propertyNumber: '306627', active: true },
  ],
  contractors: [{ id: 1, name: 'Bayhill Roofing Pty Ltd', isActive: true, trades: 'Roofer', tradeIds: [1] }],
  trades: [{ id: 1, name: 'Roofer' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Front LHS realign fascia gutter', location: 'Roof', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 2, addressId: 2, contractorId: 1, description: 'Boundary capping short front', location: 'Roof', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' },
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
  return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
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

// The address header on each screen, as it actually computes.
const read = async (label, open) => await page.evaluate(async ([label, open]) => {
  (new Function(open))();
  await new Promise(r => setTimeout(r, 90));
  // The first .contractor-name whose text is an ADDRESS, not a supplier.
  const el = [...document.querySelectorAll('.contractor-name')]
    .find(e => /Skylark|Lot \d/.test(e.textContent));
  if (!el) return { label, missing: true };
  const cs = getComputedStyle(el);
  return { label, view: state.currentView,
    size: cs.fontSize, weight: cs.fontWeight, transform: cs.textTransform,
    color: cs.color, family: cs.fontFamily.split(',')[0].replace(/"/g, ''),
    spacing: cs.letterSpacing,
    text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 50),
    rendersUpper: el.textContent.trim() !== el.textContent.trim().toUpperCase()
      ? cs.textTransform === 'uppercase' : true,
  };
}, [label, open]);

const SCREENS = [
  ['by contractor', 'viewDefectsForContractor(1)'],
  ['by trade',      'showDefectsForTrade(1)'],
  ['all defects',   'viewAllDefects()'],
];

console.log('\n--- the address header, screen by screen ---');
const seen = [];
for (const [label, open] of SCREENS) {
  const r = await read(label, open);
  seen.push(r);
  console.log(` ${label.padEnd(15)} ${(r.view||'?').padEnd(22)} ${r.missing ? 'NOT FOUND' :
    `${r.size.padEnd(7)} w${r.weight} ${r.transform.padEnd(10)} ${r.color.padEnd(18)} ${r.family}`}`);
}
for (const r of seen) check(`[${r.label}] renders an address header`, !r.missing, r.text || '');
check('each screen actually opened — a comparison of one screen with itself proves nothing',
  new Set(seen.map(r => r.view)).size === seen.length,
  JSON.stringify(seen.map(r => `${r.label}:${r.view}`)));

const live = seen.filter(r => !r.missing);
const ref = live[0];
for (const r of live.slice(1)) {
  check(`[${r.label}] is the same size as [${ref.label}]`, r.size === ref.size, `${r.size} vs ${ref.size}`);
  check(`…the same weight`, r.weight === ref.weight, `${r.weight} vs ${ref.weight}`);
  check(`…the same case`, r.transform === ref.transform, `${r.transform} vs ${ref.transform}`);
  check(`…the same colour`, r.color === ref.color, `${r.color} vs ${ref.color}`);
  check(`…and the same face`, r.family === ref.family, `${r.family} vs ${ref.family}`);
}
// The specific thing Spiro asked for, stated once rather than inferred from
// the comparison: an address reads in capitals.
check('an address reads in capitals, as it does everywhere else',
  live.every(r => r.transform === 'uppercase'),
  JSON.stringify(live.map(r => `${r.label}:${r.transform}`)));

// …and the trade view gained the tap-through that came with the class.
console.log('\n--- tapping an address ---');
const tap = await page.evaluate(async () => {
  showDefectsForTrade(1);
  await new Promise(r => setTimeout(r, 90));
  const el = [...document.querySelectorAll('.contractor-name')].find(e => /Skylark/.test(e.textContent));
  const clickable = !!(el && el.getAttribute('onclick'));
  const chevron = !!(el && /›/.test(el.textContent));
  if (clickable) el.click();
  await new Promise(r => setTimeout(r, 90));
  return { clickable, chevron, view: state.currentView, addressId: state.filters && state.filters.addressId };
});
console.log('tap:', JSON.stringify(tap));
check('the trade view\'s address is tappable, like the contractor view\'s', tap.clickable);
check('…and shows the chevron that says so', tap.chevron);
check('…and opens that address', tap.view === 'view-defects-address' && tap.addressId === 1,
  `${tap.view} / ${tap.addressId}`);

// Every palette, because the rule that does this is a theme rule.
console.log('\n--- on all fifteen palettes ---');
const across = await page.evaluate(async () => {
  const out = {};
  for (const t of F1_THEMES) {
    applyF1Theme(t.id);
    const grab = async (open) => {
      (new Function(open))();
      await new Promise(r => setTimeout(r, 40));
      const el = [...document.querySelectorAll('.contractor-name')].find(e => /Skylark/.test(e.textContent));
      if (!el) return null;
      const cs = getComputedStyle(el);
      return [cs.fontSize, cs.fontWeight, cs.textTransform, cs.color].join('|');
    };
    const a = await grab('viewDefectsForContractor(1)');
    const b = await grab('showDefectsForTrade(1)');
    out[t.id] = { a, b, same: a != null && a === b };
  }
  applyF1Theme('framework');
  return out;
});
for (const [id, v] of Object.entries(across)) {
  check(`[${id}] trade matches contractor`, v.same, v.same ? '' : `${v.b} vs ${v.a}`);
}

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
