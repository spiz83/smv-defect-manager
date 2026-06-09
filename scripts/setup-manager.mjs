// Set up the manager login: svladimiroski@hotmail.com / admin!983, confirmed,
// with profiles.role = 'manager'. The qwqw/qwqw client-side alias points here.
//
// SECURITY: reads the Supabase Management PAT from the environment so the secret
// never has to be pasted into chat. Run it yourself:
//
//   PowerShell:
//     $env:SUPABASE_ACCESS_TOKEN="<your-pat>"; node scripts/setup-manager.mjs
//   bash:
//     SUPABASE_ACCESS_TOKEN="<your-pat>" node scripts/setup-manager.mjs
//
// Idempotent: safe to re-run.

const REF    = 'cubwwnvzmeydyixhetfb';
const BASE   = `https://${REF}.supabase.co`;
const LOCAL  = 'svladimiroski';          // the manager's username (local-part)
// Canonical-account preference. CH Tracker (the established manager app) uses
// @creationhomes.com.au, so that's the real identity; the others are fallbacks.
const DOMAIN_PREF = ['creationhomes.com.au', 'hotmail.com', 'cht.local'];
const PASS   = 'admin!983';
const ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN1Ynd3bnZ6bWV5ZHlpeGhldGZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NzU3MDksImV4cCI6MjA5NDE1MTcwOX0.CkeKGBkvNE4fAUl-WDSEb8s3JLqPul2uiAodffLn2nY';

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) {
  console.error('ERROR: SUPABASE_ACCESS_TOKEN is not set. See the header of this file.');
  process.exit(1);
}

const die = (msg, extra) => { console.error('FAILED:', msg); if (extra) console.error(extra); process.exit(1); };

// 1. Get the service_role key via the Management API.
console.log('1/5  Fetching service_role key via Management API…');
let keysRes = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${PAT}` }
});
if (!keysRes.ok) die(`Management API api-keys returned HTTP ${keysRes.status}`, await keysRes.text());
const keys = await keysRes.json();
const service = (Array.isArray(keys) ? keys : []).find(k => k.name === 'service_role');
const SERVICE = service && (service.api_key || service.secret || service.value);
if (!SERVICE) die('Could not find a service_role key in the Management API response.', JSON.stringify(keys).slice(0, 400));
const admin = (path, opts = {}) => fetch(`${BASE}${path}`, {
  ...opts,
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
});

// 2. Discover every svladimiroski* account, then pick the canonical one.
console.log('2/5  Listing users to find all "' + LOCAL + '" accounts…');
const matches = [];
for (let page = 1; page <= 30; page++) {
  const r = await admin(`/auth/v1/admin/users?page=${page}&per_page=200`);
  if (!r.ok) die(`admin list users HTTP ${r.status}`, await r.text());
  const body = await r.json();
  const users = body.users || body;
  if (!users.length) break;
  for (const u of users) {
    const e = (u.email || '').toLowerCase();
    if (e.split('@')[0] === LOCAL || e.includes(LOCAL)) matches.push(u);
  }
}
console.log('     found:', matches.length ? matches.map(u => `${u.email}${u.email_confirmed_at ? '' : ' (UNCONFIRMED)'}`).join(', ') : '(none)');

const byDomain = (dom) => matches.find(u => (u.email || '').toLowerCase() === `${LOCAL}@${dom}`);
let user = null, EMAIL = null;
for (const dom of DOMAIN_PREF) { const u = byDomain(dom); if (u) { user = u; EMAIL = u.email.toLowerCase(); break; } }
if (!user && matches.length) { user = matches[0]; EMAIL = user.email.toLowerCase(); }   // any svladimiroski* match
if (!EMAIL) EMAIL = `${LOCAL}@${DOMAIN_PREF[0]}`;   // none exist → create on the manager domain
const dupes = matches.filter(u => u.id !== (user && user.id));

// 3. Create the canonical user if missing; otherwise set password + confirm.
if (!user) {
  console.log('3/5  No account — creating', EMAIL, '(confirmed)…');
  const r = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true, user_metadata: { full_name: 'Spiro Vladimiroski' } })
  });
  if (!r.ok) die(`admin create user HTTP ${r.status}`, await r.text());
  user = await r.json();
} else {
  console.log('3/5  Canonical account =', EMAIL, '(id', user.id + ') — setting password + confirming…');
  const r = await admin(`/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify({ password: PASS, email_confirm: true })
  });
  if (!r.ok) die(`admin update user HTTP ${r.status}`, await r.text());
  user = await r.json();
}

// 4. Ensure profiles.role = 'manager' (service_role bypasses RLS).
console.log('4/5  Setting profiles.role = manager…');
let pr = await admin(`/rest/v1/profiles?id=eq.${user.id}`, {
  method: 'PATCH', headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ role: 'manager' })
});
let prBody = await pr.json().catch(() => null);
if (!pr.ok) die(`profiles PATCH HTTP ${pr.status}`, JSON.stringify(prBody));
if (!Array.isArray(prBody) || !prBody.length) {
  // No profile row yet — insert one.
  const ins = await admin('/rest/v1/profiles', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ id: user.id, email: EMAIL, full_name: 'Spiro Vladimiroski', role: 'manager' })
  });
  if (!ins.ok) die(`profiles INSERT HTTP ${ins.status}`, await ins.text());
}

// 5. Verify by signing in with the public anon key.
console.log('5/5  Verifying sign-in with', EMAIL, '…');
const signin = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS })
});
const sb = await signin.json();
if (!sb.access_token) die('sign-in verification failed', JSON.stringify(sb));

console.log('\n✅ DONE. Canonical manager login is live:');
console.log('   email : ' + EMAIL + '   <-- both apps\' qwqw alias will point here');
console.log('   pass  : ' + PASS);
console.log('   role  : manager');
console.log('   id    : ' + user.id);
if (dupes.length) {
  console.log('\n⚠️  Other svladimiroski* accounts exist (NOT touched). Consider removing:');
  for (const d of dupes) console.log('     - ' + d.email + '  (id ' + d.id + ')');
}
console.log('\nNext: wire the qwqw/qwqw client-side alias -> ' + EMAIL + ' into both apps.');
