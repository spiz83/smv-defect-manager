// What makes two defects the same defect.
//
// Spiro 2026-09-04: "I entered a defect with a certain description then entered
// another with the same description, however changed the location — instead of
// ensuite I had a bathroom — and it said there's already a defect under that.
// So it's taken the photo and assigned it to the old defect. I needed it to
// have created a new defect."
//
// The guard keyed on address + description + supplier and ignored LOCATION, so
// the same wording in two rooms collapsed into one row — and the second room's
// photo was filed against the first room's defect, which is worse than the
// missing row: the evidence ends up on the wrong job.
//
// The guard itself has to survive: it exists because a double-tap on Save, and
// re-importing a report, both used to double the list, and each copy carried
// its own legacy id so the cloud could never merge them back. Every property it
// had is re-checked here alongside the fix.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__here, '..'), PORT = 8213;
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
  addresses: [{ id: 1, lot: '1756', street: 'Lot 1756, Myrtleford Street', suburb: 'Wollert', propertyNumber: '306808', supervisorId: 'me', active: true }],
  contractors: [{ id: 1, name: 'ACE TILING', trades: 'Tiler', tradeIds: [1] },
                { id: 2, name: 'HAR PAINTING', trades: 'Painter', tradeIds: [2] }],
  trades: [{ id: 1, name: 'Tiler' }, { id: 2, name: 'Painter' }],
  defects: [],
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
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 200)));
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };
const reset = () => page.evaluate(() => { db.data.defects = []; db.save(); });
const add = (o) => page.evaluate((o) => {
  const d = db.addDefect(o.defect, o.opts);
  return { id: d.id, location: d.location || '', wasDupe: db.lastAddWasDuplicate, total: db.data.defects.length };
}, o);

// ================= A. the bug =============================================
console.log('\n--- A · the same wording in two rooms ---');
{
  await reset();
  const ens = await add({ defect: { addressId: 1, contractorId: 1, description: 'Grout tiles to wall above shower.', location: 'ens' } });
  const bth = await add({ defect: { addressId: 1, contractorId: 1, description: 'Grout tiles to wall above shower.', location: 'bth' } });
  console.log('ensuite:', JSON.stringify(ens), ' bathroom:', JSON.stringify(bth));
  check('the ensuite one is raised', !ens.wasDupe && ens.total === 1);
  check('the bathroom one is a SEPARATE defect, not a duplicate of it', !bth.wasDupe, JSON.stringify(bth));
  check('…so there are two rows to go and fix, not one', bth.total === 2, String(bth.total));
  check('…with different ids, which is what keeps the photo on the right one', ens.id !== bth.id, `${ens.id} vs ${bth.id}`);
  check('…and each keeps its own room', ens.location === 'ens' && bth.location === 'bth',
    JSON.stringify([ens.location, bth.location]));
}

// ================= B. the guard still guards ==============================
console.log('\n--- B · what the guard is FOR ---');
{
  await reset();
  const one = await add({ defect: { addressId: 1, contractorId: 1, description: 'Regrout where grout is missing.', location: 'ens' } });
  const two = await add({ defect: { addressId: 1, contractorId: 1, description: 'Regrout where grout is missing.', location: 'ens' } });
  check('a double-tap on Save is still one defect', two.wasDupe && two.total === 1, JSON.stringify(two));
  check('…handing back the SAME row, so the photo lands on it', two.id === one.id, `${one.id} vs ${two.id}`);

  // Case and stray spaces are not a new defect either.
  const three = await add({ defect: { addressId: 1, contractorId: 1, description: '  REGROUT   where grout is missing. ', location: ' ENS ' } });
  check('…and neither is the same thing typed with different case or spacing',
    three.wasDupe && three.total === 1, JSON.stringify(three));
}

// ================= C. the properties location must not break ==============
console.log('\n--- C · the other things that make a defect distinct ---');
{
  await reset();
  const a = await add({ defect: { addressId: 1, contractorId: 1, description: 'Touch up paint to hallway.', location: 'all' } });
  // The reason supplier is in the key: one wording, two trades, on one job.
  const b = await add({ defect: { addressId: 1, contractorId: 2, description: 'Touch up paint to hallway.', location: 'all' } });
  check('the same wording for a DIFFERENT supplier is still its own defect',
    !b.wasDupe && b.total === 2, JSON.stringify(b));
  check('…and reaches the trade it was raised against', a.id !== b.id);

  // A completed item can genuinely happen again.
  await page.evaluate(() => { db.setDefectStatus(db.data.defects[0].id, 'completed'); });
  const again = await add({ defect: { addressId: 1, contractorId: 1, description: 'Touch up paint to hallway.', location: 'all' } });
  check('a COMPLETED defect can be raised again — things do recur',
    !again.wasDupe && again.total === 3, JSON.stringify(again));
  // …unless a source document is being re-read, where an identical line is the
  // same line read twice. This is what stopped a re-import doubling the list.
  const reimport = await add({ defect: { addressId: 1, contractorId: 1, description: 'Touch up paint to hallway.', location: 'all' },
    opts: { matchCompleted: true, quiet: true } });
  check('…but re-importing the same report does NOT double it', reimport.wasDupe, JSON.stringify(reimport));
}

// ================= D. through the actual form ============================
console.log('\n--- D · typed into Add Defects, the way it happened ---');
{
  await reset();
  // Drive the real save handler with the real form, twice — same wording, two
  // rooms — which is exactly the sequence Spiro described.
  const typeAndSave = (desc, loc) => page.evaluate(async ({ desc, loc }) => {
    startDefectsForJob(1);
    await new Promise(r => setTimeout(r, 300));
    const ci = document.getElementById('add-contractor-1-input');
    ci.value = 'ACE TILING';
    ci.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const row = document.querySelector('.add-defect-1');
    row.value = desc;
    // What the 📍 button on the row sets.
    (row.closest('.defect-input-row'))._location = loc;
    saveAddDefectsAddress();
    await new Promise(r => setTimeout(r, 300));
    return (db.data.defects || []).map(d => ({ id: d.id, loc: d.location || '', desc: d.description }));
  }, { desc, loc });

  const first = await typeAndSave('Grout tiles to wall above shower.', 'ens');
  const second = await typeAndSave('Grout tiles to wall above shower.', 'bth');
  console.log('after both saves:', JSON.stringify(second));
  check('the first save creates the ensuite defect', first.length === 1 && first[0].loc === 'ens', JSON.stringify(first));
  check('the second creates the BATHROOM one instead of matching the ensuite',
    second.length === 2, JSON.stringify(second));
  check('…and the two rooms are both recorded', 
    second.map(d => d.loc).sort().join(',') === 'bth,ens', JSON.stringify(second.map(d => d.loc)));

  // The whole point of the bug report: the photo followed the wrong defect.
  // A photo is queued against the id addDefect hands back, so distinct ids are
  // what puts the bathroom photo on the bathroom row.
  check('…under separate ids, which is what keeps each room’s photo on its own row',
    second[0].id !== second[1].id, JSON.stringify(second.map(d => d.id)));

  // And saving the SAME row twice through the same handler is still one defect.
  const third = await typeAndSave('Grout tiles to wall above shower.', 'bth');
  check('saving the same room again is still caught as a duplicate', third.length === 2, JSON.stringify(third));
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
