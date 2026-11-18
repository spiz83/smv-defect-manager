// The EZ menu (Spiro 2026-11-17): "when clicking EZ top left it does drop
// down menu showing: Shopping list / Reports / Add temp job / Settings //
// Logged in as: / Change password / Sign out. Then you can remove the stuff
// up top and at the bottom to remove the clutter."
//
// The point of the change is subtraction, so that is what this suite is
// mostly about: everything the menu now carries has to be GONE from the home
// screen, and nothing may have been lost on the way there. A menu that adds
// a route without removing the old one is just more clutter.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8146;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [{ id: 1, lot: '1635', street: 'Lot 1635, Myrtleford Street', streetName: 'Myrtleford Street', lotNo: 1635, suburb: 'Wollert', propertyNumber: '306784', active: true, supervisorName: 'Ian Schroeder' }],
  contractors: [{ id: 1, name: 'Envy Electrical Pty Ltd', isActive: true, trades: 'Electrician' }],
  trades: [],
  defects: [{ id: 1, addressId: 1, contractorId: 1, description: 'Exhaust fan', location: 'Roof', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' }],
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
page.on('pageerror', e => errs.push(String(e).slice(0, 240)));
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
// The splash covers the whole screen for the first second of a boot, so
// every suite waits it out before touching or measuring anything. Added to
// all of them at once rather than to the three that happened to fail: the
// ones that passed were passing on timing, which is the same bug asleep
// (2026-11-18).
await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });
await page.evaluate(() => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  window.CloudAuth = { currentEmail: () => 'svladimiroski@privaterelay.appleid.com',
                       openChangePassword: () => { window.__calls.push('changePassword'); },
                       signOut: async () => { window.__calls.push('signOut'); } };
  // Add temp job is admin-only, here and on the home screen before it moved.
  window.CloudAdmin = { is: () => true, tempSyncReady: () => false };
  window.__calls = [];
  render();
});

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// ================= 1. the home screen is the job list =====================
console.log('\n--- what is left on the home screen ---');
const home = await page.evaluate(() => {
  const txt = (document.getElementById('app') || document.body).innerText;
  return {
    shoppingCard: !!document.querySelector('.shop-home'),
    reportsSection: !![...document.querySelectorAll('.section-title')].find(t => /^Reports$/i.test(t.textContent.trim())),
    manageRow: !!document.querySelector('.manage-row'),
    tempCard: /Add temp job/.test(txt),
    statusbarButtons: document.querySelectorAll('#cs-statusbar button').length,
    statusbarWho: !!document.querySelector('#cs-statusbar .cs-who'),
    jobsList: !!document.getElementById('myjobs-list'),
    search: !!document.getElementById('unified-search'),
  };
});
console.log(JSON.stringify(home, null, 1));
check('the Shopping List card is gone', !home.shoppingCard);
check('the Reports section is gone', !home.reportsSection);
check('the Settings / View All Defects footer is gone', !home.manageRow);
check('the Add temp job card is gone', !home.tempCard);
check('the status bar no longer carries Sign out or the key', home.statusbarButtons === 0,
  `${home.statusbarButtons} button(s)`);
check('…nor the email address', !home.statusbarWho);
// …and the two things the screen is actually for are untouched.
check('the job list is still there', home.jobsList);
check('…and the search', home.search);

// ================= 2. nothing was lost ====================================
console.log('\n--- everything it used to reach, one tap from the mark ---');
const menu = await page.evaluate(() => {
  document.getElementById('ez-menu-btn').click();
  const items = [...document.querySelectorAll('#ez-menu .ezm-item')];
  const panel = document.querySelector('#ez-menu .ezm-panel');
  const hero = document.querySelector('.app-header.home-hero');
  return {
    open: !!document.getElementById('ez-menu'),
    expanded: document.getElementById('ez-menu-btn').getAttribute('aria-expanded'),
    role: panel ? panel.getAttribute('role') : null,
    labels: items.map(i => i.textContent.replace(/\s+/g, ' ').trim()),
    calls: items.map(i => i.getAttribute('data-call')),
    smallest: Math.min(...items.map(i => Math.round(i.getBoundingClientRect().height))),
    // It is a DROP DOWN: it hangs off the bottom of the masthead.
    belowHero: panel && hero
      ? Math.round(panel.getBoundingClientRect().top) >= Math.round(hero.getBoundingClientRect().bottom) - 1 : false,
    who: (document.querySelector('#ez-menu .ezm-who') || {}).textContent,
    heads: [...document.querySelectorAll('#ez-menu .ezm-head')].map(h => h.textContent.trim()),
  };
});
console.log(JSON.stringify(menu, null, 1));
check('tapping the mark opens the menu', menu.open);
check('…and says so to a screen reader', menu.expanded === 'true' && menu.role === 'menu',
  `aria-expanded=${menu.expanded} role=${menu.role}`);
check('…dropping down from the masthead, not floating', menu.belowHero);
for (const [label, call] of [
  ['Shopping List', 'openShoppingList(null)'],
  ['View All Defects', 'viewAllDefects()'],
  ['Add temp job', 'createTempJob()'],
  ['Settings', 'showManageScreen()'],
  ['View Recent Reports', 'openRecentReports()'],
  ['Add Report', 'openReportImport()'],
  ['Generate PDF Report', 'openReportBuilder()'],
  ['Delete Report', 'openDeleteReports()'],
  ['Change password', 'window.CloudAuth.openChangePassword()'],
  ['Sign out', 'window.CloudAuth.signOut()'],
]) {
  const i = menu.labels.findIndex(l => l.includes(label));
  check(`"${label}" is in the menu, wired to ${call}`, i >= 0 && menu.calls[i] === call,
    i < 0 ? 'missing' : menu.calls[i]);
}
check('the account block names who is signed in',
  /svladimiroski@/.test(menu.who || '') && menu.heads.includes('Logged in as'),
  `${menu.who} / ${JSON.stringify(menu.heads)}`);
check('Reports are grouped under their own heading', menu.heads.includes('Reports'), JSON.stringify(menu.heads));
check('every row is a finger-sized target', menu.smallest >= 44, `${menu.smallest}px`);

// Add temp job was admin-only as a card; moving it into a menu must not have
// quietly handed it to everyone.
const nonAdmin = await page.evaluate(() => {
  closeMainMenu();
  const was = window.CloudAdmin;
  window.CloudAdmin = { is: () => false, tempSyncReady: () => false };
  openMainMenu();
  const labels = [...document.querySelectorAll('#ez-menu .ezm-item')]
    .map(i => i.textContent.replace(/\s+/g, ' ').trim());
  closeMainMenu();
  window.CloudAdmin = was;
  return labels;
});
check('…and Add temp job is still admin-only',
  !nonAdmin.some(l => /Add temp job/.test(l)) && nonAdmin.some(l => /Settings/.test(l)),
  JSON.stringify(nonAdmin));

// ================= 3. it behaves like a menu ==============================
console.log('\n--- opening, closing, acting ---');
const behave = await page.evaluate(async () => {
  const out = {};
  // An item runs its action and dismisses.
  if (!document.getElementById('ez-menu')) openMainMenu();
  [...document.querySelectorAll('#ez-menu .ezm-item')].find(i => /Sign out/.test(i.textContent)).click();
  out.closedOnPick = !document.getElementById('ez-menu');
  await new Promise(r => setTimeout(r, 30));
  out.ranAction = (window.__calls || []).includes('signOut');
  // Escape closes it.
  openMainMenu();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  out.closedOnEscape = !document.getElementById('ez-menu');
  // Tapping the scrim closes it; tapping the panel does not.
  openMainMenu();
  document.querySelector('#ez-menu .ezm-panel').click();
  out.panelKeepsItOpen = !!document.getElementById('ez-menu');
  document.getElementById('ez-menu').click();
  out.closedOnScrim = !document.getElementById('ez-menu');
  // A second tap on the mark closes it rather than stacking a second copy.
  document.getElementById('ez-menu-btn').click();
  document.getElementById('ez-menu-btn').click();
  out.togglesShut = !document.getElementById('ez-menu');
  out.onlyOne = document.querySelectorAll('#ez-menu').length;
  out.expandedAfter = document.getElementById('ez-menu-btn').getAttribute('aria-expanded');
  return out;
});
console.log(JSON.stringify(behave));
check('picking an item runs it', behave.ranAction);
check('…and closes the menu', behave.closedOnPick);
check('Escape closes it', behave.closedOnEscape);
check('tapping the panel does NOT close it', behave.panelKeepsItOpen);
check('tapping outside does', behave.closedOnScrim);
check('tapping the mark again closes it instead of stacking another', behave.togglesShut && behave.onlyOne === 0);
check('…and the button says it is shut again', behave.expandedAfter === 'false', behave.expandedAfter);

// ================= 4. it works on every theme =============================
// The panel reads from theme tokens, so a palette that does not set one would
// show grey-on-grey. Cheap to check, and there are fifteen of them.
console.log('\n--- on all fifteen palettes ---');
const lum = (rgb) => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const themed = await page.evaluate(() => {
  const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const out = {};
  for (const t of F1_THEMES) {
    try {
      applyF1Theme(t.id); render();
      document.getElementById('ez-menu')?.remove();
      openMainMenu();
      const panel = document.querySelector('#ez-menu .ezm-panel');
      const item = document.querySelector('#ez-menu .ezm-item');
      if (!panel || !item) { out[t.id] = { err: 'menu did not render' }; closeMainMenu(); continue; }
      const bgRaw = getComputedStyle(panel).backgroundColor;
      const nums = bgRaw.match(/[\d.]+/g) || [];
      out[t.id] = { bg: parse(bgRaw), fg: parse(getComputedStyle(item).color),
                    alpha: nums.length > 3 ? Number(nums[3]) : 1 };
      closeMainMenu();
    } catch (e) { out[t.id] = { err: String(e && e.message || e) }; }
  }
  applyF1Theme('framework'); render();
  return out;
});
for (const [id, v] of Object.entries(themed)) {
  if (v.err) { check(`[${id}] the menu renders`, false, v.err); continue; }
  const [x, y] = [lum(v.fg), lum(v.bg)].sort((a, b) => b - a);
  const r = Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
  check(`[${id}] menu text is readable on its own panel`, r >= 4.5, `${r}:1`);
  check(`[${id}] …on an opaque panel, not the page showing through`, v.alpha === 1, String(v.alpha));
}

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
