// One-time migration: load a DefectTracker backup JSON into Supabase.
// Creates (or signs in) the owner account, then inserts trades, contractors,
// contractor<->trade links, addresses and defects into that user's workspace.
//
// Secrets are passed via env so they never live in the repo:
//   SUPA_URL, SUPA_ANON, SUPA_EMAIL, SUPA_PASSWORD, BACKUP_PATH
//
// Uses the public anon key + a real user session, so Row Level Security is
// fully respected (we insert exactly as the logged-in owner would).

import { readFileSync } from 'node:fs';

const URL = process.env.SUPA_URL;
const ANON = process.env.SUPA_ANON;
const EMAIL = process.env.SUPA_EMAIL;
const PASSWORD = process.env.SUPA_PASSWORD;
const BACKUP = process.env.BACKUP_PATH;

if (!URL || !ANON || !EMAIL || !PASSWORD || !BACKUP) {
  console.error('Missing env: SUPA_URL, SUPA_ANON, SUPA_EMAIL, SUPA_PASSWORD, BACKUP_PATH');
  process.exit(1);
}

const authHeaders = (token) => ({
  'apikey': ANON,
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
});

async function signUpOrIn() {
  // Try sign up first
  let r = await fetch(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, data: { full_name: 'DefFixer Owner' } })
  });
  let j = await r.json();
  if (j.access_token) { console.log('• Created new account and signed in.'); return j.access_token; }

  // Maybe the user already exists, or email-confirmation autoconfirmed without a session.
  r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  });
  j = await r.json();
  if (j.access_token) { console.log('• Signed in to existing account.'); return j.access_token; }

  console.error('\nCould not obtain a session. Server said:');
  console.error(JSON.stringify(j, null, 2));
  if (/confirm/i.test(JSON.stringify(j))) {
    console.error('\n>> Email confirmation is still ON. Turn it OFF (Authentication →');
    console.error('   Email provider → disable "Confirm email" → Save) and re-run.');
  }
  process.exit(1);
}

async function getWorkspace(token) {
  const r = await fetch(`${URL}/rest/v1/workspace_members?select=workspace_id&limit=1`, {
    headers: authHeaders(token)
  });
  const j = await r.json();
  if (!Array.isArray(j) || !j.length) {
    console.error('No workspace found for user:', JSON.stringify(j));
    process.exit(1);
  }
  return j[0].workspace_id;
}

async function insert(token, table, rows, returning = 'id,legacy_id') {
  if (!rows.length) return [];
  const r = await fetch(`${URL}/rest/v1/${table}?select=${returning}`, {
    method: 'POST',
    headers: { ...authHeaders(token), Prefer: 'return=representation' },
    body: JSON.stringify(rows)
  });
  if (!r.ok) {
    console.error(`Insert into ${table} failed [${r.status}]:`, await r.text());
    process.exit(1);
  }
  return r.json();
}

async function main() {
  const data = JSON.parse(readFileSync(BACKUP, 'utf8'));
  const trades = data.trades || [];
  const contractors = data.contractors || [];
  const addresses = data.addresses || [];
  const defects = data.defects || [];
  console.log(`Backup: ${trades.length} trades, ${contractors.length} contractors, ` +
              `${addresses.length} addresses, ${defects.length} defects`);

  const token = await signUpOrIn();
  const W = await getWorkspace(token);
  console.log('• Workspace:', W);

  // Guard against double-migration
  const existing = await fetch(`${URL}/rest/v1/dm_defects?select=id&limit=1`, { headers: authHeaders(token) });
  const existingRows = await existing.json();
  if (Array.isArray(existingRows) && existingRows.length) {
    console.error('\n>> This workspace ALREADY has defects. Aborting to avoid duplicates.');
    process.exit(1);
  }

  // Trades
  const tRows = trades.map(t => ({ workspace_id: W, legacy_id: t.id, name: t.name, code: t.code || null }));
  const tOut = await insert(token, 'dm_trades', tRows);
  const tradeMap = {}; tOut.forEach(r => tradeMap[r.legacy_id] = r.id);
  console.log(`✓ trades: ${tOut.length}`);

  // Contractors
  const cRows = contractors.map(c => ({
    workspace_id: W, legacy_id: c.id, name: c.name,
    email: c.email || null, phone: c.phone || null
  }));
  const cOut = await insert(token, 'dm_contractors', cRows);
  const contractorMap = {}; cOut.forEach(r => contractorMap[r.legacy_id] = r.id);
  console.log(`✓ contractors: ${cOut.length}`);

  // Addresses
  const aRows = addresses.map(a => ({
    workspace_id: W, legacy_id: a.id, street: a.street || null,
    suburb: a.suburb || null, property_number: a.propertyNumber || null
  }));
  const aOut = await insert(token, 'dm_addresses', aRows);
  const addressMap = {}; aOut.forEach(r => addressMap[r.legacy_id] = r.id);
  console.log(`✓ addresses: ${aOut.length}`);

  // Contractor <-> Trade links
  const linkRows = [];
  contractors.forEach(c => {
    (c.tradeIds || []).forEach(tid => {
      if (contractorMap[c.id] && tradeMap[tid]) {
        linkRows.push({ contractor_id: contractorMap[c.id], trade_id: tradeMap[tid] });
      }
    });
  });
  if (linkRows.length) {
    await insert(token, 'dm_contractor_trades', linkRows, 'contractor_id');
  }
  console.log(`✓ contractor-trade links: ${linkRows.length}`);

  // Defects
  const dRows = defects.map(d => ({
    workspace_id: W, legacy_id: d.id,
    address_id: addressMap[d.addressId] || null,
    contractor_id: contractorMap[d.contractorId] || null,
    description: d.description || '(no description)',
    status: d.completed ? 'completed' : 'open',
    unassigned: false
  }));
  const dOut = await insert(token, 'dm_defects', dRows, 'id');
  console.log(`✓ defects: ${dOut.length}`);

  console.log('\n✅ Migration complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
