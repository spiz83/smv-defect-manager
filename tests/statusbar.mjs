// The sync status bar has to be readable in every theme (Spiro 2026-11-17:
// "can't see text in white background, fix").
//
// cloud-sync paints that bar dark navy and sets near-white text to match. The
// F1 theme repaints it in the palette's own --sur and, until now, left the
// text alone — which was fine while every F1 palette was dark and wrong the
// day one was not. The DEFAULT palette is 'framework' (Blueprint, Light),
// whose --sur is #FFFFFF: near-white text on white, on a fresh install, for
// every supervisor.
//
// So this does not check one theme. It walks every palette the app offers and
// measures the real contrast ratio of what is on screen.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8140;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

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
await page.addInitScript(() => {
  localStorage.setItem('defectTrackerDB', JSON.stringify({ addresses: [], contractors: [], trades: [], defects: [] }));
  localStorage.setItem('dm_preview', '0');
  const UID = '11111111-1111-1111-1111-111111111111';
  const chain = () => { const pr = Promise.resolve({ data: [], error: null });
    ['select','eq','is','in','not','order','limit','gte','lte','filter'].forEach(k => { pr[k] = () => pr; });
    pr.maybeSingle = () => Promise.resolve({ data: null, error: null });
    pr.single = () => Promise.resolve({ data: null, error: null }); return pr; };
  const table = () => ({ select: chain, insert: () => chain(), update: () => chain(), upsert: () => chain(), delete: () => chain() });
  const chan = { on() { return chan; }, subscribe(cb) { if (cb) cb('SUBSCRIBED'); return chan; }, unsubscribe() {} };
  window.supabase = { createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: UID, email: 'demo@example.com' } } }),
            getSession: async () => ({ data: { session: { user: { id: UID, email: 'demo@example.com' } } } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
    from: table, channel: () => chan, removeChannel() {},
    storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}), upload: async () => ({ data: {}, error: null }),
      createSignedUrls: async () => ({ data: [] }), createSignedUrl: async () => ({ data: null }) }) },
    functions: { invoke: async () => ({ data: null, error: null }) } }) };
});
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');
await page.waitForFunction(() => !!document.getElementById('cs-statusbar'), { timeout: 15000 });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// WCAG relative luminance → contrast ratio. Measured from what is actually
// computed on the element, not from the palette's declared values, so a rule
// that overrides one but not the other is caught.
const contrastProbe = `(() => {
  const lum = (c) => {
    const [r, g, b] = c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number).map(v => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bar = document.getElementById('cs-statusbar');
  const bg = getComputedStyle(bar).backgroundColor;
  const parts = {};
  const el = (sel) => bar.querySelector(sel);
  const add = (name, node) => {
    if (!node) return;
    const cs = getComputedStyle(node);
    // Opacity thins the ink against the background — fold it in rather than
    // measuring a colour nobody actually sees.
    const op = parseFloat(cs.opacity || '1');
    const fg = cs.color.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);
    const bgv = bg.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);
    const mixed = fg.map((v, i) => v * op + bgv[i] * (1 - op));
    parts[name] = Math.round(ratio('rgb(' + mixed.join(',') + ')', bg) * 100) / 100;
  };
  add('status', el('#cs-status'));
  add('email', el('.cs-who'));
  add('signout', el('#cs-signout'));
  return { bg, parts };
})()`;

// Every F1 palette, plus the two non-F1 themes.
const palettes = await page.evaluate(() => F1_THEMES.map(t => ({ id: t.id, name: t.name })));
console.log(`\n--- ${palettes.length} F1 palettes + default + modern ---`);
console.log('theme'.padEnd(13), 'background'.padEnd(26), 'status  email  signout');

const worst = { ratio: 99, where: '' };
for (const t of palettes) {
  const r = await page.evaluate(async ([id, probe]) => {
    document.body.classList.add('design-f1');
    document.body.classList.remove('design-modern');
    applyF1Theme(id); render();
    await new Promise(z => setTimeout(z, 30));
    return eval(probe);
  }, [t.id, contrastProbe]);
  const p = r.parts;
  console.log(t.id.padEnd(13), String(r.bg).padEnd(26),
    String(p.status).padEnd(7), String(p.email).padEnd(6), String(p.signout));
  for (const [k, v] of Object.entries(p)) if (v < worst.ratio) { worst.ratio = v; worst.where = `${t.id}/${k}`; }
  // 4.5:1 is the WCAG AA threshold for body text. This bar is 12px, so it is
  // the right bar to hold it to, not the 3:1 large-text one.
  check(`[${t.id}] every part of the bar is legible on its own background`,
    Object.values(p).every(v => v >= 4.5), JSON.stringify(p));
}

for (const theme of ['default', 'modern']) {
  const r = await page.evaluate(async ([t, probe]) => {
    document.body.classList.toggle('design-modern', t === 'modern');
    document.body.classList.remove('design-f1');
    render(); await new Promise(z => setTimeout(z, 30));
    return eval(probe);
  }, [theme, contrastProbe]);
  console.log(theme.padEnd(13), String(r.bg).padEnd(26),
    String(r.parts.status).padEnd(7), String(r.parts.email).padEnd(6), String(r.parts.signout));
  for (const [k, v] of Object.entries(r.parts)) if (v < worst.ratio) { worst.ratio = v; worst.where = `${theme}/${k}`; }
  check(`[${theme}] every part of the bar is legible on its own background`,
    Object.values(r.parts).every(v => v >= 4.5), JSON.stringify(r.parts));
}

console.log(`\nworst anywhere: ${worst.ratio}:1 at ${worst.where}`);
check('the worst case in any theme still clears WCAG AA for body text',
  worst.ratio >= 4.5, `${worst.ratio}:1 at ${worst.where}`);
check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
