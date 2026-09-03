// A temp job for a one-off maintenance call.
//
// Spiro 2026-09-02: "something that isn't active, in the odd event that I do a
// maintenance service call… take a defect dump and then get rid of the job… I
// wouldn't want it in the database once it's been deleted, it can be
// permanently deleted. For admin user only."
//
// The guarantee is stronger than "deleted afterwards": it never goes IN. Two
// behaviours that already existed give that — addresses are CH Tracker jobs and
// are never pushed, and pushDiff drops any defect whose address has no cloud
// job. This suite pins BOTH, because either one changing would silently start
// uploading a job the supervisor was promised stays on the phone.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8207;
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
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', supervisorId: 'me', active: true }],
  contractors: [{ id: 1, name: 'COSTAS PLUMBING', trades: 'Plumber', tradeIds: [1] }],
  trades: [{ id: 1, name: 'Plumber' }],
  defects: [{ id: 1, addressId: 1, contractorId: 1, description: 'Downpipe missing', location: 'Garage', status: 'open', completed: false }],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
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
const errs = [];
const dialogs = [];
page.on('dialog', async d => { dialogs.push(d.message().slice(0, 80)); await d.accept().catch(() => {}); });
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 220)));
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

const asAdmin = (on) => page.evaluate((on) => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  window.CloudAdmin = { is: () => on, dropLocalPhotos: async (ids) => { window.__dropped = ids; return ids.length; } };
  showHomeView();
}, on);

// ================= A. admin only ===========================================
console.log('\n--- A · only the admin sees it ---');
{
  await asAdmin(false);
  await page.waitForTimeout(250);
  check('a manager who is not the admin gets no button',
    await page.evaluate(() => !document.querySelector('[onclick*="createTempJob"]')));
  const blocked = await page.evaluate(() => { createTempJob(); return !document.getElementById('tj-name'); });
  check('…and calling it directly is refused, not just hidden', blocked);

  await asAdmin(true);
  await page.waitForTimeout(250);
  const btn = await page.evaluate(() => {
    const b = document.querySelector('[onclick*="createTempJob"]');
    if (!b) return null;
    const list = document.getElementById('myjobs-list');
    return { text: b.textContent.replace(/\s+/g, ' ').trim(), belowList: b.getBoundingClientRect().top >= list.getBoundingClientRect().bottom - 1 };
  });
  console.log('button:', JSON.stringify(btn));
  check('the admin gets it', !!btn);
  check('…at the BOTTOM, under the job list', btn && btn.belowList, JSON.stringify(btn));
  check('…saying it stays on this phone', /this phone only/i.test((btn || {}).text || ''), (btn || {}).text);
}

// ================= B. create ===============================================
console.log('\n--- B · creating one ---');
{
  await page.evaluate(() => createTempJob());
  await page.waitForSelector('#tj-name', { timeout: 4000 });
  await page.evaluate(() => {
    document.getElementById('tj-name').value = '14 Bayside Ave — warranty call';
    document.getElementById('tj-sub').value = 'Point Cook';
    document.getElementById('tj-go').click();
  });
  await page.waitForTimeout(400);
  const made = await page.evaluate(() => {
    const a = (db.data.addresses || []).find(x => x.isTemp);
    return a ? { id: a.id, street: a.street, suburb: a.suburb, by: a.tempBy,
      inBand: a.id >= 1500000000 && a.id < 1600000000,
      onAddScreen: state.currentView === 'add-defects-address' && state.filters.addressId === a.id } : null;
  });
  console.log('created:', JSON.stringify(made));
  check('the job exists', !!made && /Bayside/.test(made.street), JSON.stringify(made));
  check('…owned by whoever made it', made && made.by === 'me');
  // hashId(uuid) tops out just above 1.0e9, so its own band cannot collide.
  check('…with an id that cannot collide with a real job', made && made.inBand, String(made && made.id));
  check('…and it opens straight on Add Defects, which is the whole point', made && made.onAddScreen);

  await page.evaluate(() => showHomeView());
  await page.waitForTimeout(250);
  const row = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-job-search]')].find(e => /Bayside/.test(e.innerText));
    return el ? { text: el.innerText.replace(/\n/g, ' | '), bin: !!el.querySelector('[onclick*="deleteTempJob"]') } : null;
  });
  console.log('row:', JSON.stringify(row));
  check('it is in the job list, marked TEMP', row && /TEMP/.test(row.text), JSON.stringify(row));
  check('…with a bin on it, which a real job does not get', row && row.bin);
  const realRow = await page.evaluate(() => {
    const all = [...document.querySelectorAll('[data-job-search]')];
    const el = all.find(e => /Woodlawn/.test(e.innerText));
    return { rows: all.map(e => e.innerText.replace(/\n/g, ' | ')),
      found: !!el, bin: el ? !!el.querySelector('[onclick*="deleteTempJob"]') : null,
      last: /Bayside/.test((all[all.length - 1] || {}).innerText || '') };
  });
  console.log('rows on screen:', JSON.stringify(realRow.rows));
  // The regression: the temp job carries jobStatus + supervisorId, and the job
  // list decides "does ANY job have a status/supervisor yet?" before filtering
  // on them. Counting the temp job in that probe hid every real job on a
  // handset whose cached rows predate either field. The fixture's real job
  // has no jobStatus on purpose — that is what an older cached row looks like.
  check('adding a temp job does NOT hide the real jobs', realRow.found, JSON.stringify(realRow.rows));
  check('…the real job has no bin', realRow.found && !realRow.bin, JSON.stringify(realRow));
  check('…and the temp job sits last, out of the way of the real work', realRow.last);

  // Private in practice already (it only exists on this handset), but not if
  // two people share the phone.
  await asAdmin(false);
  await page.waitForTimeout(250);
  check('a non-admin on the same handset cannot see the temp job at all',
    await page.evaluate(() => ![...document.querySelectorAll('[data-job-search]')].some(e => /Bayside/.test(e.innerText))));
  check('…while the real jobs are still there', 
    await page.evaluate(() => [...document.querySelectorAll('[data-job-search]')].some(e => /Woodlawn/.test(e.innerText))));
  await asAdmin(true);
  await page.waitForTimeout(250);
}

// ================= C. it never reaches the cloud ===========================
console.log('\n--- C · nothing about it is pushed ---');
{
  const tempId = await page.evaluate(() => (db.data.addresses || []).find(a => a.isTemp).id);
  await page.evaluate((tid) => {
    db.data.defects.push({ id: 9001, addressId: tid, contractorId: 1, description: 'Reseal shower base', location: 'Ensuite', status: 'open', completed: false });
    db.save();
  }, tempId);

  // The two rules that keep it off the cloud, asserted as behaviour rather than
  // trusted as comments: addresses are never pushed, and a defect whose address
  // has no cloud job is dropped from the push.
  const src = await page.evaluate(async () => (await (await fetch('cloud-sync.js')).text()));
  check('addresses are never pushed at all',
    /Addresses are CH Tracker jobs\s*—\s*read-only, never pushed/.test(src));
  check('…and a defect on an unmapped job is dropped from the push',
    /cur:\s*\(cur\.defects\s*\|\|\s*\[\]\)\.filter\(d\s*=>\s*idMap\.addresses\[d\.addressId\]\)/.test(src));
  check('…its photos are kept off the upload queue', /isLocalOnlyDefect\(it\.legacyId\)\) continue/.test(src));
  check('…and out of the "waiting to upload" banner', /if \(!isLocalOnlyDefect\(it\.legacyId\)\) waiting\+\+/.test(src));

  // A pull rebuilds addresses from CH Tracker wholesale. Without the carry-over
  // the temp job would be gone seconds after it was typed.
  check('a pull carries temp jobs and their defects across the rebuild',
    /carryTempAddresses/.test(src) && /carryTempDefects/.test(src));
  check('…and puts them back AFTER the cloud snapshot, so they are never diffed into a push',
    /snapshot = cloneSnap\(db\.data\);[\s\S]{0,600}?carryTempAddresses\.length/.test(src));
}

// ================= D. delete means gone ====================================
console.log('\n--- D · deleting it ---');
{
  const before = await page.evaluate(() => ({
    addresses: db.data.addresses.length, defects: db.data.defects.length,
    tempId: (db.data.addresses.find(a => a.isTemp) || {}).id,
  }));
  await page.evaluate((id) => deleteTempJob(id), before.tempId);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    addresses: db.data.addresses.length, defects: db.data.defects.length,
    anyTemp: db.data.addresses.some(a => a.isTemp),
    orphans: db.data.defects.filter(d => !db.data.addresses.some(a => a.id === d.addressId)).length,
    dropped: window.__dropped,
    stored: JSON.parse(localStorage.getItem('defectTrackerDB') || '{}'),
  }));
  console.log('before:', JSON.stringify(before), ' after:', JSON.stringify({ ...after, stored: undefined }));
  check('it was confirmed first, not deleted on a tap', dialogs.some(d => /Delete the temp job/.test(d)), JSON.stringify(dialogs));
  check('the job is gone', !after.anyTemp);
  check('…and its defects with it', after.defects === before.defects - 1, `${before.defects} -> ${after.defects}`);
  check('…leaving no orphaned defects behind', after.orphans === 0, String(after.orphans));
  check('…the local photos are dropped too — that IS the delete, there is no cloud copy',
    Array.isArray(after.dropped) && after.dropped.length === 1 && after.dropped[0] === 9001, JSON.stringify(after.dropped));
  check('…and it is out of storage, not just the screen',
    !(after.stored.addresses || []).some(a => a.isTemp), JSON.stringify((after.stored.addresses || []).map(a => a.id)));
  check('the real job is untouched',
    after.addresses === before.addresses - 1 && (after.stored.addresses || []).some(a => a.id === 1),
    `${before.addresses} -> ${after.addresses}`);
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
