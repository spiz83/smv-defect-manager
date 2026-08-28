// "It's jumpy every time I press a field" — site feedback on Bulk Import
// (2026-08-15). Three real mechanisms were fighting for space in a fixed
// overlay on a phone: an unsolicited auto-focus on every photo, a photo tall
// enough that the fields don't fit above the keyboard, and position:fixed
// clipping under iOS's keyboard-open viewport quirk. This suite can't drive a
// real iOS keyboard from headless Chromium, so it proves the three mechanisms
// this fix installed instead: no auto-focus, the photo collapses/expands with
// field focus, and the overlay tracks visualViewport when available.
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
  contractors: [{ id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber', tradeIds: [1] }],
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
  await page.evaluate(() => { document.getElementById('bulk-photo-styles').textContent = ''; });
  await page.click('#bulk-sup');
  await page.waitForTimeout(250);
  const brokenHeight = await photoMaxHeightPx();
  check('with the collapse rule removed, the photo stays full size (proves the check is real)',
    !isThumb(brokenHeight), brokenHeight + 'px');
  await page.evaluate(() => {
    document.getElementById('bulk-photo-styles').textContent = `
      #bulk-photo-ov .bulk-photo-wrap img { transition: max-height .18s ease; }
      #bulk-photo-ov.bulk-typing .bulk-photo-wrap img { max-height: 72px !important; }
    `;
  });
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

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');

await page.screenshot({ path: `${OUT}/99-bulkphoto.png` }).catch(() => {});
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
