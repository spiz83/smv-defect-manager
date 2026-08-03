// Preview mode: page through every photo, see how many there are, add one.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Paths resolve from this file, so the suite runs from any checkout.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ARTIFACTS = join(__here, 'artifacts');


const ROOT = REPO, PORT = 8109;
const OUT = ARTIFACTS;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Solid-colour PNGs so "which photo am I looking at" is answerable from pixels.
let CRC = null;
function crc32(buf) {
  if (!CRC) { CRC = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
function png(w, h, [R, G, B]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) { raw[p++] = 0; for (let x = 0; x < w; x++) { raw[p++] = R; raw[p++] = G; raw[p++] = B; } }
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
const url = (c) => 'data:image/png;base64,' + png(600, 800, c).toString('base64');
const RED = url([255, 0, 0]), GREEN = url([0, 200, 0]), BLUE = url([0, 0, 255]), YELLOW = url([255, 220, 0]);

const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', active: true }],
  contractors: [{ id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber' }],
  trades: [{ id: 1, name: 'Plumber' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Downpipe missing behind garage', location: 'Garage', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: 1, description: 'Single photo item', location: 'Ensuite', status: 'open', completed: false },
    { id: 3, addressId: 1, contractorId: 1, description: 'No photo yet', location: 'Laundry', status: 'open', completed: false },
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
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '1');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };
const shot = n => page.screenshot({ path: `${OUT}/${n}.png` });

// Stub the photo store: defect 1 has three, defect 2 one, defect 3 none.
await page.evaluate(({ RED, GREEN, BLUE }) => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  window.__store = { 1: [RED, GREEN, BLUE], 2: [RED], 3: [] };
  window.__saved = [];
  window.__edited = 0;
  window.CloudPhotos = {
    count: (id) => (window.__store[id] || []).length,
    pendingCount: () => 0,
    pendingPhotos: async () => [],
    refreshCounts: () => {},
    openGallery: (id) => { window.__openedGallery = id; },
    editPhoto: async (f) => { window.__edited++; return f; },
    savePhoto: async (id, blob) => {
      window.__saved.push({ id, size: blob.size || 0 });
      (window.__store[id] = window.__store[id] || []).push(window.__newUrl);
    },
    thumbsAll: async (ids) => {
      const o = {};
      ids.forEach(i => { if ((window.__store[i] || []).length) o[i] = window.__store[i].slice(); });
      return o;
    },
  };
  viewDefectsForAddress(1);
}, { RED, GREEN, BLUE });
await page.waitForFunction(() => document.querySelectorAll('.pv-photo img').length >= 2, null, { timeout: 15000 });
await page.waitForTimeout(300);

// helper: what colour is the card currently showing?
const colourOf = async (id) => {
  const el = await page.$(`[data-pvphoto="${id}"] img`);
  if (!el) return null;
  const buf = await el.screenshot();
  return page.evaluate(async (d) => {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = d; });
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const p = x.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data;
    return [p[0], p[1], p[2]];
  }, 'data:image/png;base64,' + buf.toString('base64'));
};
const near = (a, b) => a && b && Math.abs(a[0] - b[0]) < 40 && Math.abs(a[1] - b[1]) < 40 && Math.abs(a[2] - b[2]) < 40;

// ================= 1. the counter ==========================================
console.log('\n--- photo counter ---');
const counts = await page.evaluate(() => ({
  three: (document.querySelector('[data-pvphoto="1"] .pv-pcount') || {}).textContent,
  one: !!document.querySelector('[data-pvphoto="2"] .pv-pcount'),
  navThree: document.querySelectorAll('[data-pvphoto="1"] .pv-nav').length,
  navOne: document.querySelectorAll('[data-pvphoto="2"] .pv-nav').length,
  noSlot: !document.querySelector('[data-pvphoto="3"]'),
}));
console.log('counts:', JSON.stringify(counts));
check('a multi-photo card shows "1/3" top-right', counts.three === '1/3', String(counts.three));
check('a single-photo card shows no counter', !counts.one);
check('a multi-photo card gets both arrows', counts.navThree === 2, String(counts.navThree));
check('a single-photo card gets no arrows', counts.navOne === 0, String(counts.navOne));
check('a card with no photo shows no photo box', counts.noSlot);

const pos = await page.evaluate(() => {
  const box = document.querySelector('[data-pvphoto="1"]').getBoundingClientRect();
  const b = document.querySelector('[data-pvphoto="1"] .pv-pcount').getBoundingClientRect();
  const prev = document.querySelector('[data-pvphoto="1"] .pv-prev').getBoundingClientRect();
  const next = document.querySelector('[data-pvphoto="1"] .pv-next').getBoundingClientRect();
  return {
    topRight: Math.round(b.top - box.top) < 20 && Math.round(box.right - b.right) < 20,
    prevLeft: Math.round(prev.left - box.left) < 20,
    nextRight: Math.round(box.right - next.right) < 20,
    centred: Math.abs((prev.top + prev.bottom) / 2 - (box.top + box.bottom) / 2) < 4,
    tap: Math.round(prev.width) + 'x' + Math.round(prev.height),
  };
});
console.log('positions:', JSON.stringify(pos));
check('the counter is in the TOP-RIGHT corner of the photo', pos.topRight, JSON.stringify(pos));
check('arrows sit left and right, vertically centred', pos.prevLeft && pos.nextRight && pos.centred, JSON.stringify(pos));
check('arrows are a real tap target', parseInt(pos.tap) >= 30, pos.tap);
await shot('81-pv-carousel');

// ================= 2. paging ===============================================
console.log('\n--- paging between photos ---');
check('starts on photo 1 (red)', near(await colourOf(1), [255, 0, 0]), JSON.stringify(await colourOf(1)));

await page.click('[data-pvphoto="1"] .pv-next');
await page.waitForTimeout(250);
check('› moves to photo 2 (green)', near(await colourOf(1), [0, 200, 0]), JSON.stringify(await colourOf(1)));
check('…and the counter follows',
  await page.evaluate(() => document.querySelector('[data-pvphoto="1"] .pv-pcount').textContent) === '2/3');

await page.click('[data-pvphoto="1"] .pv-next');
await page.waitForTimeout(250);
check('› again reaches photo 3 (blue)', near(await colourOf(1), [0, 0, 255]), JSON.stringify(await colourOf(1)));

await page.click('[data-pvphoto="1"] .pv-next');
await page.waitForTimeout(250);
check('› past the end wraps to photo 1',
  near(await colourOf(1), [255, 0, 0])
  && await page.evaluate(() => document.querySelector('[data-pvphoto="1"] .pv-pcount').textContent) === '1/3');

await page.click('[data-pvphoto="1"] .pv-prev');
await page.waitForTimeout(250);
check('‹ from the first wraps to the last',
  near(await colourOf(1), [0, 0, 255])
  && await page.evaluate(() => document.querySelector('[data-pvphoto="1"] .pv-pcount').textContent) === '3/3');

// paging must not open the gallery, nor re-render the list
const isolated = await page.evaluate(async () => {
  window.__openedGallery = null;
  const card = document.querySelector('.pv-card[data-pv="1"]');
  const marked = card.__m = Symbol('same');
  document.querySelector('[data-pvphoto="1"] .pv-next').click();
  await new Promise(r => setTimeout(r, 200));
  return { opened: window.__openedGallery, sameCard: document.querySelector('.pv-card[data-pv="1"]').__m === marked };
});
check('paging does not open the full gallery', isolated.opened === null, String(isolated.opened));
check('…and does not re-render the list', isolated.sameCard);
// tapping the photo ITSELF still opens the gallery
await page.evaluate(() => { window.__openedGallery = null; });
await page.click('[data-pvphoto="1"] img');
await page.waitForTimeout(200);
check('tapping the photo still opens the full gallery',
  await page.evaluate(() => window.__openedGallery) === 1);

// ================= 3. adding a photo =======================================
console.log('\n--- adding a photo ---');
const btn = await page.evaluate(() => {
  const card = document.querySelector('.pv-card[data-pv="1"]');
  const el = card.querySelector('.pv-addphoto');
  const input = el && el.querySelector('input[type=file]');
  const b = el && el.getBoundingClientRect();
  return {
    exists: !!el, glyph: el && el.textContent.trim(),
    accept: input && input.getAttribute('accept'),
    multiple: input && input.hasAttribute('multiple'),
    size: b && (Math.round(b.width) + 'x' + Math.round(b.height)),
    order: [...card.querySelectorAll('.pv-act button, .pv-act label')].map(x => x.textContent.trim().slice(0, 12)),
  };
});
console.log('add button:', JSON.stringify(btn));
check('there is a 📷 on every preview card', btn.exists && btn.glyph === '📷', JSON.stringify(btn.glyph));
check('it offers camera AND gallery (accept=image/*)', btn.accept === 'image/*', String(btn.accept));
check('it takes more than one at a time', !!btn.multiple);
check('it is a real tap target', parseInt(btn.size) >= 36, btn.size);
check('the card action row reads Mark done, ✏️, 📍, 📷, 🛒',
  btn.order.join(',') === '◯ Mark done,✏️,📍,📷,🛒', btn.order.join(','));

// the whole action row must still fit and not overflow
const layout = await page.evaluate(() => {
  const card = document.querySelector('.pv-card[data-pv="1"]');
  const act = card.querySelector('.pv-act');
  const kids = [...act.querySelectorAll('button, label')];
  const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
  const minis = kids.slice(1);
  return {
    overflow: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - act.getBoundingClientRect().right),
    minisOneRow: new Set(minis.map(mid)).size === 1,
    tickW: Math.round(card.querySelector('.pv-tick').getBoundingClientRect().width),
    tickWraps: card.querySelector('.pv-tick').scrollHeight > card.querySelector('.pv-tick').clientHeight + 1,
  };
});
console.log('action row @390:', JSON.stringify(layout));
check('nothing overflows the card', layout.overflow <= 0, JSON.stringify(layout));
check('the four icons stay on one row', layout.minisOneRow, JSON.stringify(layout));
check('MARK DONE stays readable', !layout.tickWraps && layout.tickW >= 130, JSON.stringify(layout));

// actually add one, to a card that ALREADY has photos
const added = await page.evaluate(async (YELLOW) => {
  window.__newUrl = YELLOW;
  const card = document.querySelector('.pv-card[data-pv="1"]');
  const input = card.querySelector('.pv-addphoto input[type=file]');
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(64)], 'shot.jpg', { type: 'image/jpeg' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 600));
  return {
    saved: window.__saved.slice(),
    edited: window.__edited,
    counter: (document.querySelector('[data-pvphoto="1"] .pv-pcount') || {}).textContent,
    inputCleared: input.value === '',
  };
}, YELLOW);
console.log('after adding:', JSON.stringify(added));
check('the photo is saved against the right defect',
  added.saved.length === 1 && added.saved[0].id === 1, JSON.stringify(added.saved));
check('a single photo goes through the mark-up editor first', added.edited === 1, String(added.edited));
check('the counter grows to 1 of 4', /\/4$/.test(added.counter || ''), String(added.counter));
check('it lands ON the photo just added', added.counter === '4/4', String(added.counter));
check('the file input is cleared so the same photo can be picked again', added.inputCleared);
check('the new photo is the one on screen (yellow)',
  near(await colourOf(1), [255, 220, 0]), JSON.stringify(await colourOf(1)));

// add to a card that has NO photo at all — the slot has to be created
const fromNothing = await page.evaluate(async (RED) => {
  window.__newUrl = RED;
  const card = document.querySelector('.pv-card[data-pv="3"]');
  const before = !!card.querySelector('[data-pvphoto]');
  const input = card.querySelector('.pv-addphoto input[type=file]');
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(64)], 'a.jpg', { type: 'image/jpeg' }));
  dt.items.add(new File([new Uint8Array(64)], 'b.jpg', { type: 'image/jpeg' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  const slot = document.querySelector('[data-pvphoto="3"]');
  return {
    before,
    nowHasSlot: !!slot,
    img: !!(slot && slot.querySelector('img')),
    counter: (slot && slot.querySelector('.pv-pcount') || {}).textContent,
    saved: window.__saved.filter(s => s.id === 3).length,
    editedTotal: window.__edited,
  };
}, RED);
console.log('photo-less card:', JSON.stringify(fromNothing));
check('a card with no photo had no slot to begin with', fromNothing.before === false);
check('adding to it creates the photo box in place', fromNothing.nowHasSlot && fromNothing.img, JSON.stringify(fromNothing));
check('picking TWO at once saves both', fromNothing.saved === 2, String(fromNothing.saved));
check('…and skips the editor (editing each is tedious)', fromNothing.editedTotal === 1, String(fromNothing.editedTotal));
check('the new card counts 1/2', fromNothing.counter === '2/2', String(fromNothing.counter));
await shot('82-pv-added');

// ================= 4. narrow phone =========================================
console.log('\n--- 320px ---');
await page.setViewportSize({ width: 320, height: 720 });
await page.waitForTimeout(300);
const narrow = await page.evaluate(() => {
  const card = document.querySelector('.pv-card[data-pv="1"]');
  const act = card.querySelector('.pv-act');
  const kids = [...act.querySelectorAll('button, label')];
  const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
  const box = document.querySelector('[data-pvphoto="1"]').getBoundingClientRect();
  const prev = document.querySelector('[data-pvphoto="1"] .pv-prev').getBoundingClientRect();
  const next = document.querySelector('[data-pvphoto="1"] .pv-next').getBoundingClientRect();
  return {
    overflow: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - act.getBoundingClientRect().right),
    minisOneRow: new Set(kids.slice(1).map(mid)).size === 1,
    tickW: Math.round(card.querySelector('.pv-tick').getBoundingClientRect().width),
    arrowsInside: prev.left >= box.left && next.right <= box.right,
    arrowGap: Math.round(next.left - prev.right),
  };
});
console.log('@320px:', JSON.stringify(narrow));
check('nothing overflows at 320px', narrow.overflow <= 0, JSON.stringify(narrow));
check('the four icons stay together at 320px', narrow.minisOneRow, JSON.stringify(narrow));
check('MARK DONE stays readable at 320px', narrow.tickW >= 130, String(narrow.tickW));
check('arrows stay inside the photo at 320px', narrow.arrowsInside, JSON.stringify(narrow));
check('arrows do not collide at 320px', narrow.arrowGap > 60, String(narrow.arrowGap));
await shot('83-pv-320');

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
