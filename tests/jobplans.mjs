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

const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  // Stand in for the signed storage URL the real bucket hands back.
  if (u === '/signed-plan.pdf') {
    r.writeHead(200, { 'Content-Type': 'application/pdf' });
    return r.end(PLAN_PDF);
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
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
      const res = await fetch(`http://localhost:${port}/signed-plan.pdf`);
      return { buf: await res.arrayBuffer() };
    },
    async forget() {},
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
  await page.evaluate(() => closeJobPlan());

  await installPlans('no-bucket');
  await page.evaluate(() => openJobPlan(1));
  await page.waitForFunction(() => /migration/i.test((document.getElementById('plan-ov') || {}).innerText || ''), { timeout: 8000 });
  check('a missing bucket names the migration rather than looking like "no plan"',
    /migration 101/.test(await ovText()), await ovText());
  await page.evaluate(() => closeJobPlan());

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
  const listed = await page.evaluate(() => [...document.querySelectorAll('#plan-defect-list > div')].map(e => e.innerText.replace(/\n/g, ' | ')));
  console.log('  offered:', JSON.stringify(listed));
  check('it asks which defect, listing this job\'s defects', listed.length === 2, JSON.stringify(listed));
  check('…with the location and trade, so they can be told apart',
    listed.some(t => /Bed 2/.test(t) && /Carpenter/.test(t)), JSON.stringify(listed));

  await page.evaluate(() => planFilterDefects('ensuite'));
  const shown = await page.evaluate(() => [...document.querySelectorAll('#plan-defect-list > div')].filter(e => e.style.display !== 'none').map(e => e.innerText.split('\n')[0]));
  check('…and it can be searched on a job with a long list', shown.length === 1 && /Align door/.test(shown[0]), JSON.stringify(shown));
  await page.evaluate(() => planFilterDefects(''));

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

const bad = errs.filter(e => !/supabase-js|Failed to load resource|Service Worker|SW\]|pdf/i.test(e));
console.log('\nerrors:', bad.length ? bad : 'none');
if (bad.length) fail.push('page errors');
console.log(fail.length ? '\nFAILED: ' + fail.join(' | ') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
