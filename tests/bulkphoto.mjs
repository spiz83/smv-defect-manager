// "It's jumpy every time I press a field" — site feedback on Bulk Import
// (2026-08-15). Three real mechanisms were fighting for space in a fixed
// overlay on a phone: an unsolicited auto-focus on every photo, a photo tall
// enough that the fields don't fit above the keyboard, and position:fixed
// clipping under iOS's keyboard-open viewport quirk. This suite can't drive a
// real iOS keyboard from headless Chromium, so it proves the three mechanisms
// this fix installed instead: no auto-focus, the photo collapses/expands with
// field focus, and the overlay tracks visualViewport when available.
//
// Also covers the same-day follow-up: one-tap generic trade chips on the
// Supplier/Trade field (Painter, Carpenter, Cleaner, Caulker, Supervisor,
// Plumber, Electrician, Brick Cleaner, Site Cleaner), for photos that need a
// trade logged fast rather than a specific company searched and picked.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const OUT = join(__here, 'artifacts');
fs.mkdirSync(OUT, { recursive: true });

const ROOT = REPO, PORT = 8123;
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
    { id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber', tradeIds: [1] },
    // A real trade-placeholder, named to EXACTLY match one of the quick-pick
    // chips — proves a chip tap can resolve to a genuine contractorId via the
    // same exact-name match saveBulkPhoto already does for typed text.
    // "Electrician" (another chip) deliberately has NO matching contractor,
    // to prove the honest fallback: no match still saves, just unassigned.
    { id: 2, name: 'Painter', trades: 'Painter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    // Same "C" scenario as the regular Add Defects screen's own trade-first
    // fix, so typed-search ranking here can be checked against real
    // companies AND real trade placeholders that both match one letter.
    { id: 3, name: 'C & E Corp Vic Pty Ltd', trades: 'No Trade Assigned', tradeIds: [] },
    { id: 4, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    { id: 5, name: 'Caulker', trades: 'Caulker', tradeIds: [], isTradePlaceholder: true, isActive: true },
  ],
  trades: [{ id: 1, name: 'Plumber' }],
  defects: [],
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

// ===========================================================================
//  Runs FIRST, before anything else touches the bulk-import overlay: the
//  page's _bulkVvBound flag is a private `let`, not exposed on window (unlike
//  a `function` declaration, a top-level `let` does NOT become a window
//  property in a classic script), so there is no way to reset it from test
//  code later — this is the only point in the suite where it is genuinely at
//  its true starting value of false. Proves the listener registers exactly
//  once on the FIRST render.
// ===========================================================================
console.log('\n=== visualViewport: the very first render registers the listener once ===');
{
  const result = await page.evaluate(() => {
    if (!window.visualViewport) return null;
    let resizeCalls = 0;
    const origAdd = window.visualViewport.addEventListener.bind(window.visualViewport);
    window.visualViewport.addEventListener = (type, fn) => { if (type === 'resize') resizeCalls++; return origAdd(type, fn); };
    const files = [new File(['x'], 'a.jpg', { type: 'image/jpeg' })];
    bulkPhotoState = { addressId: 1, files, idx: 0 };
    renderBulkPhotoStep();   // 1st render ever in this page life
    renderBulkPhotoStep();   // re-render (e.g. Skip) must NOT register again
    renderBulkPhotoStep();   // neither must a third
    window.visualViewport.addEventListener = origAdd;
    document.getElementById('bulk-photo-ov') && document.getElementById('bulk-photo-ov').remove();
    bulkPhotoState = null;
    return resizeCalls;
  });
  if (result === null) {
    console.log('  (no window.visualViewport in this Chromium build — mechanism untestable here, not a failure)');
  } else {
    check('three renders in one fresh page life register the resize listener exactly once', result === 1, result + ' registration(s)');
  }
}

// Enter the tagging screen the way the real flow does after its file picker,
// without driving a native OS file dialog: seed bulkPhotoState directly and
// call the same render function the picker's onchange calls. No
// window.CloudPhotos defined, so the annotate-photo step is skipped, landing
// straight on the fields — same as the picker path once a photo is edited.
async function openBulkStep(n = 2) {
  await page.evaluate((n) => {
    const files = Array.from({ length: n }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' }));
    bulkPhotoState = { addressId: 1, files, idx: 0 };
    renderBulkPhotoStep();
  }, n);
  await page.waitForSelector('#bulk-photo-ov', { timeout: 10000 });
}

// getComputedStyle resolves units to px, so 38vh at this 820px-tall viewport
// reads back as "311.6px", never the literal string "38vh". Compare numbers.
const FULL_PX = 820 * 0.38, THUMB_PX = 72, EPS = 1;
const photoMaxHeightPx = async () => {
  const v = await page.evaluate(() => {
    const img = document.querySelector('#bulk-photo-ov .bulk-photo-wrap img');
    return img ? getComputedStyle(img).maxHeight : null;
  });
  return v == null ? null : parseFloat(v);
};
const isFull = (px) => px != null && Math.abs(px - FULL_PX) < EPS;
const isThumb = (px) => px != null && Math.abs(px - THUMB_PX) < EPS;
const hasTypingClass = () => page.evaluate(() => !!document.getElementById('bulk-photo-ov')?.classList.contains('bulk-typing'));

// ===========================================================================
//  A. No unsolicited auto-focus. This was the single most jarring jump: the
//     keyboard used to pop up 60ms after every photo loaded, before the
//     supervisor had looked at it.
// ===========================================================================
console.log('\n=== no auto-focus on a fresh photo ===');
{
  await openBulkStep();
  await page.waitForTimeout(300);   // longer than the old 60ms auto-focus delay
  const active = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check('nothing is focused when the screen first appears', !active || active === 'body', 'active=' + active);
  const full0 = await photoMaxHeightPx();
  check('the photo is at full size, nobody has tapped a field yet', isFull(full0), full0 + 'px (full=' + FULL_PX + 'px)');
  check('the header is present (nothing pre-emptively scrolled it away)',
    await page.isVisible('text=Bulk Import — Photo 1 of 2'));
}

// ===========================================================================
//  B. The photo collapses to a thumbnail the moment a field is focused, and
//     grows back once none of the three fields hold focus. This is what frees
//     enough height for the fields to fit above the keyboard without the
//     overlay needing to scroll.
// ===========================================================================
console.log('\n=== photo collapses while typing, restores when done ===');
{
  const before = await photoMaxHeightPx();
  await page.click('#bulk-desc');
  // Past the .18s CSS transition, so this reads the SETTLED value rather than
  // a value still animating between full-size and thumbnail.
  await page.waitForTimeout(250);
  check('focusing a field adds the typing state', await hasTypingClass());
  const during = await photoMaxHeightPx();
  check('…and the photo shrinks to a thumbnail', isThumb(during), `before=${before}px during=${during}px (thumb=${THUMB_PX}px)`);

  // Tabbing straight from one field to another must NOT flash the photo back
  // to full size in between — that would just trade one jump for another.
  await page.click('#bulk-loc');
  await page.waitForTimeout(40);   // well inside the 120ms blur grace period
  const midHop = await photoMaxHeightPx();
  check('moving field-to-field does not restore the photo mid-transition', isThumb(midHop), midHop + 'px');

  // Genuinely done editing: tap away from all three fields.
  await page.evaluate(() => document.getElementById('bulk-loc').blur());
  await page.waitForTimeout(400);  // past the 120ms grace period AND the .18s transition
  check('blurring everything restores the full-size photo', !(await hasTypingClass()));
  const restored = await photoMaxHeightPx();
  check('…and the max-height value is back to full size', isFull(restored), restored + 'px (full=' + FULL_PX + 'px)');
}

// This check can't fail unless it's actually testing the mechanism — prove it
// by breaking the CSS rule that does the collapsing and watching it go red.
console.log('\n=== proving the collapse check can fail ===');
{
  // Round-trip the REAL stylesheet content rather than restoring a hardcoded
  // copy: a hand-typed restore silently goes stale the moment the real rules
  // in index.html change (as happened here when the quick-pick chip CSS was
  // added later but this string wasn't updated to match) — and everything
  // AFTER this block then runs with broken chip styling for the rest of the
  // suite, not because chips are broken, just because the test corrupted its
  // own environment. Saving and restoring the live value can't drift.
  const savedCss = await page.evaluate(() => {
    const s = document.getElementById('bulk-photo-styles');
    const saved = s.textContent;
    s.textContent = '';
    return saved;
  });
  await page.click('#bulk-sup');
  await page.waitForTimeout(250);
  const brokenHeight = await photoMaxHeightPx();
  check('with the collapse rule removed, the photo stays full size (proves the check is real)',
    !isThumb(brokenHeight), brokenHeight + 'px');
  await page.evaluate((css) => { document.getElementById('bulk-photo-styles').textContent = css; }, savedCss);
  await page.evaluate(() => document.getElementById('bulk-sup').blur());
  await page.waitForTimeout(250);
}

// ===========================================================================
//  C. The location/supplier autocomplete still works — the focus/blur hooks
//     were added ALONGSIDE bulkComboFilter/bulkComboBlur, not instead of them.
// ===========================================================================
console.log('\n=== autocomplete still works after the focus/blur changes ===');
{
  await page.click('#bulk-loc');
  await page.waitForTimeout(80);
  const locList = await page.evaluate(() => document.getElementById('bulk-loc-list').style.display);
  check('focusing Location still opens its suggestion list', locList === 'block', locList);

  await page.fill('#bulk-sup', 'COSTAS');
  await page.waitForTimeout(80);
  const supItems = await page.evaluate(() => document.getElementById('bulk-sup-list').textContent);
  check('typing in Supplier still filters to the seeded contractor', /COSTAS PLUMBING/.test(supItems), supItems);
  await page.click('#bulk-sup-list [data-i]');
  check('…and picking it fills the field', (await page.inputValue('#bulk-sup')) === 'COSTAS PLUMBING');
}

// ===========================================================================
//  C2. One-tap generic trade chips on Supplier/Trade — the fast path for a
//      photo that just needs "a Painter" logged, not a specific company found.
// ===========================================================================
console.log('\n=== quick-pick trade chips ===');
{
  const WANT = ['Painter', 'Carpenter', 'Cleaner', 'Caulker', 'Supervisor', 'Plumber', 'Electrician', 'Brick Cleaner', 'Site Cleaner'];

  await page.evaluate(() => { document.getElementById('bulk-sup').value = ''; });
  await page.click('#bulk-sup');
  await page.waitForTimeout(80);
  const chipTexts = await page.evaluate(() =>
    [...document.querySelectorAll('.bulk-quick-chip')].map(b => b.textContent.trim()));
  console.log('  chips:', JSON.stringify(chipTexts));
  check('all nine trades appear as chips, in the order asked for', JSON.stringify(chipTexts) === JSON.stringify(WANT), JSON.stringify(chipTexts));

  // The chips sit ABOVE the regular contractor list, not mixed into it.
  const order = await page.evaluate(() => {
    const list = document.getElementById('bulk-sup-list');
    const quick = list.querySelector('#bulk-sup-quick');
    const firstRow = list.querySelector('[data-i]');
    return quick && firstRow ? (quick.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 : null;
  });
  check('chips render before the regular contractor list', order === true, String(order));

  // Tapping "Electrician" — deliberately NOT a seeded contractor — must still
  // fill the field cleanly. This is the case that proves the fallback is
  // honest: no matching contractor, so it will save unassigned, exactly as
  // typing "Electrician" by hand and not picking anything would today.
  await page.click('.bulk-quick-chip:has-text("Electrician")');
  await page.waitForTimeout(80);
  check('tapping a chip fills the field with that exact word', (await page.inputValue('#bulk-sup')) === 'Electrician');
  check('…and closes the dropdown', await page.evaluate(() => document.getElementById('bulk-sup-list').style.display === 'none'));

  // Typing something must hide the chips — they're the empty-field fast path,
  // not a permanent fixture competing with an active search.
  await page.click('#bulk-sup');
  await page.fill('#bulk-sup', 'COS');
  await page.waitForTimeout(80);
  check('typing hides the quick-pick chips', await page.evaluate(() => !document.getElementById('bulk-sup-quick')));
  check('…and the real search still works while they are hidden',
    /COSTAS PLUMBING/.test(await page.evaluate(() => document.getElementById('bulk-sup-list').textContent)));

  // Clearing back to empty and refocusing brings them back.
  await page.fill('#bulk-sup', '');
  await page.click('#bulk-loc');   // move focus away and back, like a real re-tap
  await page.evaluate(() => document.getElementById('bulk-loc').blur());
  await page.waitForTimeout(220);  // past bulkComboBlur's 180ms hide-delay, so the
                                    // now-closed Location dropdown stops covering Supplier
  await page.click('#bulk-sup');
  await page.waitForTimeout(80);
  check('clearing the field and refocusing brings the chips back',
    (await page.evaluate(() => [...document.querySelectorAll('.bulk-quick-chip')].length)) === 9);

  // Location must NOT grow chips — this is scoped to Supplier/Trade only.
  await page.evaluate(() => { document.getElementById('bulk-loc').value = ''; });
  await page.click('#bulk-loc');
  await page.waitForTimeout(80);
  check('Location gets no quick-pick chips', await page.evaluate(() => !document.getElementById('bulk-loc-list').querySelector('.bulk-quick-chip')));
  await page.evaluate(() => document.getElementById('bulk-loc').blur());
  await page.waitForTimeout(220);  // past bulkComboBlur's hide-delay, or the open
                                    // Location dropdown covers Supplier below it

  // Thumb-sized, matching this codebase's own bar for tap targets.
  await page.click('#bulk-sup');
  await page.waitForTimeout(80);
  const chipBox = await page.evaluate(() => {
    const b = document.querySelector('.bulk-quick-chip').getBoundingClientRect();
    return { h: b.height, w: b.width };
  });
  check('chips are thumb-sized, not fiddly', chipBox.h >= 28 && chipBox.w >= 40, JSON.stringify(chipBox));

  // Leave the field clean for section D/E, which continue this SAME 2-photo
  // session and assert on its idx — the end-to-end "does a chip's Save
  // actually assign the right contractor" check runs later, in its own fresh
  // session, so it doesn't disturb that shared state.
  await page.evaluate(() => { document.getElementById('bulk-sup').value = ''; });
}

// ===========================================================================
//  C2b. Once you type PAST the empty-field chips, the same trade-first
//       ranking the regular Add Defects screen just got (2026-08-15, same
//       day) applies here too — "minimal finger clicks" was the explicit
//       ask, and the old plain-substring filter had no ranking at all.
// ===========================================================================
console.log('\n=== typed search: trade placeholders still sort first ===');
{
  // #bulk-sup is left focused from the previous section — blur first so the
  // next focus is genuine (the exact assumption that bit this file twice
  // already; see tests/README.md).
  await page.evaluate(() => document.getElementById('bulk-sup').blur());
  await page.waitForTimeout(220);
  await page.click('#bulk-sup');
  await page.fill('#bulk-sup', 'C');
  await page.waitForTimeout(120);
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('#bulk-sup-list [data-i]')].map(el => el.textContent.trim()));
  console.log('  order for "C":', JSON.stringify(names));
  check('no quick-pick chips once typing has started', await page.evaluate(() => !document.getElementById('bulk-sup-quick')));
  check('Carpenter and Caulker (trades) sort before the real company',
    names.indexOf('Carpenter') >= 0 && names.indexOf('Caulker') >= 0 &&
    names.indexOf('Carpenter') < names.indexOf('C & E Corp Vic Pty Ltd') &&
    names.indexOf('Caulker') < names.indexOf('C & E Corp Vic Pty Ltd'),
    JSON.stringify(names));
  check('…and the real company is still findable, not crowded out',
    names.includes('C & E Corp Vic Pty Ltd'), JSON.stringify(names));

  await page.evaluate(() => { document.getElementById('bulk-sup').value = ''; });
  await page.evaluate(() => document.getElementById('bulk-sup').blur());
  await page.waitForTimeout(220);
}

// ===========================================================================
//  C3. The chips must be FULLY visible the instant the field is tapped, not
//      just present in the DOM. Site feedback (2026-08-15): on a real phone
//      with the keyboard up, only the top sliver of the chip grid showed
//      before the Skip/Save row cut it off — the chips existed, they just
//      weren't scrolled into the visible area. Headless Chromium never opens
//      a real keyboard, so the cramped-viewport condition is forced directly
//      by shrinking the overlay to the same few hundred px a keyboard would
//      leave above it — this reproduces the SAME "not enough room" geometry
//      deterministically, without needing a real device.
// ===========================================================================
console.log('\n=== chips scroll fully into view when room is tight ===');
{
  // ORDER MATTERS, and getting it wrong is what let this bug ship TWICE.
  // The first version of this section shrank the overlay and THEN focused the
  // field — under which the fix's focus-time scrollIntoView had a cramped
  // viewport to work against and passed happily, while the real device kept
  // failing. On a phone the sequence is the other way round: you tap the
  // field (overlay still full height, everything fits, that scroll does
  // nothing), and only THEN does the keyboard slide in and shrink the
  // viewport out from under the already-open list. So: focus first at full
  // height, shrink second, exactly as it happens on the device.
  await page.evaluate(() => {
    const ov = document.getElementById('bulk-photo-ov');
    ov.style.height = '820px';   // full height, no keyboard yet
    ov.style.top = '0px';
    document.getElementById('bulk-sup').value = '';
  });
  // Clicking an ALREADY-focused element does not re-fire onfocus in a real
  // browser, so blur first or this tests stale DOM state (see tests/README.md).
  await page.evaluate(() => document.getElementById('bulk-sup').blur());
  await page.waitForTimeout(220);
  await page.click('#bulk-sup');
  await page.waitForTimeout(120);

  // NOW the keyboard opens: shrink the visible area, then run the reveal that
  // _bulkVvSync runs on a real resize. Dispatching an actual resize event here
  // would be worse, not better — _bulkVvSync re-reads window.visualViewport
  // and would immediately set the height back to the full 820px this headless
  // browser reports, wiping out the simulated keyboard. That _bulkVvSync calls
  // the reveal at all is asserted separately, below.
  await page.evaluate(() => {
    const ov = document.getElementById('bulk-photo-ov');
    ov.style.height = '300px';
    ov.style.top = '0px';
    _bulkRevealOpenList();
  });
  await page.waitForTimeout(120);

  const geom = await page.evaluate(() => {
    const quick = document.getElementById('bulk-sup-quick');
    const scroller = document.querySelector('#bulk-photo-ov > div[style*="overflow:auto"]');
    if (!quick || !scroller) return null;
    const q = quick.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    return { qTop: q.top, qBottom: q.bottom, sTop: s.top, sBottom: s.bottom };
  });
  console.log('  geometry:', JSON.stringify(geom));
  const EPS = 1;
  const fullyVisible = !!geom && geom.qTop >= geom.sTop - EPS && geom.qBottom <= geom.sBottom + EPS;
  check('the chips are scrolled fully within the visible scroll area, top to bottom',
    fullyVisible, JSON.stringify(geom));

  // Prove it: without the scrollIntoView call, this same cramped layout must
  // leave the chips clipped — otherwise the check above isn't testing anything.
  const geomBroken = await page.evaluate(() => {
    const ov = document.getElementById('bulk-photo-ov');
    const scroller = document.querySelector('#bulk-photo-ov > div[style*="overflow:auto"]');
    scroller.scrollTop = 0;   // back to the top, as a fresh open (no scrollIntoView) would leave it
    const quick = document.getElementById('bulk-sup-quick');
    const q = quick.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    return { qTop: q.top, qBottom: q.bottom, sTop: s.top, sBottom: s.bottom };
  });
  const wouldBeClipped = geomBroken.qBottom > geomBroken.sBottom + EPS;
  check('…and without it (scrollTop at 0) the same layout WOULD clip them (proves the check is real)',
    wouldBeClipped, JSON.stringify(geomBroken));

  // The wiring the old version of this test never checked, and the whole
  // reason the bug survived two "fixes": the reveal has to be reachable from
  // _bulkVvSync, because THAT is what runs when the keyboard actually opens.
  // A reveal that only ever runs at focus time is a reveal that never runs
  // when it matters.
  const syncReveals = await page.evaluate(() => {
    let revealed = 0;
    const el = document.getElementById('bulk-sup-quick');
    if (!el) return null;
    const orig = el.scrollIntoView.bind(el);
    el.scrollIntoView = (...a) => { revealed++; return orig(...a); };
    _bulkVvSync();
    el.scrollIntoView = orig;
    return revealed;
  });
  check('_bulkVvSync reveals the open list (this is what fires when the keyboard opens)',
    syncReveals === 1, syncReveals + ' reveal(s)');

  // …and it must NOT fight the user when nothing is open — a stray scroll on
  // every viewport wobble would be its own kind of jumpiness.
  const syncQuiet = await page.evaluate(() => {
    document.getElementById('bulk-sup').blur();
    ['sup', 'loc'].forEach(f => { const l = document.getElementById('bulk-' + f + '-list'); if (l) l.style.display = 'none'; });
    let revealed = 0;
    const el = document.getElementById('bulk-sup-list');
    const orig = el.scrollIntoView.bind(el);
    el.scrollIntoView = () => { revealed++; };
    _bulkVvSync();
    el.scrollIntoView = orig;
    return revealed;
  });
  check('…and reveals nothing when no list is open', syncQuiet === 0, syncQuiet + ' reveal(s)');

  // THE STRUCTURAL GUARANTEE (site suggestion 2026-08-15, after two failed
  // scroll-based fixes): with the fields moved above the photo, the chips are
  // within the visible area at a keyboard-sized viewport WITHOUT ANY SCROLL AT
  // ALL. Everything above tests that scrolling recovers the chips; this tests
  // that they were never lost. scrollTop is forced to 0 first, so a scroll
  // cannot be what makes this pass.
  // 390px overlay ≈ the ACTUAL condition in the site's screenshot: measuring
  // it against the phone's screen height, the scroll area between the header
  // and the Skip/Save row is only ~275px, tighter than the ~348px an iPhone 14
  // leaves on paper. Test the real thing, not the flattering estimate.
  await page.evaluate(() => {
    const ov = document.getElementById('bulk-photo-ov');
    ov.style.height = '390px'; ov.style.top = '0px';
    document.getElementById('bulk-sup').value = '';
  });
  await page.evaluate(() => document.getElementById('bulk-sup').blur());
  await page.waitForTimeout(220);
  await page.click('#bulk-sup');          // reopen: the quiet-check above hid every list
  await page.waitForTimeout(120);

  // What the keyboard opening does on a device, in the right order: the list
  // is already open, THEN the viewport shrinks and _bulkVvSync reveals it.
  const realGeom = await page.evaluate(() => {
    const scroller = document.querySelector('#bulk-photo-ov > div[style*="overflow:auto"]');
    scroller.scrollTop = 0;               // start from "nothing has scrolled yet"
    _bulkRevealOpenList();                // …exactly what _bulkVvSync calls
    const quick = document.getElementById('bulk-sup-quick');
    if (!quick) return null;
    const q = quick.getBoundingClientRect(), s = scroller.getBoundingClientRect();
    return { qTop: q.top, qBottom: q.bottom, sTop: s.top, sBottom: s.bottom };
  });
  console.log('  at the screenshot\'s real viewport:', JSON.stringify(realGeom));
  check('all nine chips are fully visible at the viewport from the actual report',
    !!realGeom && realGeom.qTop >= realGeom.sTop - EPS && realGeom.qBottom <= realGeom.sBottom + EPS,
    JSON.stringify(realGeom));

  // How much the reorder actually buys. Being precise matters here: with the
  // photo collapsed to a 72px thumbnail the OLD order still fits on a roomy
  // screen, so "the reorder alone fixes it" would be an overclaim. What it
  // does is free the photo's height from above the chips, shrinking the
  // deficit that the scroll then has to make up — the two together are what
  // makes this work at the tight viewport above.
  const headroom = await page.evaluate(() => {
    const scroller = document.querySelector('#bulk-photo-ov > div[style*="overflow:auto"]');
    const wrap = scroller.querySelector('.bulk-photo-wrap');
    const restore = wrap.nextSibling;
    const quick = document.getElementById('bulk-sup-quick');
    scroller.scrollTop = 0;
    const now = quick.getBoundingClientRect().bottom;
    scroller.insertBefore(wrap, scroller.firstChild);   // the OLD order
    scroller.scrollTop = 0;
    const before = quick.getBoundingClientRect().bottom;
    scroller.insertBefore(wrap, restore);               // put it back
    scroller.scrollTop = 0;
    return { fieldsFirst: now, photoFirst: before, freed: before - now };
  });
  console.log('  space the reorder frees above the chips:', JSON.stringify(headroom));
  // Threshold is deliberately modest: this suite's "photo" is a fake File that
  // renders as a broken-image placeholder a few px tall, so the space freed
  // here (~36px, mostly margins) UNDERSTATES a real device, where the
  // collapsed photo is a full 72px thumbnail plus margins. Asserting a big
  // number would only be asserting something this environment cannot produce.
  check('moving the photo below the fields genuinely frees vertical space above the chips',
    headroom.freed > 25, JSON.stringify(headroom));

  // The photo is still there, just below the fields — not deleted.
  const photoBelow = await page.evaluate(() => {
    const wrap = document.querySelector('#bulk-photo-ov .bulk-photo-wrap');
    const desc = document.getElementById('bulk-desc');
    if (!wrap || !desc) return null;
    return (desc.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  });
  check('the photo still exists, positioned after the fields (a scroll away, not gone)',
    photoBelow === true, String(photoBelow));

  // Restore real sizing for the sections that follow.
  await page.waitForTimeout(250);
  await page.evaluate(() => { _bulkVvSync(); });
}

// ===========================================================================
//  D. visualViewport tracking. Headless Chromium doesn't open a real soft
//     keyboard, so this can't observe an actual clip — it proves the
//     mechanism is wired up: the sync function runs without throwing, and it
//     writes the overlay's height/top from window.visualViewport.
// ===========================================================================
console.log('\n=== overlay tracks visualViewport when available ===');
{
  const result = await page.evaluate(() => {
    if (!window.visualViewport) return { supported: false };
    const ov = document.getElementById('bulk-photo-ov');
    ov.style.height = ''; ov.style.top = '';
    _bulkVvSync();
    return {
      supported: true,
      height: ov.style.height,
      top: ov.style.top,
      matchesVv: ov.style.height === (window.visualViewport.height + 'px'),
    };
  });
  console.log('  visualViewport:', JSON.stringify(result));
  if (result.supported) {
    check('_bulkVvSync sets the overlay height from visualViewport', result.matchesVv, JSON.stringify(result));
    check('…and sets a top offset too', result.top !== '', JSON.stringify(result));
  } else {
    console.log('  (this Chromium build has no window.visualViewport — mechanism untestable here, not a failure)');
  }

  // The other half of the idempotency guarantee: by this point in the suite
  // the overlay has already been opened and bound once (the very first check
  // above), so _bulkVvBound is genuinely true here — further binds, exactly
  // as happens on every Skip/Save through the rest of a real import, must add
  // ZERO additional listeners on top of that one.
  const moreRegistrations = await page.evaluate(() => {
    if (!window.visualViewport) return null;
    let resizeCalls = 0;
    const origAdd = window.visualViewport.addEventListener.bind(window.visualViewport);
    window.visualViewport.addEventListener = (type, fn) => { if (type === 'resize') resizeCalls++; return origAdd(type, fn); };
    _bindBulkViewport();
    _bindBulkViewport();
    window.visualViewport.addEventListener = origAdd;
    return resizeCalls;
  });
  if (moreRegistrations === null) {
    console.log('  (no window.visualViewport in this Chromium build — mechanism untestable here, not a failure)');
  } else {
    check('further binds on an already-open session add zero more listeners', moreRegistrations === 0, moreRegistrations + ' registration(s)');
  }
}

// ===========================================================================
//  E. Save & Next still works end to end, including into a FRESH overlay —
//     the typing-state class must not leak from one photo to the next.
// ===========================================================================
console.log('\n=== Save & Next into a fresh photo ===');
{
  await page.fill('#bulk-loc', 'Entry');
  await page.fill('#bulk-desc', 'Scratch on door');
  await page.click('button:has-text("Save & Next")');
  await page.waitForTimeout(300);
  check('advances to photo 2 of 2', await page.isVisible('text=Bulk Import — Photo 2 of 2'));
  const freshHeight = await photoMaxHeightPx();
  check('the fresh overlay starts full-size, not still collapsed from the last photo',
    isFull(freshHeight), freshHeight + 'px (full=' + FULL_PX + 'px)');
  check('…and nothing is focused on the new photo either', await page.evaluate(() => {
    const a = document.activeElement;
    return !a || a === document.body;
  }));
  const savedDesc = await page.evaluate(() => db.data.defects.map(d => d.description));
  check('the first photo really saved as a defect', savedDesc.some(d => /Scratch on door/.test(d)), JSON.stringify(savedDesc));

  await page.fill('#bulk-desc', 'Handle loose');
  await page.click('button:has-text("Save & Finish")');
  await page.waitForTimeout(300);
  check('finishing closes the overlay', !(await page.isVisible('#bulk-photo-ov')));
  const finalDefects = await page.evaluate(() => db.data.defects.map(d => d.description));
  check('both photos saved', finalDefects.length === 2, JSON.stringify(finalDefects));
}

// ===========================================================================
//  F. A quick-pick chip is a shortcut for TYPING the word, nothing more — it
//     must go through the exact same resolution saveBulkPhoto already applies
//     to typed text. Run in its own fresh, single-photo session so the Save
//     here doesn't disturb the idx-dependent assertions above.
// ===========================================================================
console.log('\n=== a chip Save resolves through the real assignment path ===');
{
  await openBulkStep(1);
  await page.click('#bulk-sup');
  await page.waitForTimeout(80);
  // "Painter" is seeded as a real contractor (id 2); the chip is a shortcut
  // for typing it, so tapping it must resolve the SAME way typing would.
  await page.click('.bulk-quick-chip:has-text("Painter")');
  await page.fill('#bulk-loc', 'Entry');
  await page.fill('#bulk-desc', 'Overspray on skirting');
  await page.click('button:has-text("Save & Finish")');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => db.data.defects.find(d => /Overspray/.test(d.description)));
  console.log('  saved via Painter chip:', JSON.stringify(saved && { contractorId: saved.contractorId, unassigned: saved.unassigned }));
  check('a chip matching a real contractor assigns it, not "unassigned"',
    !!saved && saved.contractorId === 2 && !saved.unassigned, JSON.stringify(saved));

  // The honest other half: "Electrician" has no matching contractor in this
  // job's list. It must still save — same as typing an unmatched name today —
  // just unassigned, exactly as the response to this feature request said it
  // would, rather than silently failing or throwing.
  await openBulkStep(1);
  await page.click('#bulk-sup');
  await page.waitForTimeout(80);
  await page.click('.bulk-quick-chip:has-text("Electrician")');
  await page.fill('#bulk-loc', 'Entry');
  await page.fill('#bulk-desc', 'Power point loose');
  await page.click('button:has-text("Save & Finish")');
  await page.waitForTimeout(300);
  const savedNoMatch = await page.evaluate(() => db.data.defects.find(d => /Power point/.test(d.description)));
  console.log('  saved via Electrician chip (no matching contractor):', JSON.stringify(savedNoMatch && { contractorId: savedNoMatch.contractorId, unassigned: savedNoMatch.unassigned }));
  check('a chip with no matching contractor still saves, unassigned rather than lost',
    !!savedNoMatch && !savedNoMatch.contractorId && savedNoMatch.unassigned === true, JSON.stringify(savedNoMatch));
}

// ====== 📎 this photo belongs to a defect that is already on the list ======
// Spiro 2026-08-16: "sometimes multiple of those photos relate to the same
// defect — sometimes I'll just capture a different angle." Filling the form
// again would create a duplicate item; 📎 files the photo against the one that
// already exists instead.
console.log('\n--- 📎 add this photo to an existing defect ---');
{
  await page.evaluate(() => {
    window.__queued = [];
    window.CloudPhotos = { count: () => 0, pendingCount: () => 0, refreshCounts: () => {},
      queueRowPhoto(id, blob) { window.__queued.push({ id, size: blob.size }); } };
    db.data.defects = [
      { id: 41, addressId: 1, contractorId: 1, description: 'Downpipe missing behind garage.', location: 'Garage', status: 'open', completed: false },
      { id: 42, addressId: 1, contractorId: 4, description: 'Align door with jamb.', location: 'Ensuite', status: 'open', completed: false },
    ];
    db.save();
  });
  await openBulkStep(3);
  check('the header offers 📎 alongside the ✕',
    await page.evaluate(() => !!document.querySelector('#bulk-photo-ov [onclick*="bulkAttachExisting"]')));

  // Fields left blank on purpose — that is the whole point of the button.
  await page.evaluate(() => bulkAttachExisting());
  await page.waitForSelector('#plan-defect-list', { timeout: 6000 });
  const pick = await page.evaluate(() => {
    const el = document.getElementById('plan-defect-list');
    const r = el.getBoundingClientRect();
    const mid = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 20));
    return {
      // The picker is 100001 and the bulk form 100000, so it must land ON TOP.
      // Getting this backwards is what hid the same list behind the plan viewer.
      onTop: !!(mid && el.contains(mid)),
      rows: [...el.children].map(e => e.innerText.replace(/\n/g, ' | ')),
      newDefectOffered: !!document.querySelector('#imp-body [onclick*="planNewDefect"]'),
    };
  });
  console.log('  picker:', JSON.stringify(pick));
  check('it lists this job\'s defects, ON SCREEN not behind the form', pick.onTop && pick.rows.length === 2, JSON.stringify(pick));
  check('…with location and trade, so two similar items can be told apart',
    pick.rows.some(t => /Ensuite/.test(t) && /Carpenter/.test(t)), JSON.stringify(pick.rows));
  check('…and it does NOT offer "create a new defect" — that is what the form is for',
    !pick.newDefectOffered, JSON.stringify(pick));

  const before = await page.evaluate(() => db.data.defects.length);
  await page.evaluate(() => _pickJobDefectHit(42));
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    queued: window.__queued,
    defects: db.data.defects.length,
    heading: (document.querySelector('#bulk-photo-ov strong') || {}).textContent,
    picker: !!document.getElementById('imp-ov'),
  }));
  console.log('  after picking:', JSON.stringify(after));
  check('the photo is filed against the defect that was picked',
    after.queued.length === 1 && after.queued[0].id === 42, JSON.stringify(after.queued));
  check('…creating NO duplicate defect', after.defects === before, `${before} -> ${after.defects}`);
  check('…the picker closes', !after.picker);
  check('…and it moves on to the next photo', /Photo 2 of 3/.test(after.heading || ''), String(after.heading));

  // Cancelling leaves the photo where it was, on the same step.
  await page.evaluate(() => bulkAttachExisting());
  await page.waitForSelector('#plan-defect-list', { timeout: 6000 });
  await page.evaluate(() => document.getElementById('imp-close').click());
  await page.waitForTimeout(300);
  const cancelled = await page.evaluate(() => ({
    queued: window.__queued.length,
    heading: (document.querySelector('#bulk-photo-ov strong') || {}).textContent,
  }));
  check('backing out attaches nothing and stays on the same photo',
    cancelled.queued === 1 && /Photo 2 of 3/.test(cancelled.heading || ''), JSON.stringify(cancelled));

  // A mixed run reports both kinds honestly.
  await page.evaluate(() => {
    window.__toasts = []; const real = window.showToast;
    window.showToast = (m, bad) => { window.__toasts.push(String(m)); return real(m, bad); };
  });
  await page.evaluate(() => {
    document.getElementById('bulk-desc').value = 'Sill not sealed';
    document.getElementById('bulk-loc').value = 'Bed 2';
    saveBulkPhoto();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => skipBulkPhoto());
  await page.waitForTimeout(400);
  const done = await page.evaluate(() => ({ toasts: window.__toasts, form: !!document.getElementById('bulk-photo-ov') }));
  console.log('  finish:', JSON.stringify(done));
  check('the finish message counts new defects AND attached photos separately',
    done.toasts.some(t => /1 photo defect added/.test(t) && /1 photo added to existing/.test(t)),
    JSON.stringify(done.toasts));
  check('…and the import closes', !done.form);
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');

await page.screenshot({ path: `${OUT}/99-bulkphoto.png` }).catch(() => {});
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
