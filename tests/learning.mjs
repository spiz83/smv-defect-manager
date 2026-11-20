// MEMORY: what the app remembers, and whether it can still find it later.
//
// Spiro 2026-11-19: "keeping a log / database to LEARN as you go… BUT MEMORY IS
// VERY IMPORTANT."
//
// The shared store (dm_trade_learning) remembers forever and is shared by every
// supervisor — but it was keyed on the WHOLE normalised phrase, so it only ever
// fired on word-for-word repeats, which free-typed BPI text almost never is.
// The strongest memory in the system was the one that could least often speak.
//
// Phase 1 files every verdict under a SIGNATURE as well (the two most
// distinctive words), teaches from REASSIGNMENTS as corrections and from
// COMPLETED work as reinforcement, and says out loud how much of the evidence
// actually agreed. This suite is about all four, and every check watches what
// is WRITTEN or what comes back — never just that a function exists.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ROOT = REPO, PORT = 8195;
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

const SEED = {
  addresses: [{ id: 1, lot: '7', street: 'Lot 7, 26 Skylark Rd', streetName: 'Skylark Rd', lotNo: 7,
                suburb: 'Greenvale', propertyNumber: '306629', active: true }],
  contractors: [
    { id: 1, name: 'Painter', trades: 'Painter', isTradePlaceholder: true, isActive: true },
    { id: 2, name: 'Supervisor', trades: 'Supervisor', isTradePlaceholder: true, isActive: true },
    { id: 10, name: 'Brushworks Painting', trades: 'Painter', isActive: true },
    { id: 11, name: 'Seal Tight Caulking', trades: 'Caulker', isActive: true },
    { id: 12, name: 'Ian Quayle', trades: 'Supervisor', isActive: true },
  ],
  trades: [],
  defects: [
    { id: 101, addressId: 1, contractorId: 10, status: 'open', completed: false,
      description: 'Paint edge of skirt tile to left of trough cabinet', location: 'Laundry' },
    { id: 102, addressId: 1, contractorId: 1, status: 'open', completed: false,
      description: 'Make good cornice join in the hallway', location: 'Hallway' },
  ],
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, serviceWorkers: 'block' });
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
await page.waitForFunction(() => !document.getElementById('splash'), { timeout: 15000 });

// A recording CloudLearning: every write is captured, and reads answer from a
// table the test controls — so "it remembered" means this store was asked and
// this store replied.
const installLearning = (table) => page.evaluate((table) => {
  window.__writes = [];
  window.__table = table || {};
  window.CloudLearning = {
    suggestTrade: (key, minN) => {
      const t = window.__table[key]; if (!t) return null;
      return t.n >= minN ? { trade: t.trade, n: t.n, total: t.n } : null;
    },
    minExamples: () => 2,
    dbRules: () => [],
    historyCorpus: () => [],
    jobUuidForAddress: () => 'job-uuid',
    record: async (phraseKey, trade, wrongTrade, detail) => {
      window.__writes.push({ phraseKey, trade, wrongTrade: wrongTrade || null,
        alsoKeys: (detail && detail.alsoKeys) || [], source: detail && detail.source,
        weightFactor: detail && detail.weightFactor });
    },
    logPrediction: async () => {},
  };
}, table);

// ── 1. A signature is one key to write and several to look under ─────────
{
  const r = await page.evaluate(() => {
    const p = normalizePhrase('Paint edge of skirt tile to left of trough cabinet');
    return { phrase: p, write: phraseSignatures(p, true), read: phraseSignatures(p, false),
             normalisedCannotCollide: normalizePhrase('#ng: skirt trough').startsWith('#') };
  });
  check('a verdict is filed under three signatures, not one',
    r.write.length === 3 && r.write.every(k => k.startsWith('#ng:')), JSON.stringify(r.write));
  check('…and looked for under several, so the wording can drift',
    r.read.length >= 3 && r.read.includes(r.write[0]), JSON.stringify(r.read).slice(0, 170));
  check('the signature prefix cannot collide with a real phrase',
    r.normalisedCannotCollide === false, 'normalizePhrase strips it: ' + r.normalisedCannotCollide);
}

// ── 2. DIFFERENT WORDS, SAME MEMORY ──────────────────────────────────────
// The point of the whole change. Teach it under one sentence, ask with another.
{
  const taught = await page.evaluate(() => normalizePhrase('Paint edge of skirt tile to left of trough cabinet'));
  // Taught under the ORIGINAL wording's keys only — nothing here knows the
  // sentence the test is about to ask with.
  const keys = await page.evaluate((p) => phraseSignatures(p, true), taught);
  const table = {}; keys.forEach(k => { table[k] = { trade: 'Caulker', n: 4 }; });
  await installLearning(table);
  const r = await page.evaluate(() => ({
    // Same job, said completely differently.
    reworded: resolveTrade('Paint the skirt tile edge near the trough'),
    exactGone: resolveTrade('Replace the cracked window furniture in bed 2'),
  }));
  check('a differently-worded defect still finds what the team taught',
    r.reworded.trade === 'Caulker' && r.reworded.source === 'learned-similar',
    JSON.stringify(r.reworded));
  check('…and an unrelated defect does not borrow it',
    r.exactGone.trade !== 'Caulker' || r.exactGone.source !== 'learned-similar',
    JSON.stringify(r.exactGone));
}
// ── 3. The exact phrase still outranks the fuzzy one ─────────────────────
{
  const [phrase, key] = await page.evaluate(() => {
    const p = normalizePhrase('Paint edge of skirt tile to left of trough cabinet');
    return [p, phraseSignatures(p, true)[0]];
  });
  await installLearning({ [phrase]: { trade: 'Painter', n: 3 }, [key]: { trade: 'Caulker', n: 9 } });
  const r = await page.evaluate(() => resolveTrade('Paint edge of skirt tile to left of trough cabinet'));
  check('the exact phrase beats the signature, however well supported',
    r.trade === 'Painter' && r.source === 'learned', JSON.stringify(r));
}
// ── 4. The fuzzy read is gated one example higher ────────────────────────
{
  const key = await page.evaluate(() =>
    phraseSignatures(normalizePhrase('Paint edge of skirt tile to left of trough cabinet'), true)[0]);
  await installLearning({ [key]: { trade: 'Caulker', n: 2 } });   // exactly minExamples
  const r = await page.evaluate(() => resolveTrade('Paint the skirt tile edge near the trough'));
  check('two examples are enough for an exact phrase but not for a loose one',
    r.source !== 'learned-similar', JSON.stringify(r));
}

// ── 5. A REASSIGNMENT IS A CORRECTION ────────────────────────────────────
// Moving a defect off the painter and onto the caulker is the strongest signal
// the app gets. It used to be recorded as a first opinion, leaving both trades
// equally true.
{
  await installLearning({});
  const r = await page.evaluate(async () => {
    openDefectEdit(101);                       // currently Brushworks Painting (Painter)
    document.getElementById('de-contractor').value = '11';       // → Seal Tight Caulking
    document.getElementById('de-contractor-input').value = 'Seal Tight Caulking';
    document.getElementById('de-save').click();
    await new Promise(z => setTimeout(z, 200));
    return window.__writes;
  });
  const w = r[0] || {};
  check('reassigning teaches the new trade', w.trade === 'Caulker', JSON.stringify(r).slice(0, 200));
  check('…AND decays the one it was moved off', w.wrongTrade === 'Painter', JSON.stringify(w));
  check('…under its signatures as well as its exact wording',
    (w.alsoKeys || []).length === 3 && w.alsoKeys.every(k => k.startsWith('#ng:')), JSON.stringify(w.alsoKeys));
}

// ── 6. FINISHED WORK TEACHES, at a lower weight ──────────────────────────
{
  await installLearning({});
  const r = await page.evaluate(async () => {
    db.setDefectStatus(101, 'completed');      // assigned to Seal Tight Caulking by now
    await new Promise(z => setTimeout(z, 150));
    const first = window.__writes.slice();
    window.__writes = [];
    db.setDefectStatus(101, 'completed');      // already completed — must not double-count
    db.setDefectStatus(102, 'completed');      // assigned to a PLACEHOLDER, not a sub
    await new Promise(z => setTimeout(z, 150));
    return { first, second: window.__writes };
  });
  const c = r.first[0] || {};
  check('completing a defect teaches the sub that did it',
    r.first.length === 1 && c.source === 'completed' && c.trade === 'Caulker', JSON.stringify(r.first).slice(0, 200));
  check('…at a fraction of the weight of someone choosing',
    c.weightFactor != null && c.weightFactor > 0 && c.weightFactor < 1, String(c.weightFactor));
  check('…once only, and never for a trade placeholder',
    r.second.length === 0, JSON.stringify(r.second).slice(0, 200));
}

// ── 7. A supervisor doing it themselves teaches nothing about subs ───────
{
  await installLearning({});
  const r = await page.evaluate(async () => {
    db.updateDefect(102, { contractorId: 12 });     // Ian Quayle — Supervisor
    db.setDefectStatus(102, 'open');
    window.__writes = [];
    db.setDefectStatus(102, 'completed');
    await new Promise(z => setTimeout(z, 150));
    return window.__writes;
  });
  check('a supervisor completing it does not teach a trade', r.length === 0, JSON.stringify(r).slice(0, 160));
}

// ── 8. The review says how much of the evidence agreed ───────────────────
{
  const r = await page.evaluate(() => {
    window.CloudLearning.historyCorpus = () => Array.from({ length: 8 }, () => ([
      { t: 'Re-silicone the bath hob to the tiles', c: 11 },
      { t: 'Silicone missing to shower hob junction', c: 11 },
    ])).flat();
    try { _review = null; } catch (e) {}
    state.assignByTrade = false;
    startReportReview([{ description: 'Re-silicone the bath hob to the tiles', location: 'Bathroom', page: 1, itemNo: 1 }], 'BPI.pdf', 'BPI', 1, null);
    return Array.from(document.querySelectorAll('.rv-chip i')).map(b => b.textContent);
  });
  check('a learned chip shows support AND confidence, not just a count',
    r.some(h => /learned ×\d+ · \d+%/.test(h)), JSON.stringify(r));
}

check('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
server.close();
console.log(fail.length ? 'FAILED: ' + fail.join('; ') : 'ALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
