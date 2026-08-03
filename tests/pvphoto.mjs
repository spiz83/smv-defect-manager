// Preview-mode photos must show the WHOLE image, not a crop.
// A phone photo is portrait; the old 4/3 + object-fit:cover box sliced the top
// and bottom off — exactly where a "seal top of door" defect lives.
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


const ROOT = REPO, PORT = 8108;
const OUT = ARTIFACTS;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// ---- Build real PNGs with a distinct band at the very TOP and BOTTOM, so a
//      crop is detectable by sampling the rendered pixels, not just by maths.
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0;                                  // filter byte
    const band = y < h * 0.08 ? 0 : (y > h * 0.92 ? 1 : 2);
    for (let x = 0; x < w; x++) {
      if (band === 0) { raw[p++] = 255; raw[p++] = 0; raw[p++] = 0; }        // top = red
      else if (band === 1) { raw[p++] = 0; raw[p++] = 0; raw[p++] = 255; }   // bottom = blue
      else { raw[p++] = 220; raw[p++] = 220; raw[p++] = 220; }               // middle = grey
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC = null;
function crc32(buf) {
  if (!CRC) {
    CRC = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
const PORTRAIT = 'data:image/png;base64,' + png(600, 900).toString('base64');   // 2:3, a phone photo
const LANDSCAPE = 'data:image/png;base64,' + png(900, 600).toString('base64');  // 3:2
const VERYTALL = 'data:image/png;base64,' + png(400, 1600).toString('base64');  // 1:4, panorama-ish

const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', active: true }],
  contractors: [{ id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber' }],
  trades: [{ id: 1, name: 'Plumber' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Seal top of door', location: 'Front Door', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: 1, description: 'Adjust exhaust', location: 'Bathroom', status: 'open', completed: false },
    { id: 3, addressId: 1, contractorId: 1, description: 'Very tall shot', location: 'Garage', status: 'open', completed: false },
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

await page.evaluate(({ p, l, t }) => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  window.CloudPhotos = {
    count: () => 1,
    thumbs: async () => ({ 1: p, 2: l, 3: t }),
    openGallery: () => {},
  };
  viewDefectsForAddress(1);
}, { p: PORTRAIT, l: LANDSCAPE, t: VERYTALL });
await page.waitForFunction(() => document.querySelectorAll('.pv-photo img').length >= 3, null, { timeout: 15000 });
await page.waitForTimeout(400);

const shots = await page.evaluate(() => [...document.querySelectorAll('.pv-photo img')].map(img => {
  const b = img.getBoundingClientRect();
  const box = img.parentElement.getBoundingClientRect();
  return {
    natural: img.naturalWidth + 'x' + img.naturalHeight,
    naturalRatio: +(img.naturalWidth / img.naturalHeight).toFixed(3),
    rendered: Math.round(b.width) + 'x' + Math.round(b.height),
    renderedRatio: +(b.width / b.height).toFixed(3),
    fit: getComputedStyle(img).objectFit,
    boxW: Math.round(box.width),
    overflowsCard: Math.round(b.height) > Math.round(box.height) + 1,
  };
}));
console.log('photos:', JSON.stringify(shots, null, 1));

// A portrait photo must render at its OWN aspect ratio — that is what proves
// nothing was sliced off.
const p = shots[0];
check('the photo box no longer forces 4:3', p.renderedRatio !== 1.333, String(p.renderedRatio));
check('a PORTRAIT photo keeps its own shape (nothing cropped)',
  Math.abs(p.renderedRatio - p.naturalRatio) < 0.02, `natural ${p.naturalRatio} vs rendered ${p.renderedRatio}`);
check('…and fills the card width', p.boxW - Math.round(p.rendered.split('x')[0]) <= 2, p.rendered + ' in ' + p.boxW);
check('object-fit is contain, never cover', shots.every(s => s.fit === 'contain'), shots.map(s => s.fit).join(','));

const l = shots[1];
check('a LANDSCAPE photo keeps its own shape too',
  Math.abs(l.renderedRatio - l.naturalRatio) < 0.02, `natural ${l.naturalRatio} vs rendered ${l.renderedRatio}`);

const t = shots[2];
check('an absurdly tall photo is bounded, not endless',
  Math.round(t.rendered.split('x')[1]) <= Math.round(800 * 0.6) + 2, t.rendered);
check('…and is letterboxed rather than cropped', t.fit === 'contain');
check('no photo overflows its own box', shots.every(s => !s.overflowsCard), JSON.stringify(shots.map(s => s.overflowsCard)));

// THE REAL PROOF: photograph what is ACTUALLY ON SCREEN and sample it. The
// source has a red band across the top and a blue band across the bottom; a
// crop removes one or both.
//
// It has to be a screenshot. Re-drawing the <img> into a canvas in the page
// redraws the SOURCE and ignores the CSS crop entirely — that check passed
// against the broken build, which is exactly the sort of test that proves
// nothing.
const el = await page.$('.pv-photo img');
const shotPng = await el.screenshot();
const bands = await page.evaluate(async (dataUrl) => {
  const im = new Image();
  await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = dataUrl; });
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(im, 0, 0);
  const px = (y) => { const d = ctx.getImageData(Math.round(c.width / 2), y, 1, 1).data; return [d[0], d[1], d[2]]; };
  return { size: c.width + 'x' + c.height, top: px(2), mid: px(Math.round(c.height / 2)), bottom: px(c.height - 3) };
}, 'data:image/png;base64,' + shotPng.toString('base64'));
console.log('sampled pixels:', JSON.stringify(bands));
check('the TOP of the photo is still on screen (red band survives)',
  bands.top[0] > 200 && bands.top[2] < 60, JSON.stringify(bands.top));
check('the BOTTOM of the photo is still on screen (blue band survives)',
  bands.bottom[2] > 200 && bands.bottom[0] < 60, JSON.stringify(bands.bottom));

// The loading placeholder must hold some height so the list doesn't jump.
const wait = await page.evaluate(() => {
  const card = document.querySelector('.pv-card');
  const slot = card.querySelector('.pv-photo');
  slot.innerHTML = '<div class="pv-ph-wait">loading photo…</div>';
  const h = Math.round(slot.getBoundingClientRect().height);
  return h;
});
check('the "loading photo…" slot reserves height', wait >= 120, wait + 'px');

await page.evaluate(() => viewDefectsForAddress(1));
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/79-preview-photos.png` });

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
