// The addresses, on the screen that tells you to type them (Spiro 2026-11-17):
// "any time this screen comes up, I want the ability for the user to review
// available email addresses + copy them. Email addresses would be on grounds of
// what we discussed yesterday on the CH tracker repo."
//
// That last line matters: the addresses come from the SupplierDirectory work —
// Framework's Look Up directory, pinned by supplier code, general email first,
// accounts@/receivable inboxes dropped. This suite does not re-litigate any of
// that (supdir.mjs owns it); it checks that whatever that resolves to actually
// reaches the Attach-to-email sheet, with its source, and can be copied.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8139;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [{ id: 1, lot: '511', street: 'Lot 511, 14 Bristlecone Street', streetName: 'Bristlecone Street', lotNo: 511, suburb: 'BEVERIDGE', propertyNumber: '306666', active: true }],
  contractors: [
    // One saved address of its own, plus whatever the directory adds.
    { id: 1, name: 'Shera Bricklaying Pty Ltd', supplierCode: 'SHERA01', email: 'office@shera.com.au', isActive: true, trades: 'Bricklayer' },
    { id: 2, name: 'Matthew Carpentry', supplierCode: 'MATT01', email: '', isActive: true, trades: 'Carpenter' },
    { id: 3, name: 'No Email Co', isActive: true, trades: 'Painter' },
  ],
  trades: [], defects: [
    { id: 11, addressId: 1, contractorId: 1, description: 'Bricks step at fascia', location: 'Front Elevation', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 12, addressId: 1, contractorId: 2, description: 'Align door with jamb', location: 'Entry', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' },
  ],
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

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Feed the directory the way a pull does, so this exercises the real path.
await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  window.SupplierDirectory.setRows([
    { code: 'SHERA01', name: 'Shera Bricklaying Pty Ltd', email: 'defects@shera.com.au', callup_email: 'callups@shera.com.au', active: true },
    // accounts@ must never reach the sheet — supdir.mjs owns that rule; this
    // is here so a regression shows up where a supervisor would see it.
    { code: 'MATT01', name: 'Matthew Carpentry', email: 'accounts@matthew.com.au, matt@matthew.com.au', callup_email: '', active: true },
  ], db.getContractors());
  render();
});

// ================= 1. what the book resolves to ===========================
console.log('\n--- the address book for this job ---');
const book = await page.evaluate(() => emailBookForDefects(db.getDefects({ addressId: 1 })));
console.log(JSON.stringify(book, null, 1));
check('the directory address comes first for a pinned supplier',
  book[0] && book[0].email === 'defects@shera.com.au', JSON.stringify(book[0]));
check('…tagged with where it came from', book[0] && /Look Up/.test(book[0].src), book[0] && book[0].src);
check('the call-up address is offered too, and says so',
  book.some(b => b.email === 'callups@shera.com.au' && /call-up/.test(b.src)), JSON.stringify(book.map(b => b.src)));
check('…and the address saved on the contractor is kept as well',
  book.some(b => b.email === 'office@shera.com.au' && b.src === 'saved'), JSON.stringify(book));
check('every supplier on the job is represented',
  book.some(b => /matthew/i.test(b.email)), JSON.stringify(book.map(b => b.email)));
check('an accounts@ inbox never reaches the sheet',
  !book.some(b => /^accounts@/i.test(b.email)), JSON.stringify(book.map(b => b.email)));
check('a supplier with no address at all contributes nothing, rather than a blank row',
  book.every(b => b.email && b.email.includes('@')), JSON.stringify(book));
check('no address is listed twice', new Set(book.map(b => b.email.toLowerCase())).size === book.length,
  JSON.stringify(book.map(b => b.email)));

// ================= 2. the sheet shows them ================================
console.log('\n--- the Attach to email sheet ---');
const sheet = await page.evaluate(async () => {
  // Drive sharePdfOnTap directly with a stub file: the PDF build and the OS
  // share sheet are not what this is about, and neither runs in a harness.
  const copied = [];
  // navigator.clipboard is a read-only getter — a plain assignment is silently
  // ignored and the real (rejecting) clipboard is used instead.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
    configurable: true,
  });
  const file = new File([new Blob(['x'])], 'Matthew_17.11_Items.pdf', { type: 'application/pdf' });
  navigator.canShare = () => true;
  navigator.share = () => new Promise(() => {});      // never resolves; we only inspect the sheet
  sharePdfOnTap(file, 'Attach to email', 'note',
    { subject: 'Defects - Lot 511', body: 'b', book: emailBookForDefects(db.getDefects({ addressId: 1 })) });
  await new Promise(r => setTimeout(r, 60));
  const rows = [...document.querySelectorAll('#imp-ov .sh-addr')];
  const head = (document.querySelector('#imp-ov #imp-body') || {}).textContent || '';
  const out = {
    defaultTicks: [...document.querySelectorAll('#imp-ov .sh-box')].map(b => b.textContent.trim() === '\u2713'),
    defaultBtn: (document.querySelector('#imp-ov .sh-copysel') || {}).textContent,
    rows: rows.length,
    emails: rows.map(r => r.getAttribute('data-e')),
    shownText: rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()),
    hasCopySel: !!document.querySelector('#imp-ov .sh-copysel'),
    countedInHeader: /\d+ addresses/.test(head),
    stillHasAttach: !!document.getElementById('sh-go'),
    stillHasSubject: !!document.querySelector('#imp-ov .sh-copy'),
  };
  // Tick a second address, then copy the selection.
  rows[1].click();
  document.querySelector('#imp-ov .sh-copysel').click();
  await new Promise(r => setTimeout(r, 30));
  out.afterTick = {
    ticks: [...document.querySelectorAll('#imp-ov .sh-box')].map(b => b.textContent.trim() === '\u2713'),
    btn: (document.querySelector('#imp-ov .sh-copysel') || {}).textContent,
  };
  // The 📋 on a row copies that one address and must NOT change the selection.
  [...document.querySelectorAll('#imp-ov .sh-addr')][2].querySelector('.sh-one').click();
  await new Promise(r => setTimeout(r, 30));
  out.afterOne = [...document.querySelectorAll('#imp-ov .sh-box')].map(b => b.textContent.trim() === '\u2713');
  out.copied = copied.slice();
  impClose();
  return out;
});
console.log('sheet:', JSON.stringify(sheet, null, 1));
check('every address is listed on the sheet', sheet.rows === book.length, `${sheet.rows} rows vs ${book.length} addresses`);
check('…in the book\'s order', JSON.stringify(sheet.emails) === JSON.stringify(book.map(b => b.email)), JSON.stringify(sheet.emails));
check('…each showing where it came from',
  sheet.shownText.some(t => /Look Up/.test(t)) && sheet.shownText.some(t => /saved/.test(t)),
  JSON.stringify(sheet.shownText));
check('…and, across several suppliers, whose it is',
  sheet.shownText.some(t => /Shera/i.test(t)) && sheet.shownText.some(t => /Matthew/i.test(t)),
  JSON.stringify(sheet.shownText));
check('the header counts them', sheet.countedInHeader === true, String(sheet.countedInHeader));
// ---- the tick boxes -------------------------------------------------------
check('only the first address is ticked to start',
  JSON.stringify(sheet.defaultTicks) === JSON.stringify(book.map((_, i) => i === 0)),
  JSON.stringify(sheet.defaultTicks));
check('…which is the one the app would have sent to on its own',
  book[0].email === 'defects@shera.com.au', book[0].email);
check('…and the button counts the ticks', /Copy 1/.test(sheet.defaultBtn || ''), sheet.defaultBtn);
check('tapping a row ticks it',
  sheet.afterTick.ticks[0] === true && sheet.afterTick.ticks[1] === true,
  JSON.stringify(sheet.afterTick.ticks));
check('…and the count follows', /Copy 2/.test(sheet.afterTick.btn || ''), sheet.afterTick.btn);
// THE POINT OF THE WHOLE THING: what lands on the clipboard has to paste into
// Outlook's To field as separate recipients, which means SEMICOLONS.
check('the copy is semicolon-separated, which is what Outlook splits on',
  sheet.copied[0] === `${book[0].email}; ${book[1].email}`, JSON.stringify(sheet.copied[0]));
check('…and only the ticked ones are in it',
  !sheet.copied[0].includes(book[2].email), JSON.stringify(sheet.copied[0]));
check('the row 📋 copies that one address by itself',
  sheet.copied[1] === book[2].email, JSON.stringify(sheet.copied[1]));
check('…without changing what is ticked',
  JSON.stringify(sheet.afterOne) === JSON.stringify(sheet.afterTick.ticks),
  JSON.stringify(sheet.afterOne));
check('the Attach button is still there — this is an addition, not a replacement',
  sheet.stillHasAttach === true, String(sheet.stillHasAttach));
check('…and so is the Subject chip', sheet.stillHasSubject === true, String(sheet.stillHasSubject));

// ================= 3. the no-address case =================================
console.log('\n--- a supplier with nothing on file ---');
const empty = await page.evaluate(async () => {
  const file = new File([new Blob(['x'])], 'x.pdf', { type: 'application/pdf' });
  navigator.canShare = () => true;
  navigator.share = () => new Promise(() => {});
  sharePdfOnTap(file, 'Attach to email', 'note', { subject: 's', body: 'b', book: [] });
  await new Promise(r => setTimeout(r, 60));
  const body = (document.querySelector('#imp-ov #imp-body') || {}).textContent || '';
  const out = { rows: document.querySelectorAll('#imp-ov .sh-addr').length,
                says: /No address on file/.test(body),
                stillHasAttach: !!document.getElementById('sh-go') };
  impClose();
  return out;
});
console.log('empty:', JSON.stringify(empty));
check('no addresses means no empty rows', empty.rows === 0, String(empty.rows));
check('…it says so, and says what to do about it', empty.says === true, String(empty.says));
check('…and sending still works', empty.stillHasAttach === true, String(empty.stillHasAttach));

// ================= 4. the copy survives the Attach tap ====================
// Spiro: "the paste feature after I have copied a bunch of email addresses
// selected doesn't work". It wasn't the copy — it was what happened next.
// Tapping Attach copied the SUBJECT over the top of the addresses in the same
// tap, so by the time Mail opened the clipboard held "Defects - Lot 511".
// Pasting into To then produced recipient chips made of the subject line,
// which is exactly what the screenshot showed.
console.log('\n--- what is on the clipboard when Mail opens ---');
const survive = await page.evaluate(async () => {
  const copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
    configurable: true,
  });
  const file = new File([new Blob(['x'])], 'R.pdf', { type: 'application/pdf' });
  navigator.canShare = () => true;
  navigator.share = () => new Promise(() => {});
  const book = emailBookForDefects(db.getDefects({ addressId: 1 }));

  // (a) the user ticks and copies, then taps Attach
  sharePdfOnTap(file, 'Attach to email', 'note', { subject: 'Defects - Lot 511', body: 'b', book });
  await new Promise(r => setTimeout(r, 60));
  [...document.querySelectorAll('#imp-ov .sh-addr')].forEach((r, i) => { if (i) r.click(); });
  document.querySelector('#imp-ov .sh-copysel').click();
  await new Promise(r => setTimeout(r, 30));
  const afterCopy = copied[copied.length - 1];
  document.getElementById('sh-go').click();
  await new Promise(r => setTimeout(r, 60));
  const afterAttach = copied[copied.length - 1];
  const ov = document.getElementById('imp-ov'); if (ov) ov.remove();

  // (b) the user copies nothing — the subject is still a useful thing to hand
  //     them, so that behaviour has to stay.
  const copied2 = [];
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (t) => { copied2.push(t); return Promise.resolve(); } },
    configurable: true,
  });
  sharePdfOnTap(file, 'Attach to email', 'note', { subject: 'Defects - Lot 511', body: 'b', book });
  await new Promise(r => setTimeout(r, 60));
  document.getElementById('sh-go').click();
  await new Promise(r => setTimeout(r, 60));
  const ov2 = document.getElementById('imp-ov'); if (ov2) ov2.remove();

  // (c) the single-address 📋 counts as the user copying, too
  const copied3 = [];
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (t) => { copied3.push(t); return Promise.resolve(); } },
    configurable: true,
  });
  sharePdfOnTap(file, 'Attach to email', 'note', { subject: 'Defects - Lot 511', body: 'b', book });
  await new Promise(r => setTimeout(r, 60));
  document.querySelector('#imp-ov .sh-addr .sh-one').click();
  await new Promise(r => setTimeout(r, 30));
  const oneCopy = copied3[copied3.length - 1];
  document.getElementById('sh-go').click();
  await new Promise(r => setTimeout(r, 60));
  const ov3 = document.getElementById('imp-ov'); if (ov3) ov3.remove();

  return { afterCopy, afterAttach, noCopy: copied2, oneCopy, afterOne: copied3[copied3.length - 1] };
});
console.log('survive:', JSON.stringify(survive, null, 1));
check('copying a selection puts the addresses on the clipboard',
  /@/.test(survive.afterCopy || ''), JSON.stringify(survive.afterCopy));
check('…and tapping Attach LEAVES THEM THERE, so To pastes addresses',
  survive.afterAttach === survive.afterCopy,
  `was ${JSON.stringify(survive.afterCopy)}, became ${JSON.stringify(survive.afterAttach)}`);
check('…so the subject never lands in the To field',
  !/Defects - Lot 511/.test(survive.afterAttach || ''), JSON.stringify(survive.afterAttach));
check('with nothing copied, Attach still hands over the subject',
  survive.noCopy.length === 1 && survive.noCopy[0] === 'Defects - Lot 511',
  JSON.stringify(survive.noCopy));
check('one address copied on its own also survives the Attach tap',
  survive.afterOne === survive.oneCopy && /@/.test(survive.oneCopy || ''),
  `was ${JSON.stringify(survive.oneCopy)}, became ${JSON.stringify(survive.afterOne)}`);

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
