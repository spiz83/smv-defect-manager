// The photo markup editor — draw, text, and CROP (2026-08-16).
//
// Spiro: "in the mark up mode add the ability to crop photo aswell… across
// entire app". This ONE editor is the whole app's editor — the camera, the
// per-row 📸, Bulk Import and plan markups all resolve through
// CloudPhotos.editPhoto — so a change here reaches every photo in the app and
// nowhere else needs touching. That is the property worth pinning, and it is
// why this suite exists: the editor lives in cloud-sync.js and had no test at
// all, so "draw a box and it crops" was nobody's job to check.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8147;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Enough of a Supabase to let cloud-sync boot and define CloudPhotos.
const STUB = `(() => {
  try {
    localStorage.setItem('cs_heal', 'snap-2026-06-17');
    localStorage.removeItem('cs_dirty');
    localStorage.setItem('dm_preview', '0');
    localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
  } catch (e) {}
  const UID = '11111111-1111-1111-1111-111111111111';
  const T = { dm_trades: [], dm_contractors: [], dm_contractor_trades: [], jobs: [], dm_defects: [],
    job_call_up_archive: [], job_called_for_archive: [], dm_trade_learning: [],
    v_jobs_with_current_supervisor: [], bpi_trade_rules: [], bpi_ai_settings: [{ id: 1 }],
    deleted_rows_archive: [], dm_defect_photos: [], dm_reports: [], profiles: [{ id: UID, role: 'manager' }] };
  function q(name) {
    const api = { select: () => api, order: () => api, limit: () => api, range: () => api,
      eq: () => api, neq: () => api, in: () => api, is: () => api, not: () => api, gt: () => api,
      gte: () => api, lt: () => api, lte: () => api, like: () => api, ilike: () => api, or: () => api,
      contains: () => api, filter: () => api, match: () => api,
      maybeSingle: () => api, single: () => api,
      then: (ok) => Promise.resolve({ data: T[name] || [], error: null }).then(ok) };
    return api;
  }
  const table = (name) => ({
    select: () => q(name),
    update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    upsert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }) }) }),
    insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    delete: () => ({ not: async () => ({ error: null }), eq: async () => ({ error: null }) }),
  });
  const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
  window.supabase = { createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: UID, email: 'a@b.com' } } }),
      getSession: async () => ({ data: { session: { user: { id: UID, email: 'a@b.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
    from: table, channel: () => chan, removeChannel() {},
    storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}),
      upload: async () => ({}), createSignedUrl: async () => ({ data: null }), createSignedUrls: async () => ({ data: [] }) }) },
  }) };
})();`;

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
await page.addInitScript(STUB);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.waitForFunction(() => !!(window.CloudPhotos && window.CloudPhotos.editPhoto), { timeout: 15000 });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// A 600x400 image with four coloured quadrants, so a crop can be proved by
// WHICH COLOURS SURVIVE rather than by size alone — a size check would pass on
// a crop of entirely the wrong region.
const openEditor = () => page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 600; c.height = 400;
  const x = c.getContext('2d');
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, 300, 200);        // top-left    red
  x.fillStyle = '#00ff00'; x.fillRect(300, 0, 300, 200);      // top-right   green
  x.fillStyle = '#0000ff'; x.fillRect(0, 200, 300, 200);      // bottom-left blue
  x.fillStyle = '#ffff00'; x.fillRect(300, 200, 300, 200);    // bottom-right yellow
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'quadrants.png', { type: 'image/png' });
  window.__editResult = undefined;
  window.CloudPhotos.editPhoto(file).then(r => { window.__editResult = r; });
});
const drag = (from, to) => page.evaluate(({ from, to }) => {
  const el = document.getElementById('cs-crop');
  const ev = (t, p) => el.dispatchEvent(new PointerEvent(t, { clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
  const target = document.elementFromPoint(from.x, from.y);
  target.dispatchEvent(new PointerEvent('pointerdown', { clientX: from.x, clientY: from.y, bubbles: true, cancelable: true, pointerId: 1, isPrimary: true }));
  ev('pointermove', to);
  ev('pointerup', to);
}, { from, to });
const box = () => page.evaluate(() => {
  const b = document.querySelector('#cs-crop > div');
  const r = b.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
});
const canvasSize = () => page.evaluate(() => {
  const c = document.querySelector('#cs-edit-wrap canvas');
  return { w: c.width, h: c.height };
});
// Which of the four quadrant colours are still present.
const colours = () => page.evaluate(() => {
  const c = document.querySelector('#cs-edit-wrap canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] > 200, g = d[i + 1] > 200, b = d[i + 2] > 200;
    if (r && !g && !b) seen.add('red');
    else if (!r && g && !b) seen.add('green');
    else if (!r && !g && b) seen.add('blue');
    else if (r && g && !b) seen.add('yellow');
  }
  return [...seen].sort();
});

// ===========================================================================
//  A. The editor, and where Crop sits in it.
// ===========================================================================
console.log('\n--- A · the editor ---');
{
  await openEditor();
  await page.waitForSelector('[data-act="crop"]', { timeout: 8000 });
  const bar = await page.evaluate(() => {
    const row = document.querySelector('[data-act="cancel"]').parentElement;
    const kids = [...row.children];
    const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
    return { labels: kids.map(k => k.textContent.trim()), rows: new Set(kids.map(mid)).size,
             overflow: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - row.getBoundingClientRect().right) };
  });
  console.log('  toolbar:', JSON.stringify(bar));
  check('the editor offers Crop alongside text and undo',
    bar.labels.some(t => /Crop/.test(t)) && bar.labels.some(t => /Text/.test(t)) && bar.labels.some(t => /Undo/.test(t)), JSON.stringify(bar.labels));
  check('…and four buttons still fit one line on a 390px phone',
    bar.rows === 1 && bar.overflow <= 0, JSON.stringify(bar));
  check('…and the instruction line tells you cropping exists',
    await page.evaluate(() => /Crop/i.test(document.getElementById('cs-edit-hint').textContent)),
    await page.evaluate(() => document.getElementById('cs-edit-hint').textContent));
  const start = await canvasSize();
  check('the image loads at its own size', start.w === 600 && start.h === 400, JSON.stringify(start));
}

// ===========================================================================
//  B. Cropping to one quadrant.
// ===========================================================================
console.log('\n--- B · crop ---');
{
  await page.evaluate(() => document.querySelector('[data-act="crop"]').click());
  await page.waitForSelector('#cs-crop', { timeout: 5000 });
  const b0 = await box();
  console.log('  initial box:', JSON.stringify(b0));
  check('a crop box appears, inset from the edges so it can be grabbed', b0.w > 40 && b0.h > 40, JSON.stringify(b0));
  check('…and its own Cancel / Crop buttons replace the top row',
    await page.evaluate(() => !!document.getElementById('cs-crop-bar') &&
      document.querySelector('[data-act="cancel"]').parentElement.style.display === 'none'));
  // The colours and the drawing hint mean nothing while dragging a box, and
  // they were still sitting there taking a third of the screen.
  check('…and the colours and drawing hint step out of the way',
    await page.evaluate(() => document.getElementById('cs-edit-cols').style.display === 'none' &&
      document.getElementById('cs-edit-hint').style.display === 'none'));
  const cropBar = await page.evaluate(() => {
    const b = document.getElementById('cs-crop-bar');
    const kids = [...b.children];
    const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
    return { rows: new Set(kids.map(mid)).size, labels: kids.map(k => k.textContent.trim()) };
  });
  check('…on one line, with nothing wrapping', cropBar.rows === 1, JSON.stringify(cropBar));

  // Drag the bottom-right handle up and left, to keep roughly the top-left.
  const canvasRect = await page.evaluate(() => {
    const r = document.querySelector('#cs-edit-wrap canvas').getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });
  await drag({ x: b0.x + b0.w, y: b0.y + b0.h }, { x: canvasRect.l + canvasRect.w * 0.42, y: canvasRect.t + canvasRect.h * 0.42 });
  const b1 = await box();
  console.log('  after dragging the SE corner in:', JSON.stringify(b1));
  check('dragging a corner resizes the box', b1.w < b0.w - 10 && b1.h < b0.h - 10, `${b0.w}x${b0.h} -> ${b1.w}x${b1.h}`);

  // Move it to the very top-left so the crop is unambiguously the red quadrant.
  await drag({ x: b1.x + b1.w / 2, y: b1.y + b1.h / 2 }, { x: canvasRect.l + 5, y: canvasRect.t + 5 });
  const b2 = await box();
  check('dragging the middle moves it', b2.x < b1.x - 5 || b2.y < b1.y - 5, JSON.stringify({ b1, b2 }));
  check('…and it cannot be dragged off the image', b2.x >= Math.round(canvasRect.l) - 1 && b2.y >= Math.round(canvasRect.t) - 1,
    JSON.stringify({ box: b2, canvas: { l: Math.round(canvasRect.l), t: Math.round(canvasRect.t) } }));

  const before = await colours();
  await page.evaluate(() => document.querySelector('[data-act="cropok"]').click());
  await page.waitForTimeout(200);
  const after = await canvasSize(), cols = await colours();
  console.log(`  ${JSON.stringify(before)} -> ${JSON.stringify(cols)}, canvas ${JSON.stringify(after)}`);
  check('applying the crop shrinks the image', after.w < 600 && after.h < 400, JSON.stringify(after));
  check('…to the region that was selected, not just any region',
    cols.includes('red') && !cols.includes('yellow'), JSON.stringify(cols));
  check('…and the crop UI closes, with the normal toolbar back',
    await page.evaluate(() => !document.getElementById('cs-crop') && !document.getElementById('cs-crop-bar') &&
      document.querySelector('[data-act="cancel"]').parentElement.style.display !== 'none'));
}

// ===========================================================================
//  C. Draw after cropping, and save what you see.
// ===========================================================================
console.log('\n--- C · it is still an editor afterwards ---');
{
  const sized = await page.evaluate(() => {
    // Stroke width is derived from the image width, so a crop has to recompute
    // it or drawing on a tight crop comes out with the full sheet's fat lines.
    const c = document.querySelector('#cs-edit-wrap canvas');
    const r = c.getBoundingClientRect();
    const p = (fx, fy) => ({ x: r.left + r.width * fx, y: r.top + r.height * fy });
    const a = p(0.2, 0.2), b = p(0.8, 0.8);
    c.dispatchEvent(new PointerEvent('pointerdown', { clientX: a.x, clientY: a.y, bubbles: true, cancelable: true, pointerId: 2, isPrimary: true }));
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: b.x, clientY: b.y, bubbles: true, cancelable: true, pointerId: 2, isPrimary: true }));
    c.dispatchEvent(new PointerEvent('pointerup', { clientX: b.x, clientY: b.y, bubbles: true, cancelable: true, pointerId: 2, isPrimary: true }));
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 190 && d[i + 1] < 90 && d[i + 2] < 90) red++;
    return { drew: red > 0, w: c.width };
  });
  check('you can still draw on the cropped image', sized.drew, JSON.stringify(sized));

  const saved = await page.evaluate(async () => {
    document.querySelector('[data-act="save"]').click();
    for (let i = 0; i < 60 && window.__editResult === undefined; i++) await new Promise(r => setTimeout(r, 50));
    const b = window.__editResult;
    if (!b) return null;
    const bmp = await createImageBitmap(b);
    return { size: b.size, type: b.type, w: bmp.width, h: bmp.height };
  });
  console.log('  saved:', JSON.stringify(saved));
  check('Save returns the CROPPED image, not the original', saved && saved.w < 600 && saved.h < 400, JSON.stringify(saved));
  check('…as a real jpeg', saved && saved.type === 'image/jpeg' && saved.size > 200, JSON.stringify(saved));
}

// ===========================================================================
//  D. Backing out of a crop, and out of the editor.
// ===========================================================================
console.log('\n--- D · backing out ---');
{
  await openEditor();
  await page.waitForSelector('[data-act="crop"]', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('[data-act="crop"]').click());
  await page.waitForSelector('#cs-crop', { timeout: 5000 });
  await page.evaluate(() => document.querySelector('[data-act="cropcancel"]').click());
  await page.waitForTimeout(150);
  const back = await canvasSize();
  check('cancelling a crop leaves the image untouched', back.w === 600 && back.h === 400, JSON.stringify(back));
  check('…and puts the normal toolbar back',
    await page.evaluate(() => !document.getElementById('cs-crop') &&
      document.querySelector('[data-act="cancel"]').parentElement.style.display !== 'none'));
  check('…colours and hint included',
    await page.evaluate(() => document.getElementById('cs-edit-cols').style.display !== 'none' &&
      document.getElementById('cs-edit-hint').style.display !== 'none'));

  // Tapping Crop again closes it — the same button, both ways.
  await page.evaluate(() => document.querySelector('[data-act="crop"]').click());
  await page.waitForSelector('#cs-crop', { timeout: 5000 });
  await page.evaluate(() => document.querySelector('[data-act="crop"]').click());
  await page.waitForTimeout(150);
  check('tapping Crop again closes the crop box', await page.evaluate(() => !document.getElementById('cs-crop')));

  const cancelled = await page.evaluate(async () => {
    document.querySelector('[data-act="cancel"]').click();
    for (let i = 0; i < 40 && window.__editResult === undefined; i++) await new Promise(r => setTimeout(r, 50));
    return { result: window.__editResult, editorGone: !document.querySelector('[data-act="save"]') };
  });
  check('Cancel still abandons the whole edit', cancelled.result === null && cancelled.editorGone, JSON.stringify(cancelled));
}

// ===========================================================================
//  E. One editor, so every screen gets this.
// ===========================================================================
console.log('\n--- E · across the app ---');
{
  const wiring = await page.evaluate(() => ({
    editPhoto: typeof window.CloudPhotos.editPhoto === 'function',
    // The three entry points that all resolve through it.
    rowPhoto: typeof pickRowPhoto === 'function',
    bulk: typeof renderBulkPhotoStep === 'function',
    planMarkup: typeof planMarkup === 'function',
  }));
  check('the camera, Bulk Import and plan markup all go through this one editor',
    wiring.editPhoto && wiring.rowPhoto && wiring.bulk && wiring.planMarkup, JSON.stringify(wiring));
  const callers = await page.evaluate(() => {
    const src = [pickRowPhoto, renderBulkPhotoStep, planMarkup].map(f => f.toString()).join('\n');
    return (src.match(/editPhoto/g) || []).length;
  });
  check('…and each of them calls editPhoto rather than rolling its own', callers >= 3, String(callers));
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
