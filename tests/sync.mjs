// The "🛒 shows up then vanishes" bug.
//
// This drives the REAL cloud-sync.js pull against a stubbed Supabase client, so
// the thing under test is the actual sync code, not a re-implementation of it.
// The stub's dm_defects rows are shaped exactly like PostgREST's: when the
// order_status column doesn't exist the key is simply ABSENT from every row,
// and `select('order_status')` fails with 42703.
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


const ROOT = REPO, PORT = 8105;
const OUT = ARTIFACTS;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

// ── The stub. Installed as window.supabase BEFORE cloud-sync.js runs, so the
//    real module boots on top of it. `hasOrderCol` flips the database between
//    "migration not run" and "migration run".
function stubScript(hasOrderCol, role = 'manager', slow = null) {
  return `(() => {
    const HAS_ORDER = ${hasOrderCol};
    const ROLE = ${JSON.stringify(role)};
    const SLOW = ${JSON.stringify(slow)};
    try {
      // Skip the one-time baseline heal — it arms dirty=true, and pullAll()
      // bails while dirty, so the first pull would never run in this harness.
      localStorage.setItem('cs_heal', 'snap-2026-06-17');
      localStorage.removeItem('cs_dirty');
      localStorage.setItem('dm_preview', '0');
      // Seed ONCE. addInitScript runs on every navigation, and the reload test
      // below depends on db.data persisting across one.
      if (!localStorage.getItem('defectTrackerDB')) {
        localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
      }
    } catch (e) {}
    const UID = '11111111-1111-1111-1111-111111111111';
    const T = {
      dm_trades: [{ id: 't1', name: 'Plumber' }],
      dm_contractors: [
        { id: 'c1', legacy_id: 1, name: 'COSTAS PLUMBING', phone: '0400000001', email: 'a@b.com', is_shared: true, added_by: null },
        // Added by a supervisor in THIS app → carries a legacy_id.
        { id: 'c2', legacy_id: 2, name: 'TMG Carpentry', phone: '0401354936', email: 'tmg@x.com', is_shared: false, added_by: 'sup-1' },
        // Origin CH Tracker → legacy_id NULL, exactly like the defect rows that
        // caused the duplicate-insert bug there.
        { id: 'c3', legacy_id: null, name: 'Vic Plaster Adam', phone: '0402000000', email: 'adam.o@vicplaster.com', is_shared: false, added_by: 'sup-2' },
      ],
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
      job_call_up_archive: [], job_called_for_archive: [], dm_trade_learning: [],
      v_jobs_with_current_supervisor: [{ id: 'j1', current_supervisor_id: UID, current_supervisor_name: 'Spiro', status: 'active' }],
      bpi_trade_rules: [], bpi_ai_settings: [{ id: 1 }], deleted_rows_archive: [], dm_defect_photos: [], dm_reports: [],
    };
    if (HAS_ORDER) T.dm_defects.forEach(r => { r.order_status = null; });
    window.__stub = { T, writes: [], pulls: 0, hasOrderCol: HAS_ORDER, slowTable: SLOW && SLOW.table, slowMs: (SLOW && SLOW.ms) || 0 };

    const NO_COL = { message: 'column dm_defects.order_status does not exist', code: '42703' };
    function q(table, cols) {
      const st = { table, cols, filters: [], single: false, rangeFrom: 0, rangeTo: 1e9 };
      const rows = () => {
        let r = (T[table] || []).slice();
        for (const f of st.filters) r = r.filter(f);
        return r.slice(st.rangeFrom, st.rangeTo + 1);
      };
      const res = async () => {
        // Simulate a big table that pages slowly, so "did the app paint before
        // the pull finished?" is an answerable question.
        if (window.__stub.slowTable === table && window.__stub.slowMs) {
          await new Promise(r => setTimeout(r, window.__stub.slowMs));
        }
        // Asking for a column that doesn't exist is a hard error, exactly as
        // PostgREST behaves — this is what the capability probe relies on.
        if (!HAS_ORDER && String(st.cols || '').split(',').map(s => s.trim()).includes('order_status')) {
          return { data: null, error: NO_COL };
        }
        const r = rows();
        return st.single ? { data: r[0] || null, error: null } : { data: r, error: null };
      };
      const api = {
        select(c) { if (c) st.cols = c; return api; },
        order() { return api; },
        limit(n) { st.rangeTo = st.rangeFrom + n - 1; return api; },
        range(a, b) { st.rangeFrom = a; st.rangeTo = b; return api; },
        eq(col, v) { st.filters.push(r => r[col] === v); return api; },
        neq(col, v) { st.filters.push(r => r[col] !== v); return api; },
        gt(col, v) { st.filters.push(r => r[col] > v); return api; },
        gte(col, v) { st.filters.push(r => r[col] >= v); return api; },
        lt(col, v) { st.filters.push(r => r[col] < v); return api; },
        lte(col, v) { st.filters.push(r => r[col] <= v); return api; },
        in(col, vs) { st.filters.push(r => vs.indexOf(r[col]) >= 0); return api; },
        like() { return api; }, ilike() { return api; }, or() { return api; },
        contains() { return api; }, filter() { return api; }, match() { return api; },
        not() { return api; },
        is() { return api; },
        maybeSingle() { st.single = true; return api; },
        single() { st.single = true; return api; },
        then(ok, err) { return Promise.resolve(res()).then(ok, err); },
      };
      return api;
    }
    function table(name) {
      return {
        select: (cols) => q(name, cols),
        update(patch) {
          window.__stub.writes.push({ op: 'update', table: name, patch: JSON.parse(JSON.stringify(patch)) });
          if (window.__stub.rlsBlock && window.__stub.rlsBlock === name) {
            const e = { message: 'new row violates row-level security policy', code: '42501' };
            return { eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: e }),
                                                   single: () => Promise.resolve({ data: null, error: e }) }) }) };
          }
          if (!HAS_ORDER && 'order_status' in patch) {
            // A real database rejects the whole statement — this is the failure
            // the capability probe exists to prevent.
            return { eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: NO_COL }) }) }) };
          }
          const apply = (pred) => { (T[name] || []).forEach(r => { if (pred(r)) Object.assign(r, patch); }); };
          return { eq: (col, v) => ({ select: () => ({ maybeSingle: () => {
            apply(r => r[col] === v);
            const hit = (T[name] || []).find(r => r[col] === v);
            return Promise.resolve({ data: hit ? { id: hit.id, legacy_id: hit.legacy_id } : null, error: null });
          } }) }) };
        },
        upsert(row) {
          window.__stub.writes.push({ op: 'upsert', table: name, patch: JSON.parse(JSON.stringify(row)) });
          if (!HAS_ORDER && 'order_status' in row) {
            return { select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: NO_COL }) }) };
          }
          if (window.__stub.rlsBlock && window.__stub.rlsBlock === name) {
            // RLS denial: PostgREST returns a Postgres error code, which
            // diffEntity classifies as permanent and SWALLOWS with a warn.
            const e = { message: 'new row violates row-level security policy', code: '42501' };
            return { select: () => ({ single: () => Promise.resolve({ data: null, error: e }),
                                      maybeSingle: () => Promise.resolve({ data: null, error: e }) }) };
          }
          const list = (T[name] = T[name] || []);
          // onConflict: 'legacy_id' — a NULL legacy_id matches NOTHING in
          // Postgres (NULL != NULL), so this INSERTS. That is the real
          // behaviour, and the whole point of this fixture.
          const i = row.legacy_id == null ? -1 : list.findIndex(r => r.legacy_id === row.legacy_id);
          if (i >= 0) Object.assign(list[i], row); else list.push({ id: 'new-' + name + '-' + list.length, ...row });
          const hit = i >= 0 ? list[i] : list[list.length - 1];
          const out = { select: () => ({
            single: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }),
            maybeSingle: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }),
          }) };
          return out;
        },
        insert() { return { select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }; },
        delete() { return { not: () => Promise.resolve({ error: null }), eq: () => Promise.resolve({ error: null }) }; },
      };
    }
    const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
    window.supabase = {
      createClient: () => ({
        auth: {
          getUser: async () => ({ data: { user: { id: UID, email: 'spiro@example.com' } } }),
          getSession: async () => ({ data: { session: { user: { id: UID, email: 'spiro@example.com' } } } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({}),
        },
        from: table,
        channel: () => chan,
        removeChannel() {},
        storage: { from: () => ({
          list: async () => ({ data: [] }), remove: async () => ({}),
          upload: async () => ({ data: {}, error: null }),
          createSignedUrls: async () => ({ data: [] }), createSignedUrl: async () => ({ data: null }),
        }) },
        functions: { invoke: async () => ({ data: null, error: null }) },
      }),
    };
    // profiles.role lives on a table too
    T.profiles = [{ id: UID, role: ROLE }];
  })();`;
}

async function boot(hasOrderCol) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`)) {
      if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
      return route.continue();
    }
    // supabase-js is replaced by the stub; serve an empty body for the CDN tag.
    return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
  });
  const all = [];
  page.on('pageerror', e => { errs.push(String(e).slice(0, 200)); all.push('PAGEERROR ' + String(e).slice(0, 200)); });
  page.on('console', m => {
    all.push(m.type().toUpperCase() + ' ' + m.text().slice(0, 220));
    if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 180));
  });
  if (process.env.SYNC_DEBUG) page.on('console', m => console.log('  [page]', m.type(), m.text().slice(0, 220)));
  await page.addInitScript(stubScript(hasOrderCol));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  // The real cloud-sync boots on the stub and pulls; wait for it to land.
  try {
    await page.waitForFunction(() => window.CloudSync && db.data.defects && db.data.defects.length >= 2, null, { timeout: 15000 });
  } catch (e) {
    console.log('BOOT DIAG:', await page.evaluate(() => JSON.stringify({
      cloudSync: !!window.CloudSync,
      defects: (db.data.defects || []).length,
      addresses: (db.data.addresses || []).length,
      contractors: (db.data.contractors || []).length,
      bar: (document.getElementById('cs-statusbar') || {}).textContent,
      login: !!document.querySelector('#cs-login, .cs-login'),
    })));
    console.log('ERRS:', errs.slice(0, 8));
    throw e;
  }
  return { ctx, page, errs };
}

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ===========================================================================
//  A. The database has NOT been migrated — the reported bug.
// ===========================================================================
console.log('\n=== order_status column MISSING (today\'s live database) ===');
{
  const { ctx, page, errs } = await boot(false);

  check('cloud-sync booted on the stub and pulled',
    await page.evaluate(() => db.data.defects.length) === 2);

  // Flag it exactly the way a supervisor does — through the UI.
  await page.evaluate(() => viewDefectsForAddress(db.data.defects[0].addressId));
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('.defect-item .defect-text').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('.defect-item.row-open .order-btn').click());
  await page.waitForTimeout(400);
  check('🛒 puts the item on the shopping list',
    await page.evaluate(() => shoppingItems(null).length) === 1);

  // The write must NOT carry the unknown column, or it 400s the whole row.
  const writes = await page.evaluate(() => window.__stub.writes.filter(w => w.table === 'dm_defects'));
  console.log('defect writes:', JSON.stringify(writes.map(w => ({ op: w.op, keys: Object.keys(w.patch).length, order: 'order_status' in w.patch }))));
  check('the write omits the column that does not exist',
    writes.length > 0 && writes.every(w => !('order_status' in w.patch)),
    JSON.stringify(writes.map(w => 'order_status' in w.patch)));
  check('the rest of the defect still wrote',
    writes.some(w => w.patch.description === 'Downpipe missing behind garage'));

  // ---- THE BUG: a background pull rebuilds db.data wholesale.
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(600);
  const after1 = await page.evaluate(() => ({
    onList: shoppingItems(null).length,
    stored: (db.data.defects.find(d => d.id === 1) || {}).orderStatus,
  }));
  console.log('after 1 pull:', JSON.stringify(after1));
  check('the flag SURVIVES a background pull', after1.onList === 1 && after1.stored === 'needed', JSON.stringify(after1));

  // It vanished "after a short period" — i.e. after several pulls, not one.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.CloudSync.pull());
    await page.waitForTimeout(250);
  }
  const after5 = await page.evaluate(() => ({
    onList: shoppingItems(null).length,
    stored: (db.data.defects.find(d => d.id === 1) || {}).orderStatus,
    badge: (document.querySelector('.shop-home-n') || {}).textContent,
  }));
  console.log('after 5 pulls:', JSON.stringify(after5));
  check('…and survives five of them', after5.onList === 1 && after5.stored === 'needed', JSON.stringify(after5));

  // A reload: db.data is persisted locally, so the flag must come back.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  await page.waitForFunction(() => db.data.defects && db.data.defects.length >= 2, null, { timeout: 20000 });
  await page.waitForTimeout(600);
  check('the flag survives a full app reload',
    await page.evaluate(() => shoppingItems(null).length) === 1,
    await page.evaluate(() => JSON.stringify(db.data.defects.map(d => d.orderStatus || ''))));

  // Clearing must still clear — preservation must not become a one-way latch.
  await page.evaluate(() => { db.setDefectOrder(1, ''); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(500);
  check('clearing the flag sticks too (not a one-way latch)',
    await page.evaluate(() => shoppingItems(null).length) === 0,
    await page.evaluate(() => JSON.stringify(db.data.defects.map(d => d.orderStatus || ''))));

  // Advancing states across a pull.
  await page.evaluate(() => { db.setDefectOrder(2, 'ordered'); });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(500);
  check('"Ordered" survives a pull too',
    await page.evaluate(() => (db.data.defects.find(d => d.id === 2) || {}).orderStatus) === 'ordered');

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  console.log('errors:', bad.length ? bad : 'none');
  if (bad.length) fail.push('errors (unmigrated)');
  await page.screenshot({ path: `${OUT}/80-sync-unmigrated.png` });
  await ctx.close();
}

// ===========================================================================
//  B. The database HAS been migrated — the cloud owns the value.
// ===========================================================================
console.log('\n=== order_status column PRESENT (after the migration) ===');
{
  const { ctx, page, errs } = await boot(true);

  await page.evaluate(() => { db.setDefectOrder(1, 'needed'); });
  await page.waitForTimeout(500);
  const writes = await page.evaluate(() => window.__stub.writes.filter(w => w.table === 'dm_defects'));
  console.log('defect writes:', JSON.stringify(writes.map(w => ({ op: w.op, order: w.patch.order_status }))));
  check('the write now CARRIES the column',
    writes.some(w => w.patch.order_status === 'needed'),
    JSON.stringify(writes.map(w => w.patch.order_status)));
  check('the cloud row was updated',
    await page.evaluate(() => window.__stub.T.dm_defects.find(r => r.legacy_id === 1).order_status) === 'needed');

  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(500);
  check('and it comes back down on the next pull',
    await page.evaluate(() => (db.data.defects.find(d => d.id === 1) || {}).orderStatus) === 'needed');

  // ANOTHER DEVICE clears it. The cloud must win — this is the case the
  // per-row `'order_status' in d` test protects, and the reason preservation
  // is keyed off the row shape rather than a session-wide flag.
  await page.evaluate(() => { window.__stub.T.dm_defects.find(r => r.legacy_id === 1).order_status = null; });
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(500);
  const cleared = await page.evaluate(() => ({
    stored: (db.data.defects.find(d => d.id === 1) || {}).orderStatus,
    onList: shoppingItems(null).length,
  }));
  console.log('after another device cleared it:', JSON.stringify(cleared));
  check('a flag cleared on another device clears here', cleared.stored === '' && cleared.onList === 0, JSON.stringify(cleared));

  // …and one SET on another device arrives.
  await page.evaluate(() => { window.__stub.T.dm_defects.find(r => r.legacy_id === 2).order_status = 'ordered'; });
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(500);
  check('a flag set on another device arrives here',
    await page.evaluate(() => (db.data.defects.find(d => d.id === 2) || {}).orderStatus) === 'ordered');

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
  console.log('errors:', bad.length ? bad : 'none');
  if (bad.length) fail.push('errors (migrated)');
  await ctx.close();
}

// ===========================================================================
//  C. Sharing a supervisor-added contractor (Settings → Contractors to review)
// ===========================================================================
console.log('\n=== sharing a contractor ===');
{
  const { ctx, page, errs } = await boot(true);

  const before = await page.evaluate(() => ({
    pending: (db.data.contractors || []).filter(c => c.isShared === false).map(c => ({ id: c.id, name: c.name })),
    total: (db.data.contractors || []).length,
  }));
  console.log('to review:', JSON.stringify(before));
  check('both private contractors reach the manager', before.pending.length === 2, JSON.stringify(before.pending));

  // ---- The one that carries a legacy_id (added by a supervisor in this app).
  const withLid = before.pending.find(c => c.id === 2);
  await page.evaluate(id => shareContractor(id), withLid.id);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(700);
  const r1 = await page.evaluate(() => ({
    stillPending: (db.data.contractors || []).filter(c => c.isShared === false).map(c => c.name),
    cloud: window.__stub.T.dm_contractors.map(c => ({ n: c.name, shared: c.is_shared === true })),
    rows: window.__stub.T.dm_contractors.length,
  }));
  console.log('after sharing TMG:', JSON.stringify(r1));
  check('a contractor WITH a legacy_id shares and stays shared',
    !r1.stillPending.includes('TMG Carpentry'), JSON.stringify(r1.stillPending));
  check('…and no duplicate row was created', r1.rows === 3, r1.rows + ' rows');

  // ---- The one whose cloud legacy_id is NULL (CH Tracker origin). This is the
  //      case that broke defects; contractors take the same upsert path.
  const noLid = before.pending.find(c => c.id !== 2);
  await page.evaluate(id => shareContractor(id), noLid.id);
  await page.waitForTimeout(900);
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(700);
  const r2 = await page.evaluate(() => ({
    stillPending: (db.data.contractors || []).filter(c => c.isShared === false).map(c => c.name),
    rows: window.__stub.T.dm_contractors.length,
    names: window.__stub.T.dm_contractors.map(c => c.name),
    vicShared: (window.__stub.T.dm_contractors.find(c => c.id === 'c3') || {}).is_shared,
  }));
  console.log('after sharing Vic Plaster (legacy_id NULL):', JSON.stringify(r2));
  check('a contractor with a NULL legacy_id shares and stays shared',
    !r2.stillPending.includes('Vic Plaster Adam'), JSON.stringify(r2.stillPending));
  check('…the ORIGINAL cloud row was updated, not duplicated',
    r2.rows === 3 && r2.vicShared === true, `${r2.rows} rows: ${r2.names.join(', ')}`);

  // ---- RLS denies the write. The user must NOT be told it worked.
  await page.evaluate(() => {
    window.__stub.T.dm_contractors.find(c => c.id === 'c1').is_shared = false;
    window.__stub.rlsBlock = 'dm_contractors';
  });
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(600);
  const denied = await page.evaluate(async () => {
    const toasts = [];
    const realToast = window.showToast;
    window.showToast = (m, bad) => { toasts.push(String(m)); return realToast(m, bad); };
    const c = (db.data.contractors || []).find(x => x.isShared === false);
    await shareContractor(c.id);
    await new Promise(r => setTimeout(r, 1200));
    window.showToast = realToast;
    return { toasts, stillPending: (db.data.contractors || []).filter(x => x.isShared === false).map(x => x.name) };
  });
  console.log('when the database refuses:', JSON.stringify(denied));
  check('a refused share does NOT claim success',
    !denied.toasts.some(t => /shared with the team/i.test(t)), JSON.stringify(denied.toasts));
  check('…and says what went wrong',
    denied.toasts.some(t => /could not|couldn|failed|permission/i.test(t)), JSON.stringify(denied.toasts));
  check('…and the contractor stays in the review list, not silently gone',
    denied.stillPending.length === 1, JSON.stringify(denied.stillPending));

  const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]|row-level security/.test(e));
  console.log('errors:', bad.length ? bad : 'none');
  if (bad.length) fail.push('errors (share)');
  await ctx.close();
}


// ===========================================================================
//  D. A supervisor's jobs must appear as soon as we know WHO they are, not at
//     the end of the pull. Reported from site: "Loading your jobs..." for ages
//     while the contractor search worked fine.
// ===========================================================================
console.log('\n=== jobs paint at identity, not at end-of-pull ===');
{
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx2.newPage();
  await ctx2.route('**', route => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`)) {
      if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
      return route.continue();
    }
    return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
  });
  await page.addInitScript(stubScript(true, 'supervisor', { table: 'dm_defects', ms: 2500 }));
  // A device that already holds cached jobs from a previous session — exactly
  // the state after signing out and back in as someone else. Sign-out clears
  // cs_identity but NOT this.
  await page.addInitScript(() => {
    localStorage.setItem('defectTrackerDB', JSON.stringify({
      addresses: [
        { id: 101, street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648',
          supervisorId: '11111111-1111-1111-1111-111111111111', jobStatus: 'active', active: true },
        { id: 102, street: 'Lot 218, (14) Red Fruit St', suburb: 'Clyde North', propertyNumber: '305942',
          supervisorId: 'someone-else', jobStatus: 'active', active: true },
      ],
      contractors: [{ id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber' }],
      trades: [{ id: 1, name: 'Plumber' }], defects: [],
    }));
    localStorage.removeItem('cs_identity');
    localStorage.setItem('dm_preview', '0');
  });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');

  // No assertion on the transient "Loading your jobs..." frame: with a stubbed
  // client identity resolves in microseconds, so that state is not reliably
  // observable. The timing check below is the real proof.

  const t0 = Date.now();
  await page.waitForFunction(() => /Woodlawn/.test((document.getElementById('myjobs-list') || {}).textContent || ''),
    null, { timeout: 20000 });
  const paintedAt = Date.now() - t0;
  const pullDone = await page.evaluate(async () => {
    const t = Date.now();
    await window.CloudSync.pull();
    return Date.now() - t;
  });
  console.log(`jobs painted after ${paintedAt}ms; a full pull takes ~${pullDone}ms`);
  check("the supervisor's job appears WITHOUT waiting for the pull",
    paintedAt < 2000, `${paintedAt}ms vs a ~${pullDone}ms pull`);

  const shown = await page.evaluate(() => (document.getElementById('myjobs-list') || {}).textContent || '');
  check('it shows THEIR job', /Woodlawn/.test(shown), shown.replace(/\s+/g, ' ').slice(0, 70));
  check("and not another supervisor's", !/Red Fruit/.test(shown), shown.replace(/\s+/g, ' ').slice(0, 70));
  check('the loading message is gone', !/Loading your jobs/.test(shown));

  await ctx2.close();
}

console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
