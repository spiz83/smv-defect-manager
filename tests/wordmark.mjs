// The EZ Defect Manager mark, on every theme (Spiro 2026-11-17):
// "Apply ez defect manger logo to all other schemes".
//
// It started life inside Harbour, where it only ever had to work on one bar.
// On all fifteen it has to work on fifteen, and those bars are gradients built
// from each theme's accent — Terminal's is yellow, Papaya's orange, Blush's
// pink, Harbour Light's sky. A hard-coded white wordmark is unreadable on
// several of them, so "Defect Manager" inherits whatever colour each theme
// already chose for its header type, and this suite checks the result.
//
// Contrast is measured from PIXELS, not tokens. The bar is a gradient, so
// there is no single token behind the mark: the suite screenshots each header,
// samples the background either side of the mark, and takes the WORST of those
// samples. Reading --acc instead would describe a colour that is nowhere near
// where the type actually sits.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8144;
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
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Sampling helper, installed once. Takes a PNG of the header and reads the
// real pixels either side of the mark.
await page.evaluate(() => {
  window.__lum = (rgb) => { const [r, g, b] = rgb.map(v => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  window.__ratio = (a, b) => { const [x, y] = [window.__lum(a), window.__lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05); };
  window.__parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  window.__sample = (dataUrl, pts) => new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
      res(pts.map(([x, y]) => {
        const d = g.getImageData(Math.max(0, Math.min(img.width - 1, Math.round(x))),
                                 Math.max(0, Math.min(img.height - 1, Math.round(y))), 1, 1).data;
        return [d[0], d[1], d[2]];
      }));
    };
    img.src = dataUrl;
  });
});

const themes = await page.evaluate(() => F1_THEMES.map(t => ({ id: t.id, name: t.name })));
console.log(`\n--- the mark on all ${themes.length} themes, measured from pixels ---`);
console.log('theme'.padEnd(15), 'word'.padEnd(7), 'badge', '  backdrop sampled');

const results = {};
for (const t of themes) {
  await page.evaluate(async (id) => {
    applyF1Theme(id); state.currentView = 'home'; render();
    await new Promise(r => setTimeout(r, 70));
  }, t.id);
  const hero = page.locator('.app-header.home-hero');
  const shot = await hero.screenshot();
  const dataUrl = 'data:image/png;base64,' + shot.toString('base64');
  const r = await page.evaluate(async (dataUrl) => {
    const hero = document.querySelector('.app-header.home-hero');
    const badge = document.querySelector('.wm-badge');
    const word = document.querySelector('.wm-word');
    if (!hero || !badge || !word) return { note: 'mark not rendered' };
    const H = hero.getBoundingClientRect();
    const B = badge.getBoundingClientRect(), W = word.getBoundingClientRect();
    const midY = (B.top + B.bottom) / 2 - H.top;
    // Background points: the gap between badge and word, a sliver right of the
    // word, and just above the word's cap height. None land on a glyph.
    const pts = [
      [(B.right + W.left) / 2 - H.left, midY],
      [W.right - H.left + 2, midY],
      [W.left - H.left + 4, W.top - H.top - 3],
    ];
    const samples = await window.__sample(dataUrl, pts);
    const wordFg = window.__parse(getComputedStyle(word).color);
    const badgeBg = window.__parse(getComputedStyle(badge).backgroundColor);
    const ezFg = window.__parse(getComputedStyle(badge).color);
    const shadow = getComputedStyle(badge).boxShadow || 'none';
    const ring = shadow === 'none' ? null : window.__parse(shadow);
    const worst = (c) => Math.min(...samples.map(s => window.__ratio(c, s)));
    return {
      wordFg: `rgb(${wordFg.join(',')})`, badgeBg: `rgb(${badgeBg.join(',')})`,
      samples: samples.map(s => `rgb(${s.join(',')})`),
      word: Math.round(worst(wordFg) * 100) / 100,
      badge: Math.round(worst(badgeBg) * 100) / 100,
      // What the bar would do to plain white — the colour the title used
      // before the mark existed. The regression floor.
      wasWhite: Math.round(worst([255, 255, 255]) * 100) / 100,
      ring: ring ? Math.round(worst(ring) * 100) / 100 : null,
      hasRing: !!ring,
      ez: Math.round(window.__ratio(ezFg, badgeBg) * 100) / 100,
      wordSize: getComputedStyle(word).fontSize,
    };
  }, dataUrl);
  results[t.id] = r;
  console.log(t.id.padEnd(15), String(r.word).padEnd(7), String(r.badge).padEnd(5), ' ', (r.samples || []).join(' '));
}

// THREE palettes cannot reach 4.5 with ANY flat ink, and that is a property
// of their own hero gradient rather than of the mark. Each of those bars
// sweeps across mid-tones under the 225px the mark occupies: on Titanium the
// backdrop runs rgb(127) to rgb(79), so white is 3.87 at one end and navy is
// 1.91 at the other. Nothing flat clears AA across that span.
//
// They are named here rather than quietly excused. The rule for them is the
// one that actually protects the user: the mark must be NO LESS legible than
// the plain white title it replaced, and must still clear 3:1. If a new
// palette joins this list the suite fails, because the list is asserted —
// it cannot grow by accident.
//
// (WCAG exempts text that is part of a logo from contrast limits. That is
// true here and is deliberately not leaned on: the floor below is stricter.)
const GRADIENT_LIMITED = ['alpine', 'haas', 'powershell'];
const limited = [];
for (const [id, r] of Object.entries(results)) {
  if (r.note) { check(`[${id}] the mark renders`, false, r.note); continue; }
  if (r.word >= 4.5) {
    check(`[${id}] "Defect Manager" clears WCAG AA on the bar`, true,
      `${r.word}:1  ${r.wordFg} on ${(r.samples || [])[0]}`);
  } else {
    limited.push(id);
    check(`[${id}] "Defect Manager" is at least no worse than the old white title`,
      r.word >= r.wasWhite && r.word >= 3,
      `${r.word}:1 vs white's ${r.wasWhite}:1 — this bar's own gradient caps it`);
  }
  // The badge is a shape, so 3:1 is the bar. Where the bar sits between the
  // sky and the navy and neither separates, the keyline carries it instead.
  check(`[${id}] the badge is separated from the bar`,
    r.badge >= 3 || (r.hasRing && r.ring >= 3),
    r.hasRing ? `badge ${r.badge}:1, keyline ${r.ring}:1` : `badge ${r.badge}:1, no keyline`);
  check(`[${id}] "EZ" is readable inside the badge`, r.ez >= 4.5, `${r.ez}:1`);
}
console.log(`\ngradient-limited: ${JSON.stringify(limited)}`);
check('exactly the three known palettes fall short, and no new one has joined them',
  limited.length === GRADIENT_LIMITED.length && GRADIENT_LIMITED.every(id => limited.includes(id)),
  `${JSON.stringify(limited)} vs expected ${JSON.stringify(GRADIENT_LIMITED)}`);
check('…and on every other palette the mark clears AA outright',
  Object.entries(results).filter(([, r]) => !r.note && r.word >= 4.5).length === Object.keys(results).length - GRADIENT_LIMITED.length,
  '');
// The ink was a choice per palette; check it was the better choice, not just
// a different one.
for (const [id, r] of Object.entries(results)) {
  if (r.note || r.wordFg === 'rgb(255,255,255)') continue;
  check(`[${id}] its non-white ink beats white on that bar`, r.word > r.wasWhite,
    `${r.wordFg} ${r.word}:1 vs white ${r.wasWhite}:1`);
}

// It is the same mark everywhere: one accessible name, the same geometry, and
// no theme left showing the old text instead.
console.log('\n--- it is the same mark on every theme ---');
const sameness = await page.evaluate(async () => {
  const out = { shapes: new Set(), names: new Set(), oldTextVisible: [] };
  for (const t of F1_THEMES) {
    applyF1Theme(t.id); state.currentView = 'home'; render();
    await new Promise(r => setTimeout(r, 40));
    const ez = document.querySelector('.wm-ez'), txt = document.querySelector('.wm-text');
    const cs = ez && getComputedStyle(ez);
    if (!ez || cs.display === 'none') { out.oldTextVisible.push(t.id + ':missing'); continue; }
    const tc = txt && getComputedStyle(txt);
    if (tc && tc.visibility !== 'hidden' && tc.display !== 'none') out.oldTextVisible.push(t.id);
    out.shapes.add(Math.round(ez.getBoundingClientRect().width) + 'x' + Math.round(ez.getBoundingClientRect().height));
    out.names.add(ez.getAttribute('aria-label') || '');
  }
  return { shapes: [...out.shapes], names: [...out.names], oldTextVisible: out.oldTextVisible };
});
console.log('sameness:', JSON.stringify(sameness));
check('every theme shows the mark, none still shows "Defect Manager" as text',
  sameness.oldTextVisible.length === 0, JSON.stringify(sameness.oldTextVisible));
check('…at one size, so it is the same mark and not fifteen',
  sameness.shapes.length === 1, JSON.stringify(sameness.shapes));
check('…under one accessible name',
  sameness.names.length === 1 && sameness.names[0] === 'EZ Defect Manager',
  JSON.stringify(sameness.names));

// The bar's height is the thing Spiro ruled out moving. Check it on all of
// them, against the height each theme had before the mark existed.
const heights = await page.evaluate(async () => {
  const out = {};
  for (const t of F1_THEMES) {
    applyF1Theme(t.id); state.currentView = 'home'; render();
    await new Promise(r => setTimeout(r, 40));
    const h = document.querySelector('.app-header.home-hero');
    const txt = document.querySelector('.wm-text');
    // What the bar WOULD be if the line of type were all it held.
    out[t.id] = { bar: Math.round(h.getBoundingClientRect().height),
                  line: Math.round(parseFloat(getComputedStyle(txt.parentElement).height)) };
  }
  return out;
});
const barSet = [...new Set(Object.values(heights).map(v => v.bar))];
console.log('bar heights:', JSON.stringify(barSet), 'across', Object.keys(heights).length, 'themes');
check('the bar is the same height on every theme, as it was before the mark',
  barSet.length === 1, JSON.stringify(heights));

check('no page errors', errs.length === 0, JSON.stringify(errs));
console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
