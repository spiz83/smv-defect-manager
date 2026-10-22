// Recently visited jobs (Spiro 2026-10-22): "order addresses based on those
// visited last… it's like a recents list."
//
// At 55 active jobs the A-Z list is a scroll every time, and a supervisor works
// the same three or four houses all week. What has to hold:
//   - visiting a job floats it to the top, newest first
//   - the rest keep their A-Z order, so the list stays scannable
//   - both blocks are labelled, because a list that silently reorders itself is
//     worse than one that scrolls
//   - it survives a reload (it is the point), and survives localStorage being
//     unavailable (it must not take the list down with it)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8133;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// Twelve jobs so the 8-slot recents block can actually overflow. Streets are
// deliberately out of alphabetical order in the seed.
const SEED = {
  addresses: Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    lot: String(100 + i),
    street: `Lot ${100 + i}, ${'MKAEIGBLJCHF'[i]} Street`,
    streetName: `${'MKAEIGBLJCHF'[i]} Street`,
    lotNo: 100 + i,
    suburb: 'Clyde North', propertyNumber: String(300000 + i), active: true,
  })),
  contractors: [{ id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' }],
  trades: [], defects: [],
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
  return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };
const listState = () => page.evaluate(() => {
  const el = document.getElementById('myjobs-list');
  if (!el) return { error: 'no job list' };
  const out = [];
  [...el.children].forEach(c => {
    const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
    if (c.getAttribute('data-job-search') == null) out.push({ band: t });
    else out.push({ job: (c.querySelector('div[onclick] div') || {}).textContent || t });
  });
  return { rows: out };
});

// ================= 1. before any visit ====================================
console.log('\n--- a fresh phone ---');
const fresh = await listState();
console.log(JSON.stringify(fresh.rows.slice(0, 4)));
check('with nothing visited the list is plain A-Z, no bands',
  !fresh.rows.some(r => r.band), JSON.stringify(fresh.rows.filter(r => r.band)));
const azFirst = fresh.rows.map(r => r.job);
check('…and it IS alphabetical', /A Street/.test(azFirst[0] || ''), azFirst[0]);

// ================= 2. visiting floats a job ===============================
console.log('\n--- after visiting three jobs ---');
await page.evaluate(() => { viewDefectsForJob(2); });   // K Street
await page.evaluate(() => { startDefectsForJob(5); });  // I Street
await page.evaluate(() => { viewDefectsForAddress(9); }); // J Street
await page.evaluate(() => { state.currentView = 'home'; render(); });
const after = await listState();
console.log(JSON.stringify(after.rows.slice(0, 6)));

check('a Recent band appears', after.rows[0] && after.rows[0].band === 'Recent', JSON.stringify(after.rows[0]));
check('…newest first — the last job opened is top',
  /J Street/.test((after.rows[1] || {}).job || ''), (after.rows[1] || {}).job);
check('…then the one before it', /I Street/.test((after.rows[2] || {}).job || ''), (after.rows[2] || {}).job);
check('…then the one before that', /K Street/.test((after.rows[3] || {}).job || ''), (after.rows[3] || {}).job);
check('an All jobs band separates the rest',
  (after.rows[4] || {}).band === 'All jobs', JSON.stringify(after.rows[4]));
check('all three entry points count as a visit — view, add, and search',
  after.rows.slice(1, 4).every(r => r.job), JSON.stringify(after.rows.slice(1, 4)));

// The tail must still be A-Z, and nothing may be lost or duplicated.
const tail = after.rows.slice(5).map(r => r.job);
const streetOf = t => (String(t).split(',')[1] || '').trim();   // "Lot 102, A Street" -> "A Street"
const tailStreets = tail.map(streetOf);
check('the rest stay alphabetical underneath',
  JSON.stringify(tailStreets) === JSON.stringify(tailStreets.slice().sort()), JSON.stringify(tailStreets));
const allJobs = after.rows.filter(r => r.job).map(r => r.job);
check('every job is still listed exactly once',
  allJobs.length === 12 && new Set(allJobs).size === 12, String(allJobs.length));

// ================= 3. re-visiting reorders ================================
console.log('\n--- re-visiting an older one ---');
await page.evaluate(() => { viewDefectsForJob(2); state.currentView = 'home'; render(); });
const bumped = await listState();
check('re-opening a job bumps it back to the top',
  /K Street/.test((bumped.rows[1] || {}).job || ''), (bumped.rows[1] || {}).job);
check('…and does not duplicate it',
  bumped.rows.filter(r => r.job && /K Street/.test(r.job)).length === 1,
  String(bumped.rows.filter(r => r.job && /K Street/.test(r.job)).length));

// ================= 4. the block is capped =================================
console.log('\n--- visiting more than the block holds ---');
const capped = await page.evaluate(() => {
  for (let i = 1; i <= 11; i++) viewDefectsForJob(i);
  state.currentView = 'home'; render();
  const el = document.getElementById('myjobs-list');
  const kids = [...el.children];
  const bandAt = kids.findIndex(c => c.getAttribute('data-job-search') == null && c.textContent.trim() === 'All jobs');
  return { recentCount: bandAt - 1, total: kids.filter(c => c.getAttribute('data-job-search') != null).length };
});
console.log('capped:', JSON.stringify(capped));
check('the Recent block is capped at 8, not the whole list',
  capped.recentCount === 8, String(capped.recentCount));
check('…and the other jobs are still all there', capped.total === 12, String(capped.total));

// ================= 5. it survives a reload ================================
console.log('\n--- after a reload ---');
// Whatever is on top right now must still be on top afterwards. Reading it
// rather than hardcoding it, because section 4 above visits eleven more jobs.
const topBefore = (await listState()).rows[1].job;
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });
const reloaded = await listState();
check('recents survive closing the app — that is the whole point',
  reloaded.rows[0] && reloaded.rows[0].band === 'Recent', JSON.stringify(reloaded.rows[0]));
check('…with the last job opened still on top',
  (reloaded.rows[1] || {}).job === topBefore,
  `${(reloaded.rows[1] || {}).job} (wanted ${topBefore})`);

// ================= 6. no storage, no crash ================================
console.log('\n--- localStorage unavailable (private window, cleared data) ---');
const noStore = await page.evaluate(() => {
  const real = { get: localStorage.getItem.bind(localStorage), set: localStorage.setItem.bind(localStorage) };
  localStorage.getItem = () => { throw new Error('denied'); };
  localStorage.setItem = () => { throw new Error('denied'); };
  let threw = null;
  try { touchJob(3); render(); } catch (e) { threw = String(e); }
  const el = document.getElementById('myjobs-list');
  const n = el ? el.querySelectorAll('[data-job-search]').length : 0;
  const bands = el ? [...el.children].filter(c => c.getAttribute('data-job-search') == null).length : 0;
  localStorage.getItem = real.get; localStorage.setItem = real.set;
  return { threw, n, bands };
});
console.log('no storage:', JSON.stringify(noStore));
check('a blocked localStorage does not throw', noStore.threw === null, String(noStore.threw));
check('…and the full job list still renders, just without recents',
  noStore.n === 12 && noStore.bands === 0, JSON.stringify(noStore));

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
