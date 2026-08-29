// The ✕ that clears a text field (2026-08-15).
//
// Spiro: "a little cross… to delete the text that has been written this is to
// be a feature across the board no matter what is being selected by it.
// Location supplier or defect description in All defect modes… batch defect
// mode or other."
//
// ONE position:fixed element for the whole app, shown against whichever field
// is focused. Add Defects alone has 60 text fields; a ✕ in the markup of each
// would be noise, and an absolutely-positioned one inside a scrolling form is
// the clipping problem that took three builds to fix in Bulk Import. Being
// tied to focus also means it covers fields that do not exist yet — Bulk
// Import builds its rows in JS and needs no changes for this.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8144;
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
    { id: 1, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    { id: 2, name: 'Caulker', trades: 'Caulker', tradeIds: [], isTradePlaceholder: true, isActive: true },
    { id: 3, name: 'TMG Carpentry', trades: 'Carpenter', tradeIds: [] },
  ],
  trades: [{ id: 1, name: 'Carpenter' }, { id: 2, name: 'Caulker' }],
  defects: [],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true });
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

// Hiding now REMOVES it from the document — it lives beside whichever field is
// focused rather than floating over the page — so "not there" is "not shown".
const xState = () => page.evaluate(() => {
  const d = document.getElementById('input-clear-x');
  if (!d) return { exists: false, shown: false };
  const cs = getComputedStyle(d);
  const r = d.getBoundingClientRect();
  return { exists: true, shown: cs.display !== 'none', text: d.textContent,
           colour: cs.color, left: Math.round(r.left), top: Math.round(r.top), z: cs.zIndex };
});
// Tap it exactly as a phone does — the handler is on touchstart/mousedown, not
// click, because a click would blur the field first.
const tapX = () => page.evaluate(() => {
  const d = document.getElementById('input-clear-x');
  d.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  // A desktop browser still fires click after a prevented mousedown; the ✕ has
  // to swallow it, or the app's outside-click handler closes dropdowns behind it.
  d.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
const boxOf = (sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel); const r = el.getBoundingClientRect();
  return { right: Math.round(r.right), top: Math.round(r.top), height: Math.round(r.height), padR: getComputedStyle(el).paddingRight };
}, sel);

// ===========================================================================
//  A. Only when there is something to clear.
// ===========================================================================
console.log('\n--- A · it appears only when the focused field has text ---');
{
  await page.evaluate(() => { startDefectsForJob(1); });
  await page.waitForSelector('#add-contractor-1-input');
  check('nothing on screen before a field is touched', !(await xState()).shown);

  await page.focus('#add-contractor-1-input');
  check('…still nothing when the focused field is empty', !(await xState()).shown);

  await page.fill('#add-contractor-1-input', 'Car');
  const st = await xState();
  check('typing brings up the ✕', st.shown, JSON.stringify(st));
  check('…it is a cross', st.text === '✕', st.text);
  check('…in red, as marked up on the screenshot', /rgb\(179, 38, 30\)|rgb\(184, 30, 46\)|179|184/.test(st.colour), st.colour);

  const box = await boxOf('#add-contractor-1-input');
  check('…sitting inside the field\'s right edge', Math.abs(st.left - (box.right - 33)) <= 2, `x@${st.left}, field right ${box.right}`);
  check('…vertically centred on the field', Math.abs(st.top - (box.top + (box.height - 30) / 2)) <= 2, `x@${st.top}, field top ${box.top} h${box.height}`);
  // It used to be position:fixed and re-placed on every scroll. iOS shifts
  // fixed elements while the keyboard is up, which put it 200px above the field
  // (Spiro 2026-08-16). Now it is a child of the field's own parent, so the
  // browser keeps it there and there is nothing to go stale.
  const anchored = await page.evaluate(() => {
    const d = document.getElementById('input-clear-x'), el = document.getElementById('add-contractor-1-input');
    return { pos: getComputedStyle(d).position, sameParent: d.parentElement === el.parentElement,
             hostPos: getComputedStyle(el.parentElement).position };
  });
  check('…anchored INSIDE the field\'s parent, not floating over the viewport',
    anchored.pos === 'absolute' && anchored.sameParent, JSON.stringify(anchored));
  check('…with that parent made a positioning context', anchored.hostPos !== 'static', anchored.hostPos);
  check('…and the field gains right padding so the text does not run under it',
    parseFloat(box.padR) >= 34, box.padR);
  // It no longer needs to out-rank the modal layers: sitting inside the field's
  // own parent, it stacks with the field, wherever that field happens to be.
  check('…and it draws over the field, not under it', Number(st.z) > 0, st.z);

  await page.fill('#add-contractor-1-input', '');
  check('deleting the text by hand takes the ✕ away', !(await xState()).shown);
}

// ===========================================================================
//  B. Tapping it clears the field and keeps the keyboard up.
// ===========================================================================
console.log('\n--- B · tapping it ---');
{
  await page.fill('#add-contractor-1-input', 'Carpenter');
  await page.waitForFunction(() => {
    const d = document.getElementById('add-contractor-1-dropdown');
    return d && d.classList.contains('active');
  }, { timeout: 3000 }).catch(() => {});
  await tapX();
  check('the field is emptied', (await page.inputValue('#add-contractor-1-input')) === '');
  check('…focus stays in the field, so the keyboard does not bounce shut',
    await page.evaluate(() => document.activeElement && document.activeElement.id === 'add-contractor-1-input'),
    await page.evaluate(() => document.activeElement && document.activeElement.id));
  check('…the ✕ takes itself away once there is nothing left', !(await xState()).shown);
  check('…and the field\'s own padding is handed back',
    parseFloat((await boxOf('#add-contractor-1-input')).padR) < 34, (await boxOf('#add-contractor-1-input')).padR);
  // Clearing has to run the field's oninput, or the list under it keeps showing
  // matches for text that is no longer there.
  const listGone = await page.evaluate(() => {
    const d = document.getElementById('add-contractor-1-dropdown');
    return !d || !d.classList.contains('active') || !d.innerHTML.trim();
  });
  check('…and the dropdown under it is re-run, not left showing stale matches', listGone);
}

// ===========================================================================
//  C. Every field Spiro named — supplier, defect, location, batch mode.
// ===========================================================================
console.log('\n--- C · across the board ---');
{
  // Defect description, on the regular Add Defects screen.
  await page.evaluate(() => { const i = document.querySelector('.add-defect-1'); i.focus(); i.value = 'Adjust door margins'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  check('defect description on Add Defects', (await xState()).shown);
  await tapX();
  check('…clears', await page.evaluate(() => document.querySelector('.add-defect-1').value === ''));

  // The location picker (a modal at z-index 100001).
  await page.evaluate(() => { const i = document.querySelector('.add-defect-1'); pickRowLocation(i.closest('.defect-input-row').querySelector('.row-loc-btn')); });
  await page.waitForTimeout(150);
  const locSel = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#imp-ov input[type=text], #imp-ov input:not([type])')][0];
    if (!el) return null;
    el.focus(); el.value = 'Ensuite'; el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  if (locSel) {
    const st = await xState();
    check('location field inside the picker modal', st.shown, JSON.stringify(st));
    await tapX();
    check('…clears', await page.evaluate(() => {
      const el = [...document.querySelectorAll('#imp-ov input[type=text], #imp-ov input:not([type])')][0];
      return el && el.value === '';
    }));
  } else {
    check('location field inside the picker modal', false, 'no text input found in #imp-ov');
  }
  await page.evaluate(() => { const b = document.getElementById('imp-close'); if (b) b.click(); });
  await page.waitForTimeout(120);

  // Batch photo mode — its fields are built in JS and never knew about this.
  // Enter the tagging screen the way bulkphoto.mjs does — seed the state and
  // call the same render the file picker's onchange calls, no OS dialog.
  await page.evaluate(() => {
    const files = [new File(['x'], 'p0.jpg', { type: 'image/jpeg' })];
    bulkPhotoState = { addressId: 1, files, idx: 0 };
    renderBulkPhotoStep();
  });
  await page.waitForSelector('#bulk-desc', { timeout: 10000 });
  for (const [id, label, text] of [
    ['#bulk-sup', 'batch mode supplier', 'Carpenter'],
    ['#bulk-desc', 'batch mode defect description', 'Adjust door margins'],
    ['#bulk-loc', 'batch mode location', 'Ensuite'],
  ]) {
    await page.evaluate(({ id, text }) => { const i = document.querySelector(id); i.focus(); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); }, { id, text });
    check(label, (await xState()).shown);
    await tapX();
    check('…clears', await page.evaluate((id) => document.querySelector(id).value === '', id));
  }
  await page.evaluate(() => { bulkPhotoState = null; const o = document.getElementById('bulk-photo-ov'); if (o) o.remove(); });
  await page.waitForTimeout(150);
}

// ===========================================================================
//  D. It follows the field, and only ever shows against one.
// ===========================================================================
console.log('\n--- D · one ✕, following the focused field ---');
{
  await page.evaluate(() => { state.currentView = 'home'; render(); startDefectsForJob(1); });
  await page.waitForSelector('#add-contractor-1-input');
  await page.fill('#add-contractor-1-input', 'Carpenter');
  const a = await xState();
  await page.fill('#add-contractor-3-input', 'Caulker');
  const b = await xState();
  check('there is only ever ONE ✕ in the document',
    await page.evaluate(() => document.querySelectorAll('#input-clear-x').length === 1));
  check('…which has MOVED to the new field\'s parent, not been copied',
    await page.evaluate(() => document.getElementById('input-clear-x').parentElement === document.getElementById('add-contractor-3-input').parentElement));
  check('…and it moves to the newly focused field', b.top !== a.top, `${a.top} -> ${b.top}`);
  check('…the field left behind gets its padding back',
    parseFloat((await boxOf('#add-contractor-1-input')).padR) < 34, (await boxOf('#add-contractor-1-input')).padR);
  check('…the one still holding text keeps its value', (await page.inputValue('#add-contractor-1-input')) === 'Carpenter');

  // Scrolling the form must not leave it stranded mid-screen.
  // Nothing re-places it any more, so this proves the anchoring rather than a
  // scroll handler. The gap to the field must be identical at every position.
  const gapAt = async (y) => {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(40);
    return page.evaluate(() => {
      const d = document.getElementById('input-clear-x').getBoundingClientRect();
      const f = document.getElementById('add-contractor-3-input').getBoundingClientRect();
      return Math.round(d.top - f.top);
    });
  };
  const gaps = [];
  for (const y of [0, 90, 220, 400, 90, 0]) gaps.push(await gapAt(y));
  console.log('  ✕ offset from the field at scroll 0/90/220/400/90/0:', JSON.stringify(gaps));
  check('the ✕ keeps EXACTLY the same offset on its field at every scroll position',
    gaps.every(g => g === gaps[0]), JSON.stringify(gaps));
  await page.evaluate(() => window.scrollTo(0, 0));

  // And when the keyboard shifts the visual viewport — the case that broke it.
  await page.evaluate(() => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'offsetTop', { get: () => 200, configurable: true });
    Object.defineProperty(vv, 'height', { get: () => 500, configurable: true });
    vv.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(80);
  const kbGap = await page.evaluate(() => {
    const d = document.getElementById('input-clear-x').getBoundingClientRect();
    const f = document.getElementById('add-contractor-3-input').getBoundingClientRect();
    return Math.round(d.top - f.top);
  });
  check('…and stays on the field when the keyboard shifts the viewport',
    kbGap === gaps[0], `${kbGap} vs ${gaps[0]}`);

  // Blurring everything must take it away.
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(30);
  check('tapping away hides it', !(await xState()).shown);
}

// ===========================================================================
//  E. Fields it must stay off.
// ===========================================================================
console.log('\n--- E · where it should not appear ---');
{
  const r = await page.evaluate(() => {
    const mk = (attrs) => {
      const el = document.createElement('input');
      Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
      document.body.appendChild(el); el.value = 'x';
      el.focus(); el.dispatchEvent(new Event('input', { bubbles: true }));
      const x = document.getElementById('input-clear-x');
      const shown = !!x && getComputedStyle(x).display !== 'none';
      el.remove(); return shown;
    };
    return { readonly: mk({ type: 'text', readonly: 'readonly' }), disabled: mk({ type: 'text', disabled: 'disabled' }),
             checkbox: mk({ type: 'checkbox' }), date: mk({ type: 'date' }), optOut: mk({ type: 'text', 'data-no-clear': '' }) };
  });
  check('not on a read-only field', !r.readonly);
  check('not on a disabled field', !r.disabled);
  check('not on a checkbox', !r.checkbox);
  check('not on a date picker', !r.date);
  check('and a field can opt out with data-no-clear', !r.optOut);

  // A textarea is text you can delete too.
  const ta = await page.evaluate(() => {
    const el = document.createElement('textarea');
    document.body.appendChild(el); el.value = 'notes';
    el.focus(); el.dispatchEvent(new Event('input', { bubbles: true }));
    const x = document.getElementById('input-clear-x');
    const shown = !!x && getComputedStyle(x).display !== 'none';
    el.remove(); return shown;
  });
  check('but it DOES appear on a textarea', ta);
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
