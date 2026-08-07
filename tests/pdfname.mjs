// Every generated PDF is named after what is IN it.
//
//   <Who>_<dd.mm>_Items.pdf     e.g. Bayhill_12.06_Items.pdf
//
// Spiro 2026-08-07: "any time a pdf report is created, regardless of whether it
// is from a JOB screen or a Supplier screen, it is to be renamed and not have
// jibberish in the filename … abbreviated name of contractor or trade, followed
// by the date (only dd/mm), + items."
//
// There were TWO names in play and only one of them was ever good. The app
// named the file properly and then `CloudShare.uploadTempPdf` threw the name
// away, uploading under a 12-character random key — so what a trade actually
// tapped open, and what their phone saved, was `k3j9x2m1abcd.pdf`. This suite
// covers both: the name the app builds (part A, driven through the real
// screens) and the name that survives the upload (part B, driven through the
// real cloud-sync.js), plus the go.html link that carries it (part C).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Paths resolve from this file, so the suite runs from any checkout.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ARTIFACTS = join(__here, 'artifacts');

const ROOT = REPO, PORT = 8117;
const OUT = ARTIFACTS;
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

// Today, as the app writes it: zero-padded dd.mm and nothing else.
const now = new Date();
const DM = String(now.getDate()).padStart(2, '0') + '.' + String(now.getMonth() + 1).padStart(2, '0');

// Two plumbers and a painter over three jobs. The trading names are the awkward
// real ones: a long legal entity, and initials that a "first word" abbreviation
// would reduce to the single letter "H".
const SEED = {
  addresses: [
    { id: 1, lot: '1933', street: 'Lot 1933, 19 Lahar Road', suburb: 'Tarneit', propertyNumber: '306363', streetName: 'Lahar Road', lotNo: 1933, active: true },
    { id: 2, lot: '1258', street: 'Lot 1258, Balbi Rd', suburb: 'Truganina', propertyNumber: '306587', streetName: 'Balbi Rd', lotNo: 1258, active: true },
    { id: 3, lot: '1118', street: 'Lot 1118, 60 Rainbow Street', suburb: 'Wollert', propertyNumber: '306548', streetName: 'Rainbow Street', lotNo: 1118, active: true },
  ],
  contractors: [
    { id: 1, name: 'BAYHILL PLUMBING PTY LTD', trades: 'Plumber', tradeIds: [1] },
    { id: 2, name: 'Downeys Group Aust (VIC) P/L T/A DGA Roofing', trades: 'Plumber', tradeIds: [1] },
    { id: 3, name: 'H & K Painting', trades: 'Painter', tradeIds: [2] },
  ],
  trades: [{ id: 1, name: 'Plumber' }, { id: 2, name: 'Painter' }],
  defects: [
    { id: 1, addressId: 1, contractorId: 1, description: 'WC repair wall at cistern stop tap', status: 'open', completed: false },
    { id: 2, addressId: 2, contractorId: 1, description: 'Seal oversized hole at conduit', status: 'open', completed: false },
    { id: 3, addressId: 3, contractorId: 2, description: 'Rework downpipe', status: 'open', completed: false },
    { id: 4, addressId: 1, contractorId: 3, description: 'Paint touch ups', status: 'open', completed: false },
  ],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

// Off-origin requests are FULFILLED with an empty 200, never aborted: aborting
// leaves the Google Fonts stylesheet pending, which blocks the parser-blocking
// inline script and the app never boots.
async function newPage(initScripts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`)) {
      if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
      return route.continue();
    }
    return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
  });
  page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
  // The forced-RLS-failure case below logs on purpose — that console.error IS
  // the fallback working, so it isn't a test failure.
  page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource|\[CloudShare\] upload/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  for (const s of initScripts) await page.addInitScript(s);
  return { ctx, page, errs };
}

// ===========================================================================
//  PART A — the name the app builds, from the screens that build it
// ===========================================================================
console.log('\n=== A · the name, from each screen ===');

const A = await newPage([
  `(() => {
    localStorage.setItem('defectTrackerDB', ${JSON.stringify(JSON.stringify(SEED))});
    localStorage.setItem('dm_preview', '0');
  })();`,
]);
await A.page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await A.page.waitForFunction(() => typeof window.render === 'function');
await A.page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  // Capture the opts the screen ACTUALLY hands the PDF builder — jsPDF is a CDN
  // dependency and is blocked here, so the render itself can't run. Everything
  // up to that call is the real path, and the filename is then built from those
  // real opts by the real buildReportFilename.
  window.__opts = null;
  window.generateDefectPDF = async (list, o) => {
    window.__opts = JSON.parse(JSON.stringify(o || {}));
    return new File([new Blob(['x'])], buildReportFilename(o), { type: 'application/pdf' });
  };
  render();
});

// Run a screen's report path and return the filename it would produce.
const nameFrom = (fn) => A.page.evaluate(async (src) => {
  window.__opts = null;
  await (new Function('return (' + src + ')')())();
  await new Promise(r => setTimeout(r, 400));
  return { opts: window.__opts, name: window.__opts ? buildReportFilename(window.__opts) : null };
}, fn.toString());

// ---- the supplier screen -------------------------------------------------
console.log('\n--- supplier screen ---');
const supplier = await nameFrom(async () => {
  generateContextReport({ contractorId: 1 });
  await new Promise(r => setTimeout(r, 250));
  document.getElementById('cr-go').click();
});
console.log('opts:', JSON.stringify(supplier.opts));
check('a supplier report is named after the supplier',
  supplier.name === `Bayhill_${DM}_Items.pdf`, String(supplier.name));

// ---- a supplier at ONE job (the 📑 inside a job, and the supplier email) --
console.log('\n--- supplier, scoped to one job ---');
const supplierJob = await A.page.evaluate(async () => {
  // Exactly the opts generateContractorJobPdf and emailSupplier pass.
  return buildReportFilename({
    photos: true, asFile: true, statuses: ['open', 'pending'],
    addressIds: [1], contractorIds: [1], groupBy: 'address',
  });
});
check('a supplier report for one job is still named after the supplier',
  supplierJob === `Bayhill_${DM}_Items.pdf`, supplierJob);

// ---- the job screen ------------------------------------------------------
console.log('\n--- job screen ---');
const job = await nameFrom(async () => {
  generateContextReport({ addressId: 1 });
  await new Promise(r => setTimeout(r, 250));
  document.getElementById('cr-go').click();
});
console.log('opts:', JSON.stringify(job.opts));
check('a job report is named after the job — lot + street, no street type',
  job.name === `1933Lahar_${DM}_Items.pdf`, String(job.name));

// ---- the trade screen ----------------------------------------------------
console.log('\n--- trade screen ---');
const trade = await nameFrom(async () => {
  state.currentView = 'view-defects-trade';
  state.filters = { tradeName: 'Plumber', contractorIds: [1, 2] };
  render();
  await new Promise(r => setTimeout(r, 200));
  document.querySelector('[title="Generate PDF Report"]').click();
  await new Promise(r => setTimeout(r, 250));
  document.getElementById('cr-go').click();
});
console.log('opts:', JSON.stringify(trade.opts));
check('a trade report is named after the TRADE, not "2Suppliers"',
  trade.name === `Plumber_${DM}_Items.pdf`, String(trade.name));

// A trade dialog narrowed to a DIFFERENT trade has to say what is in the file,
// not which screen it was opened from.
const narrowed = await A.page.evaluate(() => buildReportFilename({
  tradeName: 'Plumber', tradeIds: [2], statuses: ['open'],
}));
check('…but an explicitly ticked trade wins over the screen it came from',
  narrowed === `Painter_${DM}_Items.pdf`, narrowed);

// ---- the report builder, unscoped ----------------------------------------
console.log('\n--- report builder ---');
const spread = await A.page.evaluate((dm) => ({
  none: buildReportFilename({ statuses: ['open'], addressIds: [], contractorIds: [] }),
  jobs: buildReportFilename({ statuses: ['open'], addressIds: [1, 2, 3] }),
  subs: buildReportFilename({ statuses: ['open'], contractorIds: [1, 2] }),
}), DM);
console.log('spread:', JSON.stringify(spread));
check('an unscoped report says so rather than naming nothing', spread.none === `All_${DM}_Items.pdf`, spread.none);
check('several jobs → how many jobs', spread.jobs === `3Jobs_${DM}_Items.pdf`, spread.jobs);
check('several suppliers → how many suppliers', spread.subs === `2Suppliers_${DM}_Items.pdf`, spread.subs);

// ---- awkward trading names ------------------------------------------------
console.log('\n--- abbreviating a real trading name ---');
const abbr = await A.page.evaluate(() => ({
  long: buildReportFilename({ contractorIds: [2] }),
  initials: buildReportFilename({ contractorIds: [3] }),
}));
console.log('abbr:', JSON.stringify(abbr));
check('a long legal entity is cut to the trading word',
  abbr.long === `Downeys_${DM}_Items.pdf`, abbr.long);
check('initials survive — "H & K Painting" is not just "H"',
  abbr.initials === `HK_${DM}_Items.pdf`, abbr.initials);
const accented = await A.page.evaluate(() => reportNameWord('Bäyhill Plumbing'));
check('an accented trading name folds rather than fragments',
  accented === 'Bayhill', accented);

// ---- the shape of every name ---------------------------------------------
console.log('\n--- the shape of it ---');
const every = [supplier.name, supplierJob, job.name, trade.name, narrowed, spread.none, spread.jobs, spread.subs, abbr.long, abbr.initials];
check('every name is filename-safe on every OS — no spaces, slashes or punctuation',
  every.every(n => /^[A-Za-z0-9._-]+\.pdf$/.test(n)), JSON.stringify(every.filter(n => !/^[A-Za-z0-9._-]+\.pdf$/.test(n))));
check('every name ends _Items.pdf and carries dd.mm',
  every.every(n => n.endsWith(`_${DM}_Items.pdf`)), JSON.stringify(every));
check('the old format is gone — no _defects_ and no year in the date',
  every.every(n => !/_defects/.test(n) && !new RegExp('\\.' + String(now.getFullYear()).slice(-2) + '\\b').test(n)), JSON.stringify(every));
check('no page errors', A.errs.length === 0, A.errs.slice(0, 3).join(' | '));
await A.page.screenshot({ path: `${OUT}/95-pdfname.png` });
await A.ctx.close();

// ===========================================================================
//  PART B — the name that survives the upload (real cloud-sync.js)
// ===========================================================================
console.log('\n=== B · the name that reaches the trade ===');

// A minimal Supabase stub — just enough for cloud-sync.js to mount and for
// CloudShare to exist. Every storage upload is recorded so the object PATH can
// be asserted: that path's last segment is what the phone names the file.
const STORAGE_STUB = `(() => {
  try {
    localStorage.setItem('cs_heal', 'snap-2026-06-17');
    localStorage.removeItem('cs_dirty');
    localStorage.setItem('dm_preview', '0');
    localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
  } catch (e) {}
  window.__uploads = [];
  window.__failNext = false;      // flips the shared bucket into an error, as RLS would
  const q = () => { const api = { select: () => api, order: () => api, limit: () => api, range: () => api,
    eq: () => api, neq: () => api, gt: () => api, gte: () => api, lt: () => api, lte: () => api,
    in: () => api, like: () => api, ilike: () => api, or: () => api, contains: () => api,
    filter: () => api, match: () => api, not: () => api, is: () => api,
    maybeSingle: () => api, single: () => api,
    then: (ok, err) => Promise.resolve({ data: [], error: null }).then(ok, err) }; return api; };
  const chan = { on: () => chan, subscribe: () => chan, unsubscribe: () => {} };
  window.supabase = {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({}),
      },
      from: () => ({ select: q, update: q, upsert: q, insert: q, delete: q }),
      channel: () => chan,
      removeChannel() {},
      storage: {
        from: (bucket) => ({
          list: async () => ({ data: [] }),
          remove: async () => ({}),
          upload: async (p, blob, o) => {
            window.__uploads.push({ bucket, path: p, bytes: blob && blob.size });
            if (bucket === 'shared-pdfs' && window.__failNext) {
              return { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } };
            }
            return { data: { path: p }, error: null };
          },
          createSignedUrl: async (p) => ({ data: { signedUrl: 'https://stub.test/signed/' + p + '?token=abc' }, error: null }),
          createSignedUrls: async () => ({ data: [] }),
        }),
      },
      functions: { invoke: async () => ({ data: null, error: null }) },
    }),
  };
})();`;

const B = await newPage([STORAGE_STUB]);
await B.page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await B.page.waitForFunction(() => !!window.CloudShare, null, { timeout: 20000 });

const shared = await B.page.evaluate(async () => {
  const f = new File([new Blob(['%PDF-1.4 x'])], 'Bayhill_12.06_Items.pdf', { type: 'application/pdf' });
  const url = await window.CloudShare.uploadTempPdf(f, f.name);
  return { url, key: window.CloudShare.lastKey(), uploads: window.__uploads.slice() };
});
console.log('shared:', JSON.stringify(shared, null, 1));
const seg = String(shared.key || '').split('/');
check('the PDF is uploaded under its real name, not a random one',
  seg[seg.length - 1] === 'Bayhill_12.06_Items.pdf', String(shared.key));
check('…behind a random folder, so the link stays unguessable',
  seg.length === 2 && /^[a-z0-9]{8,}$/.test(seg[0]), String(shared.key));
check('the share link ends in the report name — that is what the phone saves',
  /\/go\.html\?f=[a-z0-9]+\/Bayhill_12\.06_Items\.pdf$/.test(String(shared.url)), String(shared.url));
check('the link is still short enough for a mail app to linkify',
  String(shared.url).length <= 140, String(shared.url).length + ' chars');
check('it went to the public shared-pdfs bucket',
  shared.uploads.length === 1 && shared.uploads[0].bucket === 'shared-pdfs', JSON.stringify(shared.uploads));

// Two reports for the same supplier on the same day must not collide — the
// random folder is what keeps one supervisor's list out of another's link.
const twice = await B.page.evaluate(async () => {
  const mk = () => new File([new Blob(['%PDF'])], 'Bayhill_12.06_Items.pdf', { type: 'application/pdf' });
  const a = await window.CloudShare.uploadTempPdf(mk(), 'Bayhill_12.06_Items.pdf');
  const b = await window.CloudShare.uploadTempPdf(mk(), 'Bayhill_12.06_Items.pdf');
  return { a, b };
});
check('the same name twice gets two different links, never one overwriting the other',
  twice.a !== twice.b, JSON.stringify(twice));

// A filename can only ever come from buildReportFilename, but this is a path in
// a URL: it gets sanitised regardless.
const nasty = await B.page.evaluate(async () => {
  const out = {};
  for (const [k, n] of Object.entries({
    traversal: '../../secret/keys',
    spaces: 'Defects for Bayhill & Co.pdf',
    nonAscii: 'Bäyhill Ítems.pdf',
    huge: 'X'.repeat(400) + '.pdf',
  })) {
    window.__uploads.length = 0;
    await window.CloudShare.uploadTempPdf(new File([new Blob(['%PDF'])], 'x.pdf'), n);
    out[k] = window.__uploads[0].path;
  }
  // No name anywhere — a bare Blob has no .name to fall back on either.
  window.__uploads.length = 0;
  await window.CloudShare.uploadTempPdf(new Blob(['%PDF']), '');
  out.empty = window.__uploads[0].path;
  return out;
});
console.log('sanitised:', JSON.stringify(nasty, null, 1));
const segs = Object.values(nasty).map(p => p.split('/'));
check('a hostile filename cannot climb out of its folder',
  segs.every(s => s.length === 2 && s[1] !== '..' && s[1] !== '.'), JSON.stringify(nasty));
check('every stored name is URL- and filename-safe',
  segs.every(s => /^[A-Za-z0-9._-]+$/.test(s[1])), JSON.stringify(segs.map(s => s[1])));
check('every stored name still ends .pdf', segs.every(s => /\.pdf$/i.test(s[1])), JSON.stringify(segs.map(s => s[1])));
check('an accent is folded, not punched out — Bäyhill stays Bayhill',
  nasty.nonAscii.split('/')[1] === 'Bayhill-Items.pdf', nasty.nonAscii);
check('a missing name falls back to something readable, not blank',
  /^Defect-Report\.pdf$/.test(nasty.empty.split('/')[1]), nasty.empty);
check('a runaway name is capped', nasty.huge.split('/')[1].length <= 84, String(nasty.huge.split('/')[1].length));

// If the public bucket refuses the upload the private-bucket fallback still
// has to carry the report name — a degraded route is not a licence for
// gibberish.
const fallback = await B.page.evaluate(async () => {
  window.__uploads.length = 0;
  window.__failNext = true;
  const url = await window.CloudShare.uploadTempPdf(new File([new Blob(['%PDF'])], 'x.pdf'), 'Downeys_12.06_Items.pdf');
  window.__failNext = false;
  return { url, uploads: window.__uploads.slice() };
});
console.log('fallback:', JSON.stringify(fallback));
check('the signed-URL fallback keeps the report name too',
  /\/Downeys_12\.06_Items\.pdf\?/.test(String(fallback.url)), String(fallback.url));
check('…and it went to the private bucket',
  fallback.uploads.some(u => u.bucket === 'dm-reports'), JSON.stringify(fallback.uploads.map(u => u.bucket)));
check('no page errors', B.errs.length === 0, B.errs.slice(0, 3).join(' | '));
await B.ctx.close();

// ===========================================================================
//  PART C — go.html carries the foldered name, and nothing else
// ===========================================================================
console.log('\n=== C · the share link ===');

async function follow(f) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  let hit = null;
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`)) return route.continue();
    if (/supabase\.co/.test(u)) { hit = u; return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' }); }
    return route.fulfill({ status: 200, body: '' });
  });
  await page.goto(`http://localhost:${PORT}/go.html?f=${f}`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const msg = await page.evaluate(() => document.querySelector('.msg').textContent.trim()).catch(() => '');
  await ctx.close();
  return { hit, msg };
}

const good = await follow('k3j9x2m1abcd/Bayhill_12.06_Items.pdf');
console.log('good:', JSON.stringify(good));
check('a foldered link forwards to the PDF under its real name',
  String(good.hit).endsWith('/shared-pdfs/k3j9x2m1abcd/Bayhill_12.06_Items.pdf'), String(good.hit));

const legacy = await follow('k3j9x2m1abcd.pdf');
check('links already sitting in a trade\'s inbox still work',
  String(legacy.hit).endsWith('/shared-pdfs/k3j9x2m1abcd.pdf'), String(legacy.hit));

for (const bad of ['../secret', 'a/../../b', 'a/b/c', '..%2Fsecret', '']) {
  const r = await follow(encodeURIComponent(bad).replace(/%2F/gi, '/'));
  check(`a link that tries to climb out is refused: ${JSON.stringify(bad)}`,
    r.hit === null && /invalid or has expired/.test(r.msg), JSON.stringify(r));
}

await browser.close();
server.close();
console.log('\nArtifacts in ' + OUT);
if (fail.length) { console.log('FAILED (' + fail.length + '):'); fail.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('ALL CHECKS PASSED');
