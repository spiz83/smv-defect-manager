// Admin: mark a user's email as confirmed (so password login works even with
// "Confirm email" still enabled). Uses the service_role key. One-time helper.
//   env: SUPA_URL, SUPA_SERVICE, SUPA_EMAIL

const URL = process.env.SUPA_URL;
const SERVICE = process.env.SUPA_SERVICE;
const EMAIL = (process.env.SUPA_EMAIL || '').toLowerCase();

if (!URL || !SERVICE || !EMAIL) {
  console.error('Missing env: SUPA_URL, SUPA_SERVICE, SUPA_EMAIL');
  process.exit(1);
}
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

const r = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: H });
const j = await r.json();
const users = j.users || j;
const u = users.find(x => (x.email || '').toLowerCase() === EMAIL);
if (!u) { console.error('User not found for', EMAIL); process.exit(1); }
console.log('• Found user', u.id, '| confirmed_at:', u.email_confirmed_at || '(none)');

if (u.email_confirmed_at) { console.log('Already confirmed.'); process.exit(0); }

const r2 = await fetch(`${URL}/auth/v1/admin/users/${u.id}`, {
  method: 'PUT', headers: H, body: JSON.stringify({ email_confirm: true })
});
const j2 = await r2.json();
if (!r2.ok) { console.error('Confirm failed:', JSON.stringify(j2)); process.exit(1); }
console.log('✓ Email confirmed for', j2.email, '| confirmed_at:', j2.email_confirmed_at);
