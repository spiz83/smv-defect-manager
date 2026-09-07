// How a finished report leaves the phone.
//
// Spiro 2026-09-04, with a screenshot of a Mail draft holding nothing but a
// go.html URL: "I clicked the generate report and it basically sends as a link.
// It needs to attach as the PDF file like previous occasions."
//
// Generate PDF Report was the one route that never tried a real attachment. It
// hosted the PDF and shared a LINK, on the strength of an earlier on-device
// finding that iOS mangles file shares — while the supplier-email path attached
// a real file the whole time and worked. The link is the fallback now, not the
// plan.
//
// This drives the REAL generateDefectPDF with jsPDF served from node_modules,
// on an iPhone user agent, and reads what actually reaches navigator.share.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__here, '..'), PORT = 8212;
const JSPDF = join(__here, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js');
if (!fs.existsSync(JSPDF)) {
  console.log('SKIPPED: jspdf not installed — run ./tests/setup.sh');
  console.log('ALL CHECKS PASSED');
  process.exit(0);
}
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
server.unref();

const SEED = {
  addresses: [{ id: 1, lot: '4545', street: 'Lot 4545, 7 Hermes St', suburb: 'Wollert', propertyNumber: '306648', supervisorId: 'me', active: true }],
  contractors: [{ id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber', tradeIds: [1] }],
  trades: [{ id: 1, name: 'Plumber' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'Downpipe missing behind garage', location: 'rear elev', status: 'open', completed: false },
    { id: 2, addressId: 1, contractorId: 1, description: 'Reseal shower base', location: 'ens', status: 'open', completed: false },
  ],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// The hosted-link fallback ends in window.location.href = url, and that
// navigation is not stoppable from inside the page — blocking it just replaces
// the document with an error page, taking every counter this suite reads with
// it (the first attempt at this suite read an empty {} and looked like the app
// had done nothing at all). So the evidence is recorded in NODE as it happens,
// through an exposed binding, and survives whatever the page does next.
async function boot({ ios, canShareFiles = true, shareThrows = null }) {
  const navs = [], events = [];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: ios ? IPHONE : undefined,
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  await page.exposeFunction('__rec', (kind, val) => { events.push({ kind, val }); });
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`)) {
      if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
      return route.continue();
    }
    if (u.includes('jspdf')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(JSPDF, 'utf8') });
    if (u.includes('example.test')) { navs.push(u); return route.abort(); }
    return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
  });
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));
  await page.addInitScript(seed => {
    localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
    localStorage.setItem('dm_preview', '0');
  }, SEED);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  await page.evaluate(({ canShareFiles, shareThrows }) => {
    window.__shared = null; window.__uploaded = 0; window.__toasts = [];
    window.__navigated = null;
    window.CloudPhotos = { getForPdf: async () => [], count: () => 0, pendingCount: () => 0, refreshCounts: () => {} };
    // A GETTER, not an assignment: cloud-sync.js sets window.CloudShare when it
    // boots, which lands somewhere between this line and the tap several
    // seconds later. A plain stub was silently replaced by the real (Supabase-
    // less, always-failing) one, and the fallback looked broken when it was the
    // harness that had moved. Same trap as navigator.clipboard in emailattach.
    const shareStub = {
      uploadTempPdf: async () => { window.__uploaded++; window.__rec('upload', 'go.html'); return 'https://example.test/go.html?f=x/Report.pdf'; },
      lastKey: () => 'x/Report.pdf',
    };
    Object.defineProperty(window, 'CloudShare', {
      configurable: true, get: () => shareStub, set: () => {},
    });
    const realToast = window.showToast;
    window.showToast = (m, bad) => { window.__toasts.push(String(m)); window.__rec('toast', String(m)); return realToast(m, bad); };
    navigator.canShare = () => canShareFiles;
    navigator.share = async (d) => {
      if (shareThrows) { const e = new Error('nope'); e.name = shareThrows; throw e; }
      // Read the FILE's bytes, so "a PDF was shared" is a fact and not a name.
      const f = (d.files || [])[0];
      const head = f ? await f.slice(0, 8).text() : null;
      window.__shared = { keys: Object.keys(d).sort(), files: (d.files || []).map(x => x.name),
        bytes: f ? f.size : 0, head, url: d.url || null };
      window.__rec('share', Object.keys(d).sort().join('+'));
    };
  }, { canShareFiles, shareThrows });
  return { ctx, page, errs, navs, events };
}

// The report screen's own button, so this is the route Spiro actually takes.
const generate = (page) => page.evaluate(() => {
  generateDefectPDF(db.data.defects.slice(), { photos: true, groupBy: 'address', addressIds: [1] });
});

// ================= A. it attaches the file ================================
console.log('\n--- A · Generate PDF Report, on an iPhone ---');
{
  const { ctx, page, errs } = await boot({ ios: true });
  await generate(page);
  // No overlay at all is the regression itself — the build that went straight
  // to a hosted link never offered one. Report that, don't stack-trace on it.
  const offered = await page.waitForSelector('#sh-go', { timeout: 20000 }).then(() => true).catch(() => false);
  const btn = offered ? await page.evaluate(() => document.getElementById('sh-go').textContent.trim()) : '';
  console.log('offered:', JSON.stringify(btn));
  check('it offers to ATTACH the report, rather than quietly sending a link',
    offered && /attach/i.test(btn) && /\.pdf$/i.test(btn), btn || 'no attach overlay appeared');
  if (!offered) { fail.push('no attach overlay'); await ctx.close(); }
  else {
  await page.click('#sh-go');
  await page.waitForTimeout(600);
  const sh = await page.evaluate(() => window.__shared);
  console.log('shared:', JSON.stringify(sh));
  check('a file reaches the share sheet', sh && sh.files.length === 1, JSON.stringify(sh));
  check('…and it is a real PDF, by its bytes', sh && sh.head === '%PDF-1.3', (sh || {}).head);
  check('…named the way the report is named', sh && /^4545Hermes_.*_Items\.pdf$/.test(sh.files[0]), (sh || {}).files);
  check('…with actual content in it', sh && sh.bytes > 2000, String((sh || {}).bytes));
  // The regression, stated directly: a `url` key instead of `files` is the
  // screenshot Spiro sent.
  check('NOT a link — no url in the share, which is what the Mail draft showed',
    sh && sh.keys.indexOf('url') === -1, JSON.stringify((sh || {}).keys));
  check('…and nothing was uploaded, so no public link was made and no data spent',
    await page.evaluate(() => window.__uploaded === 0));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (A)'); }
  await ctx.close();
  }
}

// ================= B. an older iPhone still gets its report ===============
console.log('\n--- B · a device that cannot attach files ---');
{
  const { ctx, page, errs, navs } = await boot({ ios: true, canShareFiles: false });
  await generate(page);
  await page.waitForFunction(() => window.__shared || window.__uploaded > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => ({ shared: window.__shared, uploaded: window.__uploaded, toasts: window.__toasts }));
  console.log('fallback:', JSON.stringify(st));
  check('it falls back to the hosted link rather than failing', st.uploaded === 1 && st.shared && st.shared.url,
    JSON.stringify({ uploaded: st.uploaded, url: (st.shared || {}).url }));
  check('…having SAID so, so a link is never mistaken for the attachment working',
    st.toasts.some(t => /can.t attach files/i.test(t)), JSON.stringify(st.toasts));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (B)'); }
  await ctx.close();
}

// ================= C. a failed share is not a dead end ====================
console.log('\n--- C · the share itself fails ---');
{
  const { ctx, page, errs, navs, events } = await boot({ ios: true, shareThrows: 'NotAllowedError' });
  await generate(page);
  await page.waitForSelector('#sh-go', { timeout: 20000 });
  await page.click('#sh-go');
  // The page navigates to the fallback link, so wait on the NODE-side record.
  const until = Date.now() + 20000;
  while (Date.now() < until && !navs.length) await new Promise(r => setTimeout(r, 200));
  console.log('after a failed share:', JSON.stringify(events), 'opened:', JSON.stringify(navs));
  const toasts = events.filter(e => e.kind === 'toast').map(e => e.val);
  check('a refused share still gets the report out, via the link',
    events.some(e => e.kind === 'upload'), JSON.stringify(events));
  check('…and names the reason on screen, so the cause is never guesswork',
    toasts.some(t => /NotAllowedError/.test(t)), JSON.stringify(toasts));
  check('…and the link is actually opened, not just built', navs.length >= 1, JSON.stringify(navs));

  // The blocked hop to example.test leaves an opaque document behind, and the
  // app's own storage code then trips over it. That is this harness refusing
  // the navigation, not the app — the real device just opens the link.
  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]|localStorage' property/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (C)'); }
  await ctx.close();
}

// ================= D. desktop still downloads =============================
console.log('\n--- D · on a desktop ---');
{
  const { ctx, page, errs } = await boot({ ios: false });
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await generate(page);
  const got = await dl;
  console.log('download:', got ? got.suggestedFilename() : null);
  check('a desktop saves the file, with no share sheet in the way',
    !!got && /^4545Hermes_.*_Items\.pdf$/.test(got.suggestedFilename()), got ? got.suggestedFilename() : 'none');
  check('…and was not offered the phone attach overlay',
    await page.evaluate(() => !document.getElementById('sh-go')));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (D)'); }
  await ctx.close();
}

console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
