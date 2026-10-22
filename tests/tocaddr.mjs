// Address subheaders in the PDF's Summary Of Defects (Spiro 2026-10-22):
// "I have selected MULTIPLE addresses… I get that it is ideal for 1 ADDRESS
// jobs BUT need to have ADDRESS subheaders. Both for when only 1 trade
// selected or multiple trades selected."
//
// Item numbers belong to the JOB, not the report — which is right, and which
// is exactly why a multi-address contents table listed item 7 twice with
// nothing saying which house either was on.
//
// This suite RENDERS THE REAL PDF. jsPDF normally comes from a CDN the harness
// blocks, which is why the other report suites can only test the pure
// functions; here it is served from tests/node_modules instead, and the result
// read back with pdfjs-dist. The drawing is the thing being changed, so the
// drawing is what gets checked.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const JSPDF = join(__here, 'node_modules/jspdf/dist/jspdf.umd.js');
const ROOT = REPO, PORT = 8135;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const ADDRS = [
  { id: 1, lot: '1', street: 'Lot 1, 14 Skylark Road', streetName: 'Skylark Road', lotNo: 1, suburb: 'GREENVALE', propertyNumber: '306634', active: true },
  { id: 2, lot: '2', street: 'Lot 2, 16 Skylark Road', streetName: 'Skylark Road', lotNo: 2, suburb: 'GREENVALE', propertyNumber: '306635', active: true },
  { id: 3, lot: '3', street: 'Lot 3, 18 Skylark Road', streetName: 'Skylark Road', lotNo: 3, suburb: 'GREENVALE', propertyNumber: '306636', active: true },
];
// Same wordings across the three houses on purpose: without address bands the
// contents is three identical-looking runs of repeated item numbers.
const defects = [];
let id = 100;
ADDRS.forEach(a => {
  [['Carpenter', 2, 'Align door with jamb and adjust margin', 'Entry'],
   ['Carpenter', 2, 'Adjust door margins to 3mm-4mm', 'Bedroom 3'],
   ['Painter', 1, 'Touch up architraves', 'Hallway']].forEach(([, cid, desc, loc]) => {
    defects.push({ id: ++id, addressId: a.id, contractorId: cid, description: desc, location: loc, status: 'open', createdAt: '2026-10-01T00:00:00.000Z' });
  });
});
const SEED = {
  addresses: ADDRS,
  contractors: [
    { id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' },
    { id: 2, name: 'Carpenter', isTradePlaceholder: true, isActive: true, trades: 'Carpenter' },
  ],
  trades: [{ id: 1, name: 'Painter' }, { id: 2, name: 'Carpenter' }],
  defects,
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
  // The one blocked dependency this suite actually needs: serve the real jsPDF
  // from node_modules so the drawing runs.
  if (u.includes('jspdf')) {
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(JSPDF, 'utf8') });
  }
  return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Render a report and hand back the raw PDF bytes.
async function renderPdf(opts) {
  const b64 = await page.evaluate(async (o) => {
    const list = reportFilteredDefects(o);
    // Capture the document instead of downloading it.
    const real = window.savePdfDoc;
    let captured = null;
    window.__grab = (doc) => { captured = doc.output('datauristring'); };
    await generateDefectPDF(list, Object.assign({}, o, { __test_capture: true }));
    return window.__lastPdfDataUri || captured;
  }, opts);
  return b64;
}

// generateDefectPDF saves/opens rather than returning; expose the doc for the
// test by hooking the save step.
await page.evaluate(() => {
  const origCreate = window.URL.createObjectURL ? window.URL.createObjectURL.bind(window.URL) : null;
  window.__pdfBlobs = [];
  if (origCreate) {
    window.URL.createObjectURL = (b) => { window.__pdfBlobs.push(b); return origCreate(b); };
  }
});

const pdfB64 = await page.evaluate(async () => {
  const o = { statuses: ['open'], addressIds: [], contractorIds: [], from: null, to: null, photos: false };
  const list = reportFilteredDefects(o);
  await generateDefectPDF(list, o);
  const b = (window.__pdfBlobs || []).slice(-1)[0];
  if (!b) return null;
  const buf = await b.arrayBuffer();
  let s = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
});

check('the PDF actually rendered', !!pdfB64, pdfB64 ? `${Math.round(pdfB64.length / 1365)} KB` : 'no bytes');

if (pdfB64) {
  const _pdfjs = await import('./node_modules/pdfjs-dist/legacy/build/pdf.js');
  const { getDocument } = _pdfjs.default || _pdfjs;
  const data = Buffer.from(pdfB64, 'base64');
  const doc = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  // The contents pages are at the front.
  const texts = [];
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    texts.push(tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' '));
  }
  const toc = texts.join('\n');
  console.log('\n--- contents text (p1) ---\n' + texts[0].slice(0, 900) + '\n---');

  check('it is the Summary Of Defects page', /Summary Of Defects/.test(toc), '');
  for (const a of ['Lot 1, 14 Skylark Road', 'Lot 2, 16 Skylark Road', 'Lot 3, 18 Skylark Road']) {
    check(`"${a}" appears as a subheader in the contents`, toc.includes(a), '');
  }
  check('each band says how many items are under it',
    (toc.match(/3 items/g) || []).length >= 3, JSON.stringify(toc.match(/\d+ items/g)));
  // The thing that made it unreadable: repeated numbers with no house against them.
  check('…so repeated item numbers are no longer ambiguous',
    /Lot 1[\s\S]*Lot 2[\s\S]*Lot 3/.test(toc), '');
  // Each house really does restart at 1 — that is the behaviour the bands
  // exist to disambiguate, not a bug to fix.
  check('every job restarts its numbering, three times over',
    (toc.match(/ 1 Entry /g) || []).length === 3, String((toc.match(/ 1 Entry /g) || []).length));
  check('no page errors while drawing', errs.length === 0, JSON.stringify(errs));
}

// Spiro was explicit: "Both for when on only 1 trade selected or multiple
// trades selected." Filtering to a single contractor must not take the bands
// away — that is the case where repeated numbers are MOST confusing, because
// every row looks alike.
const oneTrade = await page.evaluate(async () => {
  window.__pdfBlobs = [];
  const o = { statuses: ['open'], addressIds: [], contractorIds: [2], from: null, to: null, photos: false };
  const list = reportFilteredDefects(o);
  await generateDefectPDF(list, o);
  const b = (window.__pdfBlobs || []).slice(-1)[0];
  if (!b) return null;
  const buf = await b.arrayBuffer();
  let s = ''; const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return { b64: btoa(s), n: list.length };
});
if (oneTrade) {
  const _p3 = await import('./node_modules/pdfjs-dist/legacy/build/pdf.js');
  const { getDocument } = _p3.default || _p3;
  const d3 = await getDocument({ data: new Uint8Array(Buffer.from(oneTrade.b64, 'base64')), useSystemFonts: true }).promise;
  const t3 = (await (await d3.getPage(1)).getTextContent()).items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
  console.log('\n--- one trade, three addresses ---\n' + t3.slice(0, 500) + '\n---');
  check('one trade across three jobs still gets address bands',
    ['Lot 1, 14 Skylark', 'Lot 2, 16 Skylark', 'Lot 3, 18 Skylark'].every(a => t3.includes(a)), '');
  check('…and only that trade is in it',
    /Carpenter/.test(t3) && !/Painter/.test(t3), '');
}

// One address must NOT gain a band — the title already says the address.
const singleToc = await page.evaluate(async () => {
  window.__pdfBlobs = [];
  const o = { statuses: ['open'], addressIds: [1], contractorIds: [], from: null, to: null, photos: false };
  await generateDefectPDF(reportFilteredDefects(o), o);
  const b = (window.__pdfBlobs || []).slice(-1)[0];
  if (!b) return null;
  const buf = await b.arrayBuffer();
  let s = ''; const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
});
if (singleToc) {
  const _pdfjs = await import('./node_modules/pdfjs-dist/legacy/build/pdf.js');
  const { getDocument } = _pdfjs.default || _pdfjs;
  const d2 = await getDocument({ data: new Uint8Array(Buffer.from(singleToc, 'base64')), useSystemFonts: true }).promise;
  const pg = await d2.getPage(1);
  const t = (await pg.getTextContent()).items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
  console.log('\n--- single-address contents ---\n' + t.slice(0, 400) + '\n---');
  check('a single-address report says the address in the TITLE, as before',
    /Summary Of Defects For .*Skylark/.test(t), t.slice(0, 120));
  check('…and does not repeat it as a band over its own rows',
    (t.match(/Lot 1, 14 Skylark Road/g) || []).length === 1,
    String((t.match(/Lot 1, 14 Skylark Road/g) || []).length));
}

console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
