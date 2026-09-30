// Private Inspection reports arrive as a table a supervisor already has —
// Trade / Item # / Report Page / Location / Defect — copied out of a
// spreadsheet, not typed as prose. Before this suite:
//   1. pasting that table produced ONE glommed-together "defect" (the
//      freeform bullet parser has no blank lines or bullets to split on).
//   2. even a correct structured import said "Item #7 (p.3) — ...", not
//      "PI #7 (p.3) — ..." — and could not carry a decimal item number
//      ("3.27") or a page range ("53-54") at all, because REPORT_REF_RE only
//      matched a plain integer in both places.
// This suite pins the fix: parseTabularDefects, the widened REPORT_REF_RE /
// reportRefWord, and the exact-name contractor pre-fill, driven the same way
// tests/fixes.mjs drives a real report import — through the actual Save
// button, not a hand-rolled re-implementation of what Save does.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');

const ROOT = REPO, PORT = 8121;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  const u = q.url.split('?')[0], f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('x'); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, r));

const SEED = {
  addresses: [
    { id: 1, lot: '12', street: 'Lot 12, (5) Example St', suburb: 'Roxburgh Park', propertyNumber: '900001', active: true },
  ],
  contractors: [
    { id: 1, name: 'Painter', isTradePlaceholder: true, isActive: true, trades: 'Painter' },
    { id: 2, name: 'Caulker', isTradePlaceholder: true, isActive: true, trades: 'Caulker' },
    { id: 3, name: 'Bricklayer', isTradePlaceholder: true, isActive: true, trades: 'Bricklayer' },
    { id: 4, name: 'Supervisor', isTradePlaceholder: true, isActive: true, trades: 'Supervisor' },
    { id: 5, name: 'Fix N Chips Roxburgh Park', isTradePlaceholder: false, trades: 'Carpenter' },
  ],
  trades: [
    { id: 1, name: 'Painter' }, { id: 2, name: 'Caulker' }, { id: 3, name: 'Bricklayer' }, { id: 4, name: 'Supervisor' },
  ],
  defects: [],
};

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
await page.evaluate(() => { window.CloudJobs = { isManager: () => true, currentUserId: () => 'me' }; render(); });

const fail = [];
const check = (l, c, d) => { console.log((c ? 'PASS  ' : 'FAIL  ') + l + (d ? '  ' + d : '')); if (!c) fail.push(l); };

// The exact shape a supervisor pastes: a header row, then tab-separated
// columns. Row 2 is the user's own worked example (Painter 3.27, p.53-54).
const TABLE_TSV = [
  'Trade\tItem #\tReport Page\tLocation\tDefect / Finding',
  'Painter\t3.27\t53-54\tThroughout\tDefective external paint finish - blemishes, patchy coverage, runs, texture variation',
  'Fix N Chips Roxburgh Park\t2.08\t18\tLiving\tDamaged aluminium window/door frame - dents, scratches and/or warping',
  'Caulker\t2.05\t13-14\tLeft Elevation\tGaps to eaves linings return - Fill gap',
  'Bricklayer\t3.28\t54-55\tPorch\tMisaligned brick course beneath meter box',
  'Nonexistent Trade\t9.99\t99\tNowhere\tSomething with no matching contractor',
].join('\n');

// ================= 1. parseTabularDefects (pure parsing) ====================
console.log('\n--- parseTabularDefects ---');
const parsed = await page.evaluate((t) => parseTabularDefects(t), TABLE_TSV);
check('all 5 data rows parsed (header dropped)', Array.isArray(parsed) && parsed.length === 5, JSON.stringify(parsed && parsed.length));
if (parsed) {
  const row0 = parsed[0];
  check('trade column read verbatim', row0.trade === 'Painter', row0.trade);
  check('decimal item number kept as "3.27", not truncated', row0.itemNo === '3.27', row0.itemNo);
  check('page RANGE kept as "53-54"', row0.page === '53-54', row0.page);
  check('location column read verbatim', row0.location === 'Throughout', row0.location);
  check('description column read verbatim', row0.description === 'Defective external paint finish - blemishes, patchy coverage, runs, texture variation', row0.description);
  const single = parsed.find(r => r.itemNo === '2.08');
  check('a single (non-range) page still parses', !!single && single.page === '18', single && single.page);
}

// 2+-space-aligned variant of the same two rows (no tabs) — the fallback path
// for a paste that lost its tab characters but kept column alignment.
const TABLE_SPACES = [
  'Painter        3.27   53-54   Throughout        Defective external paint finish - blemishes, patchy coverage, runs, texture variation',
  'Caulker        2.05   13-14   Left Elevation    Gaps to eaves linings return - Fill gap',
].join('\n');
const parsedSpaces = await page.evaluate((t) => parseTabularDefects(t), TABLE_SPACES);
check('space-aligned table (no tabs) also parses', Array.isArray(parsedSpaces) && parsedSpaces.length === 2, JSON.stringify(parsedSpaces));
if (parsedSpaces) check('space-aligned decimal item number survives', parsedSpaces[0].itemNo === '3.27', parsedSpaces[0].itemNo);

// Ordinary prose must NOT be swallowed by the tabular parser — one bad/absent
// row aborts the whole interpretation so extractAndReview falls through to
// the existing AI / freeform-bullet path exactly as before this change.
const PROSE = 'Paint touch ups required to the hallway skirting. Also check the ensuite grout, it looks cracked in two spots near the shower.';
const parsedProse = await page.evaluate((t) => parseTabularDefects(t), PROSE);
check('freeform prose returns null (falls back, not mis-parsed)', parsedProse === null, JSON.stringify(parsedProse));

// ================= 2. reportRefWord / REPORT_REF_RE / splitReportRef =======
console.log('\n--- PI reference word + decimal/range regex ---');
const words = await page.evaluate(() => ([reportRefWord('Private Inspection'), reportRefWord('BPI'), reportRefWord(undefined)]));
check('Private Inspection reads as "PI", not "Item"', words[0] === 'PI', words[0]);
check('BPI is unchanged', words[1] === 'BPI', words[1]);
check('no report type defaults to "BPI" (unchanged)', words[2] === 'BPI', words[2]);

const split1 = await page.evaluate(() =>
  splitReportRef('PI #3.27 (p.53-54) — Defective external paint finish - blemishes, patchy coverage, runs, texture variation'));
check('splitReportRef reads a decimal item # + page RANGE',
  split1.label === 'PI #3.27 (p.53-54)' && split1.page === '53-54', JSON.stringify(split1));
check('…and strips it off the body cleanly',
  split1.body === 'Defective external paint finish - blemishes, patchy coverage, runs, texture variation', split1.body);

// Backward compat: a row saved by the OLD code (before this change) still
// says "Item #7 (p.3)". Existing saved descriptions must keep stripping and
// comparing correctly — this is the app's own duplicate/re-import guard.
const split2 = await page.evaluate(() => splitReportRef('Item #7 (p.3) — an old-style saved defect'));
check('legacy "Item #" rows still strip correctly (backward compat)',
  split2.label === 'Item #7 (p.3)' && split2.body === 'an old-style saved defect', JSON.stringify(split2));

// ================= 3. findContractorByExactName =============================
console.log('\n--- findContractorByExactName ---');
const cid1 = await page.evaluate(() => findContractorByExactName('painter'));      // case-insensitive
const cid2 = await page.evaluate(() => findContractorByExactName('Fix N Chips Roxburgh Park'));
const cid3 = await page.evaluate(() => findContractorByExactName('Nonexistent Trade'));
check('matches a trade placeholder by exact name, case-insensitive', cid1 === 1, String(cid1));
check('matches a real contractor by exact name', cid2 === 5, String(cid2));
check('no match returns null rather than guessing', cid3 === null, String(cid3));

// ================= 4. End-to-end: paste → review → Save =====================
// Drives the review screen the way a supervisor does — the real Save button —
// exactly like tests/fixes.mjs's report re-import suite, so this proves what
// actually gets written to db.addDefect, not a re-implementation of it.
console.log('\n--- end-to-end: Private Inspection paste through Save ---');
const result = await page.evaluate(async (tsv) => {
  await extractAndReview(tsv, 'Pasted report', 'Private Inspection', false);
  const count = _review ? _review.items.length : -1;
  const preAssigned = _review ? _review.items.map(it => it._contractorId) : [];
  for (let i = 0; i < count; i++) {
    const sel = document.getElementById('rv-address');
    if (sel) sel.value = '1';
    const btn = [...document.querySelectorAll('#imp-body button')].find(b => /save/i.test(b.textContent));
    if (!btn) break;
    btn.click();
    await new Promise(r => setTimeout(r, 60));
  }
  if (_review) { try { await finishReview(); } catch (e) {} }
  await new Promise(r => setTimeout(r, 100));
  return {
    count, preAssigned,
    defects: (db.data.defects || []).map(d => ({ desc: d.description, contractorId: d.contractorId, location: d.location })),
  };
}, TABLE_TSV);

check('extractAndReview found all 5 rows (header dropped)', result.count === 5, String(result.count));
check('known trades were pre-assigned a contractor before Save',
  result.preAssigned[0] === 1 && result.preAssigned[1] === 5 && result.preAssigned[2] === 2 && result.preAssigned[3] === 3,
  JSON.stringify(result.preAssigned));
check('the unknown trade was left unassigned, not guessed',
  result.preAssigned[4] == null, JSON.stringify(result.preAssigned));
check('5 defects saved', result.defects.length === 5, String(result.defects.length));

const painted = result.defects.find(d => (d.desc || '').startsWith('PI #3.27'));
check('the worked example saves EXACTLY as "PI #3.27 (p.53-54) — …"',
  !!painted && painted.desc === 'PI #3.27 (p.53-54) — Defective external paint finish - blemishes, patchy coverage, runs, texture variation',
  JSON.stringify(painted));
check('…assigned to the Painter trade placeholder', painted && painted.contractorId === 1, painted && String(painted.contractorId));

const fixnchips = result.defects.find(d => (d.desc || '').startsWith('PI #2.08'));
check('a single-page item saves as "PI #2.08 (p.18) — …", no range artefact',
  !!fixnchips && fixnchips.desc === 'PI #2.08 (p.18) — Damaged aluminium window/door frame - dents, scratches and/or warping',
  JSON.stringify(fixnchips));
check('…and resolved to the named contractor, not a trade guess',
  fixnchips && fixnchips.contractorId === 5, fixnchips && String(fixnchips.contractorId));

check('no console/page errors during the whole run', errs.length === 0, JSON.stringify(errs));

console.log(fail.length ? `\nFAILED (${fail.length}):\n` + fail.map(f => ' - ' + f).join('\n') : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fail.length ? 1 : 0);
