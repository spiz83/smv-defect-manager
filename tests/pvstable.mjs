// Preview mode must sit still.
//
// Spiro 2026-08-16, scrolling a job on site: "the photos tend to kind of
// flicker a fair bit and refresh themselves… it kind of scrolls up and you have
// to continue scrolling down", and "when I click left or right in the photos it
// actually goes up or down".
//
// Three separate causes, one suite:
//   A  render() replaced #app and the browser threw the scroll position away.
//      Redraws fire on their own — a photo count landing, another phone's edit
//      over realtime — so it happened while you were mid-job, untouched.
//   B  fillPreviewPhotos() ran on EVERY render, revoked every object URL and
//      rewrote every slot, so all the images reloaded each time.
//   C  pvRenderPhoto() rewrote the slot's innerHTML to page a photo, dropping
//      the <img> out of the layout for a frame — the slot collapsed and the
//      rest of the list jumped up, then sprang back.
//
// The assertions are about IDENTITY and POSITION, not markup: the same <img>
// element surviving a redraw, the scroll offset unchanged, the card below not
// moving. "The photo is on screen" passed happily through all three bugs.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8195;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
server.unref();

// Solid-colour PNGs at different shapes — paging between them is what used to
// shove the list around, so the heights must genuinely differ.
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) { raw[p++] = 0; for (let x = 0; x < w; x++) { raw[p++] = rgb[0]; raw[p++] = rgb[1]; raw[p++] = rgb[2]; } }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
let CRC = null;
function crc32(buf) {
  if (!CRC) { CRC = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
const TALL = 'data:image/png;base64,' + png(400, 900, [200, 40, 40]).toString('base64');
const WIDE = 'data:image/png;base64,' + png(900, 400, [40, 90, 200]).toString('base64');
const SQUARE = 'data:image/png;base64,' + png(600, 600, [40, 170, 90]).toString('base64');

const defects = [];
for (let i = 1; i <= 12; i++) {
  defects.push({ id: i, addressId: 1, contractorId: 1, description: 'Defect number ' + i,
    location: 'Throughout', status: 'open', completed: false });
}
const SEED = {
  addresses: [{ id: 1, lot: '159', street: 'Lot 159, (42) Pinto Drive', suburb: 'Wollert', propertyNumber: '306724', active: true }],
  contractors: [{ id: 1, name: 'BRICKLAYER', trades: 'Bricklayer' }],
  trades: [{ id: 1, name: 'Bricklayer' }],
  defects,
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
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 240)));
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '1');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Defect 3 carries three photos of different shapes; the rest carry one.
await page.evaluate(({ tall, wide, square }) => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  window.__thumbCalls = 0;
  window.CloudPhotos = {
    count: (id) => (id === 3 ? 3 : 1),
    pendingCount: () => 0,
    thumbsAll: async (ids) => {
      window.__thumbCalls++;
      const out = {};
      ids.forEach(id => { out[id] = id === 3 ? [tall, wide, square] : [tall]; });
      return out;
    },
    openGallery: () => {},
    refreshCounts: () => {},
  };
  viewDefectsForAddress(1);
}, { tall: TALL, wide: WIDE, square: SQUARE });
await page.waitForFunction(() => document.querySelectorAll('.pv-photo img').length >= 10, null, { timeout: 15000 });
await page.waitForTimeout(600);

// Tag every image so we can tell a SURVIVING element from a replacement.
const tag = () => page.evaluate(() => {
  document.querySelectorAll('.pv-photo').forEach((s, i) => {
    const img = s.querySelector('img'); if (img && !img.dataset.tag) img.dataset.tag = 'i' + i + '-' + Math.random().toString(36).slice(2, 8);
  });
  return [...document.querySelectorAll('.pv-photo img')].map(i => i.dataset.tag);
});

// ================= A. a redraw keeps your place ============================
console.log('\n--- A · a redraw of the same screen does not scroll you back up ---');
{
  await page.evaluate(() => window.scrollTo(0, 1400));
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => Math.round(window.scrollY));
  await page.evaluate(() => render());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => Math.round(window.scrollY));
  console.log('scrollY', before, '->', after);
  check('the scroll position survives a redraw', Math.abs(after - before) <= 8, `${before} -> ${after}`);
}

// ================= B. a redraw does not reload the photos ==================
console.log('\n--- B · the images are not rebuilt on every redraw ---');
{
  const tagsBefore = await tag();
  const callsBefore = await page.evaluate(() => window.__thumbCalls);
  await page.evaluate(() => render());
  await page.waitForTimeout(500);
  const tagsAfter = await page.evaluate(() => [...document.querySelectorAll('.pv-photo img')].map(i => i.dataset.tag || null));
  const kept = tagsAfter.filter(Boolean).length;
  const callsAfter = await page.evaluate(() => window.__thumbCalls);
  console.log('tags kept', kept, 'of', tagsBefore.length, '| thumb fetches', callsBefore, '->', callsAfter);
  // render() rebuilds #app, so the elements are new — what must NOT happen is a
  // second wave of slot rewrites once fillPreviewPhotos runs over them again.
  const rewritten = await page.evaluate(async () => {
    const marks = [...document.querySelectorAll('.pv-photo img')];
    marks.forEach((m, i) => { m.dataset.stable = 's' + i; });
    await fillPreviewPhotos();
    await new Promise(r => setTimeout(r, 300));
    return [...document.querySelectorAll('.pv-photo img')].filter(m => !m.dataset.stable).length;
  });
  console.log('slots rewritten by a repeat fill:', rewritten);
  check('a repeat fill rewrites NO slot — this is the flicker', rewritten === 0, String(rewritten));
}

// ================= C. paging a photo moves nothing but the photo ============
console.log('\n--- C · ‹ › swaps the picture without shoving the list ---');
{
  await page.evaluate(() => {
    const s = document.querySelector('[data-pvphoto="3"]');
    s.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => {
    const s = document.querySelector('[data-pvphoto="3"]');
    const img = s.querySelector('img');
    img.dataset.paged = 'yes';
    const below = document.querySelector('[data-pv="5"]');
    return { y: Math.round(window.scrollY), slotTop: Math.round(s.getBoundingClientRect().top),
      slotH: Math.round(s.getBoundingClientRect().height),
      belowTop: Math.round(below.getBoundingClientRect().top), src: img.getAttribute('src').slice(-40) };
  });
  // Page the WHOLE set — tall → wide → square → back. Every shape change is a
  // chance for the box to resize, and it is the SECOND and THIRD steps that
  // caught the previous attempt out: "grow to the tallest seen" holds on the way
  // down and still shoves the page on the way up.
  const seen = [];
  for (let n = 0; n < 3; n++) {
    await page.evaluate(() => pvStepPhoto(3, 1));
    await page.waitForTimeout(400);
    seen.push(await page.evaluate(() => {
      const s = document.querySelector('[data-pvphoto="3"]');
      const img = s.querySelector('img');
      const below = document.querySelector('[data-pv="5"]');
      return { y: Math.round(window.scrollY), slotTop: Math.round(s.getBoundingClientRect().top),
        slotH: Math.round(s.getBoundingClientRect().height),
        belowTop: Math.round(below.getBoundingClientRect().top), src: img.getAttribute('src').slice(-40),
        sameImg: img.dataset.paged === 'yes', count: (s.querySelector('.pv-pcount') || {}).textContent };
    }));
  }
  console.log('before:', JSON.stringify(before));
  seen.forEach((a, i) => console.log(`step ${i + 1}:`, JSON.stringify(a)));
  check('the photo actually changed', before.src !== seen[0].src);
  check('…re-using the SAME <img>, not a new one', seen.every(a => a.sameImg));
  check('…the counter followed it', seen[0].count === '2/3', String(seen[0].count));
  check('the page never scrolled', seen.every(a => a.y === before.y),
    JSON.stringify([before.y].concat(seen.map(a => a.y))));
  check('…the slot never moved', seen.every(a => Math.abs(a.slotTop - before.slotTop) <= 2),
    JSON.stringify([before.slotTop].concat(seen.map(a => a.slotTop))));
  check('…the box is one fixed size for the whole set',
    seen.every(a => Math.abs(a.slotH - before.slotH) <= 2),
    JSON.stringify([before.slotH].concat(seen.map(a => a.slotH))));
  check('…and the card BELOW never moved, in either direction',
    seen.every(a => Math.abs(a.belowTop - before.belowTop) <= 2),
    JSON.stringify([before.belowTop].concat(seen.map(a => a.belowTop))));
  check('…and the photo is contained, never cropped', await page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-pvphoto="3"] img')).objectFit === 'contain'));
}

// ================= D. navigation still starts at the top ===================
console.log('\n--- D · going somewhere new still starts at the top ---');
{
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(200);
  await page.evaluate(() => showHomeView());
  await page.waitForTimeout(400);
  const y = await page.evaluate(() => Math.round(window.scrollY));
  check('a different screen is not scrolled to the old offset', y === 0, String(y));
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
