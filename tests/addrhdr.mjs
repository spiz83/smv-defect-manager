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
// The splash covers the whole screen for the first second of a boot, so
// every suite waits it out before touching or measuring anything. Added to
// all of them at once rather than to the three that happened to fail: the
// ones that passed were passing on timing, which is the same bug asleep
// (2026-11-18).
await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });
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

// All FOUR screens that group defects under an address. The last two were
// changed in the same pass and were going untested, which is how this drifted
// in the first place.
const SCREENS = [
  ['by contractor', 'viewDefectsForContractor(1)'],
  ['by trade',      'showDefectsForTrade(1)'],
  ['all defects',   'viewAllDefects()'],
  ['multi-contractor', 'state.currentView="view-multiple-contractors"; state.filters={contractorIds:[1]}; render();'],
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
console.log('\n--- all four screens, on all fifteen palettes ---');
// Spiro: "make sure it is across all Theme styles."
//
// Two things per palette. First that the four screens still agree — the rule
// doing the work is a theme rule, so agreeing on one palette proves nothing
// about the other fourteen.
//
// Second, and this is the one I owed: removing `color: var(--text-primary)`
// from two of these headers handed their colour to the theme accent, on a
// band painted with --bg-secondary. That pairing had never been measured
// anywhere. An accent is chosen to sit on the page background, and nothing
// guarantees it also clears 4.5:1 on a raised band.
const lum = (rgb) => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (x, y) => { const [h, l] = [lum(x), lum(y)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };

const across = await page.evaluate(async (SCREENS) => {
  const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  // What is really behind the text: the header's own background if it paints
  // one, otherwise the first painted ancestor. A band with no colour of its
  // own would otherwise be measured against transparent and read as perfect.
  const behind = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const p = parse(bg);
      const alpha = (bg.match(/[\d.]+/g) || [])[3];
      if (p.length === 3 && (alpha === undefined || Number(alpha) > 0.95)) return p;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  const out = {};
  for (const t of F1_THEMES) {
    applyF1Theme(t.id);
    const rows = {};
    for (const [label, open] of SCREENS) {
      (new Function(open))();
      await new Promise(r => setTimeout(r, 40));
      const el = [...document.querySelectorAll('.contractor-name')].find(e => /Skylark/.test(e.textContent));
      if (!el) { rows[label] = null; continue; }
      const cs = getComputedStyle(el);
      // Type AND layout. Matching fonts on a header that is flush to the
      // screen edge on one screen and indented on a card on another is still
      // "formatting off" to anyone looking at it (Spiro 2026-11-18).
      const r = el.getBoundingClientRect();
      rows[label] = { key: [cs.fontSize, cs.fontWeight, cs.textTransform, cs.color].join('|'),
                      // Where the GLYPHS land, not where the box starts. One
                      // screen insets with the card's padding and another with
                      // its own, which is a difference nobody can see; the type
                      // being 1px out is not.
                      textLeft: Math.round(r.left + parseFloat(cs.paddingLeft)),
                      fg: parse(cs.color), bg: behind(el) };
    }
    out[t.id] = rows;
  }
  applyF1Theme('framework');
  return out;
}, SCREENS);

for (const [id, rows] of Object.entries(across)) {
  const live = Object.entries(rows).filter(([, v]) => v);
  check(`[${id}] all four screens render an address header`,
    live.length === SCREENS.length, `${live.length} of ${SCREENS.length}`);
  const keys = new Set(live.map(([, v]) => v.key));
  check(`[${id}] …and they all spell it the same way`, keys.size <= 1,
    keys.size <= 1 ? '' : JSON.stringify(Object.fromEntries(live.map(([k, v]) => [k, v.key]))));
  const lefts = live.map(([, v]) => v.textLeft);
  check(`[${id}] …and start at the same place on the screen`,
    Math.max(...lefts) - Math.min(...lefts) <= 1,
    JSON.stringify(Object.fromEntries(live.map(([k, v]) => [k, v.textLeft + 'px']))));
  // Same surface behind them too — a header on the page background next to
  // one on a card reads as a different thing however the type is set.
  const surfaces = new Set(live.map(([, v]) => v.bg.join(',')));
  check(`[${id}] …on the same surface`, surfaces.size <= 1,
    surfaces.size <= 1 ? `rgb(${live[0][1].bg.join(',')})` :
      JSON.stringify(Object.fromEntries(live.map(([k, v]) => [k, `rgb(${v.bg.join(',')})`]))));
  // Readable on whatever each screen paints behind it.
  const worst = live.reduce((acc, [k, v]) => {
    const r = Math.round(ratio(v.fg, v.bg) * 100) / 100;
    return r < acc.r ? { r, k, fg: v.fg, bg: v.bg } : acc;
  }, { r: Infinity, k: null });
  check(`[${id}] …and it is readable on all of them`, worst.r >= 4.5,
    `worst ${worst.r}:1 on "${worst.k}" (rgb(${(worst.fg||[]).join(',')}) on rgb(${(worst.bg||[]).join(',')}))`);
}

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
