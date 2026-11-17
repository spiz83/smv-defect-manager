// The app is called EZ Defect Manager (Spiro 2026-11-17, "Do it" — the
// app-wide half of the rename that had been left for him to call).
//
// These are the places a product name actually lives, and they are easy to
// rename by halves: the tab says one thing, the home-screen icon another, the
// PDF a builder opens a third. Each is checked where it really appears —
// the manifest is fetched, the icons are decoded, the PDF is rendered by the
// real jsPDF and read back.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8145;
const JSPDF = join(__here, 'node_modules/jspdf/dist/jspdf.umd.js');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png',
               '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const NAME = 'EZ Defect Manager';
const NAVY = [26, 47, 98], SKY = [144, 191, 233];

const SEED = {
  addresses: [{ id: 1, lot: '1635', street: 'Lot 1635, Myrtleford Street', streetName: 'Myrtleford Street', lotNo: 1635, suburb: 'Wollert', propertyNumber: '306784', active: true, supervisorName: 'Ian Schroeder' }],
  contractors: [{ id: 1, name: 'Envy Electrical Pty Ltd', isActive: true, trades: 'Electrician' }],
  trades: [],
  defects: [{ id: 1, addressId: 1, contractorId: 1, description: 'Exhaust fans do not terminate externally', location: 'Roof', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' }],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await ctx.route('**', route => {
  const u = route.request().url();
  if (u.startsWith(`http://localhost:${PORT}`)) {
    if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  }
  if (u.includes('jspdf')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(JSPDF, 'utf8') });
  return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
  window.__pdfBlobs = [];
  const origCreate = window.URL.createObjectURL.bind(window.URL);
  window.URL.createObjectURL = (b) => { window.__pdfBlobs.push(b); return origCreate(b); };
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= 1. the browser tab and the home screen =================
console.log('\n--- what the phone and the browser call it ---');
const head = await page.evaluate(async () => {
  const meta = (n) => (document.querySelector(`meta[name="${n}"]`) || {}).content || null;
  const mf = document.querySelector('link[rel=manifest]');
  let manifest = null;
  try { manifest = await (await fetch(mf.href)).json(); } catch (e) { manifest = { error: String(e) }; }
  return { title: document.title, apple: meta('apple-mobile-web-app-title'),
           themeColor: meta('theme-color'), manifest };
});
console.log(JSON.stringify(head, null, 1));
check('the browser tab says the full name', head.title === NAME, JSON.stringify(head.title));
check('the manifest name says the full name', head.manifest.name === NAME, JSON.stringify(head.manifest.name));
// short_name is the label UNDER the icon. iOS truncates it at roughly twelve
// characters, so the full name would render as "EZ Defect…" — it says the
// short form on purpose rather than being cut off mid-word.
check('the under-icon label is short enough not to be truncated',
  head.manifest.short_name.length <= 12, `"${head.manifest.short_name}" (${head.manifest.short_name.length} chars)`);
check('…and still reads as this product',
  /^EZ\b/.test(head.manifest.short_name), head.manifest.short_name);
check('iOS gets the same under-icon label as Android',
  head.apple === head.manifest.short_name, `${head.apple} / ${head.manifest.short_name}`);
check('nothing still carries the bare old product name',
  ![head.title, head.apple, head.manifest.name, head.manifest.short_name]
    .some(v => /^(SMV )?Defect Manager$/.test(String(v))), '');
// The splash and the browser chrome are the icon's navy, so an install does
// not flash indigo around a navy icon.
check('the theme colour matches the icon', head.themeColor.toUpperCase() === '#1A2F62', head.themeColor);
check('…in the manifest too, and the splash background with it',
  head.manifest.theme_color.toUpperCase() === '#1A2F62' &&
  head.manifest.background_color.toUpperCase() === '#1A2F62',
  `${head.manifest.theme_color} / ${head.manifest.background_color}`);

// ================= 2. the icons are the mark ==============================
console.log('\n--- the icons ---');
const icons = await page.evaluate(async ([NAVY, SKY]) => {
  const near = (a, b, tol) => Math.abs(a[0]-b[0]) <= tol && Math.abs(a[1]-b[1]) <= tol && Math.abs(a[2]-b[2]) <= tol;
  const load = (src) => new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let sky = 0, opaque = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] > 250) opaque++;
        if (near([d[i], d[i+1], d[i+2]], SKY, 10)) sky++;
      }
      const px = cv.width * cv.height;
      const corner = [d[0], d[1], d[2], d[3]];
      res({ w: cv.width, h: cv.height, corner,
            skyPct: Math.round(sky / px * 1000) / 10,
            opaquePct: Math.round(opaque / px * 1000) / 10 });
    };
    img.onerror = () => res({ error: 'load failed' });
    img.src = src;
  });
  const out = {};
  for (const f of ['icon-512.png', 'icon-192.png', 'icon-180.png', 'favicon-48.png', 'icon.svg']) out[f] = await load(f);
  out.__navyOk = (c) => near([c[0], c[1], c[2]], NAVY, 6);
  return out;
}, [NAVY, SKY]);
for (const [f, r] of Object.entries(icons)) {
  if (f.startsWith('__')) continue;
  console.log(` ${f.padEnd(16)} ${r.w}x${r.h}  sky ${r.skyPct}%  opaque ${r.opaquePct}%  corner rgba(${(r.corner||[]).join(',')})`);
}
const expect = { 'icon-512.png': 512, 'icon-192.png': 192, 'icon-180.png': 180, 'favicon-48.png': 48, 'icon.svg': 512 };
for (const [f, size] of Object.entries(expect)) {
  const r = icons[f];
  if (r.error) { check(`[${f}] loads`, false, r.error); continue; }
  check(`[${f}] is ${size}x${size}`, r.w === size && r.h === size, `${r.w}x${r.h}`);
  // The old icon was a clipboard on TRANSPARENT. An apple-touch-icon on
  // transparency gets a black square behind it on an iOS home screen.
  check(`[${f}] is opaque, so iOS cannot put black behind it`, r.opaquePct > 99, `${r.opaquePct}%`);
  const c = r.corner;
  check(`[${f}] sits on the brand navy`,
    Math.abs(c[0]-NAVY[0]) <= 6 && Math.abs(c[1]-NAVY[1]) <= 6 && Math.abs(c[2]-NAVY[2]) <= 6,
    `rgb(${c.slice(0,3).join(',')})`);
  check(`[${f}] actually carries the badge`, r.skyPct >= 10, `${r.skyPct}% sky`);
}

// ================= 3. the PDF a builder opens =============================
// The one that leaves the company. Rendered by the real jsPDF and read back,
// because this string is the product's name in front of someone else's trade.
console.log('\n--- the report footer ---');
const pdfB64 = await page.evaluate(async () => {
  const o = { statuses: ['open'], addressIds: [], contractorIds: [], from: null, to: null, photos: false };
  const list = reportFilteredDefects(o);
  await generateDefectPDF(list, o);
  const b = (window.__pdfBlobs || []).slice(-1)[0];
  if (!b) return null;
  const u8 = new Uint8Array(await b.arrayBuffer());
  let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
});
check('a report actually rendered', !!pdfB64, pdfB64 ? `${Math.round(pdfB64.length / 1365)} KB` : 'no bytes');
if (pdfB64) {
  const _pdfjs = await import('./node_modules/pdfjs-dist/legacy/build/pdf.js');
  const { getDocument } = _pdfjs.default || _pdfjs;
  const doc = await getDocument({ data: new Uint8Array(Buffer.from(pdfB64, 'base64')), useSystemFonts: true }).promise;
  let all = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    all += tc.items.map(i => i.str).join(' ') + '\n';
  }
  all = all.replace(/\s+/g, ' ');
  const foot = (all.match(/EZ Defect Manager[^\n]{0,40}/) || [''])[0];
  console.log('footer:', JSON.stringify(foot));
  check('the report footer carries the new name', new RegExp(NAME).test(all), foot);
  check('…and the old one is gone from it', !/SMV Defect Manager/.test(all), '');
}

// ================= 4. the sign-in card ====================================
// Rendered by cloud-sync only when signed out, which this harness is not set
// up for — so the served file is checked instead, and the check says so.
console.log('\n--- the sign-in card (checked in the served source) ---');
const cs = await (await fetch(`http://localhost:${PORT}/cloud-sync.js`)).text();
const renamed = (cs.match(/<div class="lb">EZ DEFECT MANAGER<\/div>/g) || []).length;
const stale = (cs.match(/<div class="lb">DEFECT MANAGER<\/div>/g) || []).length;
check('both brand lines say the new name', renamed === 2, `${renamed} of 2`);
check('…and neither still says the old one', stale === 0, `${stale} left`);

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
