// Run a .sql file against the project via the Supabase Management API.
//   env: SUPA_PAT (personal access token), SUPA_REF (project ref)
//   arg: path to .sql file
import { readFileSync } from 'node:fs';

const PAT = process.env.SUPA_PAT;
const REF = process.env.SUPA_REF;
const file = process.argv[2];
if (!PAT || !REF || !file) {
  console.error('Usage: SUPA_PAT=.. SUPA_REF=.. node scripts/run-sql.mjs <file.sql>');
  process.exit(1);
}
const query = readFileSync(file, 'utf8');
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query })
});
const text = await r.text();
console.log('[HTTP ' + r.status + ']');
console.log(text);
if (!r.ok) process.exit(1);
