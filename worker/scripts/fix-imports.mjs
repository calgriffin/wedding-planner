#!/usr/bin/env node
/**
 * After move-decls: give each moved module the imports it needs (#3 split).
 *
 *   node scripts/fix-imports.mjs [file…]   (default: every src module except index.js)
 *
 * Runs ESLint no-undef, maps every undefined name to the src module that
 * exports it (never index.js), and inserts `import { … } from '…';` lines
 * after the module's header comment. A name nothing exports is reported and
 * left alone (it still fails the lint check). Only import lines are added, so
 * check-move.mjs still sees a pure move. Also drops names that index.js
 * imports from a moved module but no longer uses (narrowImports, which only
 * ever edits import statements: see test-check-move.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const WORKER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(WORKER_DIR, 'src');
const parse = (code) => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
const read = (f) => fs.readFileSync(f, 'utf8');
const write = (f, s, crlf) => fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);

function listSources(dir = SRC) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(p));
    else if (e.name.endsWith('.js') && e.name !== 'assets.js') out.push(p);
  }
  return out;
}

// index.js: drop moved names it no longer uses (keeps its imports minimal).
// Pure: takes and returns source with "\n" line ends. It edits only import
// statements: a narrowed import is rewritten in place, and an import dropped
// completely loses exactly its own line. Nothing else in the file changes
// (no blank-line cleanup outside those lines).
export function narrowImports(src) {
  const ast = parse(src);
  // Identifiers used outside import statements (an import's own specifiers
  // don't count as a use).
  const usedOutside = new Set();
  for (const n of ast.body) if (n.type !== 'ImportDeclaration') walk.full(n, (x) => { if (x.type === 'Identifier') usedOutside.add(x.name); });
  let dropped = 0;
  // Back to front, so earlier offsets stay valid.
  for (const n of [...ast.body].reverse()) {
    if (n.type !== 'ImportDeclaration' || !/^\.\/(core|domain|lib|routes|pages)\//.test(n.source.value) || !n.specifiers.length) continue;
    // Only plain, un-aliased named imports are narrowed: anything else
    // (default, namespace, `a as b`) is left exactly as written.
    if (!n.specifiers.every((s) => s.type === 'ImportSpecifier' && (s.imported.name ?? s.imported.value) === s.local.name)) continue;
    const keep = n.specifiers.filter((s) => usedOutside.has(s.local.name)).map((s) => s.local.name);
    if (keep.length === n.specifiers.length) continue;
    dropped += n.specifiers.length - keep.length;
    if (keep.length) {
      src = src.slice(0, n.start) + `import { ${keep.join(', ')} } from '${n.source.value}';` + src.slice(n.end);
    } else {
      const lineStart = src.lastIndexOf('\n', n.start - 1) + 1;
      let lineEnd = src.indexOf('\n', n.end);
      if (lineEnd < 0) lineEnd = src.length;
      const alone = !src.slice(lineStart, n.start).trim() && !src.slice(n.end, lineEnd).trim();
      // Alone on its line: remove the line. Sharing it with anything else:
      // remove only the statement's own text, never the other content.
      src = alone ? src.slice(0, lineStart) + src.slice(Math.min(lineEnd + 1, src.length)) : src.slice(0, n.start) + src.slice(n.end);
    }
  }
  return { src, dropped };
}

function main() {
  // name -> exporting module (absolute path)
  const exporters = new Map();
  for (const f of listSources()) {
    if (f === path.join(SRC, 'index.js')) continue;
    for (const n of parse(read(f)).body) {
      if (n.type !== 'ExportNamedDeclaration') continue;
      if (n.declaration) {
        const d = n.declaration;
        const names = d.type === 'VariableDeclaration' ? d.declarations.map((x) => x.id.name) : [d.id && d.id.name];
        for (const nm of names) if (nm) exporters.set(nm, f);
      }
      for (const s of n.specifiers || []) exporters.set(s.exported.name, f);
    }
  }

  const targets = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f)) : listSources().filter((f) => f !== path.join(SRC, 'index.js'));
  const eslint = spawnSync(process.execPath, [path.join(WORKER_DIR, 'node_modules', 'eslint', 'bin', 'eslint.js'), '--format', 'json', ...targets], { cwd: WORKER_DIR, encoding: 'utf8', maxBuffer: 64 << 20 });
  const report = JSON.parse(eslint.stdout || '[]');
  let added = 0;
  for (const r of report) {
    const undef = [...new Set(r.messages.filter((m) => m.ruleId === 'no-undef').map((m) => (m.message.match(/'([^']+)'/) || [])[1]).filter(Boolean))];
    if (!undef.length) continue;
    const byModule = new Map();
    for (const nm of undef) {
      const from = exporters.get(nm);
      if (!from || from === r.filePath) { console.log(`  ?  ${path.relative(WORKER_DIR, r.filePath)}: nothing exports ${nm}`); continue; }
      if (!byModule.has(from)) byModule.set(from, []);
      byModule.get(from).push(nm);
    }
    if (!byModule.size) continue;
    const raw = read(r.filePath);
    const crlf = raw.includes('\r\n');
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    // After the module's header (its first block of // lines) and the blank
    // line that follows it, so the imports never land between a later
    // comment and the code it describes.
    let at = 0;
    while (at < lines.length && /^\s*\/\//.test(lines[at])) at++;
    if (at > 0 && at < lines.length && !lines[at].trim()) at++;
    const existingImports = parse(lines.join('\n')).body.filter((n) => n.type === 'ImportDeclaration');
    if (existingImports.length) at = existingImports[existingImports.length - 1].loc.end.line;
    const relTo = (to) => { const p = path.relative(path.dirname(r.filePath), to).split(path.sep).join('/'); return p.startsWith('.') ? p : `./${p}`; };
    const newLines = [...byModule].sort((a, b) => relTo(a[0]).localeCompare(relTo(b[0]))).map(([from, names]) => `import { ${names.sort().join(', ')} } from '${relTo(from)}';`);
    lines.splice(at, 0, ...(existingImports.length ? newLines : [...newLines, '']));
    write(r.filePath, lines.join('\n'), crlf);
    added += newLines.length;
    console.log(`  +  ${path.relative(WORKER_DIR, r.filePath)}: ${newLines.join(' ')}`);
  }

  const INDEX = path.join(SRC, 'index.js');
  const iraw = read(INDEX);
  const { src: narrowed, dropped } = narrowImports(iraw.replace(/\r\n/g, '\n'));
  write(INDEX, narrowed, iraw.includes('\r\n'));
  console.log(`fix-imports: ${added} import line(s) added; ${dropped} unused name(s) dropped from index.js imports`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
