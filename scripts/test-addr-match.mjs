// Verify the new matchAddressFromText logic (verbatim copy) against the LIVE
// jobs table, using the real BPI filenames + simulated fragmented text.
const BASE = 'https://cubwwnvzmeydyixhetfb.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1Ynd3bnZ6bWV5ZHlpeGhldGZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NzU3MDksImV4cCI6MjA5NDE1MTcwOX0.CkeKGBkvNE4fAUl-WDSEb8s3JLqPul2uiAodffLn2nY';

const tok = await (await fetch(BASE + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'svladimiroski@hotmail.com', password: 'admin!983' })
})).json();
if (!tok.access_token) { console.log('LOGIN FAIL', JSON.stringify(tok).slice(0, 200)); process.exit(1); }

const jobs = await (await fetch(BASE + '/rest/v1/jobs?select=id,lot,street,suburb,active&order=lot', {
  headers: { apikey: ANON, Authorization: 'Bearer ' + tok.access_token }
})).json();
// Replicate the app's address shape: street = [lot, street].join(', ')
const addrs = jobs.map((j, i) => ({ id: i + 1, street: [j.lot, j.street].filter(Boolean).join(', '), suburb: j.suburb || '' }));
console.log('addresses:', addrs.length, '| sample:', addrs.slice(0, 2).map(a => a.street).join(' | '));

// ---- verbatim copy of the new matcher (db.getAddresses -> addrs) ----
function matchAddressFromText(text, fileName) {
  const norm = s => (s || '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  const low = norm((fileName || '') + ' ' + (text || ''));
  const squish = low.replace(/[^a-z0-9]+/g, '');
  let result = null, via = '';
  const lotM = low.match(/\blot\s*(\d+[a-z]?)\b/) || squish.match(/lot(\d{2,5}[a-z]?)/);
  if (lotM) {
    const lot = lotM[1];
    const hit = addrs.find(a => { const s = norm(a.street); return s.includes('lot ' + lot) || s.split(/[\s,()]+/).includes(lot); });
    if (hit) { result = hit.id; via = 'lot'; }
  }
  if (result == null) {
    const toks = new Set(low.split(/[^a-z0-9]+/).filter(Boolean));
    let best = null, ties = 0;
    for (const a of addrs) {
      const s = norm(a.street);
      if (!s) continue;
      const lotA = (s.match(/^lot\s*(\d+[a-z]?)\b/) || [])[1];
      const rest = s.replace(/^lot\s*\w+,?\s*/, '').trim();
      const houseNum = (rest.match(/\d+/) || [])[0];
      const nameTok = rest.replace(/^[()\d\s]+/, '').split(/\s+/)[0];
      let score = 0;
      if (nameTok && nameTok.length >= 4 && (toks.has(nameTok) || squish.includes(nameTok))) score += 2;
      if (lotA && (toks.has(lotA) || squish.includes('lot' + lotA))) score += 2;
      if (houseNum && toks.has(houseNum)) score += 1;
      if (score < 2) continue;
      if (!best || score > best.score) { best = { id: a.id, score }; ties = 1; }
      else if (score === best.score) ties++;
    }
    if (best && ties === 1) { result = best.id; via = 'score'; }
  }
  const street = result != null ? addrs.find(a => a.id === result).street : 'NULL';
  return via + ':' + street;
}

const cases = [
  ['filename only (Kobi)',        '', '(1st_Inspection)_1403_20_Kobi_Street_Tarneit.pdf'],
  ['filename only (Lahar)',       '', '(1st_Inspection)_1933_19_Lahar_Road_Tarneit.pdf'],
  ['filename only (Woodlawn)',    '', '(1st_Inspection)_525_23_Woodlawn_Avenue_Wyndham_Vale.pdf'],
  ['fragmented text, no file',    'L ot 14 03 - 2 0 Ko bi Stre et T arn eit Building Inspection', null],
  ['clean text, no file',         'Lot 1933 - 19 Lahar Road Tarneit', null],
  ['garbage text + filename',     'x y z nothing useful here', '(2nd_Inspection)_1403_20_Kobi_Street_Tarneit.pdf'],
  ['no signal at all',            'completely unrelated text', 'random.pdf'],
];
for (const [label, text, fn] of cases) console.log(label.padEnd(28), '->', matchAddressFromText(text, fn));
