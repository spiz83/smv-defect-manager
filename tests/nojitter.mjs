// THE MASTHEAD HOLDS STILL (Spiro 2026-11-18).
//
//   "When I press down on the screen, the whole thing goes down this needs to
//    be fixed. The header needs to be fixed and it can't jitter and move
//    slightly when the page loads… when I click on it it kind of goes up all
//    the way and then kind of comes down… make sure it looks stable and
//    solid."
//
// Three separate movements were behind that, and this suite measures all
// three from real pixels rather than from the CSS that is supposed to produce
// them:
//
//   1. THE BOOT DROP. #cs-statusbar is added by cloud-sync only once identity
//      comes back — two round trips in — and the class that reserves its strip
//      comes with it. So the masthead painted hard against the top of the
//      screen and then dropped by the height of the bar. The stub below
//      answers auth deliberately LATE for that reason: an instant answer would
//      land inside the first frame and this suite would pass on a bug.
//   2. THE 4px SLIVER. The strip was 30px, the bar measured 25.8 and the
//      measurement was rounded to 26, so the masthead sat 4px below the bar at
//      rest and snapped up to meet it as soon as the list moved.
//   3. THE BOUNCE. iOS rubber-banding drags the document — masthead included —
//      away from the top of the screen.
//
// Every check here is a before/after position of the SAME element. A rule that
// is present but beaten by another rule still fails.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8176;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Two dozen jobs, so the home list is taller than the phone and there is
// something to scroll. A page that cannot scroll cannot prove a header stays
// put while it does.
const SEED = {
  addresses: Array.from({ length: 24 }, (_, i) => ({
    id: i + 1, lot: String(100 + i),
    street: `Lot ${100 + i}, ${'MKAEIGBLJCHFMKAEIGBLJCHF'[i]} Street`,
    streetName: `${'MKAEIGBLJCHFMKAEIGBLJCHF'[i]} Street`, lotNo: 100 + i,
    suburb: 'Clyde North', propertyNumber: String(300000 + i), active: true,
  })),
  contractors: [{ id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' }],
  trades: [],
  // Forty defects on the first job: the defect screen is the one that scrolls
  // the document itself, and it carries BOTH frozen layers — the masthead and
  // the job's own header under it.
  defects: Array.from({ length: 40 }, (_, i) => ({
    id: i + 1, addressId: 1, contractorId: 1, status: 'open', completed: false,
    description: `Defect ${i + 1} — make good and repaint the affected area`,
    location: 'Bed 1', createdAt: '2026-11-01T00:00:00.000Z',
  })),
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

// `authDelayMs` is how long the fake Supabase takes to say who you are: the
// window in which the real app has rendered its home screen but has no status
// bar yet. `session: false` is a phone whose session has gone — the sign-in
// path. `flag` seeds the "this phone had a bar last time" marker cloud-sync
// writes, which is what lets the strip be reserved before the first frame.
async function boot({ authDelayMs = 350, session = true, flag = '1', viewport = { width: 390, height: 844 } } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
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
  await page.addInitScript(([seed, delay, hasSession, barFlag]) => {
    localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
    localStorage.setItem('dm_preview', '0');
    if (barFlag) localStorage.setItem('cs_bar', barFlag);
    // Sample the masthead on EVERY frame from the very first one. The bug was
    // a position that changed between two frames nobody was looking at.
    window.__samples = [];
    const tick = () => {
      const h = document.querySelector('.app-header');
      if (h && document.body) window.__samples.push({
        top: Math.round(h.getBoundingClientRect().top * 100) / 100,
        pad: getComputedStyle(document.body).paddingTop,
        bar: !!document.getElementById('cs-statusbar'),
        y: window.scrollY,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const UID = '11111111-1111-1111-1111-111111111111';
    const user = { id: UID, email: 'demo@example.com' };
    const late = (v) => new Promise(r => setTimeout(() => r(v), delay));
    const chain = () => { const pr = Promise.resolve({ data: [], error: null });
      ['select','eq','is','in','not','order','limit','gte','lte','filter','range'].forEach(k => { pr[k] = () => pr; });
      pr.maybeSingle = () => Promise.resolve({ data: null, error: null });
      pr.single = () => Promise.resolve({ data: null, error: null }); return pr; };
    const table = () => ({ select: chain, insert: () => chain(), update: () => chain(), upsert: () => chain(), delete: () => chain() });
    const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
    window.supabase = { createClient: () => ({
      auth: { getUser: async () => late({ data: { user: hasSession ? user : null } }),
              getSession: async () => late({ data: { session: hasSession ? { user } : null } }),
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
              signInWithPassword: async () => ({ data: { user }, error: null }),
              signOut: async () => ({}) },
      from: table, channel: () => chan, removeChannel() {},
      storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}), upload: async () => ({ data: {}, error: null }),
        createSignedUrls: async () => ({ data: [] }), createSignedUrl: async () => ({ data: null }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) } }) };
  }, [SEED, authDelayMs, session, flag]);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.render === 'function');
  return { ctx, page, errs };
}

// ── 1. The boot: the masthead must not move while the app wakes up ────────
{
  const { ctx, page, errs } = await boot({ authDelayMs: 350 });
  await page.waitForFunction(() => !!document.getElementById('cs-statusbar'), { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });
  await page.waitForTimeout(400);

  const s = await page.evaluate(() => window.__samples);
  const before = s.filter(x => !x.bar), after = s.filter(x => x.bar);
  // The guard that stops this suite proving nothing: if the bar were there on
  // the first frame, "it never moved" would be a statement about one state.
  check('the boot really did run with no status bar for a while, then with one',
    before.length >= 2 && after.length >= 2, `${before.length} frames without, ${after.length} with`);

  const tops = [...new Set(s.map(x => x.top))];
  check('the masthead sits at the same y on every frame of the boot',
    tops.length === 1, 'tops seen: ' + JSON.stringify(tops));
  const pads = [...new Set(s.map(x => x.pad))];
  check('the strip reserved at the top of the page never changes either',
    pads.length === 1 && pads[0] === '26px', 'padding-top seen: ' + JSON.stringify(pads));
  check('…and it was already reserved before the status bar arrived',
    before.length > 0 && before.every(x => x.pad === '26px'), before[0] && before[0].pad);

  // The three numbers that have to be one number.
  const geo = await page.evaluate(() => {
    const bar = document.getElementById('cs-statusbar'), head = document.querySelector('.app-header');
    const b = bar.getBoundingClientRect(), h = head.getBoundingClientRect();
    return { barH: b.height, barBottom: b.bottom, headTop: h.top,
             pad: parseFloat(getComputedStyle(document.body).paddingTop),
             stickyTop: getComputedStyle(head).top, flag: localStorage.getItem('cs_bar') };
  });
  check('no sliver: the masthead starts exactly where the status bar ends',
    Math.abs(geo.headTop - geo.barBottom) < 0.5, `bar ends ${geo.barBottom}, header starts ${geo.headTop}`);
  check('the reserve, the bar and the freeze point are one number',
    Math.abs(geo.pad - geo.barH) < 0.5 && geo.stickyTop === geo.pad + 'px',
    `reserve ${geo.pad}, bar ${geo.barH}, sticky top ${geo.stickyTop}`);
  check('the bar writes the flag that keeps the NEXT boot still', geo.flag === '1', String(geo.flag));

  // ── 2a. The home screen scrolls as ONE page ────────────────────────────
  // It did not always. The job list used to scroll inside its own 360px box
  // on a home screen SHORTER than the phone, so a flick ran off the end of
  // the list and chained to a document with nothing to scroll, which bounced
  // (Spiro 2026-11-18). That inner scroller was removed the same day — the
  // page scrolls as one now — and this checks the arrangement that shipped:
  // no inner scroller, and a masthead that does not move while the one page
  // underneath it does.
  await page.evaluate(() => {
    window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
    render();
  });
  const home = await page.evaluate(async () => {
    const list = document.getElementById('myjobs-list');
    const head = () => document.querySelector('.app-header').getBoundingClientRect();
    const bar = () => document.getElementById('cs-statusbar').getBoundingClientRect();
    const rest = head().top;
    const out = [];
    for (const y of [1, 4, 40, 300]) {
      window.scrollTo(0, y);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push({ y: window.scrollY, top: head().top, gap: head().top - bar().bottom });
    }
    window.scrollTo(0, 0);
    return { rest, out, innerScroll: getComputedStyle(list).overflowY,
             maxH: getComputedStyle(list).maxHeight,
             // overflow:hidden stays on the box — it is what clips the rows to
             // the rounded corners. What matters is that nothing is HELD
             // inside it: no max-height, so the list is as tall as its jobs
             // and the page does the scrolling.
             innerTall: list.scrollHeight > list.clientHeight + 10,
             pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 100 };
  });
  check('the home page scrolls as one: nothing is held inside the job list',
    !home.innerTall && home.maxH === 'none',
    `#myjobs-list max-height ${home.maxH}, ${home.innerTall ? 'content is clipped' : 'full height'}`);
  check('the home page is long enough to scroll (otherwise nothing is proven)',
    home.pageScrolls && home.out.some(o => o.y > 100), JSON.stringify(home.out.map(o => o.y)));
  check('the masthead holds still while the home page scrolls under it',
    home.out.every(o => Math.abs(o.top - home.rest) < 0.5 && Math.abs(o.gap) < 0.5),
    `at rest ${home.rest}, scrolled ${JSON.stringify(home.out.map(o => o.top))}`);

  // ── 2b. A job's defect list: the document scrolls, two frozen layers ────
  await page.evaluate(() => { viewDefectsForAddress(1); });
  await page.waitForTimeout(150);
  const scrolled = await page.evaluate(async () => {
    const head = () => document.querySelector('.defects-container > .app-header').getBoundingClientRect();
    const sub = () => document.querySelector('.defects-header').getBoundingClientRect();
    const bar = () => document.getElementById('cs-statusbar').getBoundingClientRect();
    const rest = head().top;
    const out = [];
    for (const y of [1, 4, 40, 400]) {
      window.scrollTo(0, y);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push({ y: window.scrollY, top: head().top, gap: head().top - bar().bottom,
                 stack: sub().top - head().bottom });
    }
    return { rest, out, scrollable: document.documentElement.scrollHeight > window.innerHeight + 200 };
  });
  check('the defect list is long enough to scroll the page (otherwise nothing is proven)',
    scrolled.scrollable && scrolled.out.some(o => o.y > 100), JSON.stringify(scrolled.out.map(o => o.y)));
  check('the masthead does not hop when the list starts moving',
    scrolled.out.every(o => Math.abs(o.top - scrolled.rest) < 0.5),
    `at rest ${scrolled.rest}, scrolled ${JSON.stringify(scrolled.out.map(o => o.top))}`);
  check('and it stays flush against the status bar the whole way',
    scrolled.out.every(o => Math.abs(o.gap) < 0.5), JSON.stringify(scrolled.out.map(o => o.gap)));
  check('the job header freezes exactly under the masthead, with no sliver between them',
    scrolled.out.every(o => Math.abs(o.stack) < 0.5), JSON.stringify(scrolled.out.map(o => Math.round(o.stack * 100) / 100)));
  await page.evaluate(() => { showHomeView(); });
  await page.waitForTimeout(120);

  // ── 3. The bounce ───────────────────────────────────────────────────────
  const bounce = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overscrollBehaviorY,
    body: getComputedStyle(document.body).overscrollBehaviorY,
  }));
  check('the document does not rubber-band', bounce.html === 'none' && bounce.body === 'none', JSON.stringify(bounce));

  // ── 5. Every palette, same geometry ─────────────────────────────────────
  const perTheme = await page.evaluate(async () => {
    const out = [];
    for (const t of F1_THEMES) {
      applyF1Theme(t.id); render();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const b = document.getElementById('cs-statusbar').getBoundingClientRect();
      const h = document.querySelector('.app-header').getBoundingClientRect();
      out.push({ id: t.id, barH: Math.round(b.height * 100) / 100, gap: Math.round((h.top - b.bottom) * 100) / 100 });
    }
    return out;
  });
  const badTheme = perTheme.filter(t => Math.abs(t.barH - 26) > 0.5 || Math.abs(t.gap) > 0.5);
  check(`all ${perTheme.length} palettes keep the bar 26px and the masthead flush under it`,
    badTheme.length === 0, badTheme.length ? JSON.stringify(badTheme) : '');

  // ── 5b. The notch. env(safe-area-inset-top) is 0 in a desktop browser, so
  // the arrangement that actually ships — 26px plus a 59px Dynamic Island —
  // is never exercised by any of the above. Overriding the one variable is a
  // fair stand-in precisely BECAUSE it is one variable: if the bar's height,
  // the page's reserve and the freeze point did not all come from it, this is
  // where they would come apart.
  const notch = await page.evaluate(async () => {
    document.body.style.setProperty('--cs-bar-h', '85px');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = document.getElementById('cs-statusbar').getBoundingClientRect();
    const h = document.querySelector('.app-header').getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(document.body).paddingTop);
    document.body.style.removeProperty('--cs-bar-h');
    return { barH: b.height, headTop: h.top, pad, gap: h.top - b.bottom };
  });
  check('with a notch-sized strip the bar, the reserve and the masthead still agree',
    Math.abs(notch.barH - 85) < 0.5 && Math.abs(notch.pad - 85) < 0.5 && Math.abs(notch.gap) < 0.5,
    JSON.stringify(notch));

  check('no page errors during the boot', errs.length === 0, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

// ── 4. Opening the menu must not move the page under it ───────────────────
// On a SHORT phone the home screen is taller than the glass, so the document
// itself scrolls there and the mark can be tapped part-way down a page. That
// is the only arrangement in which this proves anything: on a tall phone the
// home screen does not scroll, scrollY is 0 before and after, and the check
// passes without the bug ever having had the chance to happen.
{
  const { ctx, page } = await boot({ authDelayMs: 100, viewport: { width: 390, height: 600 } });
  await page.waitForFunction(() => !!document.getElementById('cs-statusbar'), { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });
  await page.evaluate(() => {
    window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
    render();
  });
  const menu = await page.evaluate(async () => {
    window.scrollTo(0, 150);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const before = window.scrollY;
    const headBefore = document.querySelector('.app-header').getBoundingClientRect().top;
    document.getElementById('ez-menu-btn').click();
    await new Promise(r => setTimeout(r, 150));
    return { before, after: window.scrollY, opened: !!document.getElementById('ez-menu'),
             focused: document.activeElement && document.activeElement.className,
             headBefore, headAfter: document.querySelector('.app-header').getBoundingClientRect().top };
  });
  check('the page can be scrolled before the mark is tapped (otherwise nothing is proven)',
    menu.before > 100, 'scrollY ' + menu.before);
  check('the EZ menu opens, with its first item focused', menu.opened && /ezm-item/.test(menu.focused || ''), String(menu.focused));
  // Honest about what this one proves: focusing that item is called with
  // preventScroll, but Chromium does not scroll a focused element inside a
  // fixed overlay into view in the first place, so this check cannot fail on
  // that alone. It stands as the guard for anything ELSE that would move the
  // page out from under the menu.
  check('tapping the mark does not jump the page to the top',
    menu.after === menu.before, `scrollY ${menu.before} → ${menu.after}`);
  check('…and the masthead itself does not move when the menu opens',
    Math.abs(menu.headAfter - menu.headBefore) < 0.5, `${menu.headBefore} → ${menu.headAfter}`);
  await ctx.close();
}

// ── 6. Signed out: nothing holds a strip open for a bar that isn't coming ──
{
  const { ctx, page } = await boot({ authDelayMs: 150, session: false, flag: '1' });
  await page.waitForFunction(() => !!document.getElementById('cs-overlay'), { timeout: 15000 });
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => ({
    authed: document.body.classList.contains('cs-authed'),
    flag: localStorage.getItem('cs_bar'),
    pad: getComputedStyle(document.body).paddingTop,
    bar: !!document.getElementById('cs-statusbar'),
  }));
  check('the sign-in screen clears the reserve and the flag',
    !r.authed && r.flag === null && r.pad === '0px' && !r.bar, JSON.stringify(r));
  await ctx.close();
}

await browser.close();
server.close();
console.log(fail.length ? 'FAILED: ' + fail.join('; ') : 'ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
