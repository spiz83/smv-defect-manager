// 📧 vs 🔗 on the defect list, and what the share sheet cannot fill in.
//
// Spiro, 2026-08-16, circling the 📧 on a supplier row: "the email function is
// practically the same as the share a link function". It was — literally.
// `emailDefectList(withPhotos, asLink)` carried `asLink` in its signature and
// never read it, so both buttons ran the same code and produced the same email.
//
// iOS will not let a web page set a Subject or a recipient on a share-sheet
// attachment. So the deal is: the PDF attaches for real, and the subject is put
// on the clipboard for the supervisor to paste. This suite holds all of that —
// including that the two buttons still DIFFER, which is the bit that rotted
// silently for weeks because nothing asserted it.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8193;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
server.unref();

const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobStatus: 'active', active: true }],
  contractors: [{ id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber', tradeIds: [1], email: 'orders@costasplumbing.com.au' }],
  trades: [{ id: 1, name: 'Plumber' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Downpipe missing behind garage.', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: 1, description: 'Repair wall at cistern stop tap.', status: 'open', completed: false },
  ],
};

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
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource|jspdf|pdf/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Stand in for the platform: a share that works, a clipboard we can read back,
// and a mailto we capture instead of navigating to.
async function arm() {
  await page.evaluate(() => {
    window.__shared = null; window.__clip = null; window.__uploaded = 0; window.__toasts = [];
    window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
    window.CloudShare = {
      uploadTempPdf: async () => { window.__uploaded++; return 'https://example.test/go.html?f=x/Report.pdf'; },
      lastKey: () => 'x/Report.pdf',
    };
    if (!window.__toastPatched) {
      window.__toastPatched = true;
      const real = window.showToast;
      window.showToast = (m, bad) => { (window.__toasts || []).push(String(m)); return real(m, bad); };
    }
    window.CloudMail = undefined;
    navigator.canShare = () => true;
    navigator.share = async (d) => {
      window.__shared = { files: (d.files || []).map(f => f.name), keys: Object.keys(d), text: d.text || null };
    };
    // The app's one clipboard path funnels through here. defineProperty, not
    // assignment: navigator.clipboard is a read-only accessor on the prototype,
    // so `navigator.clipboard = …` silently does nothing and the real (blocked)
    // API answers instead — which is how this read null while the app was in
    // fact copying.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t) => { window.__clip = String(t); } },
    });
    // A real PDF build needs jsPDF from a CDN this harness blocks, so stand in
    // with a file of the right shape — this suite is about the plumbing around
    // the PDF, not the PDF itself (mkpdf.mjs owns that).
    window.generateDefectPDF = async () => new File([new Blob(['%PDF-1.4'])], 'Defects-Lot905.pdf', { type: 'application/pdf' });
    render();
    viewDefectsForAddress(1);
  });
  await page.waitForTimeout(300);
}

// ================= A. the two buttons are not the same button ===============
console.log('\n--- A · 📧 attaches, 🔗 links ---');
{
  await arm();
  await page.evaluate(() => { emailDefectList(true); });      // 📧 — fire, don't await:
  // the attach overlay's promise settles on a TAP, so awaiting it here deadlocks.
  await page.waitForSelector('#sh-go', { timeout: 4000 }).catch(() => {});
  const attachUi = await page.evaluate(() => !!document.getElementById('sh-go'));
  check('📧 offers a real attachment (the share overlay opens)', attachUi);

  await page.evaluate(() => { const b = document.getElementById('sh-go'); if (b) b.click(); });
  await page.waitForTimeout(300);
  const shared = await page.evaluate(() => window.__shared);
  console.log('shared:', JSON.stringify(shared));
  check('…and the file actually reaches navigator.share', shared && shared.files.length === 1, JSON.stringify(shared));
  check('…and the defect list rides with it as the message body',
    shared && shared.keys.includes('text') && /Downpipe missing/.test(shared.text || ''),
    JSON.stringify(shared && shared.keys));
  check('…whose first line is the subject, so Outlook lifts it into the Subject field',
    shared && /^Defects - /.test(String(shared.text || '').split('\n')[0]),
    JSON.stringify(String((shared && shared.text) || '').split('\n')[0]));
  // A `url` alongside files is the thing that puts a blob: link in the body.
  check('…with no url in the payload', shared && !shared.keys.includes('url'), JSON.stringify(shared && shared.keys));
  const uploaded = await page.evaluate(() => window.__uploaded);
  check('…and nothing is uploaded, because the file itself went', uploaded === 0, `${uploaded} upload(s)`);

  // window.location cannot be stubbed in a real browser, so the link path is
  // identified by what only it does: upload the PDF to get a shareable URL,
  // then announce the hand-off to Mail.
  await arm();
  await page.evaluate(() => { emailDefectList(true, true); }); // 🔗
  await page.waitForTimeout(900);
  const link = await page.evaluate(() => ({
    overlay: !!document.getElementById('sh-go'), uploaded: window.__uploaded, toasts: window.__toasts,
  }));
  console.log('link mode:', JSON.stringify(link));
  check('🔗 does NOT open the attach overlay', !link.overlay);
  check('…it hosts the PDF and hands Mail a link', link.uploaded === 1, `${link.uploaded} upload(s)`);
  check('…and says so', link.toasts.some(t => /Opening email/i.test(t)), JSON.stringify(link.toasts));
  console.log('  >> the two buttons now do different things; asLink used to be ignored');
}

// ================= B. the clipboard carries what iOS won't ==================
console.log('\n--- B · the subject lands on the clipboard ---');
{
  await arm();
  await page.evaluate(() => { emailDefectList(true); });
  await page.waitForSelector('#sh-go', { timeout: 4000 });
  const before = await page.evaluate(() => window.__clip);
  check('nothing is copied merely by opening the sheet', before === null, String(before));
  await page.evaluate(() => document.getElementById('sh-go').click());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ clip: window.__clip, shared: !!window.__shared }));
  console.log('clipboard:', JSON.stringify(after));
  check('the subject is copied by the same tap that opens the share sheet',
    typeof after.clip === 'string' && /Defects/.test(after.clip), String(after.clip));
  check('…and the share still happened — copying did not eat the tap', after.shared);
}

// ================= C. the subject row, and ONLY the subject row =============
// Spiro 2026-08-16: "you don't have to create a copy for the email. The copy
// can just be for the subject." The recipient comes from Mail's own contacts.
console.log('\n--- C · one tap-to-copy row, for the subject ---');
{
  await arm();
  await page.evaluate(() => { emailDefectList(true); });
  await page.waitForSelector('#sh-go', { timeout: 4000 });
  const rows = await page.evaluate(() => [...document.querySelectorAll('#imp-ov .sh-copy')].map(b => b.getAttribute('data-k')));
  console.log('copy rows:', JSON.stringify(rows));
  check('there is a row for the subject', rows.includes('subject'), JSON.stringify(rows));
  check('…and NO row for the email address', !rows.includes('email'), JSON.stringify(rows));
  await page.evaluate(() => document.querySelector('#imp-ov .sh-copy[data-k="subject"]').click());
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => window.__clip);
  check('tapping it copies the subject', /^Defects - /.test(String(clip)), String(clip));
}

// ================= D. a browser that refuses the pair ======================
// canShare says no to files+text on some builds. The attachment matters more
// than the body, so the file must still go rather than the share failing.
console.log('\n--- D · files+text refused → the file still goes ---');
{
  await arm();
  await page.evaluate(() => { navigator.canShare = (d) => !(d && d.text); });
  await page.evaluate(() => { emailDefectList(true); });
  await page.waitForSelector('#sh-go', { timeout: 4000 });
  await page.evaluate(() => document.getElementById('sh-go').click());
  await page.waitForTimeout(300);
  const shared = await page.evaluate(() => window.__shared);
  console.log('degraded share:', JSON.stringify(shared && shared.keys));
  check('the PDF is still attached', shared && shared.files.length === 1, JSON.stringify(shared));
  check('…and the body is dropped rather than the whole share failing',
    shared && !shared.keys.includes('text'), JSON.stringify(shared && shared.keys));
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
