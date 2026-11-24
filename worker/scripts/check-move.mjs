#!/usr/bin/env node
/**
 * Verbatim move checker for the index.js split (#3).
 *
 *   node scripts/check-move.mjs [baseRef] [--worker-dir <dir>]   (default: origin/main)
 *
 * Compares the working tree with baseRef, by top-level AST node (acorn), not
 * by line. A pure move must satisfy all of:
 *
 * Code (every top-level statement other than an import/export statement):
 *  - index.js keeps its other nodes byte for byte, in their base order; the
 *    nodes it lost are the "moved out" set;
 *  - a module that exists in the base keeps every base node byte for byte, in
 *    order (an `export ` prefix may be added or dropped); its extra nodes,
 *    and every node of a new module, are the "moved in" set;
 *  - moved out == moved in, as a multiset of exact node source text
 *    (whitespace and blank lines inside templates included), and each
 *    module's moved-in nodes keep their base order. The only change allowed
 *    on a moved node is an `export ` prefix (exactly "export ", nothing else).
 * Comments (top level, outside any node) move as a multiset too; a new module
 * may start with a header (its first block of // lines on consecutive lines).
 *
 * Import/export statements:
 *  - every one, in every file, is the only content on its line(s);
 *  - a statement NEW in a file (not byte-identical to one in the file's base
 *    version) may only be a plain named import of names the target module
 *    exports, where the target is a .js module under src/ that this check
 *    scans (not assets.js, nothing outside src/, no .mjs/.cjs); a package
 *    import of a name the base already imports from that package; an
 *    `export { x }` without alias; or, in index.js only, a side-effect import
 *    of a src/routes/ or src/pages/ module (route registration).
 *
 * Files:
 *  - no file under src/ contains U+2028, U+2029 or a bare CR (each ends a //
 *    comment in JS, so a comment could hide code);
 *  - every path changed since baseRef (tracked or untracked) is a
 *    worker/src/**\/*.js module, or allow-listed: worker/scripts/**,
 *    worker/docs/**, worker/test-*.mjs, README.md. wrangler.toml, package
 *    files, migrations, the frontend and everything else fail;
 *  - no worker/scripts/*baseline*.json changes (a baseline is re-recorded in
 *    its own non-split PR);
 *  - nothing outside src/ is deleted (a test or script removed would drop a
 *    guard); src/ code leaves only by the node rules above.
 * Comments may not be added between unmoved nodes in index.js, by design: a
 * comment such as `// eslint-disable-next-line` changes what the guards see.
 *
 * Every module that gains moved code must be loaded from index.js, directly
 * or through other modules (a route module whose import was dropped would
 * silently register nothing: QA R1).
 *
 * Self-test: scripts/test-check-move.mjs (npm test suite "move-selftest").
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

// --worker-dir <dir> points the check at another checkout's worker/ (used by
// the self-test on fixture repos).
const args = process.argv.slice(2);
const wdAt = args.indexOf('--worker-dir');
const WORKER_DIR = wdAt >= 0 ? path.resolve(args.splice(wdAt, 2)[1]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(WORKER_DIR, 'src');
const base = args[0] || 'origin/main';
const git = (...a) => execFileSync('git', a, { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
const REPO_ROOT = git('rev-parse', '--show-toplevel').trim();
const WORKER_PREFIX = path.relative(REPO_ROOT, WORKER_DIR).split(path.sep).join('/'); // e.g. "worker"
const rel = (p) => path.relative(WORKER_DIR, p).split(path.sep).join('/');
const norm = (s) => s.replace(/\r\n/g, '\n');
const first = (s) => JSON.stringify(s.split('\n')[0].slice(0, 100));

function listSources(dir = SRC) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(p));
    else if (e.name.endsWith('.js') && p !== path.join(SRC, 'assets.js')) out.push(p);
  }
  return out;
}
function baseFiles() {
  const out = git('ls-tree', '-r', '--name-only', base, '--', 'src');
  return out.split('\n').filter((f) => f.endsWith('.js') && f !== 'src/assets.js').map((f) => path.join(WORKER_DIR, f));
}
function baseContent(file) {
  try { return git('show', `${base}:${WORKER_PREFIX ? `${WORKER_PREFIX}/` : ''}${rel(file)}`); } catch { return null; }
}

const problems = [];
const SOURCES = new Set(listSources());

// ---- files: hidden line terminators, changed paths --------------------------
// Built from char codes so this file itself never contains them.
const HIDDEN_TERMINATOR = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]|${String.fromCharCode(13)}(?!${String.fromCharCode(10)})`);
(function scanTerminators(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scanTerminators(p); continue; }
    const s = fs.readFileSync(p, 'utf8');
    const m = HIDDEN_TERMINATOR.exec(s);
    if (m) problems.push(`${rel(p)}:${s.slice(0, m.index).split('\n').length}: contains U+${m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')} (a hidden JS line terminator: U+2028, U+2029 and a bare CR are not allowed in src/)`);
  }
})(SRC);

{
  const fromRoot = (...a) => execFileSync('git', a, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
  const changed = [...new Set([...fromRoot('diff', '--name-only', '--no-renames', '-z', base, '--'), ...fromRoot('ls-files', '--others', '--exclude-standard', '-z')])].sort();
  const P = WORKER_PREFIX ? `${WORKER_PREFIX}/` : '';
  const allowed = (p) =>
    (p.startsWith(`${P}src/`) && p.endsWith('.js')) ||
    p.startsWith(`${P}scripts/`) || p.startsWith(`${P}docs/`) ||
    new RegExp(`^${P.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}test-[^/]+\\.mjs$`).test(p) ||
    p === 'README.md';
  for (const p of changed) if (!allowed(p)) problems.push(`${p}: changed, but a split PR may only change worker/src/**/*.js, worker/scripts/, worker/docs/, worker/test-*.mjs and README.md`);
  // A recorded baseline (route sets, probe statuses, bundle size) is what the
  // other guards compare against: re-recording one goes in its own non-split PR.
  for (const p of changed) if (p.startsWith(`${P}scripts/`) && /baseline[^/]*\.json$/.test(p)) problems.push(`${p}: a baseline may not change in a split PR (re-record it in its own non-split PR)`);
  // Nothing may be deleted except by moving code out of src/ (a deleted src/
  // module is checked as code below); a deleted test or script would silently
  // drop a guard.
  for (const p of fromRoot('diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', base, '--')) {
    if (!p.startsWith(`${P}src/`)) problems.push(`${p}: deleted, but a split PR may only delete code by moving it out of src/`);
  }
}

// ---- parsing -----------------------------------------------------------------
const isPureStatement = (n) => n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || (n.type === 'ExportNamedDeclaration' && !n.declaration);

// A file as: pure import/export statements, code nodes (exact text, with the
// `export ` prefix split off), top-level comments, and its header comments.
function analyse(file, code, label) {
  const comments = [];
  let ast;
  try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: comments }); } catch (e) {
    problems.push(`${label}: does not parse (${e.message})`);
    return null;
  }
  const statements = [], nodes = [];
  for (const n of ast.body) {
    if (isPureStatement(n)) { statements.push({ node: n, text: code.slice(n.start, n.end) }); continue; }
    if (n.type === 'ExportNamedDeclaration') {
      const prefix = code.slice(n.start, n.declaration.start);
      if (prefix !== 'export ') problems.push(`${label}:${n.loc.start.line}: an exported declaration must be written \`export <declaration>\` (found ${JSON.stringify(prefix)})`);
      nodes.push({ text: code.slice(n.declaration.start, n.end), exported: true, line: n.loc.start.line });
    } else {
      nodes.push({ text: code.slice(n.start, n.end), exported: false, line: n.loc.start.line });
    }
  }
  const inNode = (c) => ast.body.some((n) => c.start >= n.start && c.end <= n.end);
  const top = comments.filter((c) => !inNode(c)).map((c) => ({ text: code.slice(c.start, c.end), line: code.slice(0, c.start).split('\n').length, block: c.type === 'Block' }));
  // Header: // comments on lines 1, 2, 3… with nothing else on those lines.
  const lines = code.split('\n');
  let header = 0;
  while (header < top.length && !top[header].block && top[header].line === header + 1 && lines[header].startsWith(top[header].text)) header++;
  return { statements, nodes, comments: top, header };
}

// ---- code nodes ----------------------------------------------------------------
const files = [...new Set([...SOURCES, ...baseFiles()])].sort();
const INDEX = path.join(SRC, 'index.js');
let movedOut = []; // texts, base order
const movedIn = {}; // file -> [texts]
let commentsOut = [], commentsIn = [];
const analysed = new Map(); // file -> { now, before }

const bag = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
const minus = (a, b) => { const left = bag(b); return a.filter((x) => { const n = left.get(x) || 0; if (n) { left.set(x, n - 1); return false; } return true; }); };

for (const f of files) {
  const exists = SOURCES.has(f);
  const beforeRaw = baseContent(f);
  const now = exists ? analyse(f, norm(fs.readFileSync(f, 'utf8')), rel(f)) : null;
  const before = beforeRaw === null ? null : analyse(f, norm(beforeRaw), `${rel(f)}@base`);
  analysed.set(f, { now, before, raw: exists ? norm(fs.readFileSync(f, 'utf8')) : '' });
  if ((exists && !now) || (beforeRaw !== null && !before)) continue;
  const label = rel(f);

  if (f === INDEX) {
    if (!now) { problems.push('src/index.js: deleted'); continue; }
    // index.js: current nodes must be a subsequence of the base nodes, unchanged.
    let j = 0;
    for (const b of before.nodes) {
      const c = now.nodes[j];
      if (c && c.text === b.text && c.exported === b.exported) { j++; continue; }
      movedOut.push(b.text);
    }
    for (; j < now.nodes.length; j++) problems.push(`src/index.js:${now.nodes[j].line}: top-level code that is new, edited or reordered (index.js may only lose nodes and gain imports): ${first(now.nodes[j].text)}`);
    commentsOut = minus(before.comments.map((c) => c.text), now.comments.map((c) => c.text));
    const added = minus(now.comments.map((c) => c.text), before.comments.map((c) => c.text));
    for (const t of added) problems.push(`src/index.js: added comment ${first(t)}`);
    continue;
  }

  if (!now) { problems.push(`${label}: deleted (only index.js may lose code)`); continue; }
  const ins = [];
  if (before) {
    // An existing module keeps every base node, unchanged and in order.
    let j = 0;
    for (const b of before.nodes) {
      let k = j;
      while (k < now.nodes.length && now.nodes[k].text !== b.text) k++;
      if (k === now.nodes.length) { problems.push(`${label}: base code removed or edited (only index.js may lose code): ${first(b.text)}`); continue; }
      for (; j < k; j++) ins.push(now.nodes[j].text);
      j = k + 1;
    }
    for (; j < now.nodes.length; j++) ins.push(now.nodes[j].text);
    const lost = minus(before.comments.map((c) => c.text), now.comments.map((c) => c.text));
    for (const t of lost) problems.push(`${label}: base comment removed or edited: ${first(t)}`);
    commentsIn.push(...minus(now.comments.map((c) => c.text), before.comments.map((c) => c.text)));
  } else {
    ins.push(...now.nodes.map((n) => n.text));
    commentsIn.push(...now.comments.slice(now.header).map((c) => c.text));
  }
  if (ins.length) movedIn[label] = ins;
}

// Moved out == moved in (multiset), and each module keeps the base order.
for (const t of minus(movedOut, Object.values(movedIn).flat())) problems.push(`removed from index.js but not found, unchanged, in any module: ${first(t)}`);
for (const t of minus(Object.values(movedIn).flat(), movedOut)) problems.push(`added to a module but not removed, unchanged, from index.js (edited or new code): ${first(t)}`);
for (const [file, texts] of Object.entries(movedIn)) {
  let i = 0;
  for (const t of texts) {
    while (i < movedOut.length && movedOut[i] !== t) i++;
    if (i === movedOut.length) { problems.push(`${file}: moved code is not in its original order (first out of order: ${first(t)})`); break; }
    i++;
  }
}
// Every module that gained moved code must be loaded from index.js (directly
// or through other modules): moved code nobody imports would silently stop
// running, e.g. a route module whose import was dropped (QA R1).
{
  const reachable = new Set();
  const stack = [INDEX];
  while (stack.length) {
    const f = stack.pop();
    if (reachable.has(f)) continue;
    reachable.add(f);
    const a = analysed.get(f);
    if (!a || !a.now) continue;
    for (const { node: n } of a.now.statements) {
      if (n.source && n.source.value.startsWith('.')) stack.push(path.resolve(path.dirname(f), n.source.value));
    }
  }
  for (const file of Object.keys(movedIn)) {
    if (!reachable.has(path.join(WORKER_DIR, file))) problems.push(`${file}: holds moved code but index.js never imports it (directly or through other modules), so that code would never run`);
  }
}
for (const t of minus(commentsOut, commentsIn)) problems.push(`comment removed from index.js but not found in any module: ${first(t)}`);
for (const t of minus(commentsIn, commentsOut)) problems.push(`comment added to a module but not removed from index.js: ${first(t)}`);

// ---- import/export statements ----------------------------------------------------
// Names a scanned module exports (null if it re-exports with `export *`).
function exportsOf(file) {
  const a = analysed.get(file);
  if (!a || !a.now) return null;
  const ast = acorn.parse(a.raw, { ecmaVersion: 'latest', sourceType: 'module' });
  const names = new Set();
  for (const n of ast.body) {
    if (n.type === 'ExportAllDeclaration') return null;
    if (n.type === 'ExportDefaultDeclaration') names.add('default');
    if (n.type !== 'ExportNamedDeclaration') continue;
    const d = n.declaration;
    if (d && d.type === 'VariableDeclaration') { for (const x of d.declarations) if (x.id.type === 'Identifier') names.add(x.id.name); }
    else if (d && d.id) names.add(d.id.name);
    for (const s of n.specifiers || []) names.add(s.exported.name ?? s.exported.value);
  }
  return names;
}

const basePackageImports = new Set();
for (const [, a] of analysed) {
  if (!a.before) continue;
  for (const { node: n } of a.before.statements) {
    if (n.type !== 'ImportDeclaration' || n.source.value.startsWith('.')) continue;
    for (const s of n.specifiers) if (s.type === 'ImportSpecifier') basePackageImports.add(`${n.source.value}|${s.imported.name ?? s.imported.value}`);
  }
}

function checkNewStatement(file, n, text) {
  const out = [];
  const where = `${rel(file)}:${n.loc.start.line}`;
  const show = JSON.stringify(text.slice(0, 100));
  if (n.type === 'ExportAllDeclaration') return [`${where}: new \`export *\` statement: ${show}`];
  if (n.type === 'ExportNamedDeclaration') {
    if (n.source) return [`${where}: new re-export statement: ${show}`];
    for (const s of n.specifiers) {
      const local = s.local.name ?? s.local.value, exported = s.exported.name ?? s.exported.value;
      if (local !== exported) out.push(`${where}: export alias \`${local} as ${exported}\`: ${show}`);
    }
    return out;
  }
  const source = n.source.value;
  if (source.startsWith('.')) {
    const target = path.resolve(path.dirname(file), source);
    if (!SOURCES.has(target)) return [`${where}: a relative import must name a .js module under src/ that check-move scans (not assets.js, nothing outside src/, no .mjs/.cjs): ${show}`];
    if (!n.specifiers.length) {
      if (file !== INDEX || !/^src\/(routes|pages)\/[^/]+\.js$/.test(rel(target))) out.push(`${where}: new side-effect import (only index.js may import a routes/ or pages/ module for its side effects): ${show}`);
      return out;
    }
    const exported = exportsOf(target);
    for (const s of n.specifiers) {
      if (s.type !== 'ImportSpecifier') { out.push(`${where}: new ${s.type === 'ImportDefaultSpecifier' ? 'default' : 'namespace'} import (only plain named imports may be added): ${show}`); continue; }
      const imported = s.imported.name ?? s.imported.value;
      if (imported !== s.local.name) { out.push(`${where}: import alias \`${imported} as ${s.local.name}\`: ${show}`); continue; }
      if (!exported) out.push(`${where}: cannot list the exports of ${rel(target)} to vouch for \`${imported}\`: ${show}`);
      else if (!exported.has(imported)) out.push(`${where}: \`${imported}\` is not exported by ${rel(target)}: ${show}`);
    }
    return out;
  }
  if (!n.specifiers.length) return [`${where}: new side-effect import of package '${source}': ${show}`];
  for (const s of n.specifiers) {
    if (s.type !== 'ImportSpecifier') { out.push(`${where}: new ${s.type === 'ImportDefaultSpecifier' ? 'default' : 'namespace'} import (only plain named imports may be added): ${show}`); continue; }
    const imported = s.imported.name ?? s.imported.value;
    if (imported !== s.local.name) out.push(`${where}: import alias \`${imported} as ${s.local.name}\`: ${show}`);
    else if (!basePackageImports.has(`${source}|${imported}`)) out.push(`${where}: \`${imported}\` from package '${source}' was not imported anywhere in the base: ${show}`);
  }
  return out;
}

for (const [f, a] of analysed) {
  if (!a.now) continue;
  // Alone on its line(s).
  for (const { node: n, text } of a.now.statements) {
    const lineStart = a.raw.lastIndexOf('\n', n.start - 1) + 1;
    let lineEnd = a.raw.indexOf('\n', n.end);
    if (lineEnd < 0) lineEnd = a.raw.length;
    const around = a.raw.slice(lineStart, n.start) + a.raw.slice(n.end, lineEnd);
    if (around) problems.push(`${rel(f)}:${n.loc.start.line}: an import/export statement must be the only content on its line(s), found ${JSON.stringify(around.slice(0, 80))} beside ${JSON.stringify(text.slice(0, 60))}`);
  }
  // New statements follow the move rules.
  const left = bag((a.before ? a.before.statements : []).map((s) => s.text));
  for (const s of a.now.statements) {
    if (left.get(s.text) > 0) { left.set(s.text, left.get(s.text) - 1); continue; }
    problems.push(...checkNewStatement(f, s.node, s.text));
  }
}

// ---- report ------------------------------------------------------------------------
console.log(`check-move vs ${base}: ${movedOut.length} top-level node(s) moved out of index.js into ${Object.keys(movedIn).length} module(s)`);
for (const [f, l] of Object.entries(movedIn)) console.log(`  ${f}: ${l.length} node(s)`);
if (problems.length) {
  console.log(`  FAIL  ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.log(`        ${p}`);
  process.exit(1);
}
console.log('  PASS  pure verbatim move (whole nodes unchanged; only imports and `export ` prefixes added)');
