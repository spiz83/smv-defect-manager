// DRAG A REPORT STRAIGHT OUT OF AN EMAIL (Spiro 2026-11-19).
//
//   "In the tap to choose PDF box I also want the ability that I can drag and
//    drop straight from an email attachment into that box and it can read it,
//    saves me having to save onto my computer."
//
// The one-line version of this feature does not do that job, and that is the
// whole point of this suite. An attachment dragged out of the Outlook desktop
// app is a VIRTUAL file: there is nothing on disk, so `dataTransfer.files` is
// EMPTY and `files[0]` is undefined. The drop appears to do nothing — the
// worst possible answer, because it looks like the feature shipped broken.
// Chromium hands those bytes over through `items[i].webkitGetAsEntry()`.
//
// Section 2 is that case, built the only way it can be in a test: a
// DataTransfer with no files and an item that only answers webkitGetAsEntry,
// which is exactly the shape Chromium presents for an Outlook attachment.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8178;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 850 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await ctx.route('**', route => {
  const u = route.request().url();
  if (u.startsWith(`http://localhost:${PORT}`)) {
    if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  }
  // pdf.js is a real dependency of this path and the CDN is off-limits in the
  // sandbox, so cdnjs is served from the local npm copy — same build.
  const PDFJS = join(__here, 'node_modules/pdfjs-dist/build');
  if (u.includes('pdf.worker.min.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${PDFJS}/pdf.worker.min.js`) });
  if (u.includes('pdf.min.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(`${PDFJS}/pdf.min.js`) });
  return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
await page.addInitScript(() => {
  localStorage.setItem('defectTrackerDB', JSON.stringify({
    addresses: [{ id: 1, lot: '5', street: 'Lot 5, 22 Skylark Road', streetName: 'Skylark Road',
                  lotNo: 5, suburb: 'Greenvale', propertyNumber: '306634', active: true }],
    contractors: [{ id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' }],
    trades: [], defects: [],
  }));
  localStorage.setItem('dm_preview', '0');
});
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });


// ── helpers ───────────────────────────────────────────────────────────────
const PDF_BYTES = Array.from(fs.readFileSync(join(__here, 'artifacts', 'private-report.pdf')));

const openDialog = (type) => page.evaluate((t) => {
  const ov = document.getElementById('imp-ov'); if (ov) ov.remove();
  document.querySelectorAll('.toast').forEach(x => x.remove());
  try { _review = null; } catch (e) {}
  openReportImport();
  if (t) document.getElementById('imp-type').value = t;
  return !!document.getElementById('imp-card');
}, type || '');

// What the dialog is HOLDING. Staging and reading are separate acts now, and
// the gap between them is exactly where the bug lived, so they are checked
// separately.
const staged = () => page.evaluate(() => ({
  file: (typeof _impStaged !== 'undefined' && _impStaged)
    ? { name: _impStaged.file.name, size: _impStaged.file.size, kind: _impStaged.kind } : null,
  shown: (() => { const r = document.getElementById('imp-chosen');
                  return r && r.style.display !== 'none' ? r.textContent.replace(/\s+/g, ' ').trim() : ''; })(),
  button: (document.getElementById('imp-extract') || {}).textContent || '',
  toast: (document.querySelector('.toast') || {}).textContent || '',
}));

// Drop a File built in the page. `virtual` models an Outlook attachment:
// nothing in `files`, nothing from getAsFile(), bytes only behind the entry.
const drop = (bytes, name, type, opts) => page.evaluate(async ([bytes, name, type, o]) => {
  const f = new File([new Uint8Array(bytes)], name, type ? { type } : undefined);
  const target = document.getElementById(o.target || 'imp-drop');
  if (o.virtual) {
    const fake = { files: [], types: ['Files'], items: [{ kind: 'file', getAsFile: () => null,
      webkitGetAsEntry: () => ({ isFile: true, isDirectory: false, name, file: (cb) => cb(f) }) }] };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: fake });
    target.dispatchEvent(ev);
  } else {
    const dt = new DataTransfer(); dt.items.add(f);
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }
  await new Promise(r => setTimeout(r, 120));
}, [bytes, name, type || '', opts || {}]);

// Press Extract and wait for the review (or the message that says why not).
const extractAndWait = () => page.evaluate(async () => {
  document.getElementById('imp-extract').click();
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 100));
    let rv = null;
    try { rv = (typeof _review !== 'undefined' && _review) ? _review : null; } catch (e) {}
    const card = (document.getElementById('imp-card') || {}).textContent || '';
    if (rv) return { type: rv.reportType, n: rv.items.length,
                     items: rv.items.slice(0, 3).map(x => typeof x === 'string' ? x : (x.description || x.text || '')) };
    if (/No defects were found|Could not read/i.test(card)) return { msg: card.replace(/\s+/g, ' ').slice(0, 90) };
  }
  return { timeout: true, card: ((document.getElementById('imp-card') || {}).textContent || '').replace(/\s+/g, ' ').slice(0, 90) };
});

const TXT = Array.from(Buffer.from([
  'DEFECTS',
  '1. Touch up paint to hallway wall near light switch.',
  '2. Adjust front entry door — binding on the strike plate.',
  '3. Clean overpaint from splashback tiles in the kitchen.',
].join('\n'), 'utf8'));

// ── 1. An ordinary file drag, from a folder ───────────────────────────────
check('the Add Report dialog opens', await openDialog('Private Inspection'), '');
{
  await drop(TXT, 'Inspection.txt', 'text/plain', {});
  const st = await staged();
  check('a file dropped on the box is held, not read on the spot',
    st.file && st.file.name === 'Inspection.txt' && st.file.kind === 'text', JSON.stringify(st.file));
  check('…and the dialog shows what it is holding',
    /Inspection\.txt/.test(st.shown) && /text/.test(st.shown), st.shown);
  check('…and the button says what it will now do', /Read this report/i.test(st.button), st.button);
}

// ── 1b. The picker reads straight away; the drop waits ───────────────────
// The two paths behave DIFFERENTLY on purpose, and that is worth pinning down
// rather than leaving to luck. Picking a file is the last thing you do, after
// setting Report type, so there is nothing left to wait for (Spiro 2026-11-19:
// "leave the picker how it was before"). A drop is the first thing you do, so
// it holds the file until Extract is pressed. Both halves are checked here:
// if either drifts into the other's behaviour, one of these fails.
await openDialog('Private Inspection');
{
  // Something is already waiting from a drop …
  await drop(TXT, 'Dropped.txt', 'text/plain', {});
  const before = await staged();
  await page.setInputFiles('#imp-file', join(__here, 'artifacts', 'private-report.pdf'));
  const r = await page.evaluate(async () => {
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 100));
      let rv = null;
      try { rv = (typeof _review !== 'undefined' && _review) ? _review : null; } catch (e) {}
      const card = (document.getElementById('imp-card') || {}).textContent || '';
      if (rv) return { n: rv.items.length, name: rv.reportName,
                       stillStaged: typeof _impStaged !== 'undefined' && !!_impStaged };
      if (/No defects were found|Could not read/i.test(card)) return { msg: card.slice(0, 80) };
    }
    return { timeout: true };
  });
  check('a file chosen with the button is read without pressing Extract',
    r.n > 0 && /private-report\.pdf/i.test(r.name || ''), JSON.stringify(r).slice(0, 140));
  check('…and it clears whatever a drop had left waiting',
    before.file && before.file.name === 'Dropped.txt' && r.stillStaged === false,
    'was holding ' + JSON.stringify(before.file) + ', still staged after: ' + r.stillStaged);
}

// ── 2. THE ONE THAT MATTERS: an Outlook attachment ────────────────────────
// No file on disk: `files` is empty, getAsFile() gives nothing, and the bytes
// are only reachable through the entry. Written with `files` genuinely empty,
// because a test that leaves a file there would pass against the one-liner
// this whole feature exists to replace.
await openDialog('Private Inspection');
{
  await drop(PDF_BYTES, 'Private Inspection Report.pdf', 'application/pdf', { virtual: true });
  const st = await staged();
  check('an email attachment with NO file on disk is still picked up',
    st.file && st.file.name === 'Private Inspection Report.pdf' && st.file.size > 1000,
    JSON.stringify(st.file) + (st.toast ? ' toast: ' + st.toast : ''));
}

// ── 3. THE BUG SPIRO HIT: the settings are read when you press Extract ────
// A drop is the FIRST thing you do; choosing a file is the LAST. The old code
// started the import on the drop, so the report type was still on its default
// of BPI and a private report went through the BPI parser — "garbage text that
// doesn't follow the rules". The control underneath proves the two types
// really do produce different results for this file, so the check above it is
// not passing on a coincidence.
await openDialog('BPI');
{
  await drop(PDF_BYTES, 'HomeSure Report.pdf', 'application/pdf', { virtual: true });
  await page.evaluate(() => { document.getElementById('imp-type').value = 'Private Inspection'; });
  const r = await extractAndWait();
  check('the report type is read when Extract is pressed, not when the file lands',
    r.type === 'Private Inspection' && r.n > 0,
    JSON.stringify(r).slice(0, 170));
}
await openDialog('BPI');
{
  await drop(PDF_BYTES, 'HomeSure Report.pdf', 'application/pdf', {});
  const r = await extractAndWait();
  // The other direction of the same property: left alone, the type showing
  // when Extract is pressed is still the one used. Without this pair, the
  // check above could pass on a dialog that simply always says Private.
  check('…and a file extracted with BPI still showing is read as BPI',
    r.type === 'BPI' || /No defects/i.test(r.msg || ''), JSON.stringify(r).slice(0, 120));
}

// ── 4. The bytes decide what a file is, not its name ──────────────────────
// An attachment can arrive with no extension and no MIME type. It is still a
// PDF, and reading one as text is the mojibake the parser turns into defects.
await openDialog('Private Inspection');
{
  await drop(PDF_BYTES, 'ATT00001', '', { virtual: true });
  const st = await staged();
  check('a PDF with no extension and no MIME type is recognised from its bytes',
    st.file && st.file.kind === 'pdf', JSON.stringify(st.file) + ' ' + st.toast);
  const r = await extractAndWait();
  check('…and it reads as a PDF, not as a page of mojibake',
    r.n > 0 && r.items.some(t => /kitchen|ceiling|grout|shower/i.test(t)),
    JSON.stringify(r).slice(0, 170));
}
await openDialog('Private Inspection');
{
  // A .docx is a zip. Named .txt it would once have been read as text.
  await drop([80, 75, 3, 4, 20, 0, 6, 0, 8, 0, 0, 0, 33, 0, 0, 1, 2, 3], 'Report.txt', 'text/plain', {});
  const st = await staged();
  check('binary dressed up as text is refused, not parsed',
    !st.file && /not a PDF and not readable text/i.test(st.toast), st.toast || JSON.stringify(st.file));
}

// ── 5. A near miss anywhere on the card still counts ──────────────────────
await openDialog('Private Inspection');
{
  await drop(TXT, 'Report.txt', 'text/plain', { target: 'imp-paste' });
  const st = await staged();
  check('a drop that misses the box but lands on the card still counts',
    st.file && st.file.name === 'Report.txt', JSON.stringify(st.file));
}

// ── 6. A drop that carries no file is explained, not ignored ──────────────
// Built inside the page: a DataTransfer's accessors are functions, and
// functions do not survive the crossing into page.evaluate.
for (const [label, shape, want] of [
  ['only a link (webmail)', 'link', /web page|link/i],
  ['a folder', 'folder', /folder/i],
]) {
  await openDialog('Private Inspection');
  const r = await page.evaluate(async (shape) => {
    const fake = shape === 'link'
      ? { files: [], items: [], types: ['text/uri-list', 'text/html'] }
      : { files: [], types: ['Files'], items: [{ kind: 'file', getAsFile: () => null,
          webkitGetAsEntry: () => ({ isFile: false, isDirectory: true, name: 'Reports' }) }] };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: fake });
    document.getElementById('imp-drop').dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 90));
    return { staged: typeof _impStaged !== 'undefined' && !!_impStaged,
             toast: (document.querySelector('.toast') || {}).textContent || '' };
  }, shape);
  check('a drop carrying ' + label + ' is explained, not ignored',
    !r.staged && want.test(r.toast), r.toast);
}

// ── 7. End to end, through the real reader ────────────────────────────────
await openDialog('Private Inspection');
{
  await drop(TXT, 'Skylark Inspection.txt', 'text/plain', {});
  const r = await extractAndWait();
  check('a dropped report is read, and its own words come up for review',
    !!r.items && r.items.some(t => /hallway wall/i.test(t)),
    JSON.stringify(r).slice(0, 200));
}

// ── 8. A miss outside the dialog must not replace the app with the PDF ────
{
  const r = await page.evaluate(async () => {
    const ov = document.getElementById('imp-ov'); if (ov) ov.remove();
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'Report.pdf', { type: 'application/pdf' }));
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 40));
    return { prevented: ev.defaultPrevented, stillApp: !!document.getElementById('app') };
  });
  check('a PDF dropped anywhere else is swallowed, not opened over the app',
    r.prevented && r.stillApp, '');
}

// ── 9. One reader, not two ────────────────────────────────────────────────
{
  const src = fs.readFileSync(join(REPO, 'index.html'), 'utf8');
  const lines = src.split('\n').map((l, i) => ({ n: i + 1, l: l.trim() }))
    .filter(x => !x.l.startsWith('//') && !x.l.startsWith('*') && !x.l.startsWith('/*'))
    .filter(x => /dataTransfer\s*(&&\s*[\w.]+\s*)?\.?\s*files/.test(x.l) || /dataTransfer\.items/.test(x.l));
  const outside = lines.filter(x => !/const items = dt|const plain = dt/.test(x.l));
  check('every dropped file goes through the one reader',
    outside.length === 0, outside.map(x => x.n + ': ' + x.l.slice(0, 70)).join(' | '));
  check('the plan attach zone uses it too', /impWireDrop\(drop, drop,/.test(src), '');
}

check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
server.close();
console.log(fail.length ? 'FAILED: ' + fail.join('; ') : 'ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
