// A temp job follows your login onto another device.
//
// Spiro 2026-09-04: "when I log in using the same details I can't load up the
// temp job… it's almost like it's just saved to my phone. I need to be able to
// use it on my desktop — that temp job needs to be tied into my login."
//
// This reverses the local-only design of 2026-09-03a, so the things that made
// that design safe now have to be re-proved on new ground:
//   · the job is PRIVATE — owner-scoped, not manager-wide;
//   · a delete is PERMANENT — the row goes, and nothing archives it;
//   · nothing about it ever lands in dm_defects, which is open by RLS,
//     carries a unique index temp rows would collide on, and archives deletes.
//
// "Device 2" is a second browser context with its own empty storage, seeded
// with the cloud tables device 1 left behind — which is exactly what signing in
// on the desktop is.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__here, '..'), PORT = 8209;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
server.unref();

const IMG = `http://localhost:${PORT}/creation-homes-logo.png`;
const ME = '11111111-1111-1111-1111-111111111111';
const SOMEONE_ELSE = '22222222-2222-2222-2222-222222222222';

// `seed` carries the cloud tables between devices. `hasTempTable` false is the
// state before the migration is run. `uid` is who is signed in.
const stub = (opts) => `(() => {
  const O = ${JSON.stringify(opts)};
  try {
    localStorage.setItem('cs_heal', 'snap-2026-06-17');
    localStorage.removeItem('cs_dirty');
    localStorage.setItem('dm_preview', '0');
    localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
  } catch (e) {}
  const UID = O.uid;
  const T = Object.assign({
    dm_trades: [{ id: 't1', name: 'Plumber' }],
    dm_contractors: [{ id: 'c1', legacy_id: 1, name: 'COSTAS PLUMBING', phone: '0400000001', email: 'a@b.com', is_shared: true, added_by: null }],
    dm_contractor_trades: [{ contractor_id: 'c1', trade_id: 't1' }],
    jobs: [{ id: 'j1', job_number: '306648', lot: '905', street: '(11) Woodlawn Rd', suburb: 'Wollert', active: true, status: 'active' }],
    dm_defects: [{ id: 'd1', legacy_id: 1, job_id: 'j1', contractor_id: 'c1', description: 'Downpipe missing behind garage',
      status: 'open', unassigned: false, location: 'Garage', created_at: '2026-08-01T00:00:00Z',
      last_email_at: null, last_sms_at: null, last_update_at: null, followup_at: null, booking_at: null }],
    dm_defect_photos: [],
    job_call_up_archive: [], job_called_for_archive: [], dm_trade_learning: [],
    v_jobs_with_current_supervisor: [{ id: 'j1', current_supervisor_id: UID, current_supervisor_name: 'Spiro', status: 'active' }],
    bpi_trade_rules: [], bpi_ai_settings: [{ id: 1 }], deleted_rows_archive: [], dm_reports: [], dm_defect_wordings: [],
    profiles: [{ id: UID, role: 'manager', is_wordings_admin: true }],
    dm_temp_jobs: [],
  }, O.seed || {});
  window.__stub = { T, objects: {}, removed: [], selectsOn: [], uid: UID };

  // The table is simply absent before the migration is run — PostgREST says so
  // with 42P01, which is what the app's capability probe reads.
  const MISSING = { code: '42P01', message: 'relation "public.dm_temp_jobs" does not exist' };
  const gone = (t) => t === 'dm_temp_jobs' && !O.hasTempTable;

  function q(table, cols) {
    const st = { table, cols, filters: [], single: false, rangeFrom: 0, rangeTo: 1e9 };
    const rows = () => { let r = (T[table] || []).slice(); for (const f of st.filters) r = r.filter(f); return r.slice(st.rangeFrom, st.rangeTo + 1); };
    const res = async () => {
      if (gone(table)) return { data: null, error: MISSING };
      if (table === 'dm_temp_jobs') window.__stub.selectsOn.push(st.filters.length);
      const r = rows();
      return st.single ? { data: r[0] || null, error: null } : { data: r, error: null };
    };
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
      upsert(row, opts) {
        if (gone(name)) {
          const bad = { select: () => ({ single: () => Promise.resolve({ data: null, error: MISSING }),
                                         maybeSingle: () => Promise.resolve({ data: null, error: MISSING }) }) };
          bad.then = (ok, err) => Promise.resolve({ data: null, error: MISSING }).then(ok, err);
          return bad;
        }
        const list = (T[name] = T[name] || []);
        // Honour the composite key the app asks for, so two logins holding the
        // same local job id cannot overwrite each other.
        const keys = String((opts && opts.onConflict) || 'legacy_id').split(',').map(s => s.trim());
        const i = list.findIndex(r => keys.every(k => r[k] === row[k]));
        const stamp = new Date().toISOString();
        if (i >= 0) Object.assign(list[i], row, { updated_at: stamp });
        else list.push({ id: name + '-uuid-' + (list.length + 1), created_at: stamp, updated_at: stamp, ...row });
        const hit = i >= 0 ? list[i] : list[list.length - 1];
        const out = { select: () => ({ single: () => Promise.resolve({ data: { ...hit }, error: null }),
                                       maybeSingle: () => Promise.resolve({ data: { ...hit }, error: null }) }) };
        out.then = (ok, err) => Promise.resolve({ data: null, error: null }).then(ok, err);
        return out;
      },
      insert(rec) { (T[name] = T[name] || []).push({ id: name + '-i' + (T[name].length + 1), ...rec }); return { select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }; },
      delete() {
        const del = (pred) => { const list = T[name] || []; T[name] = list.filter(r => !pred(r)); return { error: null }; };
        return { not: () => Promise.resolve({ error: null }), eq: (col, v) => Promise.resolve(del(r => r[col] === v)) };
      },
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
      list: async () => ({ data: [] }),
      remove: async (paths) => { (paths || []).forEach(p => { delete window.__stub.objects[p]; window.__stub.removed.push(p); }); return { data: null, error: null }; },
      upload: async (p) => { window.__stub.objects[p] = 1; return { data: { path: p }, error: null }; },
      createSignedUrls: async (paths) => ({ data: paths.map(p => ({ signedUrl: window.__stub.objects[p] ? ${JSON.stringify(IMG)} : null })), error: null }),
      createSignedUrl: async () => ({ data: null }),
    }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
  }) };
})();`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

async function boot(opts) {
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
  await page.addInitScript(stub(opts));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  await page.waitForFunction(() => window.CloudAdmin && window.CloudPhotos && db.data.defects && db.data.defects.length >= 1, null, { timeout: 20000 });
  return { ctx, page, errs };
}
const cloudOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__stub.T)));
const makeTempJob = (page, name) => page.evaluate(async (nm) => {
  createTempJob();
  document.getElementById('tj-name').value = nm;
  document.getElementById('tj-sub').value = 'Point Cook';
  document.getElementById('tj-go').click();
  await new Promise(r => setTimeout(r, 300));
  const a = db.data.addresses.find(x => x.isTemp);
  db.data.defects.push({ id: 9001, addressId: a.id, contractorId: 1, description: 'Reseal shower base', location: 'Ensuite', status: 'open', completed: false });
  db.save();
  await window.CloudSync.flush(); await window.CloudSync.pull();
  return a.id;
}, name);

// ============ A. it reaches the cloud, in its own table ====================
console.log('\n--- A · raised on the phone ---');
let cloudAfterA = null, tempLocalId = null;
{
  const { ctx, page, errs } = await boot({ uid: ME, hasTempTable: true });
  tempLocalId = await makeTempJob(page, '14 Bayside Ave — warranty call');
  await page.waitForTimeout(700);
  const st = await cloudOf(page);
  const row = (st.dm_temp_jobs || [])[0];
  console.log('dm_temp_jobs:', JSON.stringify(row && { ...row, defects: (row.defects || []).length }));
  check('the job is in the cloud', !!row && /Bayside/.test(row.name), JSON.stringify(row && row.name));
  check('…owned by the login that made it, which is what ties it to the desktop', row && row.owner_id === ME);
  check('…keeping its local id, so ids line up on both devices', row && Number(row.legacy_id) === Number(tempLocalId));
  check('…carrying its defects with it', row && (row.defects || []).length === 1, JSON.stringify((row || {}).defects));

  // The reason it is not a dm_defects row is in the migration; this is the
  // assertion that it stayed out.
  check('NOTHING of it went into dm_defects', (st.dm_defects || []).every(d => !/Reseal shower/.test(d.description || '')),
    JSON.stringify((st.dm_defects || []).map(d => d.description)));
  check('…and no orphan defect was created there either', (st.dm_defects || []).length === 1, String((st.dm_defects || []).length));

  cloudAfterA = st;
  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (A)'); }
  await ctx.close();
}

// ============ B. the desktop, same login ==================================
console.log('\n--- B · signing in on the desktop ---');
let cloudAfterB = null;
{
  const { ctx, page, errs } = await boot({ uid: ME, hasTempTable: true, seed: cloudAfterA });
  await page.evaluate(async () => { await window.CloudSync.flush(); await window.CloudSync.pull(); });
  await page.waitForTimeout(900);
  const seen = await page.evaluate(() => {
    const a = (db.data.addresses || []).find(x => x.isTemp);
    return a ? { id: a.id, street: a.street, suburb: a.suburb, cloudId: a.tempCloudId,
      defects: (db.data.defects || []).filter(d => Number(d.addressId) === Number(a.id)).map(d => d.description),
      onScreen: [...document.querySelectorAll('[data-job-search]')].some(e => /Bayside/.test(e.innerText)) } : null;
  });
  console.log('device 2 sees:', JSON.stringify(seen));
  check('a device that has never seen this job loads it from the login', !!seen, JSON.stringify(seen));
  check('…with the same id it had on the phone', seen && Number(seen.id) === Number(tempLocalId));
  check('…its defects', seen && seen.defects.length === 1 && /Reseal shower/.test(seen.defects[0]), JSON.stringify(seen && seen.defects));
  check('…and it is on the job list, not just in memory', seen && seen.onScreen);

  // Editing on device 2 goes back up.
  await page.evaluate(async () => {
    const a = db.data.addresses.find(x => x.isTemp);
    db.data.defects.push({ id: 9002, addressId: a.id, contractorId: 1, description: 'Regrout shower wall', location: 'Ensuite', status: 'open', completed: false });
    db.save();
    await window.CloudSync.flush(); await window.CloudSync.pull();
  });
  await page.waitForTimeout(700);
  cloudAfterB = await cloudOf(page);
  const row = (cloudAfterB.dm_temp_jobs || [])[0];
  check('a defect added on the desktop goes back up on the same row',
    row && (row.defects || []).length === 2 && (cloudAfterB.dm_temp_jobs || []).length === 1,
    JSON.stringify({ rows: (cloudAfterB.dm_temp_jobs || []).length, defects: (row || {}).defects && row.defects.length }));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (B)'); }
  await ctx.close();
}

// ============ C. nobody else's ============================================
console.log('\n--- C · another login ---');
{
  const { ctx, page, errs } = await boot({ uid: SOMEONE_ELSE, hasTempTable: true, seed: cloudAfterB });
  await page.evaluate(async () => { await window.CloudSync.flush(); await window.CloudSync.pull(); });
  await page.waitForTimeout(900);
  const leak = await page.evaluate(() => ({
    inData: (db.data.addresses || []).some(a => a.isTemp),
    onScreen: [...document.querySelectorAll('[data-job-search]')].some(e => /Bayside/.test(e.innerText)),
    // Every read of the table must be filtered — an unfiltered one would rely
    // on RLS alone, and would show every temp job the moment a policy slipped.
    everyReadScoped: window.__stub.selectsOn.length > 0 && window.__stub.selectsOn.every(n => n > 0),
    reads: window.__stub.selectsOn.length,
  }));
  console.log('other login:', JSON.stringify(leak));
  check('someone else signed in on the same app does not get the job', !leak.inData && !leak.onScreen, JSON.stringify(leak));
  check('…and the app asks the database only for its OWN rows, rather than leaning on RLS alone',
    leak.everyReadScoped, JSON.stringify(leak));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (C)'); }
  await ctx.close();
}

// ============ D. photos travel too =======================================
console.log('\n--- D · a photo taken on the phone ---');
let cloudAfterD = null;
{
  const { ctx, page, errs } = await boot({ uid: ME, hasTempTable: true, seed: cloudAfterB });
  await page.evaluate(async () => { await window.CloudSync.flush(); await window.CloudSync.pull(); });
  await page.waitForTimeout(700);
  await page.evaluate(async (img) => {
    const blob = await (await fetch(img)).blob();
    await window.CloudPhotos.savePhoto(9001, blob);
  }, IMG);
  await page.waitForTimeout(1200);
  const up = await page.evaluate(() => {
    const a = db.data.addresses.find(x => x.isTemp);
    return { objects: Object.keys(window.__stub.objects), listed: a.tempPhotos || [], jobUuid: a.tempCloudId };
  });
  console.log('uploaded:', JSON.stringify(up));
  check('the photo is uploaded', up.objects.length === 1, JSON.stringify(up.objects));
  check('…under its own job’s folder, not a real job’s',
    up.objects[0] && up.objects[0].startsWith(up.jobUuid + '/'), JSON.stringify({ o: up.objects[0], job: up.jobUuid }));
  check('…and recorded on the job row, since dm_defect_photos needs a dm_defects row it has not got',
    up.listed.length === 1 && up.listed[0].path === up.objects[0], JSON.stringify(up.listed));
  cloudAfterD = await cloudOf(page);
  const objs = await page.evaluate(() => window.__stub.objects);
  await ctx.close();

  // …and on the desktop the report can show it.
  const two = await boot({ uid: ME, hasTempTable: true, seed: cloudAfterD });
  await two.page.evaluate((o) => { window.__stub.objects = o; }, objs);
  await two.page.evaluate(async () => { await window.CloudSync.flush(); await window.CloudSync.pull(); });
  await two.page.waitForTimeout(900);
  const pdf = await two.page.evaluate(async () => {
    const imgs = await window.CloudPhotos.getForPdf(9001);
    return imgs.map(i => ({ isData: /^data:image\//.test(i.dataUrl || ''), w: i.w }));
  });
  console.log('desktop report photos:', JSON.stringify(pdf));
  check('the desktop’s PDF gets that photo, with an empty outbox of its own',
    pdf.length === 1 && pdf[0].isData && pdf[0].w === 560, JSON.stringify(pdf));
  await two.ctx.close();

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (D)'); }
}

// ============ E. delete means gone, everywhere ===========================
console.log('\n--- E · deleting it ---');
let cloudAfterE = null;
{
  const { ctx, page, errs } = await boot({ uid: ME, hasTempTable: true, seed: cloudAfterD });
  await page.evaluate(async () => { await window.CloudSync.flush(); await window.CloudSync.pull(); });
  await page.waitForTimeout(700);
  const objs = Object.keys(await page.evaluate(() => window.__stub.objects));
  await page.evaluate((o) => { window.__stub.objects = {}; o.forEach(p => { window.__stub.objects[p] = 1; }); }, objs);
  page.on('dialog', async d => { await d.accept().catch(() => {}); });
  await page.evaluate(async () => {
    const a = db.data.addresses.find(x => x.isTemp);
    await deleteTempJob(a.id);
  });
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    rows: (window.__stub.T.dm_temp_jobs || []).length,
    archive: (window.__stub.T.deleted_rows_archive || []).length,
    objects: Object.keys(window.__stub.objects).length,
    removed: window.__stub.removed.length,
    localTemp: (db.data.addresses || []).some(a => a.isTemp),
    orphans: (db.data.defects || []).filter(d => !(db.data.addresses || []).some(a => a.id === d.addressId)).length,
  }));
  console.log('after delete:', JSON.stringify(after));
  check('the row is gone from the database', after.rows === 0);
  check('…the photo objects with it', after.objects === 0 && after.removed === 1, JSON.stringify(after));
  check('…nothing was archived, so "permanently deleted" is true', after.archive === 0);
  check('…and it is off this device, leaving no orphaned defects', !after.localTemp && after.orphans === 0, JSON.stringify(after));
  cloudAfterE = await cloudOf(page);

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (E)'); }
  await ctx.close();
}

// ============ F. the delete reaches the other device =====================
console.log('\n--- F · the phone, after the desktop deleted it ---');
{
  // This device still holds the job locally, and knows it was in the cloud.
  const { ctx, page, errs } = await boot({ uid: ME, hasTempTable: true, seed: cloudAfterD });
  await page.evaluate(async () => { await window.CloudSync.flush(); await window.CloudSync.pull(); });
  await page.waitForTimeout(800);
  check('…it has the job to begin with', await page.evaluate(() => (db.data.addresses || []).some(a => a.isTemp)));
  // Now the desktop's delete lands.
  await page.evaluate(() => { window.__stub.T.dm_temp_jobs = []; });
  await page.evaluate(async () => { await window.CloudSync.flush(); await window.CloudSync.pull(); });
  await page.waitForTimeout(900);
  const gone = await page.evaluate(() => ({
    local: (db.data.addresses || []).some(a => a.isTemp),
    onScreen: [...document.querySelectorAll('[data-job-search]')].some(e => /Bayside/.test(e.innerText)),
    pushedBack: (window.__stub.T.dm_temp_jobs || []).length,
  }));
  console.log('after the other device deleted it:', JSON.stringify(gone));
  check('a job deleted on one device disappears from the other', !gone.local && !gone.onScreen, JSON.stringify(gone));
  check('…and this device does not push it straight back up', gone.pushedBack === 0, String(gone.pushedBack));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (F)'); }
  await ctx.close();
}

// ============ G. before the migration is run =============================
console.log('\n--- G · the table is not there yet ---');
{
  const { ctx, page, errs } = await boot({ uid: ME, hasTempTable: false });
  const id = await makeTempJob(page, '9 Rosewood Dr — service call');
  await page.waitForTimeout(900);
  await page.evaluate(() => showHomeView());   // creating one lands on Add Defects
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({
    stillHere: (db.data.addresses || []).some(a => a.isTemp),
    onScreen: [...document.querySelectorAll('[data-job-search]')].some(e => /Rosewood/.test(e.innerText)),
    syncOn: tempSyncOn(),
    wording: (document.querySelector('[onclick*="createTempJob"]') || {}).textContent || '',
    defectsPushed: (window.__stub.T.dm_defects || []).some(d => /Reseal shower/.test(d.description || '')),
  }));
  console.log('pre-migration:', JSON.stringify(st));
  check('the job still works, on this device, exactly as before', st.stillHere && st.onScreen, JSON.stringify(st));
  check('…and says so rather than promising the desktop', !st.syncOn && /this device only/i.test(st.wording), st.wording.replace(/\s+/g, ' ').trim());
  check('…and still nothing leaks into dm_defects', !st.defectsPushed);

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]|does not exist/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (G)'); }
  await ctx.close();
}

// ============ H. a job raised BEFORE the migration was run ==============
// Spiro's actual position: the temp job exists on the phone, and the SQL gets
// run afterwards. Nothing about that job changes, so nothing triggers a push —
// which is how "I ran the migration and my job still isn't on the desktop"
// happens, with no error anywhere to explain it.
console.log('\n--- H · the migration is run after the job already exists ---');
{
  const { ctx, page, errs } = await boot({ uid: ME, hasTempTable: false });
  await makeTempJob(page, '7 Hermes St — maintenance call');
  await page.waitForTimeout(700);
  check('it is on the phone, and nowhere else', await page.evaluate(() =>
    (db.data.addresses || []).some(a => a.isTemp) && !(window.__stub.T.dm_temp_jobs || []).length));

  // The SQL is run. The app is reopened — a fresh page on the SAME storage,
  // which is what quitting and relaunching actually is.
  const page2 = await ctx.newPage();
  await page2.addInitScript(`(() => { window.__afterMigration = true; })();`);
  await page2.addInitScript(stub({ uid: ME, hasTempTable: true }).replace(
    /localStorage\.setItem\('defectTrackerDB'[^;]+;/, ''));   // keep what the phone already holds
  await page2.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page2.waitForFunction(() => window.CloudAdmin && typeof window.render === 'function');
  await page2.evaluate(async () => { await window.CloudSync.flush(); await window.CloudSync.pull(); });
  await page2.waitForTimeout(900);
  const up = await page2.evaluate(() => ({
    rows: (window.__stub.T.dm_temp_jobs || []).map(r => r.name),
    stillLocal: (db.data.addresses || []).some(a => a.isTemp),
    hasCloudId: !!((db.data.addresses || []).find(a => a.isTemp) || {}).tempCloudId,
    defects: ((window.__stub.T.dm_temp_jobs || [])[0] || {}).defects || [],
  }));
  console.log('after the migration:', JSON.stringify({ ...up, defects: up.defects.length }));
  check('a job that existed BEFORE the migration uploads itself on the next sync',
    up.rows.length === 1 && /Hermes/.test(up.rows[0]), JSON.stringify(up.rows));
  check('…without anyone having to touch or re-edit it', up.hasCloudId, JSON.stringify(up));
  check('…taking its defects up with it', up.defects.length === 1, String(up.defects.length));
  check('…and it is still on the phone throughout', up.stillLocal);

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]|does not exist/.test(e));
  if (bad.length) { console.log('errors:', bad); fail.push('page errors (H)'); }
  await ctx.close();
}

console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
