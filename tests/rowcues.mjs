// Two bits of site feedback, 2026-09-30, both about a screen not offering what
// the screen next to it already offers:
//
//   1. A job found through the top search showed NO outstanding-defect count,
//      while the same job in My Jobs two inches below showed a red bar and a
//      number. The search-row code even carried a comment claiming it matched
//      the My Jobs row "exactly" — true of the padding and icons, false of the
//      one thing you actually read off the row.
//
//   2. Focusing "Contractor 1" on Add Defects showed an empty dropdown. You had
//      to know a company name and start typing, when most rows only ever want
//      "the painter". Bulk Import has had one-tap trade chips since 2026-08-15.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');

const ROOT = REPO, PORT = 8123;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Gelbvieh Rd mirrors the reported screenshot. Lot 410 has 3 open defects and
// one completed (which must NOT be counted); Lot 413 has none at all.
const SEED = {
  addresses: [
    { id: 1, lot: '410', street: 'Lot 410, Gelbvieh Rd', suburb: 'Clyde North', propertyNumber: '306166', active: true },
    { id: 2, lot: '413', street: 'Lot 413, 7 Gelbvieh Road', suburb: 'CLYDE NORTH', propertyNumber: '306359', active: true },
  ],
  contractors: [
    { id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' },
    { id: 2, name: 'Carpenter', isTradePlaceholder: true, isActive: true, trades: 'Carpenter' },
    { id: 3, name: 'C & E Corp Vic Pty Ltd', isTradePlaceholder: false, trades: 'Carpenter' },
  ],
  trades: [{ id: 1, name: 'Painter' }, { id: 2, name: 'Carpenter' }],
  defects: [
    { id: 1, addressId: 1, description: 'Paint runs to hallway', status: 'open' },
    { id: 2, addressId: 1, description: 'Cornice crack', status: 'open' },
    { id: 3, addressId: 1, description: 'Chipped door', status: 'pending' },
    { id: 4, addressId: 1, description: 'Already sorted', status: 'completed', completed: true },
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
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= 1. outstanding count on a SEARCH row =====================
console.log('\n--- outstanding count on search rows ---');
const searchRows = () => page.evaluate(() => {
  const inp = document.getElementById('unified-search');
  inp.value = 'gel';
  handleAutocomplete(inp, currentSearchType());
  return [...document.querySelectorAll('#unified-search-dropdown .autocomplete-item')].map(r => {
    const badge = [...r.querySelectorAll('span')].find(s => /^\d+$/.test(s.textContent.trim()));
    return {
      text: (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      badge: badge ? badge.textContent.trim() : null,
      redBar: /solid/.test(r.style.borderLeft || ''),
    };
  });
});

const rows = await searchRows();
console.log('rows:', JSON.stringify(rows));
check('the search finds both Gelbvieh jobs', rows.length === 2, String(rows.length));

const lot410 = rows.find(r => r.text.includes('410'));
const lot413 = rows.find(r => r.text.includes('413'));
check('a job with open defects shows the count on the search row',
  !!lot410 && lot410.badge === '3', lot410 ? String(lot410.badge) : 'row missing');
check('…counting open AND pending, but NOT completed',
  !!lot410 && lot410.badge === '3', 'seeded 3 outstanding + 1 completed');
check('…and gets the same red bar the My Jobs row gets',
  !!lot410 && lot410.redBar === true, lot410 ? String(lot410.redBar) : '');
check('a job with no outstanding defects shows no badge',
  !!lot413 && lot413.badge === null, lot413 ? String(lot413.badge) : 'row missing');

// The count has to obey the same toggle as the My Jobs list, or the two
// disagree about the same job on the same screen again.
const offRows = await page.evaluate(() => {
  localStorage.setItem('dm_show_defect_markers', '0');
  const inp = document.getElementById('unified-search');
  inp.value = 'gel';
  handleAutocomplete(inp, currentSearchType());
  return [...document.querySelectorAll('#unified-search-dropdown .autocomplete-item')]
    .map(r => [...r.querySelectorAll('span')].some(s => /^\d+$/.test(s.textContent.trim())));
});
check('turning defect markers off hides it here too, same as My Jobs',
  offRows.every(v => v === false), JSON.stringify(offRows));
await page.evaluate(() => localStorage.setItem('dm_show_defect_markers', '1'));

// A contractor row is not one job, so a number on it would mean something else.
const contractorRows = await page.evaluate(() => {
  setSearchType('contractor');
  const inp = document.getElementById('unified-search');
  inp.value = 'corp';
  handleAutocomplete(inp, currentSearchType());
  return [...document.querySelectorAll('#unified-search-dropdown .autocomplete-item')]
    .map(r => [...r.querySelectorAll('span')].some(s => /^\d+$/.test(s.textContent.trim())));
});
check('contractor rows get no count', contractorRows.every(v => v === false), JSON.stringify(contractorRows));
await page.evaluate(() => { setSearchType('address'); render(); });

// ================= 2. quick-trade chips on Add Defects ======================
console.log('\n--- quick-trade chips on the Add Defects contractor field ---');
const chips = await page.evaluate(() => {
  startDefectsForJob(1);
  const inp = document.getElementById('add-contractor-1-input');
  if (!inp) return { error: 'no contractor field' };
  inp.value = '';
  handleAddDefectsContractorAutocomplete(inp, 1);
  const dd = document.getElementById('add-contractor-1-dropdown');
  return {
    open: dd.classList.contains('active'),
    labels: [...dd.querySelectorAll('.bulk-quick-chip')].map(b => b.textContent.trim()),
    styled: !!document.getElementById('bulk-photo-styles'),
  };
});
console.log('chips:', JSON.stringify(chips));
check('focusing an empty Contractor field opens the dropdown at all', chips.open === true, String(chips.open));
check('…showing the nine Bulk Import trades', chips.labels && chips.labels.length === 9, JSON.stringify(chips.labels));
check('…the same list, in the same order, from the same constant',
  JSON.stringify(chips.labels) === JSON.stringify(['Painter', 'Carpenter', 'Cleaner', 'Caulker', 'Supervisor', 'Plumber', 'Electrician', 'Brick Cleaner', 'Site Cleaner']),
  JSON.stringify(chips.labels));
check('…and the chip stylesheet is present, so they are not unstyled text',
  chips.styled === true, String(chips.styled));

// Tapping a chip whose trade placeholder EXISTS must select it properly, not
// just type the word — otherwise the defect saves against nobody.
const tapped = await page.evaluate(() => {
  const dd = document.getElementById('add-contractor-1-dropdown');
  [...dd.querySelectorAll('.bulk-quick-chip')].find(b => b.textContent.trim() === 'Painter').click();
  return {
    field: document.getElementById('add-contractor-1-input').value,
    picked: (state.selectedAddDefectsContractors || {})[1],
    open: dd.classList.contains('active'),
  };
});
check('tapping a chip fills the field with the trade', tapped.field === 'Painter', tapped.field);
check('…and actually selects that trade placeholder', tapped.picked === 1, String(tapped.picked));
check('…and closes the dropdown', tapped.open === false, String(tapped.open));

// A trade with no placeholder row still has to land the word in the field —
// resolveAddDefectsContractor matches on what is on screen.
const noPlaceholder = await page.evaluate(() => {
  const inp = document.getElementById('add-contractor-2-input');
  inp.value = '';
  handleAddDefectsContractorAutocomplete(inp, 2);
  const dd = document.getElementById('add-contractor-2-dropdown');
  [...dd.querySelectorAll('.bulk-quick-chip')].find(b => b.textContent.trim() === 'Site Cleaner').click();
  return document.getElementById('add-contractor-2-input').value;
});
check('a trade with no contractor row still fills the field', noPlaceholder === 'Site Cleaner', noPlaceholder);

// Once you type, the chips must get out of the way of the real results.
const typed = await page.evaluate(() => {
  const inp = document.getElementById('add-contractor-3-input');
  inp.value = 'corp';
  handleAddDefectsContractorAutocomplete(inp, 3);
  const dd = document.getElementById('add-contractor-3-dropdown');
  return {
    chips: dd.querySelectorAll('.bulk-quick-chip').length,
    items: [...dd.querySelectorAll('.autocomplete-item')].map(i => i.textContent.trim().slice(0, 30)),
  };
});
console.log('after typing:', JSON.stringify(typed));
check('typing replaces the chips with real matches', typed.chips === 0, String(typed.chips));
check('…and the match is there', typed.items.some(t => /C & E Corp/.test(t)), JSON.stringify(typed.items));

check('no page errors', errs.length === 0, JSON.stringify(errs));

console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
