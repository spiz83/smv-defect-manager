// "I add 5 items and only 2 show in the report."
//
// Drives the REAL cloud-sync.js against a stubbed Supabase that enforces the
// same unique index the live database carries since mig 105:
//
//     unique (job_id, description, contractor_id)      -- note: no status column
//
// The local duplicate guard in db.addDefect() deliberately IGNORES completed
// defects, so a defect that was raised and ticked off weeks ago can be raised
// again — that is correct and wanted. The database index has no such exemption.
// So the re-raised item collides, and commitDefect's adopt-on-conflict claims
// the OLD COMPLETED ROW as the new defect's cloud row. The next pull rebuilds
// db.data wholesale from the cloud, keyed by the cloud row's legacy_id, so the
// newly raised defect has no row of its own and disappears.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8113;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Three of these were raised months ago and ticked off. Two are brand new.
const OLD = ['Touch up paint to hallway', 'Silicone to shower base', 'Adjust door to robe'];
const NEW = ['Replace tap washer to laundry', 'Clean site on completion'];

// uniqueIndex=false reproduces the database as it was BEFORE mig 105.
function stubScript(uniqueIndex) {
  return `(() => {
    const UNIQUE = ${uniqueIndex};
    try {
      localStorage.setItem('cs_heal', 'snap-2026-06-17');
      localStorage.removeItem('cs_dirty');
      localStorage.setItem('dm_preview', '0');
      if (!localStorage.getItem('defectTrackerDB')) {
        localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
      }
    } catch (e) {}
    const UID = '11111111-1111-1111-1111-111111111111';
    const OLD = ${JSON.stringify(OLD)};
    const T = {
      dm_trades: [{ id: 't1', name: 'Plumber' }],
      dm_contractors: [{ id: 'c1', legacy_id: 1, name: 'COSTAS PLUMBING', phone: '0400000001', email: 'a@b.com', is_shared: true, added_by: null }],
      dm_contractor_trades: [{ contractor_id: 'c1', trade_id: 't1' }],
      jobs: [{ id: 'j1', job_number: '306648', lot: '905', street: '(11) Woodlawn Rd', suburb: 'Wollert', active: true, status: 'active' }],
      // The three that were done and signed off months ago.
      dm_defects: OLD.map((desc, i) => ({
        id: 'd' + (i + 1), legacy_id: i + 1, job_id: 'j1', contractor_id: 'c1', description: desc,
        status: 'completed', unassigned: false, location: '', created_at: '2026-05-01T00:00:00Z',
        completed_at: '2026-05-20T00:00:00Z', order_status: null,
        last_email_at: null, last_sms_at: null, last_update_at: null, followup_at: null, booking_at: null,
      })),
      job_call_up_archive: [], job_called_for_archive: [], dm_trade_learning: [],
      v_jobs_with_current_supervisor: [{ id: 'j1', current_supervisor_id: UID, current_supervisor_name: 'Spiro', status: 'active' }],
      bpi_trade_rules: [], bpi_ai_settings: [{ id: 1 }], deleted_rows_archive: [], dm_defect_photos: [], dm_reports: [],
    };
    window.__stub = { T, writes: [], conflicts: [] };

    function q(table, cols) {
      const st = { table, cols, filters: [], single: false, rangeFrom: 0, rangeTo: 1e9 };
      const rows = () => {
        let r = (T[table] || []).slice();
        for (const f of st.filters) r = r.filter(f);
        return r.slice(st.rangeFrom, st.rangeTo + 1);
      };
      const res = async () => {
        const r = rows();
        return st.single ? { data: r[0] || null, error: null } : { data: r, error: null };
      };
      const api = {
        select(c) { if (c) st.cols = c; return api; },
        order() { return api; }, limit(n) { st.rangeTo = st.rangeFrom + n - 1; return api; },
        range(a, b) { st.rangeFrom = a; st.rangeTo = b; return api; },
        eq(col, v) { st.filters.push(r => r[col] === v); return api; },
        neq(col, v) { st.filters.push(r => r[col] !== v); return api; },
        gt(col, v) { st.filters.push(r => r[col] > v); return api; },
        gte(col, v) { st.filters.push(r => r[col] >= v); return api; },
        lt(col, v) { st.filters.push(r => r[col] < v); return api; },
        lte(col, v) { st.filters.push(r => r[col] <= v); return api; },
        in(col, vs) { st.filters.push(r => vs.indexOf(r[col]) >= 0); return api; },
        is(col, v) { if (v === null) st.filters.push(r => r[col] == null); return api; },
        like() { return api; }, ilike() { return api; }, or() { return api; },
        contains() { return api; }, filter() { return api; }, match() { return api; }, not() { return api; },
        maybeSingle() { st.single = true; return api; }, single() { st.single = true; return api; },
        then(ok, err) { return Promise.resolve(res()).then(ok, err); },
      };
      return api;
    }
    function table(name) {
      return {
        select: (cols) => q(name, cols),
        update(patch) {
          window.__stub.writes.push({ op: 'update', table: name, patch: JSON.parse(JSON.stringify(patch)) });
          const apply = (pred) => { (T[name] || []).forEach(r => { if (pred(r)) Object.assign(r, patch); }); };
          return { eq: (col, v) => ({ select: () => ({ maybeSingle: () => {
            apply(r => r[col] === v);
            const hit = (T[name] || []).find(r => r[col] === v);
            return Promise.resolve({ data: hit ? { id: hit.id, legacy_id: hit.legacy_id } : null, error: null });
          } }) }) };
        },
        upsert(row) {
          window.__stub.writes.push({ op: 'upsert', table: name, patch: JSON.parse(JSON.stringify(row)) });
          const list = (T[name] = T[name] || []);
          const i = row.legacy_id == null ? -1 : list.findIndex(r => r.legacy_id === row.legacy_id);
          // THE LIVE DATABASE'S UNIQUE INDEX (mig 105). An INSERT that duplicates
          // (job_id, description, contractor_id) is rejected with 23505 — and the
          // index does not care whether the existing row is completed.
          if (i < 0 && UNIQUE && name === 'dm_defects') {
            const clash = list.find(r =>
              r.job_id === row.job_id && r.description === row.description &&
              (r.contractor_id == null ? null : r.contractor_id) === (row.contractor_id == null ? null : row.contractor_id));
            if (clash) {
              window.__stub.conflicts.push({ legacy_id: row.legacy_id, description: row.description, clashedWith: clash.legacy_id, clashStatus: clash.status });
              const e = { code: '23505', message: 'duplicate key value violates unique constraint "dm_defects_job_desc_contractor_uniq"' };
              return { select: () => ({ single: () => Promise.resolve({ data: null, error: e }),
                                        maybeSingle: () => Promise.resolve({ data: null, error: e }) }) };
            }
          }
          if (i >= 0) Object.assign(list[i], row); else list.push({ id: 'new-' + list.length, ...row });
          const hit = i >= 0 ? list[i] : list[list.length - 1];
          return { select: () => ({
            single: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }),
            maybeSingle: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }),
          }) };
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
      storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}),
        upload: async () => ({ data: {}, error: null }),
        createSignedUrls: async () => ({ data: [] }), createSignedUrl: async () => ({ data: null }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    }) };
    T.profiles = [{ id: UID, role: 'manager' }];
  })();`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function boot(uniqueIndex) {
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
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', m => { if (process.env.RECUR_DEBUG) console.log('  [page]', m.type(), m.text().slice(0, 200)); });
  await page.addInitScript(stubScript(uniqueIndex));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  await page.waitForFunction(() => window.CloudSync && db.data.defects && db.data.defects.length >= 3, null, { timeout: 20000 });
  return { ctx, page, errs };
}

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Raise all five through the real Add Defects screen (3 + 2 across two blocks,
// because a block only holds three rows).
async function raiseFive(page) {
  const addressId = await page.evaluate(() => db.data.addresses[0].id);
  await page.evaluate((id) => startDefectsForJob(id), addressId);
  await page.waitForTimeout(300);
  const toasts = await page.evaluate(async ({ old, neu }) => {
    const seen = [];
    const real = window.showToast;
    window.showToast = (m, bad) => { seen.push(String(m)); return real(m, bad); };
    const all = old.concat(neu);
    [[1, all.slice(0, 3)], [2, all.slice(3)]].forEach(([i, items]) => {
      const inp = document.getElementById(`add-contractor-${i}-input`);
      inp.value = 'COSTAS PLUMBING';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const item = document.querySelector(`#add-contractor-${i}-dropdown .autocomplete-item`);
      if (item) item.click();
      const rows = [...document.querySelectorAll(`.add-defect-${i}`)];
      items.forEach((t, ri) => { if (rows[ri]) rows[ri].value = t; });
    });
    saveAddDefectsAddress();
    await new Promise(r => setTimeout(r, 1200));
    window.showToast = real;
    return seen;
  }, { old: OLD, neu: NEW });
  return toasts;
}

const snapshot = (page) => page.evaluate(() => ({
  total: (db.data.defects || []).length,
  open: (db.data.defects || []).filter(d => d.status !== 'completed').map(d => d.description),
  completed: (db.data.defects || []).filter(d => d.status === 'completed').map(d => d.description),
}));

// ===========================================================================
console.log('\n=== WITH the live unique index on (job_id, description, contractor_id) ===');
{
  const { ctx, page } = await boot(true);
  const toasts = await raiseFive(page);
  console.log('toast the supervisor sees:', JSON.stringify(toasts));

  const before = await snapshot(page);
  console.log('immediately after saving :', JSON.stringify(before));
  check('the phone shows all 5 straight after saving', before.open.length === 5, `${before.open.length} of 5 open`);

  const conflicts = await page.evaluate(() => window.__stub.conflicts);
  console.log('unique-index rejections  :', JSON.stringify(conflicts, null, 0));

  // A background pull — realtime nudge, tab focus, or the periodic one.
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(1200);
  const after = await snapshot(page);
  console.log('after ONE background pull:', JSON.stringify(after));

  console.log(`\n  >> raised 5, still open after the pull: ${after.open.length}`);
  check('all 5 raised defects survive a pull', after.open.length === 5,
    `${after.open.length} of 5 — lost: ${JSON.stringify(OLD.concat(NEW).filter(d => !after.open.includes(d)))}`);
  check('no raised defect comes back marked completed',
    !after.completed.some(d => OLD.includes(d)) || after.open.length === 5,
    `${JSON.stringify(after.completed)}`);
  await ctx.close();
}

// ===========================================================================
// Control: the same five items against a database WITHOUT the unique index.
// If this one passes and the one above fails, the index is the cause.
console.log('\n=== CONTROL · same five items, database WITHOUT the unique index ===');
{
  const { ctx, page } = await boot(false);
  await raiseFive(page);
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(1200);
  const after = await snapshot(page);
  console.log('after ONE background pull:', JSON.stringify(after.open));
  check('all 5 survive when the index is absent', after.open.length === 5, `${after.open.length} of 5`);
  await ctx.close();
}

console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
