// Candidate finder — NOT a licence to delete. In this app most top-level
// functions are called from HTML on* attribute STRINGS, which no analyser can
// see, so every hit here is cross-checked against the raw markup before it
// counts as a candidate at all.
import { Linter } from 'eslint';
import globals from 'globals';
import fs from 'node:fs';

// Paths resolve from this file, so the suite runs from any checkout.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ARTIFACTS = join(__here, 'artifacts');


const R = REPO;
const html = fs.readFileSync(join(R,'index.html'), 'utf8');
const cs = fs.readFileSync(join(R,'cloud-sync.js'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const sources = blocks.map(m => ({ name: 'index.html', code: m[1], line0: html.slice(0, m.index).split('\n').length }));
sources.push({ name: 'cloud-sync.js', code: cs, line0: 0 });

// Everything that could reference a name outside the JS the linter sees.
const allText = html + '\n' + cs + '\n' +
  fs.readdirSync(R).filter(f => /\.(md|json|webmanifest|html|js)$/.test(f))
    .map(f => { try { return fs.readFileSync(join(R, f), 'utf8'); } catch (e) { return ''; } }).join('\n');
// Just the HTML attribute handlers — the trap.
const attrs = (html.match(/\son[a-z]+="[^"]*"/g) || []).join('\n');

const linter = new Linter();
const rows = [];
for (const s of sources) {
  const msgs = linter.verify(s.code, {
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, ...globals.es2021 } },
    rules: { 'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }] },
  });
  for (const m of msgs) {
    const name = (m.message.match(/'([^']+)' is (?:defined but never used|assigned a value but never used)/) || [])[1];
    if (!name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // How many times does the name appear ANYWHERE, minus its declaration?
    const uses = (allText.match(new RegExp('\\b' + esc + '\\b', 'g')) || []).length;
    const inAttr = new RegExp('\\b' + esc + '\\b').test(attrs);
    const asString = new RegExp("['\"`][^'\"`]*\\b" + esc + "\\b").test(allText);
    rows.push({ file: s.name, line: s.line0 + m.line, name, uses, inAttr, asString });
  }
}
rows.sort((a, b) => a.uses - b.uses || a.name.localeCompare(b.name));
console.log(`${rows.length} candidate(s) from no-unused-vars\n`);
console.log('uses  attr?  str?  where                      name');
for (const r of rows) {
  console.log(
    String(r.uses).padStart(4) + '  ' +
    (r.inAttr ? ' YES ' : '  -  ') + '  ' +
    (r.asString ? 'YES ' : ' -  ') + '  ' +
    (r.file + ':' + r.line).padEnd(24) + '  ' + r.name);
}
console.log('\nattr?=referenced from an HTML on* handler  str?=appears inside a string literal');
console.log('Either one YES means DO NOT DELETE without reading the call site.');
