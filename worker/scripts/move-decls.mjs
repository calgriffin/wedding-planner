#!/usr/bin/env node
/**
 * Move named top-level declarations out of src/index.js, verbatim (#3 split).
 *
 *   node scripts/move-decls.mjs <target> <name>[,<name>…] [--no-comment=<name>,…]
 *     [--whole-comment=<name>,…] [--header=<text>]
 *
 * By default a node takes the comment lines directly above it, up to a
 * section banner ("// ----"). --whole-comment takes the whole comment block,
 * banners included, plus a comment block one blank line above it (for a
 * per-function banner, or a comment set apart by a blank line).
 *
 * A name is a top-level function/const/let in index.js, or a route
 * registration written `route:<METHOD> <path>` (e.g. "route:GET /api/auth/status").
 * For each name the node's
 * exact source lines, plus the comment lines directly above it (unless listed
 * in --no-comment), are cut from index.js and appended to <target>
 * (e.g. src/lib/text.js) in their original order, with `export ` added to the
 * declaration line (route calls are moved as they are). index.js gets
 * `import { … } from './<target>';` for the declarations, or
 * `import './<target>';` for a module of routes only, after its last import. Nothing inside a body is touched; check-move.mjs verifies that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const WORKER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = path.join(WORKER_DIR, 'src', 'index.js');
const [targetArg, namesArg, ...rest] = process.argv.slice(2);
if (!targetArg || !namesArg) { console.error('usage: move-decls.mjs <target> <names> [--no-comment=a,b] [--header=text]'); process.exit(2); }
const opt = (k) => (rest.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3);
const names = namesArg.split(',').filter(Boolean);
const noComment = new Set(opt('no-comment').split(',').filter(Boolean));
const wholeComment = new Set(opt('whole-comment').split(',').filter(Boolean));
const header = opt('header');

const raw = fs.readFileSync(INDEX, 'utf8');
const crlf = raw.includes('\r\n');
const lines = raw.replace(/\r\n/g, '\n').split('\n');
const ast = acorn.parse(lines.join('\n'), { ecmaVersion: 'latest', sourceType: 'module', locations: true });

const routeName = (n) => {
  if (n.type !== 'ExpressionStatement' || n.expression.type !== 'CallExpression') return null;
  const { callee, arguments: [m, p] } = n.expression;
  return callee.type === 'Identifier' && callee.name === 'route' && m && m.type === 'Literal' && p && p.type === 'Literal' ? `route:${m.value} ${p.value}` : null;
};
const declName = (n) => (n.type === 'FunctionDeclaration' ? n.id.name : n.type === 'VariableDeclaration' && n.declarations.length === 1 ? n.declarations[0].id.name : routeName(n));
const isRoute = (name) => name.startsWith('route:');
const ranges = [];
for (const name of names) {
  const node = ast.body.find((n) => declName(n) === name);
  if (!node) { console.error(`move-decls: no top-level declaration named ${name}`); process.exit(1); }
  let start = node.loc.start.line - 1; // 0-based
  const end = node.loc.end.line - 1;
  // The declaration's own comment: the comment lines right above it, stopping
  // at a section banner ("// ----…"), which belongs to the section and stays.
  const BANNER = /^\s*\/\/\s*-{4,}/;
  const isComment = (i) => i >= 0 && /^\s*\/\//.test(lines[i]);
  if (wholeComment.has(name)) {
    // --whole-comment: the whole comment block above (banners included), and
    // across one blank line a comment block above that, e.g. a per-function
    // banner, or a comment the code is separated from by a blank line.
    if (!isComment(start - 1) && lines[start - 1] === '' && isComment(start - 2)) start--;
    while (isComment(start - 1)) start--;
  } else if (!noComment.has(name)) {
    while (start > 0 && isComment(start - 1) && !BANNER.test(lines[start - 1])) start--;
  }
  ranges.push({ name, start, end, declLine: node.loc.start.line - 1 });
}
ranges.sort((a, b) => a.start - b.start);

const moved = [];
for (const r of ranges) {
  if (moved.length) moved.push('');
  for (let i = r.start; i <= r.end; i++) moved.push(i === r.declLine && !isRoute(r.name) ? `export ${lines[i]}` : lines[i]);
}
// Cut from the bottom up; drop one blank line left behind so blanks don't pile up.
for (const r of [...ranges].reverse()) {
  let { start, end } = r;
  if (lines[end + 1] === '' && (start === 0 || lines[start - 1] === '')) end++;
  lines.splice(start, end - start + 1);
}

const target = path.join(WORKER_DIR, targetArg);
const relImport = './' + path.relative(path.dirname(INDEX), target).split(path.sep).join('/');
let out = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n').replace(/\n*$/, '\n\n') : (header ? `${header}\n\n` : '');
out += moved.join('\n') + '\n';
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, crlf ? out.replace(/\n/g, '\r\n') : out);

// Import after the last top-level import.
const lastImport = acorn.parse(lines.join('\n'), { ecmaVersion: 'latest', sourceType: 'module', locations: true }).body.filter((n) => n.type === 'ImportDeclaration').pop();
const at = lastImport ? lastImport.loc.end.line : 0;
const declNames = names.filter((n) => !isRoute(n));
lines.splice(at, 0, declNames.length ? `import { ${declNames.join(', ')} } from '${relImport}';` : `import '${relImport}';`);
const idx = lines.join('\n');
fs.writeFileSync(INDEX, crlf ? idx.replace(/\n/g, '\r\n') : idx);
console.log(`move-decls: ${names.length} declaration(s), ${moved.filter((l) => l.trim()).length} non-blank line(s) -> ${targetArg}`);
