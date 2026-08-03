// Shopping list — order flag on a defect, per-job list, global list.
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


const ROOT = REPO, PORT = 8103;
const OUT = ARTIFACTS;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const CONTRACTORS = [
  { id: 1, name: 'COSTAS PLUMBING', email: 'a@b.com', phone: '0400000001', trades: 'Plumber' },
  { id: 2, name: 'AUZ PAINTING', email: 'c@d.com', phone: '0400000002', trades: 'Painter' },
];
const ADDRESSES = [
  { id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', active: true },
  { id: 2, lot: '218', street: 'Lot 218, (14) Red Fruit St', suburb: 'Clyde North', propertyNumber: '305942', active: true },
];
let id = 1;
const defects = [];
const mk = (addressId, contractorId, description, extra) =>
  defects.push({ id: id++, addressId, contractorId, description, completed: false, status: 'open', ...(extra || {}) });
mk(1, 1, 'Downpipe missing behind garage', { location: 'Garage' });
mk(1, 1, 'Replace mixer tap cartridge — ensuite', { location: 'Ensuite' });
mk(1, 2, 'Paint touch ups to hallway');
mk(2, 1, 'New shower rose required', { location: 'Bathroom' });
mk(2, 2, 'Render patch to front elevation');
const SEED = { addresses: ADDRESSES, contractors: CONTRACTORS, trades: [{ id: 1, name: 'Plumber' }, { id: 2, name: 'Painter' }], defects };

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
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
// supabase-js can't load in the harness, so CloudJobs never mounts. Every
// job-scoped screen (incl. the jobs list itself) shows nothing without it, so
// stub the identity the way a real signed-in session has it. The scoping test
// at the end swaps this for a supervisor.
await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me', role: () => 'manager' };
  render();
});

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };
const shot = n => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });

// ================= 1. the row control ======================================
console.log('\n--- the 🛒 on an expanded row ---');
await page.evaluate(() => viewDefectsForAddress(1));
await page.waitForTimeout(250);

const collapsed = await page.evaluate(() => {
  const row = document.querySelector('.defect-item');
  const btn = row.querySelector('.order-btn');
  return { exists: !!btn, visible: btn ? btn.getBoundingClientRect().width > 0 : false };
});
check('🛒 exists on every row', collapsed.exists);
check('🛒 is hidden until the row is opened', !collapsed.visible);

await page.evaluate(() => document.querySelector('.defect-item .defect-text').click());
await page.waitForTimeout(200);
const opened = await page.evaluate(() => {
  const row = document.querySelector('.defect-item.row-open');
  const btns = [...row.querySelectorAll('.defect-actions button')];
  const box = row.querySelector('.order-btn').getBoundingClientRect();
  return {
    order: btns.map(b => b.className.split(' ')[0]).join(','),
    w: Math.round(box.width), h: Math.round(box.height),
    tops: btns.map(b => Math.round(b.getBoundingClientRect().top)),
    oneLine: Math.max(...btns.map(b => b.getBoundingClientRect().bottom))
             - Math.min(...btns.map(b => b.getBoundingClientRect().top)) < 40,
    aligned: new Set(btns.map(b => Math.round(b.getBoundingClientRect().top))).size === 1,
    insideRow: Math.round(box.right) <= Math.round(row.getBoundingClientRect().right),
  };
});
console.log('open row:', JSON.stringify(opened));
check('🛒 is the FOURTH control, after ✏️ 📍 📸', opened.order === 'edit-btn,loc-btn,photo-btn,order-btn', opened.order);
check('all four controls stay on one line', opened.oneLine, JSON.stringify(opened.tops));
check('🛒 sits on the same baseline as the other three', opened.aligned, JSON.stringify(opened.tops));
check('the strip still fits the row', opened.insideRow);
check('🛒 is a real tap target', opened.w >= 24 && opened.h >= 24, opened.w + 'x' + opened.h);
await shot('70-row-open');

// flag it
await page.evaluate(() => document.querySelector('.defect-item.row-open .order-btn').click());
await page.waitForTimeout(250);
const flagged = await page.evaluate(() => ({
  stored: db.data.defects[0].orderStatus,
  onList: shoppingItems(1).length,
  badge: (document.querySelector('.cart-btn .cart-n') || {}).textContent,
}));
console.log('after flagging:', JSON.stringify(flagged));
check('tapping 🛒 marks the defect as needing an order', flagged.stored === 'needed', flagged.stored);
check('it lands on that job\'s shopping list', flagged.onList === 1, String(flagged.onList));
check('the toolbar 🛒 shows a count of 1', flagged.badge === '1', flagged.badge);

// toggle back off
await page.evaluate(() => { const r = document.querySelector('.defect-item'); r.click(); });
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector('.defect-item.row-open .order-btn').click());
await page.waitForTimeout(200);
check('tapping it again takes it off the list',
  await page.evaluate(() => !db.data.defects[0].orderStatus && shoppingItems(1).length === 0));

// ================= 2. the toolbar button ===================================
console.log('\n--- the toolbar 🛒 ---');
const tb = await page.evaluate(() => {
  const bar = document.querySelector('.defects-header .toolbar');
  const kids = [...bar.children];
  const cart = bar.querySelector('.cart-btn');
  const pv = bar.querySelector('.pv-toggle');
  const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
  return {
    order: kids.map(k => k.className.replace('icon-btn ', '').trim() || k.title).join(' | '),
    cartAfterPreview: kids.indexOf(cart) === kids.indexOf(pv) + 1,
    gapToPreview: Math.round(cart.getBoundingClientRect().left - pv.getBoundingClientRect().right),
    nextGap: Math.round(kids[kids.indexOf(cart) + 1].getBoundingClientRect().left - cart.getBoundingClientRect().right),
    rows: new Set(kids.map(mid)).size,
    overflow: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - bar.getBoundingClientRect().right),
    badge: !!bar.querySelector('.cart-n'),
  };
});
console.log('toolbar:', JSON.stringify(tb));
check('🛒 sits immediately after the preview toggle', tb.cartAfterPreview, tb.order);
check('🛒 is grouped WITH preview, not floated right', tb.gapToPreview < tb.nextGap,
  `gap to preview ${tb.gapToPreview}px vs gap to next ${tb.nextGap}px`);
check('the toolbar is still ONE line', tb.rows === 1, String(tb.rows));
check('the toolbar still fits', tb.overflow <= 0, tb.overflow + 'px');
check('no badge when nothing is flagged', !tb.badge);

// 320px phone — the toolbar now carries an eighth control
await page.setViewportSize({ width: 320, height: 720 });
await page.waitForTimeout(200);
const narrow = await page.evaluate(() => {
  const bar = document.querySelector('.defects-header .toolbar');
  const kids = [...bar.children];
  const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
  return {
    n: kids.length,
    rows: new Set(kids.map(mid)).size,
    overflow: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - bar.getBoundingClientRect().right),
    left: Math.round(Math.min(...kids.map(k => k.getBoundingClientRect().left)) - bar.getBoundingClientRect().left),
    tap: Math.round(bar.querySelector('.cart-btn').getBoundingClientRect().width),
  };
});
console.log('@320px:', JSON.stringify(narrow));
check('still one line at 320px with the extra icon', narrow.rows === 1 && narrow.n === 7, JSON.stringify(narrow));
check('nothing pushed off either edge at 320px', narrow.overflow <= 0 && narrow.left >= 0, JSON.stringify(narrow));
check('🛒 is still tappable at 320px', narrow.tap >= 18, narrow.tap + 'px');
await shot('71-toolbar-320');
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(200);

// ================= 3. the job list =========================================
console.log('\n--- the per-job list ---');
await page.evaluate(() => {
  db.setDefectOrder(1, 'needed');
  db.setDefectOrder(2, 'needed');
  db.setDefectOrder(4, 'needed');   // a DIFFERENT job
  render();
});
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector('.cart-btn').click());
await page.waitForTimeout(300);
const job = await page.evaluate(() => ({
  view: state.currentView,
  scoped: state.filters.shoppingAddressId,
  rows: document.querySelectorAll('.shop-item').length,
  groups: document.querySelectorAll('.shop-addr').length,
  count: (document.querySelector('.shop-count') || {}).textContent,
  title: (document.querySelector('.lot-title') || {}).textContent,
}));
console.log('job list:', JSON.stringify(job));
check('the toolbar 🛒 opens the shopping list', job.view === 'shopping');
check('it is scoped to THIS job', job.scoped === 1, String(job.scoped));
check('it shows only this job\'s items', job.rows === 2, String(job.rows));
check('one job = one group', job.groups === 1, String(job.groups));
check('the job address is in the heading', /Woodlawn/.test(job.title), job.title);
await shot('72-job-list');

// back returns to the job, not home
await page.evaluate(() => document.querySelector('.back-link').click());
await page.waitForTimeout(250);
check('Back from a job list returns to that job',
  await page.evaluate(() => state.currentView === 'view-defects-address' && state.filters.addressId === 1),
  await page.evaluate(() => state.currentView));

// ================= 4. the global list ======================================
console.log('\n--- the global list ---');
await page.evaluate(() => showHomeView());
await page.waitForTimeout(250);
const home = await page.evaluate(() => {
  const btn = document.querySelector('.shop-home');
  const jobs = document.getElementById('myjobs-list');
  const reports = [...document.querySelectorAll('.section-title')].find(t => /Reports/i.test(t.textContent));
  return {
    exists: !!btn,
    n: (btn.querySelector('.shop-home-n') || {}).textContent,
    sub: btn.textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
    belowJobs: btn.getBoundingClientRect().top >= jobs.getBoundingClientRect().bottom - 1,
    aboveReports: btn.getBoundingClientRect().bottom <= reports.getBoundingClientRect().top + 1,
    width: Math.round(btn.getBoundingClientRect().width),
    jobsWidth: Math.round(jobs.getBoundingClientRect().width),
  };
});
console.log('home entry:', JSON.stringify(home));
check('a Shopping List entry exists on the home screen', home.exists);
check('it sits directly BELOW the job list', home.belowJobs);
check('…and ABOVE Reports — where Spiro circled it', home.aboveReports);
check('it lines up with the job list', Math.abs(home.width - home.jobsWidth) <= 2, `${home.width} vs ${home.jobsWidth}`);
check('it carries the total across all jobs', home.n === '3', home.n);
check('the subtitle names the job spread', /3 items to order across 2 jobs/.test(home.sub), home.sub);
await shot('73-home-entry');

await page.evaluate(() => document.querySelector('.shop-home').click());
await page.waitForTimeout(300);
const global = await page.evaluate(() => ({
  view: state.currentView,
  scoped: state.filters.shoppingAddressId,
  rows: document.querySelectorAll('.shop-item').length,
  groups: [...document.querySelectorAll('.shop-addr .supplier-name-txt')].map(e => e.textContent.trim()),
  perGroup: [...document.querySelectorAll('.shop-addr-n')].map(e => e.textContent),
  count: (document.querySelector('.shop-count') || {}).textContent.trim(),
  title: (document.querySelector('.lot-title') || {}).textContent.trim(),
  subs: [...document.querySelectorAll('.shop-sub')].map(e => e.textContent.trim()),
}));
console.log('global list:', JSON.stringify(global, null, 1));
check('the global list opens unscoped', global.view === 'shopping' && global.scoped === null);
check('it lists every flagged item across jobs', global.rows === 3, String(global.rows));
check('it is grouped by address', global.groups.length === 2, JSON.stringify(global.groups));
// Groups sort alphabetically: "Lot 218, (14) Red Fruit" (1 item) before
// "Lot 905, (11) Woodlawn" (2 items).
check('each address carries its own count', global.perGroup.join(',') === '1,2', global.perGroup.join(','));
check('the header totals items and jobs', /3 items to pick up · 2 jobs/.test(global.count), global.count);
check('each item names its location and supplier',
  global.subs.some(s => /Garage · COSTAS PLUMBING/.test(s)), JSON.stringify(global.subs));
await shot('74-global-list');

// ================= 5. the three states =====================================
console.log('\n--- not actioned → ordered → got it ---');
const state1 = await page.evaluate(() => [...document.querySelectorAll('.shop-state .shop-lbl')].map(e => e.textContent));
check('everything starts as "To order"', state1.every(s => s === 'To order'), JSON.stringify(state1));

await page.evaluate(() => document.querySelector('.shop-state').click());
await page.waitForTimeout(250);
const state2 = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('.shop-state .shop-lbl')].map(e => e.textContent),
  stored: db.data.defects.map(d => d.orderStatus || ''),
  rows: document.querySelectorAll('.shop-item').length,
  highlighted: document.querySelectorAll('.shop-item.is-ordered').length,
}));
console.log('after one tap:', JSON.stringify(state2));
check('one tap moves it to "Ordered"', state2.labels.filter(s => s === 'Ordered').length === 1, JSON.stringify(state2.labels));
check('"Ordered" is stored on the defect', state2.stored.filter(s => s === 'ordered').length === 1, JSON.stringify(state2.stored));
check('an ordered item STAYS on the list', state2.rows === 3, String(state2.rows));
check('an ordered item is visually distinct', state2.highlighted === 1, String(state2.highlighted));

await page.evaluate(() => document.querySelector('.shop-item.is-ordered .shop-state').click());
await page.waitForTimeout(250);
const state3 = await page.evaluate(() => ({
  rows: document.querySelectorAll('.shop-item').length,
  stored: db.data.defects.map(d => d.orderStatus || ''),
  defectStatuses: db.data.defects.map(d => defectStatusOf(d)),
  groups: document.querySelectorAll('.shop-addr').length,
}));
console.log('after the second tap:', JSON.stringify(state3));
check('marking it "Got it" removes it from the list', state3.rows === 2, String(state3.rows));
check('…but the DEFECT stays open — the trade still has to fit it',
  state3.defectStatuses.every(s => s !== 'completed'), JSON.stringify(state3.defectStatuses));
check('"done" is remembered on the defect', state3.stored.includes('done'), JSON.stringify(state3.stored));
// The "Got it" item was Red Fruit's only one, so that whole address goes.
check('an emptied address group disappears with it', state3.groups === 1, String(state3.groups));
await shot('75-states');

// ✕ removes without touching the defect
const beforeX = await page.evaluate(() => document.querySelectorAll('.shop-item').length);
await page.evaluate(() => document.querySelector('.shop-x').click());
await page.waitForTimeout(250);
check('✕ takes an item off the list and leaves the defect alone',
  await page.evaluate(() => document.querySelectorAll('.shop-item').length) === beforeX - 1
  && await page.evaluate(() => db.data.defects.every(d => defectStatusOf(d) !== 'completed')));

// ================= 6. completing the defect clears it ======================
console.log('\n--- completing the defect ---');
await page.evaluate(() => {
  db.data.defects.forEach(d => db.setDefectOrder(d.id, ''));
  db.setDefectOrder(1, 'needed');
  db.setDefectOrder(2, 'ordered');
  render();
});
await page.waitForTimeout(200);
check('two items on the list to start', await page.evaluate(() => shoppingItems(null).length) === 2);
await page.evaluate(() => { db.setDefectStatus(1, 'completed'); render(); });
await page.waitForTimeout(250);
const afterComplete = await page.evaluate(() => ({
  onList: shoppingItems(null).length,
  rows: document.querySelectorAll('.shop-item').length,
  flagKept: db.data.defects[0].orderStatus,
}));
console.log('after completing defect 1:', JSON.stringify(afterComplete));
check('completing the defect drops it off the shopping list', afterComplete.onList === 1, String(afterComplete.onList));
check('the list on screen updates with it', afterComplete.rows === 1, String(afterComplete.rows));
check('an ORDERED item also goes when its defect completes',
  await page.evaluate(() => { db.setDefectStatus(2, 'completed'); render(); return shoppingItems(null).length; }) === 0);
check('re-opening the defect brings it back',
  await page.evaluate(() => { db.setDefectStatus(2, 'open'); render(); return shoppingItems(null).length; }) === 1);

// ================= 7. empty state + copy ===================================
console.log('\n--- empty state and copy ---');
await page.evaluate(() => { db.data.defects.forEach(d => db.setDefectOrder(d.id, '')); db.setDefectStatus(1, 'open'); render(); });
await page.waitForTimeout(250);
const empty = await page.evaluate(() => ({
  rows: document.querySelectorAll('.shop-item').length,
  msg: (document.querySelector('.empty-state p') || {}).textContent.replace(/\s+/g, ' ').trim(),
  homeZero: null,
}));
console.log('empty:', JSON.stringify(empty));
check('an empty list says what to do about it',
  empty.rows === 0 && /Tap a defect to open it, then tap 🛒/.test(empty.msg), empty.msg);
await shot('76-empty');

await page.evaluate(() => showHomeView());
await page.waitForTimeout(200);
check('the home entry is still there at zero, greyed not hidden',
  await page.evaluate(() => {
    const b = document.querySelector('.shop-home');
    return !!b && b.querySelector('.shop-home-n').textContent === '0'
      && b.querySelector('.shop-home-n').classList.contains('zero');
  }));

const copied = await page.evaluate(async () => {
  db.setDefectOrder(1, 'needed'); db.setDefectOrder(4, 'ordered'); render();
  let captured = null;
  const real = navigator.clipboard && navigator.clipboard.writeText;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t) => { captured = t; return Promise.resolve(); } },
  });
  copyShoppingList(null);
  await new Promise(r => setTimeout(r, 120));
  return captured;
});
console.log('copied text:\n' + copied);
check('copy produces an address-grouped list',
  /SHOPPING LIST/.test(copied) && /Woodlawn/.test(copied) && /Red Fruit/.test(copied), String(copied).slice(0, 60));
check('copy carries each item\'s state',
  /\[To order\]/.test(copied) && /\[Ordered\]/.test(copied), String(copied).slice(0, 200));

// ================= 8. job scoping =========================================
console.log('\n--- job scoping ---');
// NOTE: db.getAddresses() sorts db.data.addresses IN PLACE, so index order is
// not seed order by this point. Address by id.
const scoped = await page.evaluate(() => {
  // A supervisor who holds only Red Fruit (job 2) must not see Woodlawn's items.
  db.data.addresses.forEach(a => { a.supervisorId = a.id === 2 ? 'me' : 'someone-else'; });
  window.CloudJobs = { isManager: () => false, currentUserId: () => 'me' };
  render();
  const btn = document.querySelector('.shop-home');
  return { visible: btn.querySelector('.shop-home-n').textContent, raw: shoppingItems(null).length };
});
console.log('scoping:', JSON.stringify(scoped));
check('the global list only shows jobs allocated to that supervisor',
  scoped.visible === '1' && scoped.raw === 2, JSON.stringify(scoped));
const scopedList = await page.evaluate(() => {
  openShoppingList(null);
  return { rows: document.querySelectorAll('.shop-item').length,
           groups: [...document.querySelectorAll('.shop-addr .supplier-name-txt')].map(e => e.textContent.trim()) };
});
check('…and the list itself is scoped to their jobs too',
  scopedList.rows === 1 && /Red Fruit/.test(scopedList.groups[0] || ''), JSON.stringify(scopedList));
// A manager sees the lot.
const asMgr = await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  render();
  return { rows: document.querySelectorAll('.shop-item').length,
           groups: document.querySelectorAll('.shop-addr').length };
});
check('a manager sees every job\'s items', asMgr.rows === 2 && asMgr.groups === 2, JSON.stringify(asMgr));

// ================= 9. PREVIEW MODE =========================================
console.log('\n--- preview mode ---');
await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  db.data.defects.forEach(d => { db.setDefectOrder(d.id, ''); db.setDefectStatus(d.id, 'open'); });
  localStorage.setItem('dm_preview', '1');
  viewDefectsForAddress(1);
});
await page.waitForTimeout(400);
const pv = await page.evaluate(() => {
  const card = document.querySelector('.pv-card');
  const acts = [...card.querySelectorAll('.pv-act button')];
  const row = card.querySelector('.pv-act').getBoundingClientRect();
  const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
  return {
    n: acts.length,
    classes: acts.map(b => b.className.replace('pv-mini ', '').trim()),
    glyphs: acts.map(b => b.textContent.trim()),
    oneLine: new Set(acts.map(mid)).size === 1,
    overflow: Math.round(Math.max(...acts.map(b => b.getBoundingClientRect().right)) - row.right),
    tickW: Math.round(card.querySelector('.pv-tick').getBoundingClientRect().width),
    tickWraps: card.querySelector('.pv-tick').scrollHeight > card.querySelector('.pv-tick').clientHeight + 1,
  };
});
console.log('preview card actions:', JSON.stringify(pv));
check('🛒 is on the preview card', pv.n === 4 && /pv-order/.test(pv.classes[3]), JSON.stringify(pv.classes));
check('it comes after Mark done, ✏️ and 📍', pv.glyphs.slice(1).join(',') === '✏️,📍,🛒', pv.glyphs.join(','));
// With FOUR icons (✏️ 📍 📷 🛒) the row deliberately wraps: MARK DONE takes the
// full width and the icons sit beneath it. Detailed coverage is in pvgallery.mjs;
// here we only care that nothing overflows and the icons stay together.
check('nothing overflows the card', pv.overflow <= 0, JSON.stringify(pv));
check('MARK DONE is still readable', pv.tickW >= 130 && !pv.tickWraps, pv.tickW + 'px');
await shot('77-preview-card');

// tapping it must NOT re-render (that loses your place in a long job)
const pvTap = await page.evaluate(async () => {
  const before = window.scrollY;
  window.scrollTo(0, 300);
  const card = document.querySelector('.pv-card');
  const marker = card.__mark = Symbol('same-node');
  card.querySelector('.pv-order').click();
  await new Promise(r => setTimeout(r, 300));
  const after = document.querySelector('.pv-card');
  return {
    stored: db.data.defects.find(d => d.id === 1).orderStatus,
    sameNode: after.__mark === marker,
    scroll: window.scrollY,
    on: after.querySelector('.pv-order').classList.contains('on'),
    glyph: after.querySelector('.pv-order').textContent.trim(),
    badge: (document.querySelector('.cart-btn .cart-n') || {}).textContent,
    before,
  };
});
console.log('after tapping 🛒 in preview:', JSON.stringify(pvTap));
check('tapping 🛒 in preview flags the defect', pvTap.stored === 'needed', pvTap.stored);
// The card node surviving IS the proof: render() rebuilds the list wholesale,
// which is what throws you back to the top of a long job.
check('…without re-rendering the list (keeps your place)', pvTap.sameNode,
  `sameNode=${pvTap.sameNode}`);
check('the button shows it is on', pvTap.on && pvTap.glyph === '🛒');
check('the toolbar count keeps up without a render', pvTap.badge === '1', pvTap.badge);

// and it reaches the same shopping list
check('the item is on the shopping list',
  await page.evaluate(() => shoppingItems(1).length) === 1);
// toggling back off
await page.evaluate(() => document.querySelector('.pv-order').click());
await page.waitForTimeout(250);
check('tapping again takes it off',
  await page.evaluate(() => shoppingItems(1).length) === 0
  && !(await page.evaluate(() => document.querySelector('.pv-order').classList.contains('on'))));

// a flag set in LIST mode shows as on when you switch to preview
await page.evaluate(() => { db.setDefectOrder(1, 'ordered'); render(); });
await page.waitForTimeout(250);
check('a flag set elsewhere shows on the card, with its state glyph',
  await page.evaluate(() => {
    const b = document.querySelector('.pv-card .pv-order');
    return b.classList.contains('on') && b.textContent.trim() === '📦';
  }),
  await page.evaluate(() => document.querySelector('.pv-card .pv-order').textContent.trim()));

// 320px — four controls in the action row is the tight case
await page.setViewportSize({ width: 320, height: 720 });
await page.waitForTimeout(300);
const pvNarrow = await page.evaluate(() => {
  const card = document.querySelector('.pv-card');
  const acts = [...card.querySelectorAll('.pv-act button')];
  const tick = card.querySelector('.pv-tick');
  const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
  return {
    rows: new Set(acts.map(mid)).size,
    overflow: Math.round(Math.max(...acts.map(b => b.getBoundingClientRect().right)) - card.querySelector('.pv-act').getBoundingClientRect().right),
    tickW: Math.round(tick.getBoundingClientRect().width),
    tickWraps: tick.scrollHeight > tick.clientHeight + 1,
    miniW: Math.round(acts[3].getBoundingClientRect().width),
    minisAligned: new Set(acts.slice(1).map(mid)).size === 1,
  };
});
console.log('@320px:', JSON.stringify(pvNarrow));
check('nothing overflows the card at 320px', pvNarrow.overflow <= 0, JSON.stringify(pvNarrow));
check('the three icons stay on one row at 320px', pvNarrow.minisAligned, JSON.stringify(pvNarrow));
check('MARK DONE keeps a readable width at 320px (wraps to its own row)',
  !pvNarrow.tickWraps && pvNarrow.tickW >= 130, JSON.stringify(pvNarrow));
check('🛒 is still a real tap target at 320px', pvNarrow.miniW >= 36, pvNarrow.miniW + 'px');
await shot('78-preview-320');
await page.setViewportSize({ width: 390, height: 800 });
await page.evaluate(() => { localStorage.setItem('dm_preview', '0'); render(); });
await page.waitForTimeout(200);

console.log('\nerrors:', errs.length ? errs : 'none');
if (errs.length) fail.push('console/page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
