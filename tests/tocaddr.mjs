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
  { id: 1, lot: '2', street: 'Lot 2, 16 Skylark Road', streetName: 'Skylark Road', lotNo: 2, suburb: 'GREENVALE', propertyNumber: '306634', active: true },
  // Lot 10 is the one a plain string sort puts between Lot 1 and Lot 2.
  { id: 2, lot: '10', street: 'Lot 10, 32 Skylark Road', streetName: 'Skylark Road', lotNo: 10, suburb: 'GREENVALE', propertyNumber: '306635', active: true },
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
  for (const a of ['Lot 2, 16 Skylark Road', 'Lot 3, 18 Skylark Road', 'Lot 10, 32 Skylark Road']) {
    check(`"${a}" appears as a subheader in the contents`, toc.includes(a), '');
  }
  check('each band says how many items are under it',
    (toc.match(/3 items/g) || []).length >= 3, JSON.stringify(toc.match(/\d+ items/g)));
  // The thing that made it unreadable: repeated numbers with no house against them.
  check('…so repeated item numbers are no longer ambiguous',
    /Lot 2,[\s\S]*Lot 3,[\s\S]*Lot 10,/.test(toc), '');
  check('lots sort NUMERICALLY — Lot 10 after Lot 3, not between 1 and 2',
    toc.indexOf('Lot 10,') > toc.indexOf('Lot 3,'), '');
  // Each house really does restart at 1 — that is the behaviour the bands
  // exist to disambiguate, not a bug to fix.
  check('every job restarts its numbering, three times over',
    (toc.match(/ 1 Entry /g) || []).length === 3, String((toc.match(/ 1 Entry /g) || []).length));
  check('no page errors while drawing', errs.length === 0, JSON.stringify(errs));
}

// ================= THE BODY MUST FOLLOW THE CONTENTS =====================
// Spiro 2026-10-26: "the table of contents seems like it's in order of the
// addresses, however the photos don't appear to be in the order of the
// addresses." The contents was banded by address while the body was still
// grouped by trade, so the two disagreed and the page numbers ran backwards
// and forwards. A contents that does not match the document it indexes is
// worse than no contents.
{
  const _p4 = await import('./node_modules/pdfjs-dist/legacy/build/pdf.js');
  const { getDocument } = _p4.default || _p4;
  const d4 = await getDocument({ data: new Uint8Array(Buffer.from(pdfB64, 'base64')), useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= d4.numPages; p++) {
    const tc = await (await d4.getPage(p)).getTextContent();
    pages.push(tc.items.map(i => i.str).join(' ').replace(/\s+/g, ' '));
  }
  const all = pages.join('\n');
  const want = ['Lot 2, 16 Skylark Road', 'Lot 3, 18 Skylark Road', 'Lot 10, 32 Skylark Road'];
  // Where each address LAST appears in the contents vs where its body section
  // header falls: both must run in the same order.
  const bodyText = pages.slice(1).join('\n');   // page 1 is the contents
  const bodyPos = want.map(a => bodyText.indexOf(a));
  console.log('\nbody section order:', JSON.stringify(bodyPos));
  check('every job gets its own section in the BODY, not just the contents',
    bodyPos.every(i => i >= 0), JSON.stringify(bodyPos));
  check('…and the body runs in the same order as the contents',
    bodyPos[0] < bodyPos[1] && bodyPos[1] < bodyPos[2], JSON.stringify(bodyPos));
  check('…so a page number in the contents points forwards, not backwards',
    /Lot 2,[\s\S]*Lot 3,[\s\S]*Lot 10,/.test(all), '');
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
    ['Lot 2, 16 Skylark', 'Lot 3, 18 Skylark', 'Lot 10, 32 Skylark'].every(a => t3.includes(a)), '');
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
    (t.match(/Lot 2, 16 Skylark Road/g) || []).length === 1,
    String((t.match(/Lot 2, 16 Skylark Road/g) || []).length));
}

// ================= EVERY PHOTO ON A DEFECT REACHES THE PDF ================
// Spiro 2026-11-01: "posted six photos however only three showed up on the
// report." The fetch capped at 3 while photoBlock() was written to shrink its
// cells so every photo fits — the two halves disagreed and the fetch won,
// silently. Counting the images actually painted into the PDF is the only
// check that would have caught that, because both halves "looked right".
console.log('\n--- six photos on one defect ---');
const sixPhotos = await page.evaluate(async () => {
  // A 2x2 JPEG, enough to be a real image in the document.
  const mk = (n) => {
    const c = document.createElement('canvas');
    c.width = 40; c.height = 30;
    const g = c.getContext('2d');
    g.fillStyle = ['#c00', '#0c0', '#00c', '#cc0', '#0cc', '#c0c'][n % 6];
    g.fillRect(0, 0, 40, 30);
    return { dataUrl: c.toDataURL('image/jpeg', 0.8), w: 40, h: 30 };
  };
  const six = [0, 1, 2, 3, 4, 5].map(mk);
  window.CloudPhotos = { getForPdf: async () => six.slice() };
  window.__pdfBlobs = [];
  const o = { statuses: ['open'], addressIds: [1], contractorIds: [], from: null, to: null, photos: true };
  const list = reportFilteredDefects(o).slice(0, 1);   // one defect, six photos
  await generateDefectPDF(list, o);
  const b = (window.__pdfBlobs || []).slice(-1)[0];
  if (!b) return null;
  const buf = await b.arrayBuffer();
  let str = ''; const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i++) str += String.fromCharCode(u8[i]);
  return { b64: btoa(str), asked: six.length };
});

if (sixPhotos) {
  const _p5 = await import('./node_modules/pdfjs-dist/legacy/build/pdf.js');
  const { getDocument, OPS } = _p5.default || _p5;
  const d5 = await getDocument({ data: new Uint8Array(Buffer.from(sixPhotos.b64, 'base64')), useSystemFonts: true }).promise;
  let painted = 0;
  for (let p = 1; p <= d5.numPages; p++) {
    const ops = await (await d5.getPage(p)).getOperatorList();
    painted += ops.fnArray.filter(fn => fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject).length;
  }
  // The company logo is drawn on the contents page and on each body page.
  console.log(`images painted: ${painted} (6 photos + logos)`);
  check('all six photos are painted into the PDF, not three',
    painted >= 6, `painted ${painted}, expected at least 6`);
}

// And the cap itself, read off the source rather than trusted from memory.
const capSrc = fs.readFileSync(join(REPO, 'cloud-sync.js'), 'utf8');
const capMatch = capSrc.match(/const PDF_PHOTOS_PER_DEFECT = (\d+);/);
check('the per-defect photo cap is declared once, as a named constant',
  !!capMatch, capMatch ? capMatch[0] : 'not found');
check('…and is well above the six angles a supervisor actually takes',
  capMatch && Number(capMatch[1]) >= 12, capMatch && capMatch[1]);
check('…with no stray default of 3 left behind',
  !/photoDataUrlsForDefect\(legacyId, limit = 3\)/.test(capSrc), '');
// Honest about what the check above does and does not reach: the stub feeds
// six images straight to the drawing, so it proves photoBlock lays out six —
// it does NOT exercise the fetch that was doing the capping. That path is
// buried in cloud-sync's closure behind IndexedDB and Supabase, so the cap
// itself is guarded by reading the constant, not by running it.

console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
