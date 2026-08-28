// Contractor ids collide across phones — "I shared it and it came back".
//
// Spiro, 2026-08-15: "when I've actually shared in the past they may have
// shared but that this still remains for some reason."
//
// db.addContractor allocated `Math.max(...existing ids) + 1`. Every phone pulls
// the SAME contractor list from the cloud, so max+1 is not merely racy — it is
// DETERMINISTIC: two supervisors who add a contractor between syncs get the
// same id with certainty. That id is pushed as `legacy_id`, and the diff
// engine inserts with `upsert(onConflict: 'legacy_id')`, so the second push
// overwrites the first contractor's row wholesale — including flipping
// is_shared back to false on one a manager had already shared. It then
// reappears in Settings → Contractors to review, which is exactly what Spiro
// is seeing.
//
// legacy_id is an int4, so the fix cannot be a timestamp: ids are drawn from a
// high random band that stays clear of the seeded ids (small) and of hashId()'s
// range (1e6..1.001e9), and a cloud row already holding the id under a
// different name is treated as someone else's contractor rather than a target
// to overwrite.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8143;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// The cloud, held in Node so two browser contexts can be two phones sharing it.
let CLOUD = [
  { id: 'c1', legacy_id: 1, name: 'COSTAS PLUMBING', phone: '', email: '', is_shared: true, added_by: null },
  { id: 'c2', legacy_id: 2, name: 'HAR Painters', phone: '', email: '', is_shared: true, added_by: null },
  { id: 'c3', legacy_id: 3, name: 'Carpenter', phone: '', email: '', is_shared: true, added_by: null, is_trade_placeholder: true },
];

function stubScript(uid, role) {
  return `(() => {
    const UID = ${JSON.stringify(uid)}, ROLE = ${JSON.stringify(role)};
    try {
      localStorage.setItem('cs_heal', 'snap-2026-06-17');
      localStorage.removeItem('cs_dirty');
      localStorage.setItem('dm_preview', '0');
      if (!localStorage.getItem('defectTrackerDB')) {
        localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
      }
    } catch (e) {}
    const T = {
      dm_trades: [], dm_contractors: [], dm_contractor_trades: [],
      jobs: [], dm_defects: [], job_call_up_archive: [], job_called_for_archive: [],
      dm_trade_learning: [], v_jobs_with_current_supervisor: [], bpi_trade_rules: [],
      bpi_ai_settings: [{ id: 1 }], deleted_rows_archive: [], dm_defect_photos: [], dm_reports: [],
      profiles: [{ id: UID, role: ROLE }],
    };
    window.__stub = { T, writes: [] };
    function q(table, cols) {
      const st = { table, cols, filters: [], single: false, from: 0, to: 1e9 };
      const rows = () => { let r = (T[table] || []).slice(); for (const f of st.filters) r = r.filter(f); return r.slice(st.from, st.to + 1); };
      const res = async () => { const r = rows(); return st.single ? { data: r[0] || null, error: null } : { data: r, error: null }; };
      const api = {
        select(c) { if (c) st.cols = c; return api; },
        order: () => api, limit(n) { st.to = st.from + n - 1; return api; },
        range(a, b) { st.from = a; st.to = b; return api; },
        eq(c, v) { st.filters.push(r => r[c] === v); return api; },
        neq(c, v) { st.filters.push(r => r[c] !== v); return api; },
        gt: () => api, gte: () => api, lt: () => api, lte: () => api,
        in(c, vs) { st.filters.push(r => vs.indexOf(r[c]) >= 0); return api; },
        like: () => api, ilike: () => api, or: () => api, contains: () => api,
        filter: () => api, match: () => api, not: () => api, is: () => api,
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
          return { eq: (col, v) => ({ select: () => ({ maybeSingle: () => {
            (T[name] || []).forEach(r => { if (r[col] === v) Object.assign(r, patch); });
            const hit = (T[name] || []).find(r => r[col] === v);
            return Promise.resolve({ data: hit ? { id: hit.id, legacy_id: hit.legacy_id } : null, error: null });
          } }) }) };
        },
        upsert(row) {
          window.__stub.writes.push({ op: 'upsert', table: name, patch: JSON.parse(JSON.stringify(row)) });
          const list = (T[name] = T[name] || []);
          // onConflict: 'legacy_id'. A NULL legacy_id matches nothing (NULL !=
          // NULL in Postgres), so that inserts; a matching one UPDATES IN PLACE,
          // which is the overwrite this suite is about.
          const i = row.legacy_id == null ? -1 : list.findIndex(r => r.legacy_id === row.legacy_id);
          if (i >= 0) Object.assign(list[i], row); else list.push({ id: 'new-' + list.length + '-' + Math.random().toString(36).slice(2, 7), ...row });
          const hit = i >= 0 ? list[i] : list[list.length - 1];
          return { select: () => ({
            single: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }),
            maybeSingle: () => Promise.resolve({ data: { id: hit.id, legacy_id: hit.legacy_id }, error: null }) }) };
        },
        insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        delete: () => ({ not: () => Promise.resolve({ error: null }), eq: () => Promise.resolve({ error: null }) }),
      };
    }
    const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
    window.supabase = { createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: UID, email: 'x@y.com' } } }),
        getSession: async () => ({ data: { session: { user: { id: UID, email: 'x@y.com' } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({}),
      },
      from: table, channel: () => chan, removeChannel() {},
      storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}), upload: async () => ({}), createSignedUrl: async () => ({ data: null }) }) },
    }) };
  })();`;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

// One phone. Its localStorage lives for the life of the context, so a device
// can act, be put down, and be picked up again with its own stale state.
async function device(uid, role) {
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
  await page.addInitScript(stubScript(uid, role));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function' && !!window.CloudSync);
  const dev = {
    page, ctx,
    // Hand this phone the current cloud, then pull it in.
    async sync() {
      await page.evaluate(rows => { window.__stub.T.dm_contractors = JSON.parse(JSON.stringify(rows)); }, CLOUD);
      await page.evaluate(() => window.CloudSync.pull());
      await page.waitForTimeout(120);
      CLOUD = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stub.T.dm_contractors)));
    },
    // Push whatever this phone has done, without pulling first — a phone that
    // has been offline, or simply hasn't refreshed since the other one acted.
    async push() {
      await page.evaluate(rows => { window.__stub.T.dm_contractors = JSON.parse(JSON.stringify(rows)); }, CLOUD);
      await page.evaluate(() => window.CloudSync.flush());
      await page.waitForTimeout(150);
      CLOUD = await page.evaluate(() => JSON.parse(JSON.stringify(window.__stub.T.dm_contractors)));
    },
    add: (name) => page.evaluate((name) => {
      const isMgr = !!(window.CloudJobs && window.CloudJobs.isManager && window.CloudJobs.isManager());
      const uid = (window.CloudJobs && window.CloudJobs.currentUserId) ? window.CloudJobs.currentUserId() : null;
      return db.addContractor({ name, tradeIds: [], isShared: isMgr, addedBy: isMgr ? null : uid }).id;
    }, name),
    // Reboot the phone with no sync baseline — a heal, a reinstall, or a
    // cleared cache. cloud-sync boots with `snapshot = emptySnap()`, which
    // means "everything re-pushes".
    async reload() {
      await page.evaluate(() => { try { localStorage.removeItem('cs_snapshot'); localStorage.removeItem('cs_idmap'); } catch (e) {} });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => typeof window.render === 'function' && !!window.CloudSync);
    },
    local: () => page.evaluate(() => (db.data.contractors || []).map(c => ({ id: c.id, name: c.name, isShared: c.isShared }))),
  };
  return dev;
}

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };
const cloudNames = () => CLOUD.map(r => `${r.legacy_id}:${r.name}${r.is_shared === false ? ' (private)' : ''}`);

// ===========================================================================
//  A. Two phones in sync allocate the SAME id for different contractors.
// ===========================================================================
console.log('\n--- A · the id generator ---');
const supA = await device('sup-a-0000-0000-0000-00000000aaaa', 'supervisor');
const supB = await device('sup-b-0000-0000-0000-00000000bbbb', 'supervisor');
await supA.sync(); await supB.sync();
{
  const a = await supA.add('Auz painting & decorating');
  const b = await supB.add('Vic Plaster Adam');
  console.log(`  supervisor A's new contractor id = ${a}, supervisor B's = ${b}`);
  check('two phones holding the same list do NOT hand out the same id', a !== b, `A=${a} B=${b}`);
  check('…and the ids stay inside int4, which is what legacy_id is',
    a > 0 && b > 0 && a < 2147483647 && b < 2147483647, `A=${a} B=${b}`);
  check('…and clear of the seeded ids and of hashId()\'s 1e6-1.001e9 band',
    a > 1001000000 && b > 1001000000, `A=${a} B=${b}`);
}

// ===========================================================================
//  B. A collision destroys one of the two contractors in the cloud.
// ===========================================================================
console.log('\n--- B · both phones push ---');
await supA.push();
await supB.push();
{
  console.log('  cloud:', JSON.stringify(cloudNames()));
  check('both contractors survive in the cloud',
    CLOUD.some(r => r.name === 'Auz painting & decorating') && CLOUD.some(r => r.name === 'Vic Plaster Adam'),
    JSON.stringify(cloudNames()));
  check('…as two separate rows, not one overwriting the other',
    CLOUD.length === 5, String(CLOUD.length));
  check('…both private to the supervisor who added them',
    CLOUD.filter(r => r.is_shared === false).length === 2, JSON.stringify(cloudNames()));
}

// ===========================================================================
//  C. The reported symptom: a shared contractor comes back as private.
// ===========================================================================
console.log('\n--- C · a manager shares one, then another phone pushes ---');
const mgr = await device('mgr-0000-0000-0000-000000000000', 'manager');
await mgr.sync();
{
  const target = CLOUD.find(r => r.name === 'Vic Plaster Adam');
  await mgr.page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'mgr' }; });
  const shared = await mgr.page.evaluate(async (id) => {
    await shareContractor(id);
    return db.getContractor(id).isShared;
  }, target.legacy_id);
  CLOUD = await mgr.page.evaluate(() => JSON.parse(JSON.stringify(window.__stub.T.dm_contractors)));
  check('the manager shares it and the cloud agrees',
    shared === true && CLOUD.find(r => r.name === 'Vic Plaster Adam').is_shared === true,
    JSON.stringify(cloudNames()));

  // The revert path. Supervisor A's phone still holds a contractor at the
  // colliding id and re-pushes it — which happens for real whenever the sync
  // baseline is reset (`snapshot = emptySnap()` on a heal, a reinstall, or a
  // cleared cache: "empty baseline => everything re-pushes"). Its stale private
  // row lands on the id the manager just shared.
  await supA.reload();
  await supA.push();
  console.log('  cloud after the stale phone re-pushes:', JSON.stringify(cloudNames()));

  const vic = CLOUD.find(r => r.name === 'Vic Plaster Adam');
  check('the contractor the manager shared is STILL shared', vic && vic.is_shared === true,
    JSON.stringify(cloudNames()));
  check('…and was not overwritten by the stale phone\'s contractor', !!vic, JSON.stringify(cloudNames()));
  check('…and the stale phone\'s own contractor survived too, under its own id',
    CLOUD.some(r => r.name === 'Auz painting & decorating'), JSON.stringify(cloudNames()));

  // What the manager sees next time they open Settings.
  await mgr.sync();
  const queue = await mgr.page.evaluate(() => {
    window.CloudJobs = { isManager: () => true, currentUserId: () => 'mgr' };
    state.currentView = 'manage'; render();
    return (db.data.contractors || []).filter(c => c.isShared === false).map(c => c.name);
  });
  console.log('  manager\'s review queue:', JSON.stringify(queue));
  check('a contractor the manager already shared does not come back to the queue',
    !queue.includes('Vic Plaster Adam'), JSON.stringify(queue));
  check('…and the one genuinely still waiting is there',
    queue.includes('Auz painting & decorating'), JSON.stringify(queue));
}

// ===========================================================================
//  D. Collisions ALREADY in the data heal themselves on the next push.
// ===========================================================================
// Every contractor added before this fix carries a low max+1 id, on every
// phone, and those are the ones colliding right now. A new allocator does
// nothing for them — the push has to notice and renumber.
console.log('\n--- D · healing a collision that already exists ---');
{
  const stale = await device('sup-d-0000-0000-0000-00000000dddd', 'supervisor');
  // A phone carrying pre-fix data: contractor id 7, plus a defect against it.
  await stale.page.evaluate(() => {
    db.data.contractors.push({ id: 7, name: 'TMG Carpentry', email: '', phone: '0401354936',
      tradeIds: [], trades: 'No Trade Assigned', isShared: false, addedBy: 'sup-d' });
    db.data.defects.push({ id: 901, addressId: 1, contractorId: 7, description: 'Adjust door margins.', status: 'open', completed: false });
    db.save();
  });
  // …and the cloud already has a DIFFERENT contractor sitting on id 7,
  // shared by a manager.
  CLOUD.push({ id: 'c7', legacy_id: 7, name: 'Vic Plaster Adam', phone: '', email: '', is_shared: true, added_by: null });
  await stale.push();
  console.log('  cloud:', JSON.stringify(cloudNames()));

  const seven = CLOUD.find(r => r.legacy_id === 7);
  check('the cloud row on the colliding id is untouched',
    seven && seven.name === 'Vic Plaster Adam' && seven.is_shared === true, JSON.stringify(seven));
  check('…and the stale phone\'s contractor still reached the cloud, renumbered',
    CLOUD.some(r => r.name === 'TMG Carpentry' && r.legacy_id !== 7), JSON.stringify(cloudNames()));

  const after = await stale.page.evaluate(() => {
    const c = (db.data.contractors || []).find(x => x.name === 'TMG Carpentry');
    const d = (db.data.defects || []).find(x => x.id === 901);
    return { id: c && c.id, defectPointsAt: d && d.contractorId };
  });
  console.log('  renumbered locally to', after.id);
  check('the phone renumbered it locally too', after.id !== 7 && after.id > 1001000000, String(after.id));
  check('…and its defect follows the contractor, not the old id',
    after.defectPointsAt === after.id, `defect -> ${after.defectPointsAt}, contractor ${after.id}`);

  // A genuine re-push of the SAME contractor must still update in place — that
  // is what the upsert-on-legacy_id is for, and renumbering it would duplicate.
  const before = CLOUD.length;
  await stale.reload();
  await stale.push();
  check('re-pushing the same contractor updates in place, it does not duplicate',
    CLOUD.length === before, `${before} -> ${CLOUD.length}`);
}

console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
