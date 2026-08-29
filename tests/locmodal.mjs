// The Location picker sits at the TOP of the screen (2026-08-15).
//
// Spiro: "One more change with the location is being edited it needs to bring
// it up top (like the first photo) so that all of the predictive options can
// be seen."
//
// The overlay centred its card with `align-items:center`, measured against the
// LAYOUT viewport — which iOS does NOT shrink for the keyboard. So a card
// centred on an 844px screen sat half behind a 336px keyboard, and the matches
// under the search box ("ent" → "Entry") were hidden by it. Exactly the failure
// Bulk Import took three builds to fix, in a different place.
//
// Two parts, and the second is what makes it hold: pinned to the top so the
// field and its matches are above the fold whatever the keyboard does, and the
// card capped to visualViewport.height so it can never extend behind it.
// Static, not adaptive — a card that repositions itself when the keyboard opens
// is the jumpiness Spiro complained about on Bulk Import.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8145;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobStatus: 'active', active: true }],
  contractors: [{ id: 1, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true }],
  trades: [{ id: 1, name: 'Carpenter' }],
  defects: [{ id: 1, addressId: 1, contractorId: 1, description: 'Adjust door margins.', status: 'open', completed: false }],
};

// The screenshot's phone: 390x844, and iOS's keyboard is ~336px of that.
const VH = 844, KEYBOARD = 336;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: VH }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true });
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
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Headless Chromium has no soft keyboard, so stand one in: shrink the visual
// viewport the way iOS does and fire the event the app listens for. Without
// this the bug is invisible — everything fits on a full-height screen, which is
// exactly how the Bulk Import version of this got shipped broken twice.
const keyboard = (up) => page.evaluate(({ up, VH, KEYBOARD }) => {
  const vv = window.visualViewport;
  if (!window.__vvPatched) {
    window.__vvH = VH;
    Object.defineProperty(vv, 'height', { get: () => window.__vvH, configurable: true });
    window.__vvPatched = true;
  }
  window.__vvH = up ? VH - KEYBOARD : VH;
  vv.dispatchEvent(new Event('resize'));
}, { up, VH, KEYBOARD });

const card = () => page.evaluate(() => {
  const c = document.getElementById('imp-card'); if (!c) return null;
  const r = c.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
           maxH: getComputedStyle(c).maxHeight };
});
const openLocPicker = async () => {
  await page.evaluate(() => { startDefectsForJob(1); });
  await page.waitForSelector('.row-loc-btn');
  await page.evaluate(() => { document.querySelector('.row-loc-btn').click(); });
  await page.waitForSelector('#loc-search', { timeout: 5000 });
};

// ===========================================================================
//  A. Top of the screen, not the middle.
// ===========================================================================
console.log('\n--- A · the card is pinned to the top ---');
{
  await openLocPicker();
  const c = await card();
  console.log('  card top', c.top, 'bottom', c.bottom, 'of a', VH, 'px screen');
  check('the card starts at the top of the screen', c.top <= 40, `top ${c.top}`);
  check('…not centred half way down', c.top < VH / 4, `top ${c.top}, screen ${VH}`);
  check('…and clear of the notch', c.top >= 8, `top ${c.top}`);

  const searchTop = await page.evaluate(() => Math.round(document.getElementById('loc-search').getBoundingClientRect().top));
  console.log('  search box at y =', searchTop);
  check('the search box is near the top, where the thumb and the eye already are',
    searchTop < 150, String(searchTop));
}

// ===========================================================================
//  B. With the keyboard up, the matches are still visible.
// ===========================================================================
console.log('\n--- B · with the keyboard up ---');
{
  await keyboard(true);
  await page.waitForTimeout(60);
  const c = await card();
  const visible = VH - KEYBOARD;
  console.log(`  keyboard up: visible area is ${visible}px, card is ${c.top}..${c.bottom}`);
  check('the card does not extend behind the keyboard', c.bottom <= visible + 1, `bottom ${c.bottom} vs ${visible}`);
  check('…because its max-height follows the VISIBLE viewport, not 90vh',
    parseFloat(c.maxH) < VH * 0.9, `${c.maxH} (90vh would be ${VH * 0.9})`);

  // The actual complaint: type, and see the match.
  await page.evaluate(() => { const i = document.getElementById('loc-search'); i.focus(); i.value = 'ent'; i.dispatchEvent(new Event('input', { bubbles: true })); filterLocOpts('ent'); });
  await page.waitForTimeout(60);
  const hits = await page.evaluate(() => [...document.querySelectorAll('#imp-ov .loc-opt')]
    .filter(b => b.style.display !== 'none')
    .map(b => ({ text: b.textContent.trim(), bottom: Math.round(b.getBoundingClientRect().bottom) })));
  console.log('  matches for "ent":', JSON.stringify(hits));
  check('typing narrows to the matching location', hits.length >= 1 && hits.some(h => /entry/i.test(h.text)), JSON.stringify(hits.map(h => h.text)));
  check('…and every match sits above the keyboard, which is the whole point',
    hits.length > 0 && hits.every(h => h.bottom <= visible), JSON.stringify(hits));

  // A card that moves when the keyboard opens is the jumpiness from Bulk Import.
  const withKb = (await card()).top;
  await keyboard(false);
  await page.waitForTimeout(60);
  const without = (await card()).top;
  check('the card does not jump up or down when the keyboard opens or closes',
    withKb === without, `${withKb} vs ${without}`);
}

// ===========================================================================
//  C. The other Location picker, and the modals that share the overlay.
// ===========================================================================
console.log('\n--- C · the same everywhere the overlay is used ---');
{
  // The OTHER Location picker — the one on a saved defect, not an entry row.
  await page.evaluate(() => { impClose(); state.currentView = 'view-all-defects'; render(); openLocationPicker(1); });
  await page.waitForSelector('#loc-search', { timeout: 5000 });
  const l = await card();
  check('the defect-list Location picker is pinned to the top as well', l.top <= 40, `top ${l.top}`);
  await keyboard(true);
  await page.waitForTimeout(60);
  check('…and capped to the visible viewport with the keyboard up',
    (await card()).bottom <= VH - KEYBOARD + 1, `bottom ${(await card()).bottom} vs ${VH - KEYBOARD}`);
  await keyboard(false);
  await page.evaluate(() => impClose());

  // Edit defect shares the overlay and is the same shape: a text field with a
  // list under it. It gets the fix for free, and must not have been broken by it.
  await page.evaluate(() => { state.currentView = 'view-all-defects'; render(); openDefectEdit(1); });
  await page.waitForSelector('#imp-card', { timeout: 5000 });
  const e = await card();
  check('Edit defect is pinned to the top too', e.top <= 40, `top ${e.top}`);
  await keyboard(true);
  await page.waitForTimeout(60);
  const e2 = await card();
  check('…and is capped to the visible viewport with the keyboard up',
    e2.bottom <= VH - KEYBOARD + 1, `bottom ${e2.bottom} vs ${VH - KEYBOARD}`);
  await keyboard(false);
  await page.evaluate(() => impClose());
}

// ===========================================================================
//  D. Nothing lost: it still closes, and a long list still scrolls.
// ===========================================================================
console.log('\n--- D · still behaves like a modal ---');
{
  await openLocPicker();
  check('the full location list is there', await page.evaluate(() => document.querySelectorAll('#imp-ov .loc-opt').length > 5),
    String(await page.evaluate(() => document.querySelectorAll('#imp-ov .loc-opt').length)));
  const scrolls = await page.evaluate(() => {
    const b = document.getElementById('imp-body');
    return getComputedStyle(b).overflow === 'auto' || getComputedStyle(b).overflowY === 'auto';
  });
  check('…and the body still scrolls, so a capped card never hides options', scrolls);
  await page.evaluate(() => document.getElementById('imp-close').click());
  check('✕ still closes it', await page.evaluate(() => !document.getElementById('imp-ov')));

  await openLocPicker();
  await page.evaluate(() => { const ov = document.getElementById('imp-ov'); ov.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  check('tapping the backdrop still closes it', await page.evaluate(() => !document.getElementById('imp-ov')));

  // And picking one still works.
  await openLocPicker();
  const picked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#imp-ov .loc-opt')].find(x => x.textContent.trim() && !/none/i.test(x.textContent));
    const label = b.textContent.trim();
    b.click();
    const pin = document.querySelector('.row-loc-btn');
    return {
      label, closed: !document.getElementById('imp-ov'),
      stored: pin.closest('.defect-input-row')._location,
      lit: pin.classList.contains('has-loc'),
      title: pin.title,
      // The pin carries NO text since 2026-08-16 — colour is the whole signal.
      text: pin.textContent.trim(),
      opacity: getComputedStyle(pin).opacity,
    };
  });
  check('picking a location still sets it on the row and closes',
    picked.closed && picked.stored === picked.label, JSON.stringify(picked));
  check('…and the pin lights up rather than spelling the location out',
    picked.lit && picked.text === '\u{1F4CD}' && !picked.text.includes(picked.label),
    JSON.stringify(picked));
  check('…with the location still on the title, for a long-press',
    picked.title.includes(picked.label), picked.title);
  // An empty pin must look different from a set one, or the colour says nothing.
  const emptyPin = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.row-loc-btn')].find(b => !b.classList.contains('has-loc'));
    return p ? getComputedStyle(p).opacity : null;
  });
  check('…and a pin with no location is visibly fainter',
    emptyPin !== null && parseFloat(emptyPin) < parseFloat(picked.opacity) - 0.15,
    `set ${picked.opacity} vs empty ${emptyPin}`);
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
