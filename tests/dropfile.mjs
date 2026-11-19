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

// The test's own instrument: record what reaches the ONE entry point every
// path is supposed to end at. Reassigning the global works because the drop
// handler resolves the name at call time — which is itself worth knowing: if
// someone inlines the handler into the drop, these checks go quiet, and the
// "the real reader ran" check at the end is what catches that.
await page.evaluate(() => {
  window.__got = [];
  const real = window.impHandleReportFile;
  window.__real = real;
  window.impHandleReportFile = async (f) => {
    window.__got.push({ name: f && f.name, size: f && f.size, type: f && f.type });
  };
});

const openDialog = () => page.evaluate(() => {
  const ov = document.getElementById('imp-ov'); if (ov) ov.remove();
  window.__got = [];
  document.querySelectorAll('.toast').forEach(t => t.remove());
  openReportImport();
  return !!document.getElementById('imp-card');
});
const toast = () => page.evaluate(() => {
  const t = document.querySelector('.toast');
  return t ? t.textContent : '';
});

// ── 1. An ordinary file drag, from a folder ───────────────────────────────
check('the Add Report dialog opens', await openDialog(), '');
{
  const r = await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['- Touch up paint to hallway wall\n- Adjust front door'],
                          'Inspection.txt', { type: 'text/plain' }));
    const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
    document.getElementById('imp-drop').dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 60));
    return { got: window.__got, prevented: ev.defaultPrevented };
  });
  check('a file dropped on the box reaches the reader',
    r.got.length === 1 && r.got[0].name === 'Inspection.txt' && r.got[0].size > 0, JSON.stringify(r.got));
  check('…and the browser is stopped from opening it instead', r.prevented, '');
}

// ── 2. THE ONE THAT MATTERS: an Outlook attachment ────────────────────────
// No file on disk: `files` is empty, `getAsFile()` gives nothing, and the
// bytes are only reachable through the entry. Written with `files` genuinely
// empty, because a test that leaves a file in there would pass against the
// one-liner this change exists to replace.
await openDialog();
{
  const r = await page.evaluate(async () => {
    const real = new File(['- Seal junction between ceiling and wall'],
                          'Private Inspection Report.pdf', { type: 'application/pdf' });
    const fake = {
      files: [],                                   // ← Outlook gives none
      types: ['Files'],
      items: [{
        kind: 'file',
        getAsFile: () => null,                     // ← and nothing here either
        webkitGetAsEntry: () => ({
          isFile: true, isDirectory: false, name: real.name,
          file: (cb) => cb(real),
        }),
      }],
    };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: fake });
    document.getElementById('imp-drop').dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 80));
    return { got: window.__got, toast: (document.querySelector('.toast') || {}).textContent || '' };
  });
  check('an email attachment with NO file on disk still reaches the reader',
    r.got.length === 1 && r.got[0].name === 'Private Inspection Report.pdf' && r.got[0].size > 0,
    JSON.stringify(r.got) + (r.toast ? ' toast: ' + r.toast : ''));
}

// ── 3. A near miss anywhere on the card still counts ──────────────────────
await openDialog();
{
  const r = await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['- Adjust door rattle'], 'Report.txt', { type: 'text/plain' }));
    document.getElementById('imp-paste').dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 60));
    return window.__got;
  });
  check('a drop that misses the box but lands on the card still counts',
    r.length === 1 && r[0].name === 'Report.txt', JSON.stringify(r));
}

// ── 4. Webmail hands over a link, not a file — say so ─────────────────────
await openDialog();
{
  const r = await page.evaluate(async () => {
    const fake = { files: [], items: [], types: ['text/uri-list', 'text/html'] };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: fake });
    document.getElementById('imp-drop').dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 60));
    return { got: window.__got, toast: (document.querySelector('.toast') || {}).textContent || '' };
  });
  check('a drop that carries only a link is explained, not ignored',
    r.got.length === 0 && /web page|link/i.test(r.toast), JSON.stringify(r.toast));
}

// ── 5. A folder, and an empty attachment ──────────────────────────────────
await openDialog();
{
  const r = await page.evaluate(async () => {
    const fake = { files: [], types: ['Files'], items: [{
      kind: 'file', getAsFile: () => null,
      webkitGetAsEntry: () => ({ isFile: false, isDirectory: true, name: 'Reports' }) }] };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: fake });
    document.getElementById('imp-drop').dispatchEvent(ev);
    await new Promise(r => setTimeout(r, 60));
    return { got: window.__got, toast: (document.querySelector('.toast') || {}).textContent || '' };
  });
  check('a folder is named as a folder', r.got.length === 0 && /folder/i.test(r.toast), r.toast);
}

// ── 6. The wrong kind of file, through the REAL reader ────────────────────
// extractReportText falls back to file.text() for anything that is not a PDF,
// so a .docx would be read as binary and "extract" a page of mojibake. This
// one runs against the real function, not the instrument.
await openDialog();
{
  const r = await page.evaluate(async () => {
    window.impHandleReportFile = window.__real;
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([80, 75, 3, 4, 20, 0])], 'Report.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    document.getElementById('imp-drop').dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 120));
    const t = (document.querySelector('.toast') || {}).textContent || '';
    const still = !!document.getElementById('imp-drop');
    return { toast: t, still };
  });
  check('a .docx is refused by name rather than read as gibberish',
    /not a PDF or text file/i.test(r.toast), r.toast);
  check('…and the dialog stays open so you can try the right file', r.still, '');
}

// ── 7. The real reader actually reads a dropped report ────────────────────
// Everything above proves the plumbing. This proves the pipe has water in it:
// no instrument, a real text report, and the review screen it produces.
await openDialog();
{
  const r = await page.evaluate(async () => {
    window.impHandleReportFile = window.__real;
    document.getElementById('imp-type').value = 'Private Inspection';
    const body = [
      'DEFECTS',
      '1. Touch up paint to hallway wall near light switch.',
      '2. Adjust front entry door — binding on the strike plate.',
      '3. Clean overpaint from splashback tiles in the kitchen.',
    ].join('\n');
    const dt = new DataTransfer();
    dt.items.add(new File([body], 'Skylark Inspection.txt', { type: 'text/plain' }));
    document.getElementById('imp-drop').dispatchEvent(
      new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const items = () => {
      // The parser emits plain strings; other paths emit objects. Take both.
      try { return (typeof _review !== 'undefined' && _review)
        ? _review.items.map(i => (typeof i === 'string' ? i : (i && (i.description || i.text || i.raw)) || ''))
        : null; }
      catch (e) { return null; }
    };
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      const got = items();
      const card = document.getElementById('imp-card');
      const txt = card ? card.textContent : '';
      if ((got && got.length) || /Nothing|could not|No defects/i.test(txt)) {
        return { items: got, txt: txt.replace(/\s+/g, ' ').slice(0, 200) };
      }
    }
    const card = document.getElementById('imp-card');
    return { items: items(), txt: card ? card.textContent.replace(/\s+/g, ' ').slice(0, 200) : '(no card)' };
  });
  // The file's own words, out the other end — not just "a screen appeared".
  check('a dropped report is read, and its defects come up for review',
    !!r.items && r.items.some(t => /hallway wall/i.test(t))
             && r.items.some(t => /splashback/i.test(t)),
    (r.items ? r.items.length + ' items: ' + JSON.stringify(r.items).slice(0, 180) : 'no review: ' + r.txt));
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
// The plan attach zone had its own dataTransfer.files[0] line, which would
// have done nothing with an Outlook attachment. A second reader anywhere is
// the same bug waiting to be reintroduced, so this reads the source.
{
  const src = fs.readFileSync(join(REPO, 'index.html'), 'utf8');
  const lines = src.split('\n')
    .map((l, i) => ({ n: i + 1, l: l.trim() }))
    // Prose about the bug is not a second reader of it.
    .filter(x => !x.l.startsWith('//') && !x.l.startsWith('*') && !x.l.startsWith('/*'))
    .filter(x => /dataTransfer\s*(&&\s*[\w.]+\s*)?\.?\s*files/.test(x.l) || /dataTransfer\.items/.test(x.l));
  const outside = lines.filter(x => !/const items = dt|const plain = dt/.test(x.l));
  check('every dropped file goes through the one reader',
    outside.length === 0, outside.map(x => x.n + ': ' + x.l.trim().slice(0, 70)).join(' | '));
  check('the plan attach zone uses it too', /impWireDrop\(drop, drop,/.test(src), '');
}

check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
server.close();
console.log(fail.length ? 'FAILED: ' + fail.join('; ') : 'ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
