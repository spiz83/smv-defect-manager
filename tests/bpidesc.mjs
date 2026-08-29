// BPI defect-wording autocomplete (2026-08-15).
//
// Suggests real defect wordings from CH Tracker's BPI training data as a
// supervisor types, narrowed to the trade of whichever contractor is selected,
// on BOTH the regular Add Defects screen and Bulk Import photo tagging.
//
// The corpus is CURATED_DEFECT_WORDINGS in index.html, which ships EMPTY.
// v1 sourced it from bpi_training_examples and had to be withdrawn: on real
// data every observation carries its location baked into the text ("Laundry
// Adjust door rattle"), which this app already has a separate Location field
// for. Section G pins the shipped-empty state; every other section seeds the
// list so the engine stays covered and a curated list can be dropped in with
// confidence.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8134;
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
  contractors: [
    // A trade placeholder (name IS the trade) and a real company categorised
    // under a trade — the two shapes bpiTradeForContractorName has to handle.
    { id: 1, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    { id: 2, name: 'Caulker', trades: 'Caulker', tradeIds: [], isTradePlaceholder: true, isActive: true },
    { id: 3, name: 'G&C Caulking Pty Ltd', trades: 'Caulker, Waterproofing', tradeIds: [] },
    { id: 4, name: 'NO TRADE MOB', trades: 'No Trade Assigned', tradeIds: [] },
  ],
  trades: [{ id: 1, name: 'Carpenter' }, { id: 2, name: 'Caulker' }],
  defects: [],
};

// Real wordings, taken from the Training tab in the site's own screenshot.
const CATALOGUE = [
  { text: 'Left Elevation Caulk the gap to barge eave and fascia.', trade: 'Caulker', n: 12 },
  { text: 'Caulk the gap to skirting throughout.', trade: 'Caulker', n: 7 },
  { text: 'Caulk around the bath hob.', trade: 'Caulker', n: 3 },
  { text: 'Garage Seal the gap to brickwork and plaster, both sides of garage opening. Quad to sides', trade: 'Carpenter', n: 9 },
  { text: 'Adjust the door to close correctly.', trade: 'Carpenter', n: 6 },
  { text: 'Margin to top of door requires adjustment.', trade: 'Carpenter', n: 4 },
  { text: 'Replace damaged architrave.', trade: 'Carpenter', n: 2 },
  { text: 'Garage External PA door The bottom of external door is water damaged and gas yellowed.', trade: 'Painter', n: 5 },
  { text: 'Kitchen Small hole in grout under splashback GPO.', trade: 'Tiler', n: 3 },
];

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
await page.evaluate((cat) => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  // Keep the REAL shipped list before swapping in the fixture — section G
  // checks the curated data itself, and every section before it overwrites
  // this variable, so without stashing it there is nothing left to check.
  window.__shippedWordings = CURATED_DEFECT_WORDINGS.slice();
  // Seed the curated list the engine actually reads.
  CURATED_DEFECT_WORDINGS = cat;
  render();
}, CATALOGUE);

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };
const texts = (rows) => rows.map(r => r.text);

// ===========================================================================
//  A. The ranking engine, directly.
// ===========================================================================
console.log('\n--- A · suggestions narrow by trade, then by each word typed ---');
{
  const r = await page.evaluate(() => ({
    carpenterNoQuery: bpiDefectSuggestions('Carpenter', '', 20).map(x => x.text),
    caulkerNoQuery: bpiDefectSuggestions('Caulker', '', 20).map(x => x.text),
    nothingAtAll: bpiDefectSuggestions('', '', 20).map(x => x.text),
    caulk1: bpiDefectSuggestions('Caulker', 'caulk', 20).map(x => x.text),
    caulk2: bpiDefectSuggestions('Caulker', 'caulk gap', 20).map(x => x.text),
    caulk3: bpiDefectSuggestions('Caulker', 'caulk gap skirt', 20).map(x => x.text),
    noMatch: bpiDefectSuggestions('Caulker', 'zzzz', 20).map(x => x.text),
  }));
  console.log('  Carpenter, nothing typed:', JSON.stringify(r.carpenterNoQuery));
  check('picking a trade alone already suggests that trade\'s wordings',
    r.carpenterNoQuery.length === 4 && r.carpenterNoQuery.every(t => /door|architrave|garage/i.test(t)),
    JSON.stringify(r.carpenterNoQuery));
  check('…and they come most-used first (the "regular BPI items")',
    r.carpenterNoQuery[0] === 'Garage Seal the gap to brickwork and plaster, both sides of garage opening. Quad to sides',
    r.carpenterNoQuery[0]);
  check('a different trade gives entirely different wordings',
    r.caulkerNoQuery.length === 3 && r.caulkerNoQuery.every(t => /caulk/i.test(t)),
    JSON.stringify(r.caulkerNoQuery));
  check('no trade and nothing typed suggests nothing (no noise before there is a signal)',
    r.nothingAtAll.length === 0, JSON.stringify(r.nothingAtAll));

  // The core behaviour asked for: each extra word can only shrink the list.
  console.log(`  "caulk" ${r.caulk1.length} → "caulk gap" ${r.caulk2.length} → "caulk gap skirt" ${r.caulk3.length}`);
  check('every extra word narrows the list, never widens it',
    r.caulk1.length >= r.caulk2.length && r.caulk2.length >= r.caulk3.length && r.caulk3.length < r.caulk1.length,
    `${r.caulk1.length}/${r.caulk2.length}/${r.caulk3.length}`);
  check('…down to the one wording that matches all three words',
    r.caulk3.length === 1 && /skirting/i.test(r.caulk3[0]), JSON.stringify(r.caulk3));
  check('words are prefix-matched, so partial typing works ("skirt" → "skirting")',
    /skirting/i.test(r.caulk3[0] || ''), JSON.stringify(r.caulk3));
  check('a query matching nothing suggests nothing rather than falling back to noise',
    r.noMatch.length === 0, JSON.stringify(r.noMatch));
}

// ===========================================================================
//  B. Resolving the trade from what is in the supplier box — both shapes.
// ===========================================================================
console.log('\n--- B · trade resolution: placeholder vs real supplier ---');
{
  const r = await page.evaluate(() => ({
    placeholder: bpiTradeForContractorName('Carpenter'),
    realCompany: bpiTradeForContractorName('G&C Caulking Pty Ltd'),
    noTrade: bpiTradeForContractorName('NO TRADE MOB'),
    unknown: bpiTradeForContractorName('Some Company Never Heard Of'),
    empty: bpiTradeForContractorName(''),
    caseInsensitive: bpiTradeForContractorName('  carpenter '),
  }));
  console.log('  resolved:', JSON.stringify(r));
  check('a trade placeholder resolves to itself', r.placeholder === 'Carpenter', r.placeholder);
  check('a real supplier resolves to its categorised trade', r.realCompany === 'Caulker', r.realCompany);
  check('"No Trade Assigned" resolves to no trade, not to that literal string', r.noTrade === '', JSON.stringify(r.noTrade));
  check('an unknown name resolves to no trade', r.unknown === '', JSON.stringify(r.unknown));
  check('an empty box resolves to no trade', r.empty === '', JSON.stringify(r.empty));
  check('matching ignores case and stray spaces', r.caseInsensitive === 'Carpenter', r.caseInsensitive);

  // A real supplier must get its trade's wordings, same as the placeholder.
  const viaCompany = await page.evaluate(() =>
    bpiDefectSuggestions(bpiTradeForContractorName('G&C Caulking Pty Ltd'), 'caulk', 20).map(x => x.text));
  check('picking a real COMPANY suggests its trade\'s wordings, not nothing',
    viaCompany.length === 3 && viaCompany.every(t => /caulk/i.test(t)), JSON.stringify(viaCompany));
}

// ===========================================================================
//  C. Typing stays free. This must never become a picker.
// ===========================================================================
console.log('\n--- C · free typing is never blocked ---');
{
  const r = await page.evaluate(() => {
    const hitsForNovel = bpiDefectSuggestions('Carpenter', 'completely novel defect wording', 20);
    return { hits: hitsForNovel.length };
  });
  check('a wording that exists nowhere in the catalogue simply offers nothing',
    r.hits === 0, String(r.hits));
  // …and the field still accepts it (proven end-to-end in section D/E saves).
}

// ===========================================================================
//  D. The regular Add Defects screen.
// ===========================================================================
console.log('\n--- D · Add Defects screen ---');
{
  await page.evaluate(() => startDefectsForJob(1));
  await page.waitForTimeout(300);
  // Pick the supplier for block 1 the way a supervisor does.
  await page.evaluate(() => {
    const inp = document.getElementById('add-contractor-1-input');
    inp.value = 'Carpenter';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const item = document.querySelector('#add-contractor-1-dropdown .autocomplete-item');
    if (item) item.click();
  });
  await page.waitForTimeout(150);

  await page.click('.add-defect-1');
  await page.waitForTimeout(200);
  const onFocus = await page.evaluate(() => {
    const p = document.getElementById('bpi-desc-pop');
    return { shown: p && p.style.display === 'block', items: p ? [...p.querySelectorAll('[data-d]')].map(e => e.textContent.trim()) : [] };
  });
  console.log('  on focus with Carpenter picked:', JSON.stringify(onFocus.items.slice(0, 3)));
  check('focusing a defect row suggests the picked supplier\'s trade wordings', onFocus.shown, JSON.stringify(onFocus));
  check('…and they are Carpenter wordings, not another trade\'s',
    onFocus.items.length === 4 && onFocus.items.every(t => /door|architrave|garage/i.test(t)), JSON.stringify(onFocus.items));

  await page.fill('.add-defect-1', 'door');
  await page.waitForTimeout(150);
  const typed = await page.evaluate(() => [...document.querySelectorAll('#bpi-desc-pop [data-d]')].map(e => e.textContent.trim()));
  console.log('  after typing "door":', JSON.stringify(typed));
  check('typing narrows the list', typed.length > 0 && typed.length < onFocus.items.length, `${onFocus.items.length} → ${typed.length}`);
  check('…to wordings containing that word', typed.every(t => /door/i.test(t)), JSON.stringify(typed));

  // Tapping one fills the field, and it is still editable afterwards.
  await page.evaluate(() => {
    const el = document.querySelector('#bpi-desc-pop [data-d]');
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await page.waitForTimeout(120);
  const picked = await page.inputValue('.add-defect-1');
  check('tapping a suggestion fills the defect row', /door/i.test(picked) && picked.length > 10, picked);
  check('…and the popup closes', await page.evaluate(() => document.getElementById('bpi-desc-pop').style.display === 'none'));

  await page.fill('.add-defect-1', picked + ' — plus my own note');
  check('the filled text is still freely editable afterwards',
    (await page.inputValue('.add-defect-1')).includes('plus my own note'));

  // And it saves for real, through the untouched normal save path.
  await page.evaluate(() => { saveAddDefectsAddress(); });
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => db.data.defects.map(d => d.description));
  console.log('  saved:', JSON.stringify(saved));
  check('a suggestion-filled defect saves like any other', saved.some(d => /plus my own note/.test(d)), JSON.stringify(saved));
}

// ===========================================================================
//  E. Bulk Import photo tagging — the same feature, the other screen.
// ===========================================================================
console.log('\n--- E · Bulk Import photo tagging ---');
{
  await page.evaluate(() => {
    db.data.defects = []; db.save();
    const files = [new File(['x'], 'p1.jpg', { type: 'image/jpeg' })];
    bulkPhotoState = { addressId: 1, files, idx: 0 };
    renderBulkPhotoStep();
  });
  await page.waitForSelector('#bulk-photo-ov', { timeout: 10000 });

  // No supplier yet: typing alone should still find wordings across trades.
  await page.click('#bulk-desc');
  await page.fill('#bulk-desc', 'caulk');
  await page.waitForTimeout(150);
  const noSup = await page.evaluate(() => [...document.querySelectorAll('#bulk-desc-list [data-d]')].map(e => e.textContent.trim()));
  console.log('  "caulk", no supplier picked:', JSON.stringify(noSup));
  check('with no supplier chosen, the typed words alone still suggest',
    noSup.length > 0 && noSup.every(t => /caulk/i.test(t)), JSON.stringify(noSup));

  // Now set the supplier and confirm it narrows to that trade.
  await page.evaluate(() => { document.getElementById('bulk-sup').value = 'Carpenter'; });
  await page.fill('#bulk-desc', '');
  await page.click('#bulk-desc');
  await page.waitForTimeout(150);
  const withSup = await page.evaluate(() => [...document.querySelectorAll('#bulk-desc-list [data-d]')].map(e => e.textContent.trim()));
  console.log('  Carpenter picked, nothing typed:', JSON.stringify(withSup.slice(0, 2)));
  check('choosing the supplier narrows Bulk Import suggestions to its trade',
    withSup.length === 4 && withSup.every(t => /door|architrave|garage/i.test(t)), JSON.stringify(withSup));

  await page.fill('#bulk-desc', 'margin');
  await page.waitForTimeout(150);
  const narrowed = await page.evaluate(() => [...document.querySelectorAll('#bulk-desc-list [data-d]')].map(e => e.textContent.trim()));
  check('typing narrows it further', narrowed.length === 1 && /Margin/i.test(narrowed[0]), JSON.stringify(narrowed));

  await page.evaluate(() => { document.querySelector('#bulk-desc-list [data-d]').click(); });
  await page.waitForTimeout(120);
  check('tapping fills the Bulk Import description',
    (await page.inputValue('#bulk-desc')) === 'Margin to top of door requires adjustment.',
    await page.inputValue('#bulk-desc'));

  await page.fill('#bulk-loc', 'Master Bedroom');
  await page.click('button:has-text("Save & Finish")');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => db.data.defects.map(d => ({ d: d.description, c: d.contractorId })));
  console.log('  saved:', JSON.stringify(saved));
  check('it saves through the normal Bulk Import path, assigned to the supplier',
    saved.length === 1 && /Margin to top of door/.test(saved[0].d) && saved[0].c === 1,
    JSON.stringify(saved));
}

// ===========================================================================
//  F. An empty list must be a silent no-op, not a broken description field.
//     This is the state the app SHIPS in, so it is the state that matters most.
// ===========================================================================
console.log('\n--- F · degrades silently with an empty list ---');
{
  const r = await page.evaluate(() => {
    const real = CURATED_DEFECT_WORDINGS;
    CURATED_DEFECT_WORDINGS = [];
    const a = bpiDefectSuggestions('Carpenter', 'door', 10).length;
    const b = bpiDefectSuggestions('', '', 10).length;
    CURATED_DEFECT_WORDINGS = real;
    return { withTrade: a, withNothing: b };
  });
  check('an empty list suggests nothing and does not throw', r.withTrade === 0 && r.withNothing === 0, JSON.stringify(r));

  await page.evaluate(() => { startDefectsForJob(1); });
  await page.waitForTimeout(250);
  await page.evaluate(() => { window.__realList = CURATED_DEFECT_WORDINGS; CURATED_DEFECT_WORDINGS = []; });
  await page.click('.add-defect-1');
  await page.fill('.add-defect-1', 'Typed with no suggestions available');
  await page.waitForTimeout(150);
  check('typing works normally with an empty list',
    (await page.inputValue('.add-defect-1')) === 'Typed with no suggestions available');
  check('…and no empty popup is left on screen',
    await page.evaluate(() => { const p = document.getElementById('bpi-desc-pop'); return !p || p.style.display === 'none'; }));
  await page.evaluate(() => { CURATED_DEFECT_WORDINGS = window.__realList; });
}

// ===========================================================================
//  G. THE SHIPPED LIST. Guards the curated wordings themselves, not the
//     engine: the list is data a human edits, so the checks here are the
//     rules that data has to obey to actually work.
// ===========================================================================
console.log('\n--- G · the shipped curated list ---');
{
  const shipped = await page.evaluate(() => window.__shippedWordings.map(w => ({ text: w.text, trade: w.trade })));
  check('the curated list ships populated', shipped.length === 62, shipped.length + ' items');

  const byTrade = {};
  shipped.forEach(w => { byTrade[w.trade || '(none)'] = (byTrade[w.trade || '(none)'] || 0) + 1; });
  console.log('  by trade:', JSON.stringify(byTrade));
  check('every item has wording text', shipped.every(w => w.text && w.text.trim().length > 5),
    JSON.stringify(shipped.filter(w => !w.text || w.text.trim().length <= 5)));

  // THE RULE THAT KILLED v1: no location baked into the wording, because the
  // app has a separate Location field and repeating the room duplicates it.
  // Catches a room name used as a LEADING word, which is the shape the BPI
  // observations had ("Laundry Adjust door rattle"). Mid-sentence mentions
  // ("Remove paint from garage floor") are describing the defect, not
  // labelling where it is, and are fine.
  const ROOMS = ['laundry', 'bedroom', 'bed', 'kitchen', 'bathroom', 'ensuite', 'garage',
                 'hallway', 'entry', 'lounge', 'living', 'wc', 'toilet', 'robe', 'pantry',
                 'alfresco', 'porch', 'stairs', 'elevation'];
  const leadingRoom = shipped.filter(w => ROOMS.includes(String(w.text).trim().split(/[\s,]+/)[0].toLowerCase()));
  check('no wording starts with a room name (the mistake that withdrew v1)',
    leadingRoom.length === 0, JSON.stringify(leadingRoom.map(w => w.text)));

  // A trade that does not match a contractor/trade-placeholder name EXACTLY
  // narrows to nothing, so the item would be unreachable by picking a
  // supplier. Blank is allowed and meaningful: findable by typing only.
  const KNOWN = ['Painter', 'Carpenter', 'Caulker', 'Cleaner', 'Brick Cleaner', 'Bricklayer',
                 'Plumber', 'Electrician', 'Tiler', 'Renderer', 'Landscaper', 'Supervisor'];
  const oddTrades = [...new Set(shipped.map(w => w.trade).filter(t => !KNOWN.includes(t)))];
  check('every trade is one of the agreed names', oddTrades.length === 0, JSON.stringify(oddTrades));

  // Spiro's rule (2026-08-15): anything not owned by a specific trade goes to
  // Supervisor. So NOTHING should be blank — a blank trade now means an item
  // slipped through unassigned rather than being a deliberate choice.
  check('no item is left without a trade — unassigned means Supervisor now',
    (byTrade['(none)'] || 0) === 0, String(byTrade['(none)'] || 0));
  check('the four formerly-unassigned items are Supervisor',
    (byTrade['Supervisor'] || 0) === 4, String(byTrade['Supervisor'] || 0));

  // Duplicates would show twice in one dropdown.
  const seen = new Set(), dupes = [];
  shipped.forEach(w => { const k = (w.trade + '|' + w.text).toLowerCase(); if (seen.has(k)) dupes.push(w.text); seen.add(k); });
  check('no duplicate wording within a trade', dupes.length === 0, JSON.stringify(dupes));

  // End to end against the REAL shipped list, not the seeded fixture.
  const real = await page.evaluate(() => {
    const seeded = CURATED_DEFECT_WORDINGS;
    CURATED_DEFECT_WORDINGS = window.__shippedWordings;      // run against the REAL list
    const out = { carpenter: bpiDefectSuggestions('Carpenter', 'door', 20).map(x => x.text),
                  supervisor: bpiDefectSuggestions('Supervisor', '', 20).map(x => x.text) };
    CURATED_DEFECT_WORDINGS = seeded;
    return out;
  });
  console.log('  real list, Carpenter + "door":', JSON.stringify(real.carpenter));
  check('the real shipped list suggests sensibly for a picked trade',
    real.carpenter.length >= 3 && real.carpenter.every(t => /door/i.test(t)), JSON.stringify(real.carpenter));
  console.log('  real list, Supervisor:', JSON.stringify(real.supervisor));
  check('…and picking Supervisor surfaces the four catch-all items',
    real.supervisor.length === 4 && real.supervisor.some(t => /vermin proof/i.test(t)),
    JSON.stringify(real.supervisor));
}

// ===========================================================================
//  H. The list is IN THE FLOW, directly under the row. Nothing to chase.
// ===========================================================================
// Spiro, 2026-08-15: "As I scroll up and down the screen, it just moves around
// and it's really cra[p]."
//
// It was position:fixed, so it had to be re-placed on every scroll event, and
// on a phone those arrive late and in bursts during momentum scrolling — the
// list lags the field and snaps. Two builds of placement maths each fixed a
// symptom of chasing without stopping the chase. It is now one element moved
// around the DOM: the browser keeps it under the field because it IS under the
// field. These checks are about that, not about coordinates.
console.log('\n--- H · the list sits in the flow, under the row ---');
{
  await page.evaluate(() => { state.currentView = 'home'; render(); startDefectsForJob(1); });
  await page.waitForSelector('.add-defect-1');

  const type = (idx) => page.evaluate((idx) => {
    const inp = [...document.querySelectorAll('input[class*="add-defect-"]')][idx];
    inp.focus(); inp.value = 'c';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const pop = document.getElementById('bpi-desc-pop');
    const pr = pop.getBoundingClientRect(), ir = inp.getBoundingClientRect();
    return {
      shown: pop.style.display === 'block',
      // The thing that makes it stable: no coordinates of our own.
      position: getComputedStyle(pop).position,
      hasInlineTop: !!pop.style.top, hasInlineLeft: !!pop.style.left,
      // …and it is the element immediately after the row being typed in.
      rightAfterRow: pop.previousElementSibling === (inp.closest('.defect-input-row') || inp),
      insideSameBlock: pop.parentElement === (inp.closest('.defect-input-row') || inp).parentElement,
      popTop: Math.round(pr.top), popBottom: Math.round(pr.bottom),
      inputTop: Math.round(ir.top), inputBottom: Math.round(ir.bottom),
      height: Math.round(pr.height), rows: pop.querySelectorAll('[data-d]').length,
    };
  }, idx);

  const first = await type(0);
  check('the list shows under the first row', first.shown && first.popTop >= first.inputBottom,
    `pop ${first.popTop}, field ends ${first.inputBottom}`);
  check('…in NORMAL FLOW, not fixed or absolute', first.position === 'static', first.position);
  check('…with no coordinates of its own to go stale',
    !first.hasInlineTop && !first.hasInlineLeft, `top:${first.hasInlineTop} left:${first.hasInlineLeft}`);
  check('…as the very next element after the row', first.rightAfterRow);
  check('…in the same supplier block, so it cannot be orphaned', first.insideSameBlock);

  // Scrolling is where it used to come apart. In the flow there is nothing to
  // re-place: the offset from the field is fixed by the document, not recomputed.
  const gapAt = async (y) => {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(30);
    return page.evaluate(() => {
      const pop = document.getElementById('bpi-desc-pop');
      const inp = pop._input;
      // A hidden element measures as all zeros, which would read as a wild gap
      // rather than as "the list disappeared" — say which it is.
      if (pop.style.display !== 'block') return 'HIDDEN';
      return Math.round(pop.getBoundingClientRect().top - inp.getBoundingClientRect().bottom);
    });
  };
  const gaps = [];
  for (const y of [0, 60, 150, 320, 150, 0]) gaps.push(await gapAt(y));
  console.log('  gap between field and list at scroll 0/60/150/320/150/0:', JSON.stringify(gaps));
  check('the list stays up throughout the scroll', gaps.every(g => g !== 'HIDDEN'), JSON.stringify(gaps));
  check('the list keeps EXACTLY the same gap under the field at every scroll position',
    gaps.every(g => g === gaps[0]), JSON.stringify(gaps));
  await page.evaluate(() => window.scrollTo(0, 0));

  // Every row behaves the same — "moving around" was rows disagreeing.
  const all = [];
  const n = await page.evaluate(() => document.querySelectorAll('input[class*="add-defect-"]').length);
  for (let i = 0; i < n; i++) {
    const r = await type(i);
    if (r.shown) all.push(r.rightAfterRow && r.popTop >= r.inputBottom);
  }
  console.log(`  ${all.filter(Boolean).length}/${all.length} rows anchor the list under themselves`);
  check('EVERY row anchors it the same way', all.length > 0 && all.every(Boolean),
    `${all.filter(Boolean).length}/${all.length}`);

  // It must stay a list, not take the screen — that was the other complaint.
  const last = await type(0);
  console.log(`  ${last.rows} suggestions, ${last.height}px tall`);
  check('it stays a compact list rather than filling the screen', last.height <= 240, `${last.height}px`);
  check('…and still offers a useful number of wordings', last.rows >= 4, String(last.rows));
  check('…scrolling inside itself when there are more',
    await page.evaluate(() => getComputedStyle(document.getElementById('bpi-desc-pop')).overflowY === 'auto'));

  // Picking still works now that it lives somewhere else in the DOM.
  const picked = await page.evaluate(() => {
    const pop = document.getElementById('bpi-desc-pop');
    const row = pop.querySelector('[data-d]');
    const want = row.textContent.trim();
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    return { want, got: pop._input.value, hidden: pop.style.display === 'none' };
  });
  check('tapping a suggestion still fills the field and closes the list',
    picked.got === picked.want && picked.hidden, JSON.stringify(picked));
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
