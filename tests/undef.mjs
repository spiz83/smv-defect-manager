// Static "is every identifier actually defined?" scan over the app's inline
// script + cloud-sync.js. This is the class of bug that shipped as
// "Save changes does nothing" — a ReferenceError at click time.
import { Linter } from 'eslint';
import globals from 'globals';
import fs from 'node:fs';

// Paths resolve from this file, so the suite runs from any checkout.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __here = dirname(fileURLToPath(import.meta.url));
const REPO = join(__here, '..');
const ARTIFACTS = join(__here, 'artifacts');


const html = fs.readFileSync(join(REPO,'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
// Offset of each block so we can report real line numbers.
const sources = blocks.map(m => ({
  name: 'index.html <script>',
  code: m[1],
  line0: html.slice(0, m.index).split('\n').length,
}));
sources.push({ name: 'cloud-sync.js', code: fs.readFileSync(join(REPO,'cloud-sync.js'), 'utf8'), line0: 0 });

// Everything the app legitimately gets from elsewhere: the browser, the other
// script block, and the two CDN libraries.
const extra = ['db', 'render', 'state', 'showToast', 'supabase', 'pdfjsLib', 'jspdf', 'html2canvas', 'CloudSync', 'CloudPhotos', 'CloudJobs', 'CloudAI', 'CloudLearning', 'CloudReports', 'SUPABASE_CONFIG', 'isBusyEditing'];
const linter = new Linter();
let total = 0;
for (const s of sources) {
  const msgs = linter.verify(s.code, {
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'script',
      globals: { ...globals.browser, ...globals.es2021, ...Object.fromEntries(extra.map(k => [k, 'writable'])) },
    },
    rules: { 'no-undef': 'error' },
  });
  // Anything DECLARED in one block is visible to the others (same realm), so
  // collect declarations across all blocks and forgive those.
  for (const m of msgs) {
    const name = (m.message.match(/'([^']+)' is not defined/) || [])[1];
    if (!name) continue;
    const declaredElsewhere = sources.some(o => o !== s &&
      new RegExp('(?:function|const|let|var|class)\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(o.code));
    if (declaredElsewhere) continue;
    console.log(`${s.name}:${s.line0 + m.line} — ${name} is not defined`);
    total++;
  }
}
console.log(total ? `\n${total} undefined identifier(s)` : '\nNo undefined identifiers');
process.exit(total ? 1 : 0);
