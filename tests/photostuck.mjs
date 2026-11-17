// Photos that will never upload, and a message that says so (Spiro 2026-11-17):
// "what kind of bullshit is that what am I supposed to do with info what photo
// how do I fix" — about a pill reading
//
//   "7 photos still on this phone. Last attempt: new row violates row-level
//    security policy. It keeps retrying by itself; the photos are safe on the
//    phone meanwhile."
//
// Two separate failures, and the message was the smaller one.
//
// THE BUG. A photo's storage path starts with its JOB's uuid, and the bucket
// policy checks that folder against the jobs you may write to. The lookup that
// produced it was purely local — it needed the defect to still be in db.data
// AND its job to be in idMap.addresses. When either was missing it returned
// null and the path silently fell back to the DEFECT uuid, which is not a job
// folder, so storage rejected it. Every sweep. Forever. resolveDefectUuid had
// already been hardened against exactly this; this lookup had been missed.
//
// THE MESSAGE. "It keeps retrying by itself" was true and useless: retrying
// cannot repair a stale id map. The raw Postgres text named nothing the user
// owned, no job, and no action.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8143;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const JOB_UUID = 'aaaaaaaa-0000-4000-8000-000000000001';
const DEF_UUID = 'bbbbbbbb-0000-4000-8000-000000000002';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await ctx.newPage();
await ctx.route('**', route => {
  const u = route.request().url();
  if (u.startsWith(`http://localhost:${PORT}`)) {
    if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  }
  return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));

await page.addInitScript(([JOB_UUID, DEF_UUID]) => {
  // One job, one defect on it. The id map is left EMPTY, which is the stale
  // state the bug needs — and the state any fresh boot is in before a pull.
  localStorage.setItem('defectTrackerDB', JSON.stringify({
    addresses: [{ id: 1, lot: '1635', street: 'Lot 1635, Myrtleford Street',
                  streetName: 'Myrtleford Street', suburb: 'Wollert', active: true }],
    contractors: [], trades: [],
    defects: [{ id: 10, addressId: 1, description: 'Exhaust fan', location: 'Roof',
                status: 'open', createdAt: '2026-11-01T00:00:00.000Z' }],
  }));
  localStorage.setItem('dm_preview', '0');
  window.__dmJobLookups = 0;
  const UID = '11111111-1111-1111-1111-111111111111';
  const chain = (rows) => {
    const o = { data: rows || [], error: null };
    const self = () => p;
    const p = Promise.resolve(o);
    ['select', 'eq', 'is', 'in', 'not', 'order', 'limit', 'gte', 'lte', 'filter'].forEach(k => { p[k] = self; });
    p.maybeSingle = () => Promise.resolve({ data: (rows && rows[0]) || null, error: null });
    p.single = () => Promise.resolve({ data: (rows && rows[0]) || null, error: null });
    return p;
  };
  window.__jobsFetches = 0;
  const table = (name) => ({
    // The server always knows which job a defect belongs to. That is the whole
    // point of the fallback.
    select: (cols) => {
      if (name === 'dm_defects' && String(cols).includes('job_id')) {
        window.__dmJobLookups++;
        return chain([{ job_id: JOB_UUID }]);
      }
      if (name === 'jobs') {
        window.__jobsFetches++;
        // DELIBERATELY completed. CH Tracker marks a job completed while a
        // supervisor is still logging defects on it; the old recovery applied
        // the job LIST's visibility filter to this write path and left it
        // unmapped, so those defects could never leave the phone.
        return chain([{ id: JOB_UUID, active: false, status: 'completed' }]);
      }
      return chain();
    },
    insert: () => chain(), update: () => chain(), upsert: () => chain(), delete: () => chain(),
  });
  const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
  window.supabase = {
    createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: UID, email: 'demo@example.com' } } }),
        getSession: async () => ({ data: { session: { user: { id: UID, email: 'demo@example.com' } } } }),
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
}, [JOB_UUID, DEF_UUID]);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.waitForFunction(() => !!(window.CloudSync && window.CloudSync.indicator), { timeout: 15000 });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= 1. the folder the photo is filed under =================
console.log('\n--- which folder the photo goes to ---');
const folder = await page.evaluate(async (DEF_UUID) => {
  const h = window.CloudSync.indicator;
  return {
    localOnly: h.jobFolderLocalOnly(10),
    resolved: await h.jobFolderFor(10, DEF_UUID),
    lookups: window.__dmJobLookups,
  };
}, DEF_UUID);
console.log('folder:', JSON.stringify(folder));
// This is the bug, stated plainly: the local lookup CANNOT answer here.
check('the local id map cannot name the job — this is the state the bug needed',
  folder.localOnly === null, JSON.stringify(folder.localOnly));
check('…so the job is resolved from the server instead',
  folder.resolved === JOB_UUID, JSON.stringify(folder.resolved));
check('…which is the job folder, NOT the defect uuid the old path fell back to',
  folder.resolved !== DEF_UUID && folder.resolved === JOB_UUID,
  `got ${folder.resolved}, the old fallback was ${DEF_UUID}`);
check('…and it actually asked the server', folder.lookups >= 1, String(folder.lookups));

// Having resolved it once, it is cached — a job with 40 photos must not make
// 40 round trips.
const cached = await page.evaluate(async (DEF_UUID) => {
  const before = window.__dmJobLookups;
  const again = await window.CloudSync.indicator.jobFolderFor(10, DEF_UUID);
  return { again, extra: window.__dmJobLookups - before };
}, DEF_UUID);
console.log('cached:', JSON.stringify(cached));
check('the answer is cached, so the next photo on the job costs no round trip',
  cached.again === JOB_UUID && cached.extra === 0, JSON.stringify(cached));

// ================= 1b. the job the DEFECT write needs =====================
// The photos wait on the defect; the defect waits on its job being mapped.
// commitDefect used to just `return` when it was not — silently, every sweep,
// for ever. That is the whole 36-changes-stuck chain.
console.log('\n--- the job lookup the defect write depends on ---');
const jobMap = await page.evaluate(async (JOB_UUID) => {
  const h = window.CloudSync.indicator;
  h.forgetJobMap();
  const lid = h.hashId(JOB_UUID);
  const before = window.__jobsFetches;
  return {
    lid,
    localOnly: h.jobForAddressLocalOnly(lid),
    resolved: await h.jobForAddress(lid),
    fetches: window.__jobsFetches - before,
    // A failing flush calls this once per queued defect; thirty-six of those
    // must not be thirty-six round trips.
    secondCall: await h.jobForAddress(999999999),
    fetchesAfterSecond: window.__jobsFetches - before,
  };
}, JOB_UUID);
console.log('jobMap:', JSON.stringify(jobMap));
check('the local map cannot name the job — the state the defect got stuck in',
  jobMap.localOnly === null, JSON.stringify(jobMap.localOnly));
check('…so it is resolved from the server, even though the job is COMPLETED',
  jobMap.resolved === JOB_UUID, JSON.stringify(jobMap.resolved));
check('…which is the point: hiding a finished job is a display decision, not a write one',
  jobMap.fetches === 1, `${jobMap.fetches} fetch(es)`);
check('a second miss does not mean a second round trip',
  jobMap.fetchesAfterSecond === 1 && jobMap.secondCall === null,
  `${jobMap.fetchesAfterSecond} fetch(es) total, second lookup ${JSON.stringify(jobMap.secondCall)}`);

// ================= 2. what the pill says ==================================
console.log('\n--- what the message tells a supervisor ---');
const msgs = await page.evaluate(() => {
  const h = window.CloudSync.indicator;
  h.updatePendingBanner(7);
  h.setStuckJobs(['Lot 1635, Myrtleford Street']);
  const out = {};
  const cases = {
    rls: 'new row violates row-level security policy',
    auth: 'JWT expired',
    size: 'Payload too large',
    net: 'Failed to fetch',
    notsynced: 'the defect it belongs to has not synced yet',
  };
  h.setPushState(0, '');
  for (const [k, v] of Object.entries(cases)) { h.setPhotoError(v); out[k] = h.photoWaitingReason(); }
  h.setPhotoError('');
  out.clean = h.photoWaitingReason();
  // The state Spiro was actually in: on wifi, 36 changes queued in front of
  // the photos. The photo was reporting its own symptom and blaming signal.
  h.setPhotoError('the defect it belongs to has not synced yet');
  h.setPushState(36, '');
  out.queued = h.photoWaitingReason();
  h.setPushState(36, 'the job it belongs to could not be found in the cloud');
  out.queuedStuck = h.photoWaitingReason();
  h.setPushState(0, '');
  return out;
});
for (const [k, v] of Object.entries(msgs)) console.log(` ${k}: ${JSON.stringify(v)}`);

const rls = msgs.rls;
check('the raw Postgres wording is no longer the explanation',
  !/^7 photos still on this phone\. Last attempt: new row violates/.test(rls), rls.slice(0, 70));
check('it names the job, so the user knows which of 56 it means',
  /Myrtleford Street/.test(rls), '');
check('it says what to do, not just what broke',
  /refresh/i.test(rls) && /send this screen|whoever set up/i.test(rls), '');
check('it stops claiming a permanent rejection will fix itself by retrying',
  !/keeps retrying by itself/i.test(rls), '');
check('the server\'s own words are still there for whoever they forward it to',
  /row-level security policy/.test(rls), '');
check('an expired login says to sign in again',
  /sign out and sign back in/i.test(msgs.auth), msgs.auth.slice(0, 60));
check('a genuinely transient failure still says there is nothing to do',
  /nothing to do/i.test(msgs.net) && !/Technical detail/.test(msgs.net), msgs.net.slice(0, 60));
check('a defect that has not synced yet is described as waiting, not broken',
  /on their own/i.test(msgs.notsynced) && !/Technical detail/.test(msgs.notsynced), '');
// Spiro, on wifi, being told to wait for signal: "Yes but I have wifi atm".
check('nothing blames signal while the phone is online',
  !Object.entries(msgs).some(([, v]) => /signal/i.test(v)),
  JSON.stringify(Object.entries(msgs).filter(([, v]) => /signal/i.test(v)).map(([k]) => k)));
check('with changes queued in front, it names them instead of the defect',
  /36 changes they belong to/.test(msgs.queued), msgs.queued);
check('…and points at the number that should be going down',
  /not going down/i.test(msgs.queued), '');
check('when those changes are stuck too, it says so and why',
  /stuck too/i.test(msgs.queuedStuck) && /could not be found in the cloud/.test(msgs.queuedStuck),
  msgs.queuedStuck.slice(0, 120));
check('with no error at all it still reads as uploading',
  /uploading now/.test(msgs.clean), msgs.clean.slice(0, 50));

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
