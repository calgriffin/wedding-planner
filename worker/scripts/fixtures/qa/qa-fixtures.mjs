// QA fixtures for check-move (#3, PR #48). Each case = base repo (BASE) + working-tree files.
// kind 'exploit': check-move MUST fail. kind 'benign': check-move MUST pass.
// Usage: node qa-fixtures.mjs   (run from worker/; uses scripts/check-move.mjs --worker-dir <fixture>)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const CHECK = path.resolve('scripts/check-move.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fixtures-'));
const worker = path.join(root, 'worker');
const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=qa', '-c', 'user.email=qa@example.invalid', ...a], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (files) => { for (const [p, c] of Object.entries(files)) { const f = path.join(worker, p); if (c === null) { fs.rmSync(f, { force: true }); continue; } fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); } };

const AUDIT = '  globalThis.__audit = (globalThis.__audit || 0) + 1;';
const PAGE_TEMPLATE = ['  return `<h1>${escHtml(name)}</h1>', '', '', '<p>hello</p>', '    ', '    <pre>', '  keep</pre>`;'];
const indexSrc = ({ imports, page = true, escHtml = true, guardAudit = true, pageTemplate = PAGE_TEMPLATE } = {}) => [
  ...(imports || ["import { json } from './lib/http.js';"]), '',
  ...(escHtml ? ['// Escapes text for HTML (all five specials).', 'function escHtml(s) {', "  return String(s).replace(/[&<>\"']/g, (c) => `&#${c.charCodeAt(0)};`);", '}', ''] : []),
  ...(page ? ['function page(name) {', ...pageTemplate, '}', ''] : []),
  'function guard(role) {', "  if (role !== 'admin') {", '    return false;', '  }', ...(guardAudit ? [AUDIT] : []), '  return true;', '}', '',
  "export default { fetch() { return json({ p: page('x'), g: guard('admin') }); } };", '',
].join('\n');
export const BASE = {
  'src/lib/http.js': ['export function json(d) { return new Response(JSON.stringify(d)); }', 'export function ok(d) { return json({ success: true, data: d }); }', 'export function now() { return new Date().toISOString(); }', ''].join('\n'),
  'src/index.js': indexSrc(),
  'wrangler.toml': 'name = "x"\ncompatibility_date = "2026-11-13"\n',
  'package.json': '{ "name": "w", "dependencies": { "a": "1.0.0" } }\n',
};
const TEXT_HEADER = '// Text helpers (moved verbatim from index.js, #3).';
const textModule = ({ header = TEXT_HEADER, imports = [], extra = '' } = {}) => [header, '', ...imports, ...(imports.length ? [''] : []), '// Escapes text for HTML (all five specials).', 'export function escHtml(s) {', "  return String(s).replace(/[&<>\"']/g, (c) => `&#${c.charCodeAt(0)};`);", '}', ''].join('\n') + extra;
const pageModule = (tpl = PAGE_TEMPLATE) => [TEXT_HEADER, '', "import { escHtml } from './text.js';", '', 'export function page(name) {', ...tpl, '}', ''].join('\n');
const IDX = (imports, o = {}) => indexSrc({ escHtml: false, imports, ...o });
const IMP = ["import { json } from './lib/http.js';", "import { escHtml } from './lib/text.js';"];
const MOVE = { 'src/lib/text.js': textModule(), 'src/index.js': IDX(IMP) };

export const CASES = [
  ['C0', 'benign', 'control: clean move (escHtml -> lib/text.js)', MOVE],
  ['C1', 'benign', 'control: escHtml and page() moved, templates untouched', { ...MOVE, 'src/lib/pages.js': pageModule(), 'src/index.js': IDX([...IMP, "import { page } from './lib/pages.js';"], { page: false }) }],
  ['H1', 'exploit', 'delete the audit line from unmoved guard(), re-add it as a top-level line at the end of lib/text.js', { ...MOVE, 'src/index.js': IDX(IMP, { guardAudit: false }), 'src/lib/text.js': textModule({ extra: AUDIT + '\n' }) }],
  ['H1b', 'exploit', 'same, but the line is re-added inside the moved function body', { ...MOVE, 'src/index.js': IDX(IMP, { guardAudit: false }), 'src/lib/text.js': textModule().replace("  return String(s)", AUDIT + "\n  return String(s)") }],
  ['H2', 'exploit', 'moved page(): blank-line run inside its template literal removed', { ...MOVE, 'src/lib/pages.js': pageModule(['  return `<h1>${escHtml(name)}</h1>', '<p>hello</p>', '    ', '    <pre>', '  keep</pre>`;']), 'src/index.js': IDX([...IMP, "import { page } from './lib/pages.js';"], { page: false }) }],
  ['H3', 'exploit', 'whitespace-only template line changed (4 -> 8 spaces) in UNMOVED code', { 'src/index.js': indexSrc({ pageTemplate: PAGE_TEMPLATE.map((l) => (l === '    ' ? '        ' : l)) }) }],
  ['H3b', 'exploit', 'blank lines deleted inside a template literal in UNMOVED code (no move)', { 'src/index.js': indexSrc({ pageTemplate: PAGE_TEMPLATE.filter((l) => l !== '') }) }],
  ['H4', 'exploit', "new src/evil.mjs + `import { pwn } from './evil.mjs'` in index.js", { ...MOVE, 'src/evil.mjs': 'globalThis.__pwn = 1;\nexport const pwn = 1;\n', 'src/index.js': IDX([...IMP, "import { pwn } from './evil.mjs';"]) }],
  ['H5', 'exploit', "new worker/evil.js (outside src/) + `import { pwn } from '../evil.js'`", { ...MOVE, 'evil.js': 'globalThis.__pwn = 1;\nexport const pwn = 1;\n', 'src/index.js': IDX([...IMP, "import { pwn } from '../evil.js';"]) }],
  ['H5b', 'exploit', "new src/x.cjs + `import { pwn } from './x.cjs'`", { ...MOVE, 'src/x.cjs': 'globalThis.__pwn = 1;\nexport const pwn = 1;\n', 'src/index.js': IDX([...IMP, "import { pwn } from './x.cjs';"]) }],
  ['H6a', 'exploit', 'clean move + wrangler.toml compatibility_date changed', { ...MOVE, 'wrangler.toml': 'name = "x"\ncompatibility_date = "2024-01-01"\n' }],
  ['H6b', 'exploit', 'clean move + dependency added in package.json', { ...MOVE, 'package.json': '{ "name": "w", "dependencies": { "a": "1.0.0", "evil": "9.9.9" } }\n' }],
  ['H6c', 'benign', 'clean move + README.md changed (allow-listed)', { ...MOVE, '../README.md': '# readme changed\n' }],
  ['H7', 'benign', 'multi-line import with a comment inside the braces', { ...MOVE, 'src/index.js': IDX(["import { json } from './lib/http.js';", 'import {', '  escHtml, // used by page()', "} from './lib/text.js';"]) }],
  ['H8', 'benign', 'module name written with an escape (./lib/\\u0074ext.js)', { ...MOVE, 'src/index.js': IDX(["import { json } from './lib/http.js';", "import { escHtml } from './lib/\\u0074ext.js';"]) }],
  ['H9', 'exploit', 'dynamic import() added in a moved module', { ...MOVE, 'src/lib/text.js': textModule({ extra: "const m = await import('./http.js');\n" }) }],
  ['H12', 'exploit', 'default parameter added to a moved signature', { ...MOVE, 'src/lib/text.js': textModule().replace('escHtml(s)', 'escHtml(s = globalThis.__pwn)') }],
  ['H13', 'exploit', 'homoglyph name in an import (Cyrillic e)', { ...MOVE, 'src/index.js': IDX(["import { json } from './lib/http.js';", "import { еscHtml } from './lib/text.js';"]) }],
  ['H20', 'exploit', '`/*` and `*/` lines hiding part of a moved body', { ...MOVE, 'src/lib/text.js': textModule().replace('  return String(s)', '  /*\n  return String(s)').replace('(c) => `&#${c.charCodeAt(0)};`);', '(c) => `&#${c.charCodeAt(0)};`);\n  */') }],
  ['H21', 'exploit', 'moved declaration reordered relative to another moved declaration (page before escHtml)', { ...MOVE, 'src/lib/text.js': [TEXT_HEADER, '', 'export function page(name) {', '  return name;', '}', '', textModule().split('\n').slice(2).join('\n')].join('\n') }],
  ['H22', 'exploit', 'a moved declaration duplicated into a second module', { ...MOVE, 'src/lib/text2.js': textModule() }],
  ['H23', 'exploit', 'unmoved declaration gets an extra statement at module end of index.js', { ...MOVE, 'src/index.js': IDX(IMP) + 'globalThis.__pwn = 1;\n' }],
  ['H24', 'exploit', 'trailing whitespace added to a moved line', { ...MOVE, 'src/lib/text.js': textModule().replace('export function escHtml(s) {', 'export function escHtml(s) { ') }],
  ['H25', 'exploit', 'U+2028 inside a template literal of an unmoved function', { 'src/index.js': indexSrc({ pageTemplate: PAGE_TEMPLATE.map((l, i) => (i === 3 ? l + String.fromCharCode(0x2028) : l)) }) }],
  ['H26', 'exploit', 'moved declaration changes `function` to `async function`', { ...MOVE, 'src/lib/text.js': textModule().replace('export function escHtml', 'export async function escHtml') }],
  ['H27', 'exploit', 'new `export { escHtml as escAlias }`', { ...MOVE, 'src/lib/text.js': textModule() + 'export { escHtml as escAlias };\n' }],
  ['H28', 'exploit', "import alias swap in index.js (json as ok, ok as json)", { ...MOVE, 'src/index.js': IDX(["import { json as ok, ok as json } from './lib/http.js';", "import { escHtml } from './lib/text.js';"]) }],
  ['D1', 'exploit', 'block comment /* eslint-disable no-undef */ added at the top of a moved module (turns the lint guard off)', { ...MOVE, 'src/lib/text.js': '/* eslint-disable no-undef */\n' + textModule() }],
  ['D2', 'exploit', '// eslint-disable-next-line no-undef comment added between nodes in index.js', { ...MOVE, 'src/index.js': IDX(IMP).replace('function guard(role) {', '// eslint-disable-next-line no-undef\nfunction guard(role) {') }],
  ['D3', 'benign', 'plain comment line added between two unmoved nodes in index.js', { ...MOVE, 'src/index.js': IDX(IMP).replace('function guard(role) {', '// note\nfunction guard(role) {') }],
  ['D4', 'exploit', 'scripts/route-baseline.json edited in a move PR (hides a lost route)', { ...MOVE, 'scripts/route-baseline.json': '{"total":0}\n' }],
  ['D5', 'exploit', 'scripts/test-local.mjs deleted in a move PR (a test silently removed)', { ...MOVE, 'test-local.mjs': null }],
  ['D6', 'exploit', '/*#__PURE__*/ annotation added inside a moved node', { ...MOVE, 'src/lib/text.js': textModule().replace('String(s)', '/*#__PURE__*/ String(s)') }],
  ['D7', 'exploit', '"use strict" directive added to index.js', { ...MOVE, 'src/index.js': '"use strict";\n' + IDX(IMP) }],
  ['D8', 'exploit', 'comment-only change that hides a sourceMappingURL: //# sourceMappingURL=http://evil/x.map appended to a moved module', { ...MOVE, 'src/lib/text.js': textModule() + '//# sourceMappingURL=http://evil.example/x.map\n' }],
  ['H29', 'exploit', 'code appended on an import line', { ...MOVE, 'src/index.js': IDX(["import { json } from './lib/http.js';", "import { escHtml } from './lib/text.js'; globalThis.__pwn = 1;"]) }],
];

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  git('init', '-q'); git('config', 'core.autocrlf', 'false'); write(BASE); git('add', '-A'); git('commit', '-q', '-m', 'base');
  const baseRef = git('rev-parse', 'HEAD').trim();
  let bad = 0;
  for (const [id, kind, desc, files] of CASES) {
    git('reset', '-q', '--hard', baseRef); git('clean', '-q', '-fd');
    const readme = path.join(root, 'README.md');
    const f2 = { ...files }; if ('../README.md' in f2) { fs.writeFileSync(readme, f2['../README.md']); delete f2['../README.md']; }
    write(f2);
    const r = spawnSync(process.execPath, [CHECK, baseRef, '--worker-dir', worker], { encoding: 'utf8' });
    const out = `${r.stdout}${r.stderr}`;
    const passed = r.status === 0;
    const ok = kind === 'exploit' ? !passed : passed;
    if (!ok) bad++;
    const why = passed ? '' : ' -> ' + (out.split('\n').find((l) => /^\s{8}\S/.test(l)) || '').trim().slice(0, 100);
    console.log(`${ok ? 'ok  ' : 'BAD '} ${id.padEnd(4)} ${kind === 'exploit' ? (passed ? 'BYPASS (passes)' : 'caught') : (passed ? 'passes' : 'FALSE POSITIVE')}  ${desc}${why}`);
  }
  console.log(`\n${CASES.length} cases, ${bad} unexpected`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}
