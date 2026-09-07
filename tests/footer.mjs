// The refresh button must sit BELOW the content, never on top of it.
//
// Spiro 2026-09-04, with a screenshot of it covering a PLASTERER defect row:
// "the refresh button is sometimes in the way of buttons that I need to access…
// have this button below everything so if there's a defect on there it goes
// below the defect so it's always accessible."
//
// It was position:fixed bottom-left, so it overlapped whatever happened to be
// underneath — a defect row, the ⋯ menu on that row, and the sync banner.
//
// Every check here is GEOMETRY, not markup: elementFromPoint and box maths.
// "The button exists and the CSS looks right" is exactly the kind of assertion
// that passed while this bug was on Spiro's phone.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__here, '..'), PORT = 8210;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));
server.unref();

// A job with enough defects to fill several screens — the shape Spiro was on.
const DEFECTS = [];
const TRADES = ['Renderer', 'Caulker', 'Electrician', 'Plasterer', 'Plumber', 'Tiler'];
TRADES.forEach((t, ti) => {
  for (let i = 0; i < 5; i++) {
    DEFECTS.push({ id: ti * 10 + i + 1, addressId: 1, contractorId: ti + 1,
      description: `${t} item ${i + 1} — something that needs doing on site`,
      location: i % 2 ? 'rear elev' : 'frt elev', status: 'open', completed: false });
  }
});
const SEED = {
  addresses: [{ id: 1, lot: '4545', street: 'Lot 4545, 7 Hermes St', suburb: 'Wollert', propertyNumber: '306648', supervisorId: 'me', active: true }],
  contractors: TRADES.map((t, i) => ({ id: i + 1, name: t.toUpperCase(), trades: t, tradeIds: [i + 1] })),
  trades: TRADES.map((t, i) => ({ id: i + 1, name: t })),
  defects: DEFECTS,
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

// ================= A. it is laid out, not floated ==========================
console.log('\n--- A · it is part of the page ---');
{
  const geo = await page.evaluate(() => {
    const b = document.getElementById('app-refresh');
    if (!b) return null;
    const foot = document.getElementById('app-foot');
    return { pos: getComputedStyle(b).position,
      footPos: foot ? getComputedStyle(foot).position : 'NO FOOTER',
      insideApp: document.getElementById('app').contains(b) };
  });
  console.log('geometry:', JSON.stringify(geo));
  check('the button is there', !!geo);
  check('…laid out in the page, not floating over it', geo && geo.pos === 'static' && geo.footPos === 'static', JSON.stringify(geo));
  check('…inside the app content, so it moves with the page', geo && geo.insideApp);
}

// ================= B. below the last defect ================================
console.log('\n--- B · below the defects, on a long screen ---');
{
  await page.evaluate(() => { viewDefectsForJob(1); });
  await page.waitForTimeout(400);
  const below = await page.evaluate(() => {
    const b = document.getElementById('app-refresh').getBoundingClientRect();
    const doc = document.documentElement;
    const y = window.scrollY;
    // Every defect row on the screen, in page coordinates.
    const rows = [...document.querySelectorAll('.defect-item')]
      .map(e => e.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    const lowest = rows.length ? Math.max(...rows.map(r => r.bottom + y)) : 0;
    return { rows: rows.length, btnTop: b.top + y, lowestRow: lowest, scrollable: doc.scrollHeight > window.innerHeight };
  });
  console.log('long screen:', JSON.stringify(below));
  check('the screen really is longer than the phone, or this proves nothing', below.scrollable);
  check('…there are defect rows to get in the way of', below.rows > 10, String(below.rows));
  check('the button sits BELOW every one of them', below.btnTop >= below.lowestRow, JSON.stringify(below));
}

// ================= C. it covers nothing, anywhere ==========================
console.log('\n--- C · nothing is underneath it ---');
{
  // Scroll to the very bottom, where the button now lives, and ask the browser
  // what is actually at each corner of it. Anything but the button or its own
  // footer means it is sitting on top of something.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const hit = await page.evaluate(() => {
    const b = document.getElementById('app-refresh');
    const r = b.getBoundingClientRect();
    const pts = [[r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4], [r.left + r.width / 2, r.top + r.height / 2]];
    return pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el === b || b.contains(el) || el.id === 'app-foot' ? 'button' : (el.id || el.className || el.tagName)) : 'nothing';
    });
  });
  console.log('what is at the button:', JSON.stringify(hit));
  check('the button is what you tap when you tap the button', hit.every(h => h === 'button'), JSON.stringify(hit));

  // And the reverse: the place it used to float over must now be content.
  const oldSpot = await page.evaluate(() => {
    const el = document.elementFromPoint(33, window.innerHeight - 33);   // old fixed position
    const b = document.getElementById('app-refresh');
    return { isButton: !!(el && (el === b || b.contains(el))), tag: el ? (el.id || el.tagName) : 'nothing' };
  });
  check('…and it is no longer parked over the bottom-left corner of the screen', !oldSpot.isButton, JSON.stringify(oldSpot));
}

// ================= D. the sync banner does not bury it =====================
console.log('\n--- D · while a sync banner is up ---');
{
  // The banner is fixed to the bottom of the viewport and slides up over the
  // page — the exact thing in Spiro's screenshot, under the refresh button.
  await page.evaluate(() => {
    const b = document.createElement('div');
    b.id = 'cs-banner';
    b.textContent = '⬆️ Uploading 150 change(s) saved on this phone…';
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9997;padding:11px 16px;text-align:center;font:600 13.5px/1.4 sans-serif;color:#fff;background:#1d4ed8;';
    document.body.appendChild(b);
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForTimeout(300);
  const clear = await page.evaluate(() => {
    const b = document.getElementById('app-refresh').getBoundingClientRect();
    const ban = document.getElementById('cs-banner').getBoundingClientRect();
    const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const btn = document.getElementById('app-refresh');
    return { btnBottom: b.bottom, bannerTop: ban.top, tappable: !!(el && (el === btn || btn.contains(el))) };
  });
  console.log('with the banner up:', JSON.stringify(clear));
  check('scrolled to the bottom, the button clears the sync banner', clear.btnBottom <= clear.bannerTop, JSON.stringify(clear));
  check('…and is still the thing you tap', clear.tappable, JSON.stringify(clear));
}

// ================= E. reachable on every screen ============================
console.log('\n--- E · it survives a re-render ---');
{
  // render() rewrites #app wholesale, so a footer built once at boot would be
  // gone the first time anything redrew.
  const screens = await page.evaluate(async () => {
    const out = {};
    showHomeView(); await new Promise(r => setTimeout(r, 120));
    out.home = !!document.getElementById('app-refresh');
    viewDefectsForJob(1); await new Promise(r => setTimeout(r, 120));
    out.viewDefects = !!document.getElementById('app-refresh');
    startDefectsForJob(1); await new Promise(r => setTimeout(r, 120));
    out.addDefects = !!document.getElementById('app-refresh');
    showHomeView(); await new Promise(r => setTimeout(r, 120));
    render(); await new Promise(r => setTimeout(r, 120));
    out.afterBareRender = !!document.getElementById('app-refresh');
    out.justOne = document.querySelectorAll('#app-refresh').length;
    return out;
  });
  console.log('screens:', JSON.stringify(screens));
  check('it is on the home screen', screens.home);
  check('…on View Defects', screens.viewDefects);
  check('…on Add Defects', screens.addDefects);
  check('…and it survives a redraw, which wholesale-replaces the screen', screens.afterBareRender);
  check('…exactly once, not stacking up a copy per render', screens.justOne === 1, String(screens.justOne));

  const ver = await page.evaluate(() => (document.getElementById('app-ver') || {}).textContent || '');
  check('the build stamp came with it, so "which version am I on" is still readable', /^v\d{4}-\d{2}-\d{2}/.test(ver), ver);
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]/.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
