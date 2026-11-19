// The splash (Spiro 2026-11-18): "insert the following splash screen, keep the
// Creation Homes logo however remove the line about being in partnership, so
// the idea is that it loads, the load bar kinda takes a few seconds with
// respect to the loading of the photos in the background, and then goes into
// the defect screen."
//
// Most of this suite is about the one way a splash can be worse than no
// splash: becoming the thing between someone and their job list. It is a
// full-screen element over the whole app, so every exit is tested — the happy
// one, the sign-in one, the init-threw one, the no-cloud-layer one, and the
// hard timeout under all of them.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8149;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [{ id: 1, lot: '1635', street: 'Lot 1635, Myrtleford Street', streetName: 'Myrtleford Street', lotNo: 1635, suburb: 'Wollert', propertyNumber: '306784', active: true }],
  contractors: [], trades: [],
  defects: [{ id: 1, addressId: 1, description: 'x', location: 'Roof', status: 'open', createdAt: '2026-11-01T00:00:00.000Z' }],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// `mode` decides which boot the page gets, so each exit can be driven.
const open = async (mode) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await ctx.route('**', route => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`)) {
      if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
      // "no cloud layer" is a build where cloud-sync simply is not there.
      if (mode === 'nocloud' && u.includes('cloud-sync.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
      return route.continue();
    }
    return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
  });
  await page.addInitScript(([seed, mode]) => {
    localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
    localStorage.setItem('dm_preview', '0');
    // Watch the label from the first frame. Polling misses the middle of a
    // fast boot entirely — against the stub it was already on the last step
    // by the time the first sample landed, which says nothing about whether
    // the earlier ones ever appeared.
    // Record the STEPS, not the element's text. The boot's milestones land
    // within one microtask flush, so the DOM has already settled on the last
    // of them by the time any observer or poll runs — watching the element
    // made a bar that moves through four states look like one that moves
    // through two. Intercepting the call catches every one.
    window.__labels = ['Starting up…'];          // the markup's own first word
    let _splash;
    Object.defineProperty(window, 'AppSplash', {
      configurable: true,
      get: () => _splash,
      set: (v) => {
        _splash = v;
        if (v && typeof v.step === 'function') {
          const orig = v.step.bind(v);
          v.step = (t, p) => { if (t) window.__labels.push(t); return orig(t, p); };
        }
      },
    });
    if (mode === 'nocloud') return;
    const UID = '11111111-1111-1111-1111-111111111111';
    const chain = () => { const o = { data: [], error: null }; const self = () => p; const p = Promise.resolve(o);
      ['select','eq','is','in','not','order','limit','range','gte','lte','filter'].forEach(k => { p[k] = self; });
      p.maybeSingle = () => Promise.resolve({ data: null, error: null });
      p.single = () => Promise.resolve({ data: null, error: null }); return p; };
    const table = () => ({ select: chain, insert: () => chain(), update: () => chain(), upsert: () => chain(), delete: () => chain() });
    const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
    const session = mode === 'signedout' ? null : { user: { id: UID, email: 'a@b.c' } };
    window.supabase = { createClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: session ? session.user : null } }),
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({}),
        signInWithPassword: async () => ({ data: {}, error: { message: 'no' } }),
      },
      from: table, channel: () => chan, removeChannel() {},
      storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}),
        upload: async () => ({ data: {}, error: null }),
        createSignedUrls: async () => ({ data: [] }), createSignedUrl: async () => ({ data: null }) }) },
      functions: { invoke: async () => ({ data: null, error: null }) },
    }) };
  }, [SEED, mode]);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'commit' });
  return { ctx, page, errs };
};

// ================= 1. it is there before anything else ====================
console.log('\n--- what shows on the first frame ---');
{
  const { ctx, page } = await open('signedin');
  // Read it the instant the document exists, before any boot has finished.
  await page.waitForSelector('#splash', { timeout: 5000 });
  const first = await page.evaluate(() => {
    const el = document.getElementById('splash');
    const cs = getComputedStyle(el);
    const badge = document.querySelector('.sp-badge');
    const foot = document.querySelector('.sp-foot img');
    return {
      covers: Math.round(el.getBoundingClientRect().width) >= innerWidth - 1
           && Math.round(el.getBoundingClientRect().height) >= innerHeight - 1,
      onTop: Number(cs.zIndex) > 1000,
      badge: badge ? getComputedStyle(badge).backgroundColor : null,
      badgeInk: badge ? getComputedStyle(badge).color : null,
      words: [...document.querySelectorAll('.sp-word span')].map(s => s.textContent),
      logo: foot ? foot.getAttribute('src') : null,
      text: el.innerText.replace(/\s+/g, ' ').trim(),
      status: (document.getElementById('splash-status') || {}).textContent,
    };
  });
  console.log(JSON.stringify(first));
  check('the splash is in the markup, so it paints on the first frame', first.covers && first.onTop,
    JSON.stringify({ covers: first.covers, onTop: first.onTop }));
  check('it carries the EZ badge in the brand sky and navy',
    first.badge === 'rgb(144, 191, 233)' && first.badgeInk === 'rgb(26, 47, 98)',
    `${first.badge} / ${first.badgeInk}`);
  check('…with Defect and Manager stacked',
    JSON.stringify(first.words) === JSON.stringify(['Defect', 'Manager']), JSON.stringify(first.words));
  check('…the Creation Homes logo', /creation-homes-logo\.png/.test(first.logo || ''), first.logo);
  // The one explicit removal in the brief.
  check('…and NOT the "in partnership with" line',
    !/partnership/i.test(first.text), first.text.slice(0, 80));
  check('it says what it is doing', !!(first.status || '').trim(), JSON.stringify(first.status));
  await ctx.close();
}

// ================= 2. the bar tracks real work ============================
console.log('\n--- the bar, and then the app ---');
{
  const { ctx, page, errs } = await open('signedin');
  await page.waitForSelector('#splash', { timeout: 5000 });
  const widths = [];
  for (let i = 0; i < 24; i++) {
    const r = await page.evaluate(() => {
      const bar = document.getElementById('splash-bar');
      return { w: bar ? parseFloat(getComputedStyle(bar).width) : null,
               gone: !document.getElementById('splash') };
    });
    if (r.w != null) widths.push(Math.round(r.w));
    if (r.gone) break;
    await page.waitForTimeout(150);
  }
  const labels = await page.evaluate(() => window.__labels || []);
  console.log('labels:', JSON.stringify(labels));
  console.log('bar widths:', JSON.stringify(widths.filter((w, i, a) => i === 0 || w !== a[i - 1])));
  check('the bar advances rather than sitting still',
    widths.length > 1 && Math.max(...widths) > Math.min(...widths),
    `${Math.min(...widths)} → ${Math.max(...widths)}px`);
  check('…and the words change with it, naming real steps',
    labels.length >= 3 && labels.some(l => /jobs/i.test(l))
      && labels.some(l => /photos/i.test(l)), JSON.stringify(labels));
  check('…starting before anything has been reached',
    /starting/i.test(labels[0] || ''), JSON.stringify(labels[0]));
  // THE POINT: it gets out of the way.
  await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 12000 });
  check('it leaves, and the app is underneath',
    await page.evaluate(() => !document.getElementById('splash') && !!document.querySelector('#app .app-header')),
    '');
  check('…removed from the DOM, not left covering the app invisibly',
    await page.evaluate(() => !document.getElementById('splash')), '');
  check('no page errors', errs.length === 0, JSON.stringify(errs));
  await ctx.close();
}

// ================= 3. every other way out =================================
// A splash is a full-screen element over the whole app. Each of these is a
// way the boot can end WITHOUT reaching the happy path, and each one has to
// let go of the screen.
console.log('\n--- the exits ---');
for (const [mode, why] of [
  ['signedout', 'the sign-in card appears — a login behind a splash is a locked door'],
  ['nocloud',   'there is no cloud layer at all, so no milestone is ever coming'],
]) {
  const { ctx, page } = await open(mode);
  await page.waitForSelector('#splash', { timeout: 5000 });
  let gone = true;
  try {
    await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 8000 });
  } catch (e) { gone = false; }
  check(`[${mode}] it steps aside when ${why}`, gone, '');
  if (mode === 'signedout') {
    check('…and the sign-in card is reachable, not behind it',
      await page.evaluate(() => {
        const ov = document.getElementById('cs-overlay');
        if (!ov) return false;
        const r = ov.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && !!top.closest('#cs-overlay');
      }), '');
  }
  await ctx.close();
}

// The backstop, proved rather than assumed: break the boot outright and the
// splash must still go.
{
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
  // supabase present but every call hangs for ever: onAuthed never returns.
  await page.addInitScript((seed) => {
    localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
    localStorage.setItem('dm_preview', '0');
    const hang = () => new Promise(() => {});
    window.supabase = { createClient: () => ({
      auth: { getUser: hang, getSession: hang,
              onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: hang },
      from: () => ({ select: hang, insert: hang, update: hang, upsert: hang, delete: hang }),
      channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
      removeChannel() {}, storage: { from: () => ({ list: hang, upload: hang, remove: hang }) },
      functions: { invoke: hang },
    }) };
  }, SEED);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'commit' });
  await page.waitForSelector('#splash', { timeout: 5000 });
  let gone = true;
  try { await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 13000 }); }
  catch (e) { gone = false; }
  check('[boot hangs for ever] the hard timeout still lets go of the screen', gone,
    'this is the backstop for the failure modes nobody thought of');
  await ctx.close();
}

// ── the splash must hold ONE spot through the whole boot ────────────────
// The jitter (Spiro 2026-11-19) was env(safe-area-inset-bottom) inside
// #splash's padding: 0 on the first frame, ~34px a beat later, which moved the
// flex-centred mark up ~17px mid-boot. The centring box must not depend on a
// value that only resolves after paint — the home indicator is cleared by
// .sp-foot's own inset-aware bottom, not by this padding. Headless Chromium
// can't set the inset, so this guards the source: the centring padding stays
// inset-free.
{
  const css = fs.readFileSync(join(REPO, 'index.html'), 'utf8');
  const m = css.match(/#splash\s*\{[^}]*\}/);
  const padLine = ((m ? m[0] : '').match(/padding:[^;]*;/) || [''])[0];
  check('the splash centring padding does not depend on a safe-area inset',
    !!m && !/env\(\s*safe-area-inset/.test(padLine), padLine.trim());
}

console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
