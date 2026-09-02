// Settings → Defect wordings editor (2026-08-15).
//
// The 62 curated wordings that feed the BPI suggestions are no longer frozen
// in index.html: managers edit them from Settings, grouped by trade, and the
// list is shared through Supabase (dm_defect_wordings) so every phone sees the
// same one. Spiro's rules, in his words:
//   "under the certain trade categorise the respective items … I can add a
//    defect or remove a defect Edit a comment"
//   "defects that are not assigned under a trade to be go as Supervisor"
//   "Manager only"  → the CARD and the SCREEN, not just the ✎ buttons. A
//    supervisor never sees this; the wordings still reach them as suggestions
//    while they type, which is the only part of it they need.
//   "with the trades they need to match exactly how they are written in the
//    database to match"  → the editor FLAGS a trade no contractor answers to,
//    because a wording filed under it can never be reached by picking a
//    supplier. Silently listing it would look fine and do nothing.
//
// The shared table is optional: until the migration is run the screen is
// read-only over the built-in list rather than broken or missing (section B).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8141;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [{ id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobStatus: 'active', active: true }],
  contractors: [
    { id: 1, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    { id: 2, name: 'Painter', trades: 'Painter', tradeIds: [], isTradePlaceholder: true, isActive: true },
    { id: 3, name: 'Supervisor', trades: 'Supervisor', tradeIds: [], isTradePlaceholder: true, isActive: true },
    // A real company categorised under a trade — the trade counts as "known"
    // even with no placeholder of that name.
    { id: 4, name: 'G&C Caulking Pty Ltd', trades: 'Caulker, Waterproofing', tradeIds: [] },
    { id: 5, name: 'NO TRADE MOB', trades: 'No Trade Assigned', tradeIds: [] },
  ],
  trades: [{ id: 1, name: 'Carpenter' }, { id: 2, name: 'Painter' }],
  defects: [],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
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
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 220)));
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
page.on('dialog', d => d.accept());
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };   // sections A-G run as a manager
  window.__shippedWordings = CURATED_DEFECT_WORDINGS.slice();
});

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// A stand-in for the Supabase-backed CloudWordings: same signatures, same
// return shapes, backed by an array so the round-trip is observable.
// `canEdit` is SEPARATE from the role since 2026-09-02: a manager sees the
// screen, but only the flagged wordings admin may write to the table
// (profiles.is_wordings_admin, enforced by RLS). Defaults to the old coupling so
// the sections written before that still read the way they were written.
const installFakeCloud = (role, rows, canEdit) => page.evaluate(({ role, rows, canEdit }) => {
  // CloudJobs for who may SEE the screen, CloudWordings for who may WRITE.
  window.CloudJobs = { isManager: () => role === 'manager', currentUserId: () => 'me' };
  let list = rows.map(r => ({ ...r }));
  let seq = 100;
  window.__cloudCalls = [];
  window.CloudWordings = {
    ready: () => true,
    list: () => list.slice(),
    canEdit: () => (canEdit === undefined ? role === 'manager' : !!canEdit),
    async add(text, trade, sortN) {
      window.__cloudCalls.push(['add', text, trade]);
      if (!String(text || '').trim()) return { error: 'empty' };
      const id = 'w' + (++seq);
      list.push({ id, text: String(text).trim(), trade: String(trade || 'Supervisor').trim(), n: Number(sortN) || 1 });
      return { ok: true, id };
    },
    async update(id, text, trade) {
      window.__cloudCalls.push(['update', id, text, trade]);
      const hit = list.find(w => w.id === id);
      if (hit) { hit.text = String(text).trim(); hit.trade = String(trade || 'Supervisor').trim(); }
      return { ok: true };
    },
    async remove(id) {
      window.__cloudCalls.push(['remove', id]);
      list = list.filter(w => w.id !== id);
      return { ok: true };
    },
  };
  render();
}, { role, rows, canEdit });

const FIXTURE = [
  { id: 'w1', text: 'Adjust door margins to 3mm-4mm.', trade: 'Carpenter', n: 3 },
  { id: 'w2', text: 'Align door with jamb.', trade: 'Carpenter', n: 2 },
  { id: 'w3', text: "Knock down hinge pins — it's binding.", trade: 'Carpenter', n: 1 },
  { id: 'w4', text: 'Complete outstanding internal paint items.', trade: 'Painter', n: 2 },
  { id: 'w5', text: 'Apply gloss where missed.', trade: 'Painter', n: 1 },
  { id: 'w6', text: 'Caulk inside of sink.', trade: 'Caulker', n: 1 },
  { id: 'w7', text: 'Seal hole in oven space to make vermin proof.', trade: 'Supervisor', n: 1 },
  // No contractor and no company is a "Landscaper" in SEED — this is the
  // exact case the ⚠ warning exists for.
  { id: 'w8', text: 'Compact landscaping correctly.', trade: 'Landscaper', n: 1 },
];

// Opens a trade section only if it isn't already open. The editor keeps the
// open section across a save, so a blind toggleWordingTrade() would close it.
const openTrade = (t) => page.evaluate((t) => { if (_wordOpenTrade !== t) toggleWordingTrade(t); }, t);
const closeTrade = (t) => page.evaluate((t) => { if (_wordOpenTrade === t) toggleWordingTrade(t); }, t);
const body = () => page.evaluate(() => (document.getElementById('wordings-body') || {}).innerText || '');
const screen = () => page.evaluate(() => (document.querySelector('.defects-container') || {}).innerText || '');

// ===========================================================================
//  A. The Settings entry point.
// ===========================================================================
console.log('\n--- A · Settings card ---');
{
  await page.evaluate(() => { state.currentView = 'manage'; render(); });
  const card = await page.evaluate(() => {
    const h = [...document.querySelectorAll('div')].find(d => d.textContent.trim().startsWith('📝 Defect wordings') && d.children.length === 0);
    const box = h && h.parentElement;
    return { found: !!h, text: box ? box.innerText : '', btn: box ? (box.querySelector('button') || {}).innerText : '' };
  });
  check('Settings shows a Defect wordings card', card.found, card.text.replace(/\n/g, ' | '));
  check('…with a live count of the shipped list, not a hardcoded number',
    /62 items across 12 trades\./.test(card.text), card.text.replace(/\n/g, ' | '));
  check('…and the button opens the screen', /wordings/i.test(card.btn), card.btn);

  await page.evaluate(() => showWordingsEditor());
  check('tapping it opens the editor', await page.evaluate(() => state.currentView === 'wordings'));
  check('…which the router actually renders (a missing case blanks the app)',
    /Defect wordings/.test(await screen()));
}

// ===========================================================================
//  B. No migration run yet → read-only over the built-in list.
// ===========================================================================
console.log('\n--- B · before the migration: readable, honest, not broken ---');
{
  const s = await screen();
  check('says plainly that it is read-only and why', /Read-only/.test(s) && /migration|\.sql/i.test(s), s.split('\n').slice(0, 4).join(' | '));
  check('…and still lists the built-in wordings rather than showing nothing',
    /Painter/.test(s) && /Carpenter/.test(s));
  const editable = await page.evaluate(() => wordingsCanEdit());
  check('…with editing off', editable === false);
  check('…so no ✎ / ✕ / + Add anywhere on the screen',
    !/[✎✕]/.test(await body()) && !/\+ Add/.test(await body()));
}

// ===========================================================================
//  C. Grouped by trade, collapsed, with counts.
// ===========================================================================
console.log('\n--- C · grouped by trade ---');
{
  await installFakeCloud('manager', FIXTURE);
  await page.evaluate(() => showWordingsEditor());
  const t = await body();
  check('every trade in the list has a section', ['Carpenter', 'Painter', 'Caulker', 'Supervisor', 'Landscaper'].every(x => t.includes(x)), t.replace(/\n/g, ' | '));
  check('…with its item count beside it', /Carpenter\s*3/.test(t), t.replace(/\n/g, ' | '));
  check('sections start collapsed, so 12 trades fit on one phone screen',
    !t.includes('Adjust door margins'), t.replace(/\n/g, ' | '));

  await page.evaluate(() => toggleWordingTrade('Carpenter'));
  const open = await body();
  check('tapping a trade expands just that one',
    open.includes('Adjust door margins') && !open.includes('Apply gloss where missed'), open.replace(/\n/g, ' | '));
  await page.evaluate(() => toggleWordingTrade('Carpenter'));
  check('tapping again collapses it', !(await body()).includes('Adjust door margins'));

  await page.evaluate(() => toggleWordingTrade('Painter'));
  check('opening a second trade closes the first (one section at a time)',
    (await body()).includes('Apply gloss') && !(await body()).includes('Adjust door margins'));
  await closeTrade('Painter');
}

// ===========================================================================
//  D. A trade no contractor answers to is dead weight — say so.
// ===========================================================================
console.log('\n--- D · trades that will never match a supplier ---');
{
  const known = await page.evaluate(() => [...wordingKnownTrades()].sort());
  console.log('  known trades:', JSON.stringify(known));
  check('a trade placeholder counts as a known trade', known.includes('carpenter'));
  check('…and so does a trade on a real company', known.includes('caulker'), JSON.stringify(known));
  check('"No Trade Assigned" is not a trade', !known.includes('no trade assigned'));

  const t = await body();
  check('an unmatched trade is flagged', /⚠\s*Landscaper/.test(t), t.replace(/\n/g, ' | '));
  check('…and matched ones are not', !/⚠\s*Carpenter/.test(t) && !/⚠\s*Caulker/.test(t));
  await openTrade('Landscaper');
  const w = await body();
  check('…with the reason spelled out when opened',
    /never appear when a supplier is picked/.test(w), w.replace(/\n/g, ' | ').slice(0, 200));
  await closeTrade('Landscaper');
}

// ===========================================================================
//  E. Search.
// ===========================================================================
console.log('\n--- E · search ---');
{
  await page.evaluate(() => wordingsSetFilter('door'));
  const d = await body();
  check('searching filters to matching wordings', d.includes('Adjust door margins') && d.includes('Align door with jamb'), d.replace(/\n/g, ' | '));
  check('…auto-expands, so a hit is never hidden behind a collapsed section',
    !d.includes('Apply gloss'), d.replace(/\n/g, ' | '));
  await page.evaluate(() => wordingsSetFilter('painter'));
  check('searching a trade name finds its items', (await body()).includes('Apply gloss'));
  await page.evaluate(() => wordingsSetFilter('zzzz'));
  check('no match says so instead of showing a blank screen', /No wordings match/.test(await body()));
  await page.evaluate(() => wordingsSetFilter(''));
  check('clearing the search restores every trade', (await body()).includes('Landscaper'));
}

// ===========================================================================
//  F. Add / edit / remove — the whole point.
// ===========================================================================
console.log('\n--- F · a manager edits the list ---');
{
  await openTrade('Carpenter');
  check('a manager gets ✎ and ✕ on each item and + Add on the trade',
    /✎/.test(await body()) && /✕/.test(await body()) && /\+ Add/.test(await body()));

  // EDIT
  await page.evaluate(() => editWording('w2'));
  await page.waitForSelector('#wording-edit-input');
  check('editing opens the wording in a box, not a blank one',
    (await page.inputValue('#wording-edit-input')) === 'Align door with jamb.');
  await page.fill('#wording-edit-input', 'Align door within jamb, both leaves.');
  await page.evaluate(() => saveWordingEdit('w2', 'Carpenter'));
  await page.waitForFunction(() => !document.getElementById('wording-edit-input'));
  check('…and the trade stays open, so several edits in a row do not mean re-tapping',
    await page.evaluate(() => _wordOpenTrade === 'Carpenter'));
  const afterEdit = await body();
  check('saving updates the wording', afterEdit.includes('Align door within jamb, both leaves.') && !afterEdit.includes('Align door with jamb.'), afterEdit.replace(/\n/g, ' | '));
  check('…and it is sent to the shared list, not just this phone',
    await page.evaluate(() => window.__cloudCalls.some(c => c[0] === 'update' && c[1] === 'w2')));

  // CANCEL
  await page.evaluate(() => editWording('w1'));
  await page.fill('#wording-edit-input', 'nonsense');
  await page.evaluate(() => cancelWordingEdit());
  check('cancelling changes nothing', (await body()).includes('Adjust door margins to 3mm-4mm.') && !(await body()).includes('nonsense'));

  // ADD
  await page.evaluate(() => startAddWording('Carpenter'));
  await page.waitForSelector('#wording-edit-input');
  check('adding starts from an empty box', (await page.inputValue('#wording-edit-input')) === '');
  await page.evaluate(() => saveWordingEdit('', 'Carpenter'));
  check('an empty wording is refused rather than saved blank',
    await page.evaluate(() => !window.__cloudCalls.some(c => c[0] === 'add' && !String(c[1]).trim())));
  await page.fill('#wording-edit-input', 'Refit loose door stop.');
  await page.evaluate(() => saveWordingEdit('', 'Carpenter'));
  await openTrade('Carpenter');
  const afterAdd = await body();
  check('the new wording lands under the trade it was added to',
    afterAdd.includes('Refit loose door stop.') && /Carpenter\s*4/.test(afterAdd), afterAdd.replace(/\n/g, ' | '));

  // The added wording has to reach the suggestions — that is what the list is for.
  const suggested = await page.evaluate(() => bpiDefectSuggestions('Carpenter', 'refit', 10).map(x => x.text));
  check('…and immediately shows up as a suggestion while typing a defect',
    suggested.includes('Refit loose door stop.'), JSON.stringify(suggested));

  // REMOVE
  await page.evaluate(() => deleteWording('w1'));
  await openTrade('Carpenter');
  const afterDel = await body();
  check('removing takes the wording out', !afterDel.includes('Adjust door margins to 3mm-4mm.') && /Carpenter\s*3/.test(afterDel), afterDel.replace(/\n/g, ' | '));
  check('…through the shared list', await page.evaluate(() => window.__cloudCalls.some(c => c[0] === 'remove' && c[1] === 'w1')));
}

// ===========================================================================
//  G. An apostrophe in a wording must not break the buttons.
// ===========================================================================
console.log("--- G · wordings with an apostrophe (the ' in \"it's\") ---");
{
  await openTrade('Carpenter');
  const t = await body();
  check('a wording containing an apostrophe renders intact',
    t.includes("Knock down hinge pins — it's binding."), t.replace(/\n/g, ' | '));
  await page.evaluate(() => { const el = [...document.querySelectorAll('#wordings-body span')].find(s => s.textContent.trim() === '✎' && s.parentElement.textContent.includes('hinge pins')); el.click(); });
  await page.waitForSelector('#wording-edit-input');
  check('…and its ✎ still opens the right item, not a JS syntax error',
    (await page.inputValue('#wording-edit-input')).includes("it's binding"));
  await page.evaluate(() => cancelWordingEdit());
  check('…no page errors from the escaping', errs.filter(e => /SyntaxError|Unexpected/.test(e)).length === 0, JSON.stringify(errs.slice(0, 2)));
}

// ===========================================================================
//  H. A supervisor never gets here at all.
// ===========================================================================
console.log('\n--- H · manager only ---');
{
  await installFakeCloud('supervisor', FIXTURE);
  await page.evaluate(() => { state.currentView = 'manage'; render(); });
  const settings = await screen();
  check('a supervisor does not see the Defect wordings card in Settings',
    !/Defect wordings/.test(settings), settings.replace(/\n/g, ' | ').slice(0, 200));
  check('…and the rest of Settings is untouched', /Themes/.test(settings) || /login/i.test(settings));

  // The card is the only door, but showWordingsEditor() is a function on a page
  // a supervisor has loaded. The screen has to hold on its own.
  await page.evaluate(() => showWordingsEditor());
  const s2 = await screen();
  check('…and opening the screen directly says Managers only', /Managers only/.test(s2), s2.replace(/\n/g, ' | ').slice(0, 160));
  check('…without listing a single wording', !/Align door with jamb/.test(s2) && !/\+ Add/.test(s2));
  check('…and tells them the suggestions still work', /suggestions/i.test(s2), s2.replace(/\n/g, ' | ').slice(0, 200));
  check('…with editing off', await page.evaluate(() => wordingsCanEdit() === false));

  const blocked = await page.evaluate(async () => {
    const before = window.CloudWordings.list().length;
    await saveWordingEdit('w2', 'Carpenter');   // nothing on screen to read → refused
    return window.CloudWordings.list().length === before;
  });
  check('…and a stray save call changes nothing', blocked);
  check('Back still works from the locked screen',
    await page.evaluate(() => { document.querySelector('.back-link').click(); return state.currentView === 'manage'; }));
}

// ===========================================================================
//  I. Back.
// ===========================================================================
console.log('\n--- I · getting out ---');
{
  await installFakeCloud('manager', FIXTURE);
  await page.evaluate(() => showWordingsEditor());
  await page.click('.back-link');
  check('Back returns to Settings', await page.evaluate(() => state.currentView === 'manage'));
  check('…and Settings still renders', /Settings/.test(await screen()));
}

// ===========================================================================
//  J. The shipped fallback still matches what Spiro approved.
// ===========================================================================
console.log('\n--- J · the built-in list behind the shared one ---');
{
  const r = await page.evaluate(() => {
    window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
    delete window.CloudWordings;
    const all = defectWordingList();
    return {
      n: all.length,
      trades: [...new Set(all.map(w => w.trade))].sort(),
      untraded: all.filter(w => !w.trade).length,
      summary: wordingsSummary(),
    };
  });
  console.log('  ', r.summary, JSON.stringify(r.trades));
  check('with no shared list the built-in 62 are used', r.n === 62, String(r.n));
  check('…every one has a trade ("not assigned under a trade to be go as Supervisor")', r.untraded === 0, String(r.untraded));
  check('…and Supervisor is one of them', r.trades.includes('Supervisor'), JSON.stringify(r.trades));
  check('the Settings card counts the same list', /62 items across 12 trades\./.test(r.summary), r.summary);
}

// ===== only the flagged admin may edit ====================================
// Spiro 2026-09-02: "I need to be able to start adding new wordings… only admin
// email can do this." A manager can still SEE the list; writing needs the flag.
console.log('\n--- only the wordings admin can edit ---');
{
  await installFakeCloud('manager', FIXTURE, false);
  await page.evaluate(() => { state.currentView = 'wordings'; render(); });
  await page.waitForTimeout(200);
  const ro = await page.evaluate(() => ({
    body: document.body.innerText,
    controls: /✎|✕|\+ Add/.test(document.body.innerText),
    newBtn: !!document.getElementById('wording-new'),
  }));
  check('a manager who is not the admin sees the list', /Carpenter/.test(ro.body));
  check('…told plainly why it is read-only', /not the wordings admin/i.test(ro.body),
    ro.body.split('\n').slice(0, 4).join(' | '));
  check('…and pointed at the grant that fixes it', /defect_wordings_admin\.sql/.test(ro.body));
  check('…with no edit controls at all', !ro.controls && !ro.newBtn, JSON.stringify(ro.controls));

  // The admin gets them.
  await installFakeCloud('manager', FIXTURE, true);
  await page.evaluate(() => { state.currentView = 'wordings'; render(); });
  await page.waitForTimeout(200);
  const rw = await page.evaluate(() => ({
    newBtn: !!document.getElementById('wording-new'),
    banner: /Read-only/.test(document.body.innerText),
  }));
  check('the admin gets a ＋ New wording button', rw.newBtn);
  check('…and no read-only banner', !rw.banner);

  // A trade with NO wordings yet has no group, so it had no way in.
  await page.evaluate(() => startNewWordingTrade());
  await page.waitForSelector('#wn-trade', { timeout: 4000 });
  await page.evaluate(() => { document.getElementById('wn-trade').value = 'Renderer'; document.getElementById('wn-go').click(); });
  await page.waitForTimeout(250);
  const fresh = await page.evaluate(() => ({
    input: !!document.getElementById('wording-edit-input'),
    hasGroup: /Renderer/.test(document.getElementById('wordings-body').innerText),
  }));
  check('a brand-new trade gets a group to add into', fresh.hasGroup && fresh.input, JSON.stringify(fresh));

  await page.evaluate(() => {
    document.getElementById('wording-edit-input').value = 'Patch and re-render damaged section.';
    saveWordingEdit('', 'Renderer');
  });
  await page.waitForTimeout(300);
  const added = await page.evaluate(() => ({
    calls: window.__cloudCalls.filter(c => c[0] === 'add'),
    listed: window.CloudWordings.list().some(w => w.trade === 'Renderer'),
  }));
  console.log('add call:', JSON.stringify(added.calls));
  check('…and the wording saves against that trade',
    added.listed && added.calls.some(c => c[2] === 'Renderer'), JSON.stringify(added));

  // The trade must match a contractor name exactly, so the picker offers the
  // ones that exist rather than leaving it to memory.
  await page.evaluate(() => startNewWordingTrade());
  // Wait on the visible INPUT: a <datalist> is never visible, so waiting for it
  // times out even though it is right there in the DOM.
  await page.waitForSelector('#wn-trade', { timeout: 4000 });
  const opts = await page.evaluate(() => [...document.querySelectorAll('#wn-trades option')].map(o => o.value));
  check('the trade field suggests trades that actually exist', opts.includes('Carpenter'), JSON.stringify(opts.slice(0, 6)));
  await page.evaluate(() => impClose());
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
