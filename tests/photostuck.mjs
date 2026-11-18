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
const CON_UUID = 'cccccccc-0000-4000-8000-000000000003';
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

await page.addInitScript(([JOB_UUID, DEF_UUID, CON_UUID]) => {
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
    // `range` matters: selectAllRows paginates with it, and a stub that did
    // not model it made the real paginated call throw and look like "no rows"
    // — which is exactly how a 1000-row cap would have failed in production,
    // silently.
    ['select', 'eq', 'is', 'in', 'not', 'order', 'limit', 'range', 'gte', 'lte', 'filter']
      .forEach(k => { p[k] = self; });
    p.maybeSingle = () => Promise.resolve({ data: (rows && rows[0]) || null, error: null });
    p.single = () => Promise.resolve({ data: (rows && rows[0]) || null, error: null });
    return p;
  };
  window.__jobsFetches = 0; window.__conFetches = 0;
  // 1200 jobs, the wanted one at index 1100 — past the first page.
  window.__allJobs = Array.from({ length: 1200 }, (_, i) => ({
    id: i === 1100 ? JOB_UUID : `0000${String(i).padStart(4, '0')}-0000-4000-8000-00000000ffff`,
    active: false, status: 'completed',
  }));
  // The table temp jobs sync into does not exist — which is the state Spiro's
  // database was actually in, since 2026-09-04_temp_jobs.sql had never been
  // run. Postgres answers 42P01, and everything on a temp job stops here.
  window.__tempJobsExist = false;
  const table = (name) => ({
    // The server always knows which job a defect belongs to. That is the whole
    // point of the fallback.
    select: (cols) => {
      if (name === 'dm_defects' && String(cols).includes('job_id')) {
        window.__dmJobLookups++;
        return chain([{ job_id: JOB_UUID }]);
      }
      if (name === 'dm_temp_jobs' && !window.__tempJobsExist) {
        const p = Promise.resolve({ data: null,
          error: { code: '42P01', message: 'relation "public.dm_temp_jobs" does not exist' } });
        ['select', 'eq', 'is', 'in', 'not', 'order', 'limit', 'range', 'gte', 'lte', 'filter']
          .forEach(k => { p[k] = () => p; });
        p.maybeSingle = () => p; p.single = () => p;
        return p;
      }
      if (name === 'dm_contractors' && String(cols).includes('legacy_id')) {
        window.__conFetches++;
        // Inactive on purpose: a contractor hidden from the picker is a
        // display decision, and a defect already assigned to them still has
        // to upload.
        return chain([{ id: CON_UUID, legacy_id: 77, is_active: false }]);
      }
      if (name === 'jobs') {
        window.__jobsFetches++;
        // A REAL pager, with the wanted job on the SECOND page. The jobs table
        // is shared with CH Tracker and this query carries no status filter on
        // purpose, so it asks for every job ever — well past a thousand on a
        // builder's history. A plain .select() is capped at 1000 rows and
        // would miss exactly the old completed jobs the fix exists to find.
        //
        // The target is also DELIBERATELY completed: CH Tracker marks a job
        // completed while a supervisor is still logging defects on it, and the
        // old recovery applied the job LIST's visibility filter to this write
        // path, leaving it unmapped for ever.
        const all = window.__allJobs;
        const p2 = Promise.resolve({ data: all.slice(0, 1000), error: null });
        ['select', 'eq', 'is', 'in', 'not', 'order', 'limit', 'gte', 'lte', 'filter']
          .forEach(k => { p2[k] = () => p2; });
        p2.range = (from, to) => {
          window.__pages = (window.__pages || 0) + 1;
          const page = all.slice(from, to + 1);
          const r = Promise.resolve({ data: page, error: null });
          ['select', 'eq', 'is', 'in', 'not', 'order', 'limit', 'gte', 'lte', 'filter', 'range']
            .forEach(k => { r[k] = () => r; });
          return r;
        };
        return p2;
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
}, [JOB_UUID, DEF_UUID, CON_UUID]);
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
  const localOnly = h.jobForAddressLocalOnly(lid);
  window.__pages = 0;
  const resolved = await h.jobForAddress(lid);
  const pagesForFirst = window.__pages;
  // A failing flush asks once per queued defect; thirty-six of those must not
  // be thirty-six trips to the server.
  const secondCall = await h.jobForAddress(999999999);
  return { lid, localOnly, resolved, pagesForFirst, secondCall,
           pagesAfterSecond: window.__pages };
}, JOB_UUID);
console.log('jobMap:', JSON.stringify(jobMap));
check('the local map cannot name the job — the state the defect got stuck in',
  jobMap.localOnly === null, JSON.stringify(jobMap.localOnly));
check('…so it is resolved from the server, even though the job is COMPLETED',
  jobMap.resolved === JOB_UUID, JSON.stringify(jobMap.resolved));
check('…which is the point: hiding a finished job is a display decision, not a write one',
  jobMap.resolved === JOB_UUID, '');
check('…and it pages past the first 1000 rows to reach it',
  jobMap.pagesForFirst >= 2, `${jobMap.pagesForFirst} page(s); the job sits at row 1100 of 1200`);
check('a second miss within the window costs nothing',
  jobMap.pagesAfterSecond === jobMap.pagesForFirst && jobMap.secondCall === null,
  `${jobMap.pagesAfterSecond} page(s) in total, second lookup ${JSON.stringify(jobMap.secondCall)}`);

// The contractor map is the same hole one map over. An ASSIGNED defect whose
// contractor is unmapped is deferred rather than written — correct, since
// writing would resolve the contractor to NULL and wipe the assignment — but
// the defer was permanent, so the defect sat in the outbox for ever with its
// photos behind it.
const conMap = await page.evaluate(async () => {
  const h = window.CloudSync.indicator;
  h.forgetJobMap();
  const before = window.__conFetches;
  return { localOnly: h.contractorForLocalOnly(77),
           resolved: await h.contractorFor(77),
           fetches: window.__conFetches - before };
});
console.log('conMap:', JSON.stringify(conMap));
check('an unmapped contractor is resolved from the server too, not deferred for ever',
  conMap.localOnly === null && conMap.resolved === CON_UUID,
  `${JSON.stringify(conMap.localOnly)} -> ${JSON.stringify(conMap.resolved)}`);
check('…including an inactive one, since the defect is already assigned to them',
  conMap.fetches === 1, `${conMap.fetches} fetch(es)`);

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

// ================= 5. the diagnostic ======================================
// Three rounds were spent guessing from screenshots of a symptom. This is the
// thing that ends that: every link in the chain, in one copyable block.
console.log('\n--- what the "why is it stuck" panel reports ---');
const diag = await page.evaluate(async () => {
  const h = window.CloudSync.indicator;
  // Queue a real photo through the real entry point, so the per-item lines
  // come from the actual outbox rather than a stub of it.
  try {
    await window.CloudPhotos.savePhoto(10, new File([new Blob(['x'])], 'p.jpg', { type: 'image/jpeg' }));
  } catch (e) { /* the upload will fail; the queue entry is the point */ }
  h.setPushState(36, 'the upload was refused');
  h.setPhotoError('the defect it belongs to has not synced yet');
  const text = await h.photoDiagnostic();
  await h.openPhotoHelp();
  const ov = document.getElementById('cs-phelp');
  const pre = document.getElementById('cs-phelp-pre');
  // What Copy actually puts on the clipboard, vs what is on the screen. The
  // previous version compared two separate photoDiagnostic() calls, which is
  // a race rather than a property — the queue can move between them.
  let copied = null;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (t) => { copied = t; return Promise.resolve(); } }, configurable: true });
  document.getElementById('cs-phelp-copy').click();
  await new Promise(r => setTimeout(r, 40));
  const out = {
    text,
    shown: !!ov,
    preMatches: pre ? copied === pre.textContent : false,
    hasCopy: !!document.getElementById('cs-phelp-copy'),
    hasRetry: !!document.getElementById('cs-phelp-retry'),
    explains: ov ? /still on this phone/.test(ov.textContent) : false,
  };
  document.getElementById('cs-phelp-close').click();
  out.closed = !document.getElementById('cs-phelp');
  h.setPushState(0, '');
  return out;
});
console.log(diag.text);
check('the panel opens with the plain explanation at the top', diag.shown && diag.explains, '');
check('…and a Copy details button, because a toast cannot be copied', diag.hasCopy, '');
check('…and a Try again, for the person who will not wait out the timer', diag.hasRetry, '');
check('…and closes', diag.closed, '');
check('what it copies is exactly what is on the screen', diag.preMatches, '');
// The links themselves. Each of these was a theory at some point, and the
// point of the block is that it answers all of them at once.
for (const needle of ['build ', 'online:', 'photos queued:', 'changes queued:',
                      'jobs mapped:', 'last photo error:', 'last push error:']) {
  check(`it reports "${needle.trim()}"`, diag.text.includes(needle), '');
}
check('every queued photo names its job and every link in its chain',
  /defect \d+ — /.test(diag.text)
  && /addressId=/.test(diag.text) && /temp=/.test(diag.text)
  && /jobMapped=/.test(diag.text) && /defectInCloud=/.test(diag.text)
  && /contractor=/.test(diag.text),
  '');
check('…and it says which of them is the broken link',
  /jobMapped=NO|defectInCloud=NO|contractor=NOT MAPPED|NOT IN LOCAL DB/.test(diag.text),
  'at least one link reported as broken in this fixture');

// ================= 6. the actual cause, found 2026-11-17 ==================
// The diagnostic's first real use. Spiro's phone reported:
//
//   defect 999665643 — Lot 4545, 7 Hermes St
//      addressId=1556837901 temp=true jobMapped=NO defectInCloud=NO queued=yes
//
// temp=true was the whole answer, and none of the three theories before it
// had looked there. A temp job is not a CH Tracker job: it has no row in
// `jobs`, so NO amount of resolving a job uuid can ever work, and its defects
// must not go into dm_defects at all (2026-09-04_temp_jobs.sql sets out why).
// They sync through dm_temp_jobs — a table that was drafted in September and
// never created, so everything on a temp job had been stuck ever since with
// nothing on screen saying so.
console.log('\n--- a temp job, before the migration has been run ---');
const temp = await page.evaluate(async () => {
  const h = window.CloudSync.indicator;
  // A temp job and a defect on it, exactly as the app holds them.
  db.data.addresses.push({ id: 1556837901, lot: '4545', street: 'Lot 4545, 7 Hermes St',
                           streetName: 'Hermes St', isTemp: true });
  db.data.defects.push({ id: 999665643, addressId: 1556837901, description: 'Reseal shower',
                         location: 'Ensuite', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' });
  db.save();
  h.setPushState(0, '');
  // A photo on the temp defect, through the real save path.
  try {
    await window.CloudPhotos.savePhoto(999665643,
      new File([new Blob(['x'])], 't.jpg', { type: 'image/jpeg' }));
  } catch (e) {}
  await window.CloudSync.indicator.commitDefect(999665643);
  await new Promise(r => setTimeout(r, 60));
  const text = await h.photoDiagnostic();
  return { text, pushErr: h.lastPushError ? h.lastPushError() : null,
           stillQueued: h.outboxHas ? h.outboxHas(999665643) : null,
           reason: h.photoWaitingReason() };
});
console.log(temp.text.split('\n').slice(0, 9).join('\n'));
check('the diagnostic says outright that temp-job sync is unavailable',
  /temp-job sync: NOT AVAILABLE/.test(temp.text), '');
check('…and names the migration that has to be run',
  /2026-09-04_temp_jobs\.sql/.test(temp.text), '');
check('a temp defect is NOT left queued for dm_defects',
  temp.stillQueued === false, String(temp.stillQueued));
check('the message stops reading like a permissions problem',
  /temp job/i.test(temp.reason) && !/login can see/i.test(temp.reason),
  temp.reason.slice(0, 160));
check('…and says the phone, the signal and the login are all fine',
  /Nothing is wrong with the phone/.test(temp.reason), '');

// ================= 7. the migration gets run mid-session ==================
// Spiro ran 2026-09-04_temp_jobs.sql with the app open and 54 photos queued.
// The probe used to cache "missing" for the whole session, so that phone
// would never have found out: every refresh, sweep and retry short-circuits
// on the stale answer and nothing uploads again until the app is force-quit.
// Nobody would connect those two things — the screen would go on saying the
// migration had not been run, after it had.
console.log('\n--- the table appears while the app is open ---');
const healed = await page.evaluate(async () => {
  const h = window.CloudSync.indicator;
  const out = {};
  // Pre-migration: the probe concludes missing.
  window.__tempJobsExist = false;
  out.before = await h.tempJobsAvailable();
  out.errBefore = h.lastPushError();
  // The migration runs. Nothing else changes — no reload, no sign-in.
  window.__tempJobsExist = true;
  // Immediately after, the cached answer still stands: it is a 2-minute
  // back-off, not a free round trip on every single photo.
  out.rightAway = await h.tempJobsAvailable();
  // Wind the clock past the retry window.
  h.expireTempProbe();
  out.afterRetry = await h.tempJobsAvailable();
  await new Promise(r => setTimeout(r, 60));
  out.errAfter = h.lastPhotoError();
  return out;
});
console.log('healed:', JSON.stringify(healed));
check('before the migration the probe says the table is missing',
  healed.before === false, String(healed.before));
check('…and says why, in the push error',
  /temp_jobs\.sql/.test(healed.errBefore || ''), healed.errBefore);
check('it does not re-ask on every single photo — that is a 2-minute back-off',
  healed.rightAway === false, String(healed.rightAway));
check('…but it DOES re-ask, so a migration run mid-session is noticed',
  healed.afterRetry === true, String(healed.afterRetry));
check('…and the stale "has not been run" message is cleared when it is',
  !/temp_jobs\.sql/.test(healed.errAfter || ''), JSON.stringify(healed.errAfter));

// ================= 8. photos with nothing to attach to ====================
// After the migration ran, Spiro's queue went 54 -> 7 and his changes 36 -> 0.
// Six of the seven read "NOT IN LOCAL DB": the defect they were taken against
// is on neither the phone nor the cloud, usually deleted after the photo, or
// left behind when a temp job was replaced by its cloud copy under new ids.
//
// Nothing can attach those. Retrying them for ever is why a counter that says
// "7 photos waiting" never reaches zero, and why the toast kept promising a
// background retry that could not possibly work.
console.log('\n--- photos whose defect no longer exists ---');
const orphan = await page.evaluate(async () => {
  const h = window.CloudSync.indicator;
  const out = {};
  // A photo against a defect id that is in neither place.
  try {
    await window.CloudPhotos.savePhoto(424242,
      new File([new Blob(['x'])], 'o.jpg', { type: 'image/jpeg' }));
  } catch (e) {}
  await new Promise(r => setTimeout(r, 120));
  const text1 = await h.photoDiagnostic();
  out.saysOrphan = /ORPHAN/.test(text1);
  out.perItem = /\[ORPHAN/.test(text1) || /last tried: ORPHAN/.test(text1);
  // The message stops promising a retry that cannot work.
  h.setPhotoError('ORPHAN — the defect it belongs to is not on this phone or in the cloud');
  out.reason = h.photoWaitingReason();
  // …and the panel offers the only thing that CAN clear them.
  const keys = await h.orphanPhotoKeys();
  out.keys = keys.length;
  await h.openPhotoHelp();
  out.hasDiscard = !!document.getElementById('cs-phelp-drop');
  out.discardLabel = (document.getElementById('cs-phelp-drop') || {}).textContent;
  // Never without asking.
  let asked = null;
  window.confirm = (m) => { asked = m; return false; };
  document.getElementById('cs-phelp-drop').click();
  await new Promise(r => setTimeout(r, 60));
  out.asked = asked;
  out.keptOnNo = (await h.orphanPhotoKeys()).length;
  // Say yes, and they go.
  window.confirm = () => true;
  document.getElementById('cs-phelp-drop').click();
  await new Promise(r => setTimeout(r, 120));
  out.goneOnYes = (await h.orphanPhotoKeys()).length;
  document.getElementById('cs-phelp')?.remove();
  return out;
});
console.log('orphan:', JSON.stringify(orphan, null, 1));
check('a photo whose defect is in neither place is called an orphan',
  orphan.saysOrphan, '');
check('…and the diagnostic says so against THAT photo, not the queue as a whole',
  orphan.perItem, '');
check('…the message stops promising a retry that cannot work',
  /no longer exists/.test(orphan.reason) && !/keeps trying on its own/.test(orphan.reason),
  orphan.reason.slice(0, 140));
check('…and points at the only thing that clears them', /Discard/i.test(orphan.reason), '');
check('the panel offers a Discard, counting exactly the unattachable ones',
  orphan.hasDiscard && orphan.keys >= 1 && new RegExp(`Discard ${orphan.keys} `).test(orphan.discardLabel || ''),
  `${orphan.keys} orphan(s): ${orphan.discardLabel}`);
check('…and never deletes without asking first',
  /cannot be undone/i.test(orphan.asked || ''), JSON.stringify(orphan.asked));
check('…saying no keeps every one of them',
  orphan.keptOnNo === orphan.keys, `${orphan.keptOnNo} of ${orphan.keys}`);
check('…saying yes clears them', orphan.goneOnYes === 0, String(orphan.goneOnYes));

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
