// Photos in the PDF report.
//
// Spiro 2026-09-03: "with the temp job feature, when I generate the PDF report
// it doesn't actually show the photos, just shows the items."
//
// getForPdf used to read the CLOUD only — it started from the defect's cloud
// uuid and gave up when there wasn't one. So a temp job, whose photos are
// deliberately never uploaded, produced a report of pure text. The same hole
// hit ordinary jobs in a dead spot: the photo taken minutes ago was still in
// the outbox, so it was missing from the report being printed right then.
//
// This suite boots the REAL cloud-sync on a stubbed Supabase, so the outbox is
// a real IndexedDB and getForPdf is the real function — a mock of it would
// have passed happily while the bug was there.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__here, '..'), PORT = 8208;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
server.unref();

// The real repo logo: a genuine PNG the browser can decode, so the width and
// height that come back are the image's own and not a hopeful zero.
const IMG = `http://localhost:${PORT}/creation-homes-logo.png`;
const LOGO_W = 560, LOGO_H = 169;

// A trimmed Supabase stub — enough for cloud-sync to complete one pull, which
// is what builds the legacy-id → uuid map the cloud photo path needs.
// `uploadFails` keeps a photo stuck in the outbox, which is the dead-spot case.
const stub = (uploadFails) => `(() => {
  const UID = '11111111-1111-1111-1111-111111111111';
  try {
    localStorage.setItem('cs_heal', 'snap-2026-06-17');
    localStorage.removeItem('cs_dirty');
    localStorage.setItem('dm_preview', '0');
    localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
  } catch (e) {}
  const T = {
    dm_trades: [{ id: 't1', name: 'Plumber' }],
    dm_contractors: [{ id: 'c1', legacy_id: 1, name: 'COSTAS PLUMBING', phone: '0400000001', email: 'a@b.com', is_shared: true, added_by: null }],
    dm_contractor_trades: [{ contractor_id: 'c1', trade_id: 't1' }],
    jobs: [{ id: 'j1', job_number: '306648', lot: '905', street: '(11) Woodlawn Rd', suburb: 'Wollert', active: true, status: 'active' }],
    dm_defects: [
      { id: 'd1', legacy_id: 1, job_id: 'j1', contractor_id: 'c1', description: 'Downpipe missing behind garage',
        status: 'open', unassigned: false, location: 'Garage', created_at: '2026-08-01T00:00:00Z',
        last_email_at: null, last_sms_at: null, last_update_at: null, followup_at: null, booking_at: null },
      { id: 'd2', legacy_id: 2, job_id: 'j1', contractor_id: 'c1', description: 'Replace mixer tap cartridge',
        status: 'open', unassigned: false, location: 'Ensuite', created_at: '2026-08-01T00:00:00Z',
        last_email_at: null, last_sms_at: null, last_update_at: null, followup_at: null, booking_at: null },
    ],
    // d1 has ONE photo that finished uploading; nothing is queued for it.
    dm_defect_photos: [{ id: 'p1', defect_id: 'd1', storage_path: 'w/p1.jpg' }],
    job_call_up_archive: [], job_called_for_archive: [], dm_trade_learning: [],
    v_jobs_with_current_supervisor: [{ id: 'j1', current_supervisor_id: UID, current_supervisor_name: 'Spiro', status: 'active' }],
    bpi_trade_rules: [], bpi_ai_settings: [{ id: 1 }], deleted_rows_archive: [], dm_reports: [],
    dm_defect_wordings: [],
    profiles: [{ id: UID, role: 'manager', is_wordings_admin: true }],
  };
  window.__stub = { T, signedFor: [], uploads: 0 };
  function q(table, cols) {
    const st = { table, cols, filters: [], single: false, rangeFrom: 0, rangeTo: 1e9 };
    const rows = () => { let r = (T[table] || []).slice(); for (const f of st.filters) r = r.filter(f); return r.slice(st.rangeFrom, st.rangeTo + 1); };
    const res = async () => { const r = rows(); return st.single ? { data: r[0] || null, error: null } : { data: r, error: null }; };
    const api = {
      select(c) { if (c) st.cols = c; return api; },
      order() { return api; }, limit(n) { st.rangeTo = st.rangeFrom + n - 1; return api; },
      range(a, b) { st.rangeFrom = a; st.rangeTo = b; return api; },
      eq(col, v) { st.filters.push(r => r[col] === v); return api; },
      neq(col, v) { st.filters.push(r => r[col] !== v); return api; },
      gt() { return api; }, gte() { return api; }, lt() { return api; }, lte() { return api; },
      in(col, vs) { st.filters.push(r => vs.indexOf(r[col]) >= 0); return api; },
      like() { return api; }, ilike() { return api; }, or() { return api; }, contains() { return api; },
      filter() { return api; }, match() { return api; }, not() { return api; }, is() { return api; },
      maybeSingle() { st.single = true; return api; }, single() { st.single = true; return api; },
      then(ok, err) { return Promise.resolve(res()).then(ok, err); },
    };
    return api;
  }
  function table(name) {
    return {
      select: (cols) => q(name, cols),
      update() { return { eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }; },
      upsert(row) {
        const list = (T[name] = T[name] || []);
        const i = row.legacy_id == null ? -1 : list.findIndex(r => r.legacy_id === row.legacy_id);
        if (i >= 0) Object.assign(list[i], row); else list.push({ id: 'new-' + name + '-' + list.length, ...row });
        const hit = i >= 0 ? list[i] : list[list.length - 1];
        const out = { select: () => ({ single: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }),
                                       maybeSingle: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }) }) };
        out.then = (ok, err) => Promise.resolve({ data: null, error: null }).then(ok, err);
        return out;
      },
      insert() { return { select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }; },
      delete() { return { not: () => Promise.resolve({ error: null }), eq: () => Promise.resolve({ error: null }) }; },
    };
  }
  const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
  window.supabase = { createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: UID, email: 'spiro@example.com' } } }),
      getSession: async () => ({ data: { session: { user: { id: UID, email: 'spiro@example.com' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
    from: table, channel: () => chan, removeChannel() {},
    storage: { from: () => ({
      list: async () => ({ data: [] }), remove: async () => ({}),
      // Failing the upload is how a photo stays in the outbox — the dead-spot case.
      upload: async () => { window.__stub.uploads++; return ${uploadFails} ? { data: null, error: { message: 'offline' } } : { data: {}, error: null }; },
      createSignedUrls: async (paths) => { window.__stub.signedFor.push(...paths); return { data: paths.map(() => ({ signedUrl: ${JSON.stringify(IMG)} })), error: null }; },
      createSignedUrl: async () => ({ data: null }),
    }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
  }) };
})();`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

async function boot(uploadFails) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
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
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));
  await page.addInitScript(stub(uploadFails));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  await page.waitForFunction(() => window.CloudPhotos && db.data.defects && db.data.defects.length >= 2, null, { timeout: 20000 });
  return { ctx, page, errs };
}

// Grab the repo logo as a real image blob to feed the outbox.
const grab = `(async () => (await (await fetch(${JSON.stringify(IMG)})).blob()))()`;

// ============ A. the bug: a temp job's photos are on the phone only =========
console.log('\n--- A · a temp job report ---');
{
  const { ctx, page, errs } = await boot(false);
  // A temp job and a defect on it. Neither is ever pushed, so the defect has
  // no cloud uuid — which is exactly what used to make getForPdf give up.
  await page.evaluate(async (grabSrc) => {
    db.data.addresses.push({ id: 1500000042, street: '14 Bayside Ave — warranty call', suburb: 'Point Cook', isTemp: true, tempBy: 'me', jobStatus: 'active', active: true });
    db.data.defects.push({ id: 9001, addressId: 1500000042, contractorId: 1, description: 'Reseal shower base', location: 'Ensuite', status: 'open', completed: false });
    db.save();
    const blob = await eval(grabSrc);
    await window.CloudPhotos.savePhoto(9001, blob);
  }, grab);
  await page.waitForTimeout(900);

  const got = await page.evaluate(async () => {
    const imgs = await window.CloudPhotos.getForPdf(9001);
    return imgs.map(i => ({ isData: /^data:image\//.test(i.dataUrl || ''), w: i.w, h: i.h, len: (i.dataUrl || '').length }));
  });
  console.log('temp-job photos for the PDF:', JSON.stringify(got));
  check('the report gets the photo, with no cloud copy in existence', got.length === 1, JSON.stringify(got));
  check('…as an embeddable data URL, not a signed link that needs reception',
    got[0] && got[0].isData && got[0].len > 1000, JSON.stringify(got[0]));
  check('…with the real pixel dimensions, so the layout can size it',
    got[0] && got[0].w === LOGO_W && got[0].h === LOGO_H, JSON.stringify(got[0]));
  check('…and nothing was asked of storage for it',
    await page.evaluate(() => window.__stub.signedFor.length === 0));
  check('…and it was never uploaded either', await page.evaluate(() => window.__stub.uploads === 0));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (A)'); }
  await ctx.close();
}

// ============ B. the same hole on an ordinary job in a dead spot ============
console.log('\n--- B · an ordinary job with no reception ---');
{
  const { ctx, page, errs } = await boot(true);   // every upload fails
  await page.evaluate(async (grabSrc) => {
    const blob = await eval(grabSrc);
    await window.CloudPhotos.savePhoto(2, blob);   // legacy 2 = d2, a real cloud defect
  }, grab);
  await page.waitForTimeout(900);

  const stuck = await page.evaluate(() => window.__stub.uploads > 0);
  check('the upload was attempted and failed, so the photo is still on the phone', stuck);
  const got = await page.evaluate(async () => {
    const imgs = await window.CloudPhotos.getForPdf(2);
    return imgs.map(i => ({ w: i.w, h: i.h, isData: /^data:image\//.test(i.dataUrl || '') }));
  });
  console.log('dead-spot photos for the PDF:', JSON.stringify(got));
  check('a photo that has not uploaded yet still reaches the report printed now',
    got.length === 1 && got[0].isData && got[0].w === LOGO_W, JSON.stringify(got));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]|offline/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (B)'); }
  await ctx.close();
}

// ============ C. the cloud path still works ================================
console.log('\n--- C · a photo that did upload ---');
{
  const { ctx, page, errs } = await boot(false);
  const got = await page.evaluate(async () => {
    const imgs = await window.CloudPhotos.getForPdf(1);   // legacy 1 = d1, one cloud photo
    return { n: imgs.length, w: imgs[0] && imgs[0].w, isData: /^data:image\//.test((imgs[0] || {}).dataUrl || ''),
      signed: window.__stub.signedFor.slice() };
  });
  console.log('cloud photos for the PDF:', JSON.stringify(got));
  check('a confirmed cloud photo is still fetched and embedded',
    got.n === 1 && got.isData && got.w === LOGO_W, JSON.stringify(got));
  check('…via a signed URL for its own storage path', got.signed.length === 1 && got.signed[0] === 'w/p1.jpg', JSON.stringify(got.signed));

  // Both copies at once must not double up. An upload deletes the outbox entry,
  // so this can only happen in the window between the two — and a report is far
  // more likely to be built mid-sweep than at rest.
  const both = await page.evaluate(async (grabSrc) => {
    const blob = await eval(grabSrc);
    await window.CloudPhotos.savePhoto(1, blob);
    const imgs = await window.CloudPhotos.getForPdf(1);
    return imgs.length;
  }, grab);
  check('a defect with photos in BOTH places is still capped at the limit of 3', both <= 3, String(both));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (C)'); }
  await ctx.close();
}

console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
