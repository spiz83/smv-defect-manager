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


const ROOT = REPO, PORT = 8099;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// The real offenders from the supervisor's screenshot.
const CONTRACTORS = [
  { id: 1, name: 'AUZ PAINTING & DECORATING PTY LTD', email: 'a@b.com', phone: '0400000001', trades: ['Painter'] },
  { id: 2, name: 'IAN SCHROEDER', email: 'c@d.com', phone: '0400000002', trades: ['Glazier'] },
  { id: 3, name: 'COSTAS PLUMBING', email: 'e@f.com', phone: '0400000003', trades: ['Plumber'] },
  { id: 4, name: 'A VERY LONG SUPPLIER TRADING NAME PTY LTD PROPRIETARY LIMITED', email: 'g@h.com', phone: '0400000004', trades: ['Tiler'] },
];
let id = 1;
const defects = [];
CONTRACTORS.forEach(c => {
  for (let i = 1; i <= 3; i++) {
    defects.push({ id: id++, addressId: 1, contractorId: c.id, description: `Paint touch ups ${i}`, completed: false, status: 'open' });
  }
});
const SEED = {
  addresses: [{ id: 1, lot: '905', street: '(11) Woodlawn Rd', suburb: 'Wollert', jobNumber: '306648', active: true }],
  contractors: CONTRACTORS,
  trades: CONTRACTORS.map((c, i) => ({ id: i + 1, name: c.trades[0] })),
  defects,
  contractorBookings: {},
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
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
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const shot = n => page.screenshot({ path: `/tmp/claude-0/-home-user-smv-defect-manager/2ef86133-2a08-5486-ab00-e436549df5d8/scratchpad/${n}.png` });
const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

const heads = () => page.evaluate(() => [...document.querySelectorAll('.contractor-hdr')].map(h => {
  const name = h.querySelector('.supplier-name-txt');
  const r = h.getBoundingClientRect();
  const lineH = parseFloat(getComputedStyle(h).lineHeight) || 24;
  const kids = [...h.children];
  return {
    text: name ? name.textContent.slice(0, 22) : '(none)',
    h: Math.round(r.height),
    lines: Math.max(1, Math.round(r.height / lineH)),
    nameW: name ? Math.round(name.getBoundingClientRect().width) : 0,
    truncated: name ? name.scrollWidth > name.clientWidth + 1 : false,
    chev: !!h.querySelector('.supplier-chev'),
    overflows: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - r.right),
    sameLine: new Set(kids.map(k => Math.round((k.getBoundingClientRect().top + k.getBoundingClientRect().bottom) / 2))).size,
    visibleBtns: [...h.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).length,
  };
}));

// set a booking date so the calendar label is exercised
await page.evaluate(() => { db.setContractorBooking(1, 1, '2026-08-07'); viewDefectsForAddress(1); });
await page.waitForTimeout(300);

const before = await heads();
console.log('\nheadings:', JSON.stringify(before, null, 1));
await shot('30-supplier-headings');

check('every supplier heading is ONE line', before.every(h => h.lines === 1), before.map(h => h.lines).join(','));
check('nothing overflows the heading', before.every(h => h.overflows <= 0), before.map(h => h.overflows).join(','));
check('name + actions share one line', before.every(h => h.sameLine === 1));
check('the › survives truncation', before.every(h => h.chev));
check('collapsed heading shows 3 buttons (edit, calendar, send)',
  before.every(h => h.visibleBtns === 3), before.map(h => h.visibleBtns).join(','));

const dateLbl = await page.evaluate(() => {
  const booked = document.querySelector('.supplier-book-btn.has-booking');
  const empty = document.querySelector('.supplier-book-btn:not(.has-booking)');
  const box = booked.getBoundingClientRect();
  return {
    booked: booked.textContent.trim(),
    bookedTitle: booked.getAttribute('title'),
    bookedTap: Math.round(box.width) + 'x' + Math.round(box.height),
    empty: empty.textContent.trim(),
    emptyHasIcon: !!empty.querySelector('svg.ic'),
    bookedHasIcon: !!booked.querySelector('svg.ic'),
    onclick: (booked.getAttribute('onclick') || '').split('(')[0],
  };
});
console.log('booking button:', JSON.stringify(dateLbl));
check('booked: date only, no calendar icon', dateLbl.booked === '07/08', dateLbl.booked);
check('booked: day/month, no year', !/2026/.test(dateLbl.booked), dateLbl.booked);
check('unbooked: calendar icon stays', dateLbl.empty === '📅', dateLbl.empty);
check('tapping the date still opens the picker', dateLbl.onclick === 'openSupplierBooking', dateLbl.onclick);
check('date tap target is not tiny', parseInt(dateLbl.bookedTap) >= 40, dateLbl.bookedTap);
check('full date still in the tooltip', /07\/08\/2026/.test(dateLbl.bookedTitle || ''), dateLbl.bookedTitle);

// expand the send group
await page.click('.contractor-hdr .send-toggle');
await page.waitForTimeout(200);
const open = await heads();
console.log('after expanding send:', JSON.stringify(open[0]));
await shot('31-send-expanded');
check('send expands to 4 options (incl. copy)', open[0].visibleBtns === 7, `${open[0].visibleBtns} buttons`);
check('still one line when expanded', open.every(h => h.lines === 1), open.map(h => h.lines).join(','));
check('still nothing overflowing', open.every(h => h.overflows <= 0), open.map(h => h.overflows).join(','));
check('expanding shrank the name, did not wrap it', open[0].nameW < before[0].nameW, `${before[0].nameW} -> ${open[0].nameW}px`);

// only one expands at a time
await page.click('.contractor-hdr:nth-of-type(1) .send-toggle');  // close
await page.waitForTimeout(120);
await page.evaluate(() => document.querySelectorAll('.send-toggle')[0].click());
await page.waitForTimeout(120);
await page.evaluate(() => document.querySelectorAll('.send-toggle')[1].click());
await page.waitForTimeout(150);
check('only one send group open at a time',
  await page.evaluate(() => document.querySelectorAll('.supplier-send.open').length === 1));
// tapping it again closes
await page.evaluate(() => document.querySelectorAll('.send-toggle')[1].click());
await page.waitForTimeout(150);
check('tapping the send icon again closes it',
  await page.evaluate(() => document.querySelectorAll('.supplier-send.open').length === 0));

// the three actions still fire
const wired = await page.evaluate(() => {
  document.querySelectorAll('.send-toggle')[0].click();
  const opts = [...document.querySelectorAll('.supplier-send.open .send-opts button')];
  return opts.map(b => (b.getAttribute('onclick') || '').split('(')[0]);
});
console.log('wired to:', JSON.stringify(wired));
check('email / link / pdf / COPY all wired',
  wired.join(',') === 'emailSupplier,emailSupplier,generateContractorJobPdf,copySupplierDefects', wired.join(','));

// narrow phone
await page.setViewportSize({ width: 320, height: 700 });
await page.waitForTimeout(250);
const narrow = await heads();
await shot('32-headings-320');
check('one line at 320px too', narrow.every(h => h.lines === 1), narrow.map(h => h.lines).join(','));
check('nothing overflows at 320px', narrow.every(h => h.overflows <= 0), narrow.map(h => h.overflows).join(','));

console.log('\nerrors:', errs.length ? errs : 'none');
console.log(fail.length ? 'FAILED: ' + fail.join(' | ') : 'ALL CHECKS PASSED');
await browser.close();
server.close();
