// "Contractors to review" — approved contractors keep coming back.
//
// Sharing works on the manager's own phone (sync.mjs case C proves that). What
// it could not cover is a SECOND device: the supervisor who added the contractor
// still holds it locally as private (isShared: false). The diff engine's update
// patch carries the WHOLE row, so the moment anything about that contractor
// changes on their phone — a phone number, an email, a baseline heal — it pushes
// is_shared: false straight over the manager's approval, and the contractor is
// back in the review list on the next pull. Approve, revert, approve, revert.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8116;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

function stubScript() {
  return `(() => {
    try {
      localStorage.setItem('cs_heal', 'snap-2026-06-17');
      localStorage.removeItem('cs_dirty');
      localStorage.setItem('dm_preview', '0');
      if (!localStorage.getItem('defectTrackerDB')) {
        localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
      }
    } catch (e) {}
    const UID = '11111111-1111-1111-1111-111111111111';
    const T = {
      dm_trades: [{ id: 't1', name: 'Carpenter' }],
      dm_contractors: [
        { id: 'c1', legacy_id: 1, name: 'COSTAS PLUMBING', phone: '0400000001', email: 'a@b.com', is_shared: true, added_by: null },
        { id: 'c2', legacy_id: 2, name: 'TMG Carpentry', phone: '0401354936', email: 'tmg@x.com', is_shared: false, added_by: 'sup-1' },
        { id: 'c3', legacy_id: null, name: 'Vic Plaster Adam', phone: '0402000000', email: 'adam.o@vicplaster.com', is_shared: false, added_by: 'sup-2' },
      ],
      dm_contractor_trades: [],
      jobs: [{ id: 'j1', job_number: '306648', lot: '905', street: '(11) Woodlawn Rd', suburb: 'Wollert', active: true, status: 'active' }],
      dm_defects: [],
      job_call_up_archive: [], job_called_for_archive: [], dm_trade_learning: [],
      v_jobs_with_current_supervisor: [{ id: 'j1', current_supervisor_id: UID, current_supervisor_name: 'Spiro', status: 'active' }],
      bpi_trade_rules: [], bpi_ai_settings: [{ id: 1 }], deleted_rows_archive: [], dm_defect_photos: [], dm_reports: [],
    };
    window.__stub = { T, writes: [] };
    function q(table, cols) {
      const st = { table, cols, filters: [], single: false, rangeFrom: 0, rangeTo: 1e9 };
      const rows = () => { let r = (T[table] || []).slice(); for (const f of st.filters) r = r.filter(f); return r.slice(st.rangeFrom, st.rangeTo + 1); };
      const res = async () => { const r = rows(); return st.single ? { data: r[0] || null, error: null } : { data: r, error: null }; };
      const api = {
        select(c) { if (c) st.cols = c; return api; }, order() { return api; },
        limit(n) { st.rangeTo = st.rangeFrom + n - 1; return api; },
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
          if (i >= 0) Object.assign(list[i], row); else list.push({ id: 'new-' + list.length, ...row });
          const hit = i >= 0 ? list[i] : list[list.length - 1];
          return { select: () => ({
            single: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }),
            maybeSingle: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }) }) };
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
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}),
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
const page = await ctx.newPage();
await ctx.route('**', route => {
  const u = route.request().url();
  if (u.startsWith(`http://localhost:${PORT}`)) {
    if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  }
  return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
});
page.on('console', m => { if (process.env.SHARE_DEBUG) console.log('  [page]', m.type(), m.text().slice(0, 200)); });
await page.addInitScript(stubScript());
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.waitForFunction(() => window.CloudSync && (db.data.contractors || []).length >= 3, null, { timeout: 20000 });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

const cloudShared = (name) => page.evaluate(n =>
  (window.__stub.T.dm_contractors.find(c => c.name === n) || {}).is_shared, name);
const pending = () => page.evaluate(() =>
  (db.data.contractors || []).filter(c => c.isShared === false).map(c => c.name));

// ---- The manager approves both private contractors.
console.log('\n=== the manager approves both ===');
{
  const before = await pending();
  console.log('to review:', JSON.stringify(before));
  check('both start in the review list', before.length === 2, JSON.stringify(before));
  for (const name of ['TMG Carpentry', 'Vic Plaster Adam']) {
    await page.evaluate(async (n) => {
      const c = db.data.contractors.find(x => x.name === n);
      await shareContractor(c.id);
    }, name);
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(700);
  console.log('after approving:', JSON.stringify(await pending()));
  check('the review list empties', (await pending()).length === 0, JSON.stringify(await pending()));
  check('TMG is shared in the cloud', (await cloudShared('TMG Carpentry')) === true);
}

// ---- The supervisor's phone still holds it as PRIVATE and edits the number.
//      This is the second device the manager never sees.
console.log('\n=== a supervisor\'s phone, still holding it as private, syncs ===');
{
  await page.evaluate(() => {
    const c = db.data.contractors.find(x => x.name === 'TMG Carpentry');
    c.isShared = false;            // their copy predates the approval
    c.addedBy = 'sup-1';
    c.phone = '0401 354 999';      // and they corrected the phone number
    db.save();
  });
  await page.evaluate(() => window.CloudSync.flush());
  await page.waitForTimeout(900);

  const shared = await cloudShared('TMG Carpentry');
  const patches = await page.evaluate(() => window.__stub.writes
    .filter(w => w.table === 'dm_contractors' && 'is_shared' in w.patch && w.patch.is_shared === false)
    .map(w => ({ op: w.op, name: w.patch.name, is_shared: w.patch.is_shared })));
  console.log('pushes that carried is_shared:false:', JSON.stringify(patches));
  console.log('cloud is_shared for TMG now:', shared);

  check('the supervisor\'s edit does NOT un-share the contractor', shared === true, String(shared));
  check('the phone correction still reached the cloud',
    await page.evaluate(() => (window.__stub.T.dm_contractors.find(c => c.name === 'TMG Carpentry') || {}).phone === '0401 354 999'));

  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(700);
  const back = await pending();
  console.log('review list after the next pull:', JSON.stringify(back));
  check('the approved contractor does NOT come back to the review list',
    !back.includes('TMG Carpentry'), JSON.stringify(back));
}

// ---- Same again for the CH Tracker-origin row (legacy_id NULL).
console.log('\n=== same, for a CH Tracker row with legacy_id NULL ===');
{
  await page.evaluate(() => {
    const c = db.data.contractors.find(x => x.name === 'Vic Plaster Adam');
    c.isShared = false; c.addedBy = 'sup-2'; c.email = 'adam.o@vicplaster.com.au';
    db.save();
  });
  await page.evaluate(() => window.CloudSync.flush());
  await page.waitForTimeout(900);
  await page.evaluate(() => window.CloudSync.pull());
  await page.waitForTimeout(700);
  const back = await pending();
  console.log('review list:', JSON.stringify(back), 'cloud shared:', await cloudShared('Vic Plaster Adam'));
  check('Vic Plaster Adam stays approved', !back.includes('Vic Plaster Adam'), JSON.stringify(back));
  check('…and no duplicate row appeared',
    await page.evaluate(() => window.__stub.T.dm_contractors.length === 3),
    await page.evaluate(() => String(window.__stub.T.dm_contractors.length) + ' rows'));
}

// ---- A brand-new private contractor must STILL arrive as private.
console.log('\n=== a newly added contractor still arrives for review ===');
{
  await page.evaluate(() => {
    db.data.contractors.push({ id: 9001, name: 'Brand New Sub', phone: '0400111222', email: 'new@sub.com',
      trades: 'No Trade Assigned', tradeIds: [], isShared: false, addedBy: 'sup-1' });
    db.save();
  });
  await page.evaluate(() => window.CloudSync.flush());
  await page.waitForTimeout(900);
  const shared = await cloudShared('Brand New Sub');
  console.log('cloud is_shared for the new sub:', shared);
  check('a new supervisor-added contractor is created PRIVATE', shared === false, String(shared));
  check('…and shows in the review list', (await pending()).includes('Brand New Sub'), JSON.stringify(await pending()));
}

console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
