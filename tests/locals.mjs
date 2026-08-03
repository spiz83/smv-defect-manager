// Precise: which flagged names occur EXACTLY ONCE in the app's own source (i.e.
// only their declaration) and appear in no HTML handler? Those are unused
// locals — the one category static analysis can be trusted on here.
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
const app = html + '\n' + cs;
const attrs = (html.match(/\son[a-z]+="[^"]*"/g) || []).join('\n');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const srcs = blocks.map(m => ({ f: 'index.html', code: m[1], l0: html.slice(0, m.index).split('\n').length }));
srcs.push({ f: 'cloud-sync.js', code: cs, l0: 0 });
const linter = new Linter();
const out = [];
for (const s of srcs) {
  for (const m of linter.verify(s.code, {
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, ...globals.es2021 } },
    rules: { 'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }] },
  })) {
    const name = (m.message.match(/'([^']+)' is /) || [])[1];
    if (!name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const n = (app.match(new RegExp('\\b' + esc + '\\b', 'g')) || []).length;
    if (n !== 1) continue;                                   // referenced somewhere else
    if (new RegExp('\\b' + esc + '\\b').test(attrs)) continue; // live handler
    const line = (s.f === 'index.html' ? html : cs).split('\n')[s.l0 + m.line - 1];
    out.push({ where: s.f + ':' + (s.l0 + m.line), name, src: (line || '').trim() });
  }
}
console.log(`${out.length} name(s) occurring exactly ONCE in the app source:\n`);
out.forEach(o => console.log(`${o.where.padEnd(22)} ${o.name.padEnd(20)} ${o.src.slice(0, 96)}`));
