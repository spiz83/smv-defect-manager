// 📐 Job plans — the construction plan, one tap from the job (2026-08-15).
//
// Spiro: "I would use CH tracker to upload the floor plan the plans or the
// plan per job and then on those grounds I can just click of a button bring up
// the plan using the defects app relative because the jobs are the same."
//
// The gateway needed no building. CH Tracker (creation-homes-tracker,
// migration 101 + src/lib/jobPlans.ts) already stores ONE plan PDF per job in
// the private `job-plans` bucket as `{job_number}.pdf`, and this app already
// carries that same job_number on every address as `propertyNumber`. Same
// Supabase project, same auth, and the bucket's RLS already grants SELECT to
// every authenticated user while restricting writes to managers — exactly the
// split wanted here. So the whole feature is a read against a key that already
// lines up. These checks pin that key, because if the naming on either side
// drifts every job silently says "no plan".
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

// A real one-page PDF, built by hand so the suite needs no fixture file and
// pdf.js has something genuine to parse.
function tinyPdf(label) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = `BT /F1 36 Tf 60 480 Td (${label}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const PLAN_PDF = tinyPdf('LOT 905 GROUND FLOOR');

// A real plan set is ~15 sheets and that is the case that matters: floor plans,
// elevations, sections, details, schedules (Spiro 2026-08-15). Each page here
// carries its own sheet title, the way a title block does, so the index has
// something to read.
const SHEET_TITLES = [
  'COVER SHEET', 'SITE PLAN', 'GROUND FLOOR PLAN', 'FIRST FLOOR PLAN',
  'ELEVATIONS NORTH SOUTH', 'ELEVATIONS EAST WEST', 'SECTION A-A',
  'SLAB AND FOOTING PLAN', 'ROOF PLAN', 'BRACING PLAN', 'TIE DOWN PLAN',
  'WINDOW SCHEDULE', 'DOOR SCHEDULE', 'ELECTRICAL PLAN', 'CONSTRUCTION DETAILS',
];
// Built to reproduce the TRAPS a real Creation Homes set exposed, not just to
// have several pages. Positions mirror a real title block, scaled to A3:
//
//   sheet name  bottom-right, 10pt   ← varies per sheet: the thing to find
//   client      left of it,   10pt   ← constant, must be rejected
//   house type  further left, 10pt   ← constant
//   job number  above it,      8pt   ← constant
//   sheet no    far right,     8pt   ← varies, but short and numeric
//   scale       mid-right,     8pt   ← nearly constant
//
// …plus, on the sheets that broke the first two attempts: a big CALLOUT drawn
// into the bottom-right corner, larger than the title (this is what made a
// "largest text in the corner" rule call sheet 6 "HIGH LEVEL ROOF VENT PITCHED
// ROOF"), and a bare scale note ("1:50") that won the same way on sheet 21.
function multiPagePdf(titles) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null];
  const kids = [];
  const fontObj = 3 + titles.length * 2;
  titles.forEach((t, i) => {
    const pageObj = 3 + i * 2, contObj = pageObj + 1;
    kids.push(`${pageObj} 0 R`);
    objs[pageObj - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contObj} 0 R >>`;
    const T = (size, x, y, str) => `BT /F1 ${size} Tf ${x} ${y} Td (${str}) Tj ET\n`;
    let g = '0.7 w\n60 120 700 330 re S\n';
    g += T(20, 70, 470, 'DRAWING AREA');
    // The title block.
    g += T(10, 652, 20, t);                                   // sheet name — varies
    g += T(10, 523, 20, 'A CLIENT NAME');                     // constant
    g += T(10, 421, 46, 'Mia 14 - Acacia');                   // constant
    g += T(8, 652, 41, '306363');                             // constant
    g += T(8, 821, 42, String(i + 1).padStart(2, '0'));       // varies, numeric
    g += T(8, 738, 41, '1:100@A3');                           // near-constant
    g += T(8, 421, 33, 'CONSTRUCTION DRAWINGS');              // constant
    // The decoys, on the sheets whose equivalents broke the earlier rules.
    if (i === 5) g += T(12, 700, 100, 'HIGH LEVEL ROOF VENT PITCHED ROOF');
    if (i === 10) g += T(12, 760, 95, '1:50');
    if (i === 12) g += T(14, 690, 110, 'TYP. LINEN');
    objs[contObj - 1] = `<< /Length ${g.length} >>\nstream\n${g}\nendstream`;
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${titles.length} >>`;
  objs[fontObj - 1] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
const PLAN_SET = multiPagePdf(SHEET_TITLES);

const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  // Stand in for the signed storage URL the real bucket hands back.
  if (u === '/signed-plan.pdf') {
    r.writeHead(200, { 'Content-Type': 'application/pdf' });
    return r.end(PLAN_PDF);
  }
  if (u === '/signed-set.pdf') {
    r.writeHead(200, { 'Content-Type': 'application/pdf' });
    return r.end(PLAN_SET);
  }
  // Spiro's real 23-sheet Creation Homes set (job 306363). Synthetic fixtures
  // cannot tell you whether the sheet names come out right on a real title
  // block; this one can, and did — it is why the naming was rebuilt.
  if (u === '/signed-real.pdf') {
    const f2 = path.join(__here, 'fixtures-plan-306363.pdf');
    if (!fs.existsSync(f2)) { r.writeHead(404); return r.end('x'); }
    r.writeHead(200, { 'Content-Type': 'application/pdf' });
    return r.end(fs.readFileSync(f2));
  }
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

// propertyNumber IS CH Tracker's job_number. That is the whole join.
const SEED = {
  addresses: [
    { id: 1, lot: '905', street: 'Lot 905, (11) Woodlawn Rd', suburb: 'Wollert', propertyNumber: '306648', jobStatus: 'active', active: true },
    { id: 2, lot: '12', street: 'Lot 12, Band St', suburb: 'Craigieburn', propertyNumber: '', jobStatus: 'active', active: true },
  ],
  contractors: [{ id: 1, name: 'Carpenter', trades: 'Carpenter', tradeIds: [], isTradePlaceholder: true, isActive: true }],
  trades: [],
  defects: [
    { id: 11, addressId: 1, contractorId: 1, description: 'Adjust door margins to 3mm-4mm.', location: 'Bed 2', status: 'open', completed: false },
    { id: 12, addressId: 1, contractorId: 1, description: 'Align door with jamb.', location: 'Ensuite', status: 'open', completed: false },
  ],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true });
const page = await ctx.newPage();
await ctx.route('**', route => {
  const u = route.request().url();
  if (u.startsWith(`http://localhost:${PORT}`)) {
    if (u.includes('/sw.js')) return route.fulfill({ status: 404, body: '' });
    return route.continue();
  }
  // pdf.js comes from a CDN in production; serve the copy in node_modules so
  // the suite tests OUR code rather than the network.
  if (/pdf\.min\.js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(join(__here, 'node_modules/pdfjs-dist/build/pdf.js'), 'utf8') });
  if (/pdf\.worker\.min\.js/.test(u)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(join(__here, 'node_modules/pdfjs-dist/build/pdf.worker.js'), 'utf8') });
  return route.fulfill({ status: 200, contentType: u.includes('fonts.googleapis') ? 'text/css' : 'application/javascript', body: '' });
});
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 220)));
page.on('console', m => { if (m.type() === 'error' && !/supabase-js|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
await page.addInitScript(seed => {
  localStorage.setItem('defectTrackerDB', JSON.stringify(seed));
  localStorage.setItem('dm_preview', '0');
}, SEED);
await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.render === 'function');

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// Stand in for cloud-sync's CloudPlans with the same contract, recording which
// storage path it was asked for — that path is the join and is what a rename
// on either side would break.
const installPlans = (mode) => page.evaluate(({ mode, port }) => {
  window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' };
  window.__planAsks = [];
  window.CloudPlans = {
    available: () => mode !== 'local',
    async status(jn) { window.__planAsks.push(['status', String(jn) + '.pdf']); return mode === 'present' ? 'present' : 'absent'; },
    async bytes(jn) {
      window.__planAsks.push(['bytes', String(jn) + '.pdf']);
      if (mode === 'no-bucket') return { error: 'Plans are not set up yet — migration 101 has not been applied in Supabase.' };
      if (mode === 'absent') return { error: 'No plan has been uploaded for this job yet. Attach it in CH Tracker.' };
      if (mode === 'no-plan') return { error: 'No plan.' };
      const res = await fetch(`http://localhost:${port}/` + (mode === 'real' ? 'signed-real.pdf' : mode === 'set' ? 'signed-set.pdf' : 'signed-plan.pdf'));
      return { buf: await res.arrayBuffer() };
    },
    async forget() {},
    canEdit: () => mode !== 'supervisor',
    async upload(jn, file) {
      window.__uploads = window.__uploads || [];
      window.__uploads.push({ path: String(jn) + '.pdf', name: file.name, type: file.type, size: file.size });
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return { error: file.name + " isn't a PDF — construction plans have to be a PDF." };
      return { ok: true };
    },
  };
}, { mode, port: PORT });

const ovText = () => page.evaluate(() => { const o = document.getElementById('plan-ov'); return o ? o.innerText : null; });

// ===========================================================================
//  A. The join: propertyNumber IS the plan's filename.
// ===========================================================================
console.log('\n--- A · the key that links the two apps ---');
{
  await installPlans('present');
  await page.evaluate(() => { viewDefectsForAddress(1); });
  await page.waitForSelector('.defects-header');
  check('the job screen offers a 📐 button',
    await page.evaluate(() => !!document.querySelector('[onclick^="openJobPlan"]')));

  await page.evaluate(() => openJobPlan(1));
  await page.waitForFunction(() => (window.__planAsks || []).length > 0, { timeout: 8000 });
  const asked = await page.evaluate(() => window.__planAsks);
  console.log('  asked storage for:', JSON.stringify(asked));
  check('it asks for {job_number}.pdf — the exact name CH Tracker writes',
    asked.some(a => a[1] === '306648.pdf'), JSON.stringify(asked));
  check('…taken from the address\'s propertyNumber, not the lot or the id',
    await page.evaluate(() => jobPlanNumber(1) === '306648'),
    await page.evaluate(() => jobPlanNumber(1)));
}

// ===========================================================================
//  B. It opens, and it renders.
// ===========================================================================
console.log('\n--- B · the plan opens ---');
{
  await page.waitForSelector('#plan-canvas', { timeout: 15000 });
  await page.waitForFunction(() => {
    const c = document.getElementById('plan-canvas');
    return c && c.width > 10 && c.height > 10;
  }, { timeout: 15000 });
  const c = await page.evaluate(() => {
    const el = document.getElementById('plan-canvas');
    const ctx2 = el.getContext('2d');
    // Anything actually painted? A blank canvas is all one colour.
    const d = ctx2.getImageData(0, 0, el.width, Math.min(el.height, 200)).data;
    let seen = new Set();
    for (let i = 0; i < d.length; i += 400) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    return { w: el.width, h: el.height, cssW: el.style.width, colours: seen.size };
  });
  console.log(`  canvas ${c.w}x${c.h} (css ${c.cssW}), ${c.colours} distinct colours sampled`);
  check('the PDF is rendered to the canvas, not left blank', c.w > 10 && c.colours > 1, JSON.stringify(c));
  check('…fitted to the screen width so it opens readable',
    parseFloat(c.cssW) > 300 && parseFloat(c.cssW) <= 390, c.cssW);
  check('…with the page count shown', /Page 1 of 1/.test(await ovText()), (await ovText() || '').split('\n')[0]);
  // Nothing tappable may sit in the top strip, where the clock and the island
  // are. Everything the viewer offers lives at the bottom.
  const chrome = await page.evaluate(() => {
    const ov = document.getElementById('plan-ov');
    const vh = window.innerHeight;
    return [...ov.querySelectorAll('button')].map(b => {
      const r = b.getBoundingClientRect();
      return { t: b.textContent.trim().slice(0, 12), top: Math.round(r.top), frac: +(r.top / vh).toFixed(2) };
    });
  });
  console.log('  controls:', JSON.stringify(chrome));
  check('every control in the viewer is in the bottom third, clear of the status bar',
    chrome.length > 0 && chrome.every(c => c.frac > 0.66), JSON.stringify(chrome.filter(c => c.frac <= 0.66)));
  check('…including Back and the job number', /Job 306648/.test(await ovText()) && chrome.some(c => /Back/.test(c.t)));
  // Six controls plus a labelled button did not fit 390px and cut the + off the
  // right edge. Page nav moved to the header; this is what keeps it honest.
  const bar = await page.evaluate(() => {
    const row = document.getElementById('plan-markup').parentElement;
    const kids = [...row.children];
    const mid = el => Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2);
    return { rows: new Set(kids.map(mid)).size, n: kids.length,
             overflow: Math.round(Math.max(...kids.map(k => k.getBoundingClientRect().right)) - row.getBoundingClientRect().right),
             clipped: Math.round(row.getBoundingClientRect().left - Math.min(...kids.map(k => k.getBoundingClientRect().left))) };
  });
  console.log('  toolbar:', JSON.stringify(bar));
  check('every control on the plan toolbar fits on one line',
    bar.rows === 1 && bar.overflow <= 0 && bar.clipped <= 0, JSON.stringify(bar));
  check('…and the job number in the header', /306648/.test(await ovText()));
}

// ===========================================================================
//  C. Zoom — reading a room name off a plan is the point.
// ===========================================================================
console.log('\n--- C · zoom ---');
{
  const w0 = await page.evaluate(() => parseFloat(document.getElementById('plan-canvas').style.width));
  await page.evaluate(() => planZoom(1));
  await page.waitForTimeout(300);
  const w1 = await page.evaluate(() => parseFloat(document.getElementById('plan-canvas').style.width));
  check('zooming in makes the plan bigger', w1 > w0 * 1.2, `${w0} -> ${w1}`);
  check('…and says what zoom you are at', /15\d%|1\d\d%/.test(await page.evaluate(() => document.getElementById('plan-zoomlbl').textContent)),
    await page.evaluate(() => document.getElementById('plan-zoomlbl').textContent));
  check('…the view scrolls, so you can pan around a zoomed plan',
    await page.evaluate(() => {
      const b = document.getElementById('plan-scroll');
      return getComputedStyle(b).overflow === 'auto' && b.scrollWidth > b.clientWidth;
    }));
  await page.evaluate(() => planZoom(0));
  await page.waitForTimeout(300);
  const w2 = await page.evaluate(() => parseFloat(document.getElementById('plan-canvas').style.width));
  check('Fit returns it to the screen width', Math.abs(w2 - w0) < 2, `${w0} -> ${w2}`);
  check('…and zooming never exceeds the canvas ceiling a phone can hold',
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) planZoom(1);
      await new Promise(r => setTimeout(r, 500));
      const el = document.getElementById('plan-canvas');
      return el.width * el.height <= 12e6 + 1;
    }));
  await page.evaluate(() => planZoom(0));

  // A landscape sheet on a portrait phone is a strip across the top. Turning it
  // uses the screen, the same as turning a paper plan.
  const before = await page.evaluate(() => {
    const c = document.getElementById('plan-canvas');
    return { w: parseFloat(c.style.width), h: parseFloat(c.style.height) };
  });
  await page.evaluate(() => planRotate());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const c = document.getElementById('plan-canvas'), b = document.getElementById('plan-scroll');
    return { w: parseFloat(c.style.width), h: parseFloat(c.style.height), box: b.clientHeight };
  });
  console.log(`  ${before.w}x${before.h} -> rotated ${after.w}x${after.h} in a ${after.box}px-tall view`);
  check('⟳ turns the sheet 90°', after.h > before.h && after.w <= before.w + 1, JSON.stringify({ before, after }));
  check('…and a landscape sheet then uses far more of the screen',
    (after.h / after.box) > (before.h / after.box) * 1.5, `${Math.round(before.h / after.box * 100)}% -> ${Math.round(after.h / after.box * 100)}% of the view`);
  await page.evaluate(() => { planRotate(); planRotate(); planRotate(); });
  await page.waitForTimeout(400);
  check('…and four turns come back to where it started',
    Math.abs((await page.evaluate(() => parseFloat(document.getElementById('plan-canvas').style.width))) - before.w) < 2);

  // No grey field under a short page.
  const centred = await page.evaluate(() => {
    const c = document.getElementById('plan-canvas'), b = document.getElementById('plan-scroll');
    const h = parseFloat(c.style.height), mt = parseFloat(c.style.marginTop) || 0;
    return { fits: h < b.clientHeight, mt, want: Math.round((b.clientHeight - h) / 2) };
  });
  check('a page shorter than the view is centred, not pinned to the top',
    !centred.fits || Math.abs(centred.mt - centred.want) <= 1, JSON.stringify(centred));
}

// ===========================================================================
//  D. Getting out, and the states that are not "here is your plan".
// ===========================================================================
console.log('\n--- D · the other outcomes ---');
{
  await page.evaluate(() => closeJobPlan());
  check('Back closes the plan', await page.evaluate(() => !document.getElementById('plan-ov')));
  check('…and the job screen is still there', await page.evaluate(() => !!document.querySelector('.defects-header')));

  await installPlans('absent');
  await page.evaluate(() => openJobPlan(1));
  await page.waitForFunction(() => /uploaded|Attach/i.test((document.getElementById('plan-ov') || {}).innerText || ''), { timeout: 8000 });
  check('a job with no plan says so, and says where to attach one',
    /No plan has been uploaded/.test(await ovText()) && /CH Tracker/.test(await ovText()), await ovText());
  // This is a FULL-SCREEN fixed overlay. A message with no header is a dead end
  // — force-quit the app or nothing (Spiro, 2026-08-16, on exactly this screen).
  const wayOut = await page.evaluate(() => {
    const ov = document.getElementById('plan-ov');
    const b = [...ov.querySelectorAll('button')].find(x => /back/i.test(x.textContent));
    if (!b) return { back: false };
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return { back: true, tappable: !!(hit && (hit === b || b.contains(hit))),
             top: Math.round(r.top), vh: window.innerHeight, says: ov.innerText.split('\n')[0] };
  });
  check('…and there is a Back button on it, not a dead end', wayOut.back, JSON.stringify(wayOut));
  check('…which is actually tappable, not covered', wayOut.tappable, JSON.stringify(wayOut));
  // At the top it sat under the clock and the Dynamic Island — padding for
  // env(safe-area-inset-top) was the textbook fix and still did not clear it on
  // a real iPhone. The bottom has nothing to argue with, and is where the thumb
  // already is (Spiro 2026-08-16).
  check('…and it is at the BOTTOM, clear of the status bar',
    wayOut.top > wayOut.vh * 0.75, `y ${wayOut.top} of ${wayOut.vh}`);
  // Centring the message in a full-height overlay put it halfway down an empty
  // screen, well below where anyone looks. It belongs under the header.
  const msgY = await page.evaluate(() => {
    const ov = document.getElementById('plan-ov');
    const el = [...ov.querySelectorAll('div')].find(d => /No plan has been uploaded/.test(d.textContent) && d.children.length === 0);
    return el ? Math.round(el.getBoundingClientRect().top) : -1;
  });
  console.log('  message sits at y =', msgY, 'of 844');
  check('…and the message is near the top, not stranded mid-screen', msgY > 0 && msgY < 300, String(msgY));
  check('…with the job in the header so you know what you are looking at',
    /306648/.test(await ovText()), (await ovText() || '').split('\n').slice(0, 2).join(' | '));
  await page.evaluate(() => { const ov = document.getElementById('plan-ov'); [...ov.querySelectorAll('button')].find(x => /back/i.test(x.textContent)).click(); });
  check('…and tapping it actually leaves', await page.evaluate(() => !document.getElementById('plan-ov')));

  await installPlans('no-bucket');
  await page.evaluate(() => openJobPlan(1));
  await page.waitForFunction(() => /migration/i.test((document.getElementById('plan-ov') || {}).innerText || ''), { timeout: 8000 });
  check('a missing bucket names the migration rather than looking like "no plan"',
    /migration 101/.test(await ovText()), await ovText());
  check('…and that message has a way out too',
    await page.evaluate(() => [...document.getElementById('plan-ov').querySelectorAll('button')].some(x => /back/i.test(x.textContent))));
  await page.evaluate(() => closeJobPlan());

  // Leaving DURING the load must actually leave. The open path awaits a font, a
  // download and a parse; without a guard the fetch finishes and re-opens the
  // plan on top of wherever the supervisor went next.
  await page.evaluate(() => {
    window.CloudPlans.bytes = () => new Promise(res => { window.__release = res; });
  });
  page.evaluate(() => openJobPlan(1));
  await page.waitForFunction(() => !!document.getElementById('plan-ov'), { timeout: 5000 });
  check('the loading screen has a Back button as well',
    await page.evaluate(() => [...document.getElementById('plan-ov').querySelectorAll('button')].some(x => /back/i.test(x.textContent))));
  await page.evaluate(() => closeJobPlan());
  await page.evaluate(() => { window.__release({ error: 'nope' }); });
  await page.waitForTimeout(400);
  check('…and leaving mid-load stays left, rather than the fetch re-opening it',
    await page.evaluate(() => !document.getElementById('plan-ov')));
  await installPlans('present');

  // A job with no job_number can never have a plan — say that, don't spin.
  await installPlans('present');
  const noJn = await page.evaluate(async () => {
    window.__toasts = []; const orig = window.showToast;
    window.showToast = (m) => { window.__toasts.push(m); };
    await openJobPlan(2);
    window.showToast = orig;
    return { toasts: window.__toasts, overlay: !!document.getElementById('plan-ov') };
  });
  check('a job with no job number says so instead of opening an empty viewer',
    !noJn.overlay && noJn.toasts.some(t => /job number/i.test(t)), JSON.stringify(noJn));

  // Local-only build: no cloud, no plans, no broken button.
  await page.evaluate(() => { delete window.CloudPlans; });
  const local = await page.evaluate(async () => {
    window.__toasts = []; const orig = window.showToast;
    window.showToast = (m) => { window.__toasts.push(m); };
    await openJobPlan(1);
    window.showToast = orig;
    return { toasts: window.__toasts, overlay: !!document.getElementById('plan-ov') };
  });
  check('with no cloud sign-in it says so rather than throwing',
    !local.overlay && local.toasts.length > 0, JSON.stringify(local));
}

// ===========================================================================
//  E. The Add Defects screen has it too — that is where a supervisor stands.
// ===========================================================================
console.log('\n--- E · reachable from both job screens ---');
{
  await installPlans('present');
  await page.evaluate(() => { startDefectsForJob(1); });
  await page.waitForSelector('.add-defect-1');
  check('Add Defects offers the 📐 button as well',
    await page.evaluate(() => !!document.querySelector('[onclick^="openJobPlan"]')));
  await page.evaluate(() => openJobPlan(1));
  await page.waitForSelector('#plan-canvas', { timeout: 15000 });
  check('…and it opens the same plan', /306648/.test(await ovText()));
  check('…over the top of the entry form, which is still there underneath',
    await page.evaluate(() => !!document.querySelector('.add-defect-1')));
  await page.evaluate(() => closeJobPlan());
}

// ===========================================================================
//  F. Mark up a plan, and it lands on a defect.
// ===========================================================================
// Spiro asked where a markup should go and chose a defect — so it travels to
// the trade in the contractor PDF next to the wording, which is the only route
// this app has to the person who has to act on it.
console.log('\n--- F · markup ---');
{
  await installPlans('present');
  // Stand in for the photo layer: record what gets drawn on and what it is
  // attached to. editPhoto is the app's real markup editor; here it just hands
  // the image straight back, as "use as-is" does.
  await page.evaluate(() => {
    window.__saved = [];
    window.__edited = [];
    window.CloudPhotos = {
      count: () => 0, pendingCount: () => 0, refreshCounts: () => {},
      async editPhoto(file) { window.__edited.push({ name: file.name, type: file.type, size: file.size }); return file; },
      async savePhoto(defectId, blob) { window.__saved.push({ defectId, size: blob.size }); },
    };
  });
  await page.evaluate(() => { viewDefectsForAddress(1); openJobPlan(1); });
  await page.waitForSelector('#plan-canvas', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('plan-canvas').width > 10, { timeout: 15000 });

  check('the viewer offers Mark up', await page.evaluate(() => !!document.getElementById('plan-markup')));

  // Zoom in first: a markup is for pointing at one spot, so what gets captured
  // has to be what is ON SCREEN, not the whole sheet.
  await page.evaluate(() => planZoom(1));
  await page.waitForTimeout(400);
  const cap = await page.evaluate(async () => {
    const r = _planVisibleRegion();
    const c = document.getElementById('plan-canvas');
    return { region: { w: Math.round(r.sw), h: Math.round(r.sh) }, whole: { w: c.width, h: c.height } };
  });
  console.log('  captured region', JSON.stringify(cap.region), 'of a canvas', JSON.stringify(cap.whole));
  check('it captures the visible region, not the whole page',
    cap.region.w < cap.whole.w, `${cap.region.w} of ${cap.whole.w} wide`);

  await page.evaluate(() => planMarkup());
  await page.waitForFunction(() => (window.__edited || []).length > 0, { timeout: 8000 });
  const ed = await page.evaluate(() => window.__edited[0]);
  console.log('  handed to the markup editor:', JSON.stringify(ed));
  check('the capture goes through the app\'s existing photo markup editor', !!ed && ed.type === 'image/jpeg', JSON.stringify(ed));
  check('…named so it is identifiable later', /plan-306648-p1\.jpg/.test(ed.name), ed.name);
  check('…and it is a real image, not an empty file', ed.size > 500, String(ed.size));

  // Then: which defect?
  await page.waitForSelector('#plan-defect-list', { timeout: 8000 });
  // In the DOM is not the same as ON SCREEN. The plan viewer sits above the
  // shared modal layer, so the picker opened BEHIND it and the screen looked
  // frozen after the drawing — a screenshot caught what a querySelector did not.
  const visible = await page.evaluate(() => {
    const el = document.getElementById('plan-defect-list');
    const r = el.getBoundingClientRect();
    const mid = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 20));
    return { onTop: !!(mid && el.contains(mid)), planHidden: (document.getElementById('plan-ov') || {}).style.display === 'none' };
  });
  check('the picker is actually ON SCREEN, not behind the plan viewer',
    visible.onTop && visible.planHidden, JSON.stringify(visible));
  const listed = await page.evaluate(() => [...document.querySelectorAll('#plan-defect-list > div')].map(e => e.innerText.replace(/\n/g, ' | ')));
  console.log('  offered:', JSON.stringify(listed));
  check('it asks which defect, listing this job\'s defects', listed.length === 2, JSON.stringify(listed));
  check('…with the location and trade, so they can be told apart',
    listed.some(t => /Bed 2/.test(t) && /Carpenter/.test(t)), JSON.stringify(listed));

  await page.evaluate(() => planFilterDefects('ensuite'));
  const shown = await page.evaluate(() => [...document.querySelectorAll('#plan-defect-list > div')].filter(e => e.style.display !== 'none').map(e => e.innerText.split('\n')[0]));
  check('…and it can be searched on a job with a long list', shown.length === 1 && /Align door/.test(shown[0]), JSON.stringify(shown));
  await page.evaluate(() => planFilterDefects(''));

  // Backing out of the picker has to put the plan back, not leave a blank screen.
  await page.evaluate(() => document.getElementById('imp-close').click());
  const backOut = await page.evaluate(() => ({
    picker: !!document.getElementById('imp-ov'),
    plan: (document.getElementById('plan-ov') || {}).style.display,
  }));
  check('backing out of the picker returns to the plan, not a blank screen',
    !backOut.picker && backOut.plan === 'flex', JSON.stringify(backOut));
  await page.evaluate(() => planMarkup());
  await page.waitForSelector('#plan-defect-list', { timeout: 8000 });

  await page.evaluate(() => planAttachTo(12));
  await page.waitForFunction(() => (window.__saved || []).length > 0, { timeout: 8000 });
  const saved = await page.evaluate(() => window.__saved[0]);
  console.log('  attached:', JSON.stringify(saved));
  check('the markup is attached to the defect that was picked', saved.defectId === 12, JSON.stringify(saved));
  check('…as a real image', saved.size > 500, String(saved.size));
  check('…and the viewer closes, back to the job', await page.evaluate(() => !document.getElementById('plan-ov')));
  check('…with the picker gone too', await page.evaluate(() => !document.getElementById('imp-ov')));

  // Cancelling in the editor must attach nothing.
  await page.evaluate(() => { window.CloudPhotos.editPhoto = async () => null; });
  await page.evaluate(() => openJobPlan(1));
  await page.waitForFunction(() => document.getElementById('plan-canvas') && document.getElementById('plan-canvas').width > 10, { timeout: 15000 });
  await page.evaluate(() => planMarkup());
  await page.waitForTimeout(400);
  check('cancelling the markup attaches nothing and asks nothing',
    await page.evaluate(() => window.__saved.length === 1 && !document.getElementById('plan-defect-list')));
  await page.evaluate(() => closeJobPlan());

  // A job with no defects has nowhere to put a markup — say so up front.
  await page.evaluate(() => { window.CloudPhotos.editPhoto = async (f) => f; db.data.defects = []; db.save(); });
  await page.evaluate(() => openJobPlan(1));
  await page.waitForFunction(() => document.getElementById('plan-canvas') && document.getElementById('plan-canvas').width > 10, { timeout: 15000 });
  const none = await page.evaluate(async () => {
    window.__toasts = []; const orig = window.showToast;
    window.showToast = (m) => { window.__toasts.push(m); };
    await planMarkup();
    window.showToast = orig;
    return { toasts: window.__toasts, asked: !!document.getElementById('plan-defect-list') };
  });
  check('a job with no defects yet says to add one first, rather than a dead end',
    !none.asked && none.toasts.some(t => /defect/i.test(t)), JSON.stringify(none));
  await page.evaluate(() => closeJobPlan());
}

// ===========================================================================
//  G. A real set: 15 sheets, not one floor plan.
// ===========================================================================
// Spiro, 2026-08-15: "plans are typically about 15 pages and it has everything
// from floor plan to elevations to details to a whole bunch of things." The
// single-page case was the easy one; finding the elevations in a set of
// fifteen, on a phone, is the actual job.
console.log('\n--- G · a 15-sheet plan set ---');
{
  await installPlans('set');
  // Section F emptied the job to check the no-defects case; a markup needs one.
  await page.evaluate(() => {
    window.__cap = null;
    db.data.defects = [{ id: 12, addressId: 1, contractorId: 1, description: 'Align door with jamb.', location: 'Ensuite', status: 'open', completed: false }];
    db.save();
  });
  await page.evaluate(() => { window.CloudPhotos = { count: () => 0, pendingCount: () => 0, refreshCounts: () => {}, async editPhoto(f) { window.__cap = f; return f; }, async savePhoto(d, b) { (window.__saved = window.__saved || []).push({ d, size: b.size }); } }; });
  await page.evaluate(() => { viewDefectsForAddress(1); openJobPlan(1); });
  await page.waitForSelector('#plan-canvas', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('plan-canvas').width > 10, { timeout: 15000 });
  check('all 15 sheets are there', await page.evaluate(() => _planState.pdf.numPages === 15),
    String(await page.evaluate(() => _planState.pdf.numPages)));
  // The naming is the whole point of the index on a set this size, and it is
  // what the real 23-sheet set proved twice wrong before this.
  const names = await page.evaluate(() => _planSheetNames(_planState.pdf));
  console.log('  names:', JSON.stringify(names));
  check('every sheet is named exactly as its title block draws it',
    JSON.stringify(names) === JSON.stringify(SHEET_TITLES), JSON.stringify(names));
  check('…a big callout drawn into the corner does not win over the title',
    names[5] === 'ELEVATIONS EAST WEST', names[5]);
  check('…nor does a bare scale note', names[10] === 'TIE DOWN PLAN', names[10]);
  check('…nor a detail label larger than the title', names[12] === 'DOOR SCHEDULE', names[12]);
  check('…and the constant fields (job number, client, house type) are not mistaken for it',
    !names.some(t => /306363|CLIENT NAME|Acacia|CONSTRUCTION DRAWINGS/.test(t)), JSON.stringify(names));
  check('…nor the sheet number, which varies but says nothing',
    !names.some(t => /^\d{2}$/.test(t)), JSON.stringify(names));

  check('the header shows which sheet you are on, and offers the rest',
    await page.evaluate(() => { const b = document.getElementById('plan-sheetbtn'); return !!b && /1 \/ 15/.test(b.textContent); }),
    await page.evaluate(() => (document.getElementById('plan-sheetbtn') || {}).textContent));

  // The index. Thumbnails alone are 15 grey rectangles on a phone; the labels
  // are what make it possible to find the elevations without opening each one.
  await page.evaluate(() => planSheets());
  await page.waitForSelector('#plan-sheet-grid');
  await page.waitForFunction(() => {
    const c = document.querySelectorAll('#plan-sheet-grid .lbl');
    return c.length === 15 && [...c].every(e => e.textContent !== '…');
  }, { timeout: 30000 });
  const sheets = await page.evaluate(() => [...document.querySelectorAll('#plan-sheet-grid > div')].map(d => d.innerText.replace(/\n/g, ' ').trim()));
  console.log('  index:', JSON.stringify(sheets));
  check('every sheet is listed', sheets.length === 15, String(sheets.length));
  check('…labelled with the sheet\'s real name, not just numbered',
    SHEET_TITLES.every((t, i) => sheets[i].indexOf(t) >= 0), JSON.stringify(sheets.slice(0, 4)));
  check('…so "where are the elevations" is answerable at a glance',
    sheets.some(t => /^5\b.*ELEVATIONS NORTH SOUTH/.test(t)), JSON.stringify(sheets.filter(t => /ELEVATION/i.test(t))));
  // In the DOM is not on screen: the card is overflow:hidden for its rounded
  // corners, so a short row track clipped the caption off the bottom while the
  // thumbnails looked perfect. Measure that the caption is INSIDE its card.
  const capped = await page.evaluate(() => [...document.querySelectorAll('#plan-sheet-grid > div')].map(c => {
    const row = c.querySelector('.lbl').parentElement;
    const cr = c.getBoundingClientRect(), rr = row.getBoundingClientRect();
    return rr.height > 8 && rr.bottom <= cr.bottom + 1 && rr.top >= cr.top - 1;
  }));
  check('every sheet name is visible inside its card, not clipped off',
    capped.length === 15 && capped.every(Boolean), `${capped.filter(Boolean).length}/${capped.length}`);
  const idxChrome = await page.evaluate(() => {
    const ov = document.getElementById('plan-sheets'), vh = window.innerHeight;
    return [...ov.querySelectorAll('button')].map(b => +(b.getBoundingClientRect().top / vh).toFixed(2));
  });
  check('the sheet index keeps its controls at the bottom too',
    idxChrome.length > 0 && idxChrome.every(f => f > 0.75), JSON.stringify(idxChrome));
  check('the sheet index pads for the notch as well',
    await page.evaluate(() => /padding-top:\s*env\(safe-area-inset-top/.test(document.getElementById('plan-sheets').style.cssText)),
    await page.evaluate(() => document.getElementById('plan-sheets').style.cssText.slice(-60)));
  check('…and each has a thumbnail, not an empty box',
    await page.evaluate(() => [...document.querySelectorAll('#plan-sheet-grid canvas')].filter(c => c.width > 20).length === 15),
    String(await page.evaluate(() => document.querySelectorAll('#plan-sheet-grid canvas').length)));

  // Jump straight to the elevations.
  await page.evaluate(() => planGoToSheet(5));
  await page.waitForFunction(() => !document.getElementById('plan-sheets'), { timeout: 5000 });
  await page.waitForTimeout(500);
  check('tapping a sheet jumps straight to it', await page.evaluate(() => _planState.page === 5), String(await page.evaluate(() => _planState.page)));
  check('…and the header follows',
    await page.evaluate(() => /5 \/ 15/.test((document.getElementById('plan-sheetbtn') || {}).textContent || '')));
  check('…at Fit, not still zoomed in from the last sheet',
    await page.evaluate(() => _planState.scale === 1));

  // Swiping is the other way through — the gesture already used for photos.
  const swipe = async (dx) => page.evaluate((dx) => {
    const box = document.getElementById('plan-scroll');
    const t = (x, y) => [new Touch({ identifier: 1, target: box, clientX: x, clientY: y })];
    box.dispatchEvent(new TouchEvent('touchstart', { touches: t(200, 400), bubbles: true }));
    box.dispatchEvent(new TouchEvent('touchend', { changedTouches: t(200 + dx, 410), bubbles: true }));
  }, dx);
  await swipe(-120); await page.waitForTimeout(400);
  check('swiping left goes to the next sheet', await page.evaluate(() => _planState.page === 6), String(await page.evaluate(() => _planState.page)));
  await swipe(120); await page.waitForTimeout(400);
  check('…and swiping right goes back', await page.evaluate(() => _planState.page === 5), String(await page.evaluate(() => _planState.page)));

  // Zoomed in, a sideways drag must PAN the sheet, not flip the page.
  await page.evaluate(() => planZoom(1));
  await page.waitForTimeout(400);
  await swipe(-120); await page.waitForTimeout(300);
  check('zoomed in, a sideways drag pans the sheet instead of flipping it',
    await page.evaluate(() => _planState.page === 5), String(await page.evaluate(() => _planState.page)));
  await page.evaluate(() => planZoom(0));
  await page.waitForTimeout(300);

  // And a markup taken on sheet 5 says sheet 5.
  await page.evaluate(() => planMarkup());
  await page.waitForFunction(() => !!window.__cap, { timeout: 8000 });
  const name = await page.evaluate(() => window.__cap.name);
  check('a markup records which sheet it came off', /-p5\.jpg$/.test(name), name);
  await page.evaluate(() => { const b = document.getElementById('imp-close'); if (b) b.click(); });
  // Replacing a plan in CH Tracker has to be reachable from here, or a phone
  // shows yesterday's sheets forever — the cache that makes it work offline is
  // exactly what makes a replacement invisible.
  const reloaded = await page.evaluate(async () => {
    window.__forgot = [];
    const prev = window.CloudPlans.forget;
    window.CloudPlans.forget = async (jn) => { window.__forgot.push(jn); return prev && prev(jn); };
    const hasBtn = !!document.querySelector('[onclick="planReload()"]');
    await planReload();
    return { hasBtn, forgot: window.__forgot };
  });
  check('the viewer offers a reload for a plan replaced in CH Tracker', reloaded.hasBtn);
  check('…which drops the cached copy for THIS job before fetching again',
    reloaded.forgot.length === 1 && reloaded.forgot[0] === '306648', JSON.stringify(reloaded.forgot));
  await page.waitForSelector('#plan-canvas', { timeout: 15000 });
  await page.waitForFunction(() => document.getElementById('plan-canvas').width > 10, { timeout: 15000 });
  check('…and the plan comes back up rather than closing on you',
    await page.evaluate(() => !!_planState && _planState.pdf.numPages === 15));

  await page.evaluate(() => closeJobPlan());
  check('closing the plan takes the sheet index with it',
    await page.evaluate(() => !document.getElementById('plan-sheets') && !document.getElementById('plan-ov')));
}

// ===========================================================================
//  H. A REAL Creation Homes plan set — 23 sheets, real title blocks.
// ===========================================================================
// Spiro sent one so the naming could be checked against the real thing rather
// than a fixture I wrote to suit myself. It is the whole reason the labelling
// was rebuilt: guessing at the title block's position scored 21/23, calling
// sheet 6 "HIGH LEVEL ROOF VENT PITCHED ROOF" (a callout drawn into the
// corner) and sheet 21 "1:50" (a scale note). Learning WHICH FIELD varies
// per sheet gets all 23, verbatim.
console.log('\n--- H · a real 23-sheet Creation Homes set ---');
if (!fs.existsSync(join(__here, 'fixtures-plan-306363.pdf'))) {
  console.log('SKIP  (fixtures-plan-306363.pdf not present)');
} else {
  await installPlans('real');
  await page.evaluate(() => { db.data.defects = [{ id: 12, addressId: 1, contractorId: 1, description: 'Align door with jamb.', location: 'Ensuite', status: 'open', completed: false }]; db.save(); });
  await page.evaluate(() => { viewDefectsForAddress(1); openJobPlan(1); });
  await page.waitForSelector('#plan-canvas', { timeout: 20000 });
  await page.waitForFunction(() => document.getElementById('plan-canvas').width > 10, { timeout: 20000 });
  check('all 23 sheets load', await page.evaluate(() => _planState.pdf.numPages === 23),
    String(await page.evaluate(() => _planState.pdf.numPages)));

  const names = await page.evaluate(() => _planSheetNames(_planState.pdf));
  console.log('  sheet names read off the title blocks:');
  names.forEach((t, i) => console.log(`    ${String(i + 1).padStart(2)}  ${t}`));
  const WANT = ['COVER SHEET', 'SITE PLAN', 'DRAINAGE PLAN', 'SLAB SETOUT', 'GROUND FLOOR PLAN',
    'ROOF PLAN', 'ELEVATIONS 01', 'ELEVATIONS 02', 'WINDOW & DOOR SCHEDULE', 'ELECTRICAL PLANS',
    'SECTIONS', 'PORCH DETAILS', 'INTERNAL DOOR DETAILS', 'GARAGE AND POST DETAILS',
    'BRICK VENEER DETAILS', 'LIGHTWEIGHT CLADDING DETAILS', 'BATH & WC NOGGING DETAILS',
    'WALL TYPE SCHEDULE', 'WATERPROOFING DETAILS', 'INTERNALS 01', 'INTERNALS 02', 'INTERNALS 03',
    'LANDSCAPE PLAN'];
  const wrong = WANT.map((w, i) => names[i] === w ? null : `${i + 1}: got "${names[i]}" want "${w}"`).filter(Boolean);
  check('every sheet is named exactly as the title block draws it', wrong.length === 0, JSON.stringify(wrong));

  // The names are the point: they are what makes a 23-sheet set navigable.
  check('…so the elevations are findable by name',
    names.filter(t => /^ELEVATIONS/.test(t)).length === 2, JSON.stringify(names.filter(t => /ELEVATION/i.test(t))));
  check('…and so is the window schedule', names.includes('WINDOW & DOOR SCHEDULE'));
  check('…and no sheet is left unnamed', names.every(t => t && t.length > 2), JSON.stringify(names.filter(t => !t || t.length <= 2)));

  // End to end through the index, on the real set.
  await page.evaluate(() => planSheets());
  await page.waitForSelector('#plan-sheet-grid');
  await page.waitForFunction(() => {
    const c = document.querySelectorAll('#plan-sheet-grid .lbl');
    return c.length === 23 && [...c].every(e => e.textContent !== '…');
  }, { timeout: 60000 });
  const shown = await page.evaluate(() => [...document.querySelectorAll('#plan-sheet-grid .lbl')].map(e => e.textContent));
  check('the index shows those names', shown[6] === 'ELEVATIONS 01' && shown[22] === 'LANDSCAPE PLAN',
    JSON.stringify([shown[6], shown[22]]));
  await page.evaluate(() => planGoToSheet(7));
  await page.waitForFunction(() => !document.getElementById('plan-sheets'), { timeout: 5000 });
  await page.waitForTimeout(700);
  check('tapping the elevations opens sheet 7 of the real set',
    await page.evaluate(() => _planState.page === 7 && /7 \/ 23/.test((document.getElementById('plan-sheetbtn') || {}).textContent || '')),
    await page.evaluate(() => (document.getElementById('plan-sheetbtn') || {}).textContent));
  check('…and it renders', await page.evaluate(() => document.getElementById('plan-canvas').width > 100));
  await page.evaluate(() => closeJobPlan());
}

// ===========================================================================
//  I. Attaching a plan from here, and the notch.
// ===========================================================================
// Spiro, standing on a job with the PDF on his phone: "Create ability to drop
// file in". Sending a manager to a desktop app to attach a file that is
// already in their hand was the wrong answer. Same bucket either way, so there
// is still one copy per job and one place it lives.
console.log('\n--- I · attach a plan from the app ---');
{
  await installPlans('absent');
  await page.evaluate(() => openJobPlan(1));
  await page.waitForSelector('#plan-drop', { timeout: 8000 });
  const d = await page.evaluate(() => {
    const el = document.getElementById('plan-drop');
    const r = el.getBoundingClientRect();
    return { text: el.innerText.replace(/\n/g, ' | '), onScreen: r.top > 0 && r.bottom < window.innerHeight, hasInput: !!el.querySelector('input[type=file]') };
  });
  check('the "no plan" screen offers a way to attach one', /Attach the plan/.test(d.text), d.text);
  check('…visible without scrolling', d.onScreen, JSON.stringify(d));
  check('…with a real file picker behind it', d.hasInput);
  check('…and it no longer says "attach it in CH Tracker" right above an Attach button',
    !/Attach it in CH Tracker/.test(await ovText()), (await ovText() || '').replace(/\n/g, ' | ').slice(0, 140));

  // The header must clear the notch — it was overlapping the clock and the
  // Dynamic Island. This can only be asserted STRUCTURALLY: headless Chromium
  // has no notch, so env(safe-area-inset-top) legitimately computes to 0 here
  // and would on a notchless phone too. What matters is that the declaration is
  // there and that the box sizes with it. (The page sets viewport-fit=cover, or
  // iOS would report 0 regardless — the two go together.)
  const hdr = await page.evaluate(() => {
    const ov = document.getElementById('plan-ov');
    return { css: ov.style.cssText, boxSizing: getComputedStyle(ov).boxSizing,
             cover: (document.querySelector('meta[name=viewport]') || {}).content || '' };
  });
  check('the plan overlay pads for the status bar / Dynamic Island',
    /padding-top:\s*env\(safe-area-inset-top/.test(hdr.css) && hdr.boxSizing === 'border-box', hdr.css.slice(-80));
  check('…and viewport-fit=cover is set, or iOS reports no inset at all',
    /viewport-fit\s*=\s*cover/.test(hdr.cover), hdr.cover);
  // The state exists from the moment an open starts, before the PDF arrives —
  // so every control that reaches into it has to survive being called then.
  const early = await page.evaluate(async () => {
    const before = document.body.innerHTML.length;
    await planSheets(); planPage(1); planRotate(); planZoom(1); await planMarkup();
    return { sheets: !!document.getElementById('plan-sheets'), grew: document.body.innerHTML.length !== before };
  });
  check('the viewer controls do nothing, rather than throw, before a plan is loaded',
    !early.sheets, JSON.stringify(early));

  // Attach a PDF.
  const okUp = await page.evaluate(async () => {
    window.__uploads = [];
    const f = new File([new Uint8Array([37, 80, 68, 70])], 'Plans306363.pdf', { type: 'application/pdf' });
    await _planDoUpload(1, f);
    return window.__uploads;
  });
  console.log('  uploaded:', JSON.stringify(okUp));
  check('picking a PDF sends it to the job\'s own storage path',
    okUp.length === 1 && okUp[0].path === '306648.pdf', JSON.stringify(okUp));
  check('…as a PDF', okUp[0] && okUp[0].type === 'application/pdf');

  // A non-PDF is refused with a readable reason, and the attach screen stays up.
  await installPlans('absent');
  await page.evaluate(() => openJobPlan(1));
  await page.waitForSelector('#plan-drop', { timeout: 8000 });
  await page.evaluate(async () => {
    window.__uploads = [];
    await _planDoUpload(1, new File(['x'], 'site-photo.jpg', { type: 'image/jpeg' }));
  });
  await page.waitForFunction(() => /isn't a PDF/.test((document.getElementById('plan-ov') || {}).innerText || ''), { timeout: 5000 });
  check('a photo instead of a plan is refused, in plain words', /isn't a PDF/.test(await ovText()), (await ovText() || '').split('\n')[2]);
  check('…and you can try again rather than being dumped out',
    await page.evaluate(() => !!document.getElementById('plan-drop')));
  check('…with Back still there', await page.evaluate(() =>
    [...document.getElementById('plan-ov').querySelectorAll('button')].some(x => /back/i.test(x.textContent))));

  // A supervisor is told there is no plan, and is NOT offered the upload.
  await installPlans('supervisor');
  await page.evaluate(() => { window.CloudPlans.bytes = async () => ({ error: 'No plan has been uploaded for this job yet. Attach it in CH Tracker.' }); });
  await page.evaluate(() => openJobPlan(1));
  await page.waitForFunction(() => /No plan has been uploaded/.test((document.getElementById('plan-ov') || {}).innerText || ''), { timeout: 8000 });
  check('a supervisor sees the message but is not offered the upload',
    await page.evaluate(() => !document.getElementById('plan-drop')));
  check('…and IS still told where it gets attached, since they cannot do it here',
    /CH Tracker/.test(await ovText()), (await ovText() || '').replace(/\n/g, ' | ').slice(0, 140));
  await page.evaluate(() => closeJobPlan());
}

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]|pdf/i.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
