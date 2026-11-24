#!/usr/bin/env node
/**
 * Self-test for check-move.mjs and fix-imports' narrowImports (#3 split).
 *
 *   node scripts/test-check-move.mjs        (npm test suite "move-selftest")
 *
 * Builds a fixture repo (worker/src/index.js, lib/http.js, wrangler.toml,
 * package.json, a migration, a frontend file, README.md), commits it as the
 * base, then applies one working-tree change per case and runs the real
 * check-move.mjs on it with --worker-dir. Clean moves must PASS; every known
 * way to smuggle a change through a "move" must FAIL, for the expected
 * reason. Cases are grouped by the hole they cover:
 *   round 1 (QA): code on an import line; import/export content (aliases,
 *     side-effect imports, names the target lacks); code hidden behind
 *     U+2028 / U+2029 / a bare CR in a header comment; edited lines.
 *   round 2 (QA):
 *     1 line smuggling: a line taken out of a node that stays in index.js
 *       and slipped into a moved node (the old line multiset still matched);
 *     2 whitespace edits: blank or whitespace-only lines added to / removed
 *       from a template literal in a moved node (old check skipped blanks);
 *     3 import targets outside the scanned modules (scripts/, .mjs);
 *     4 changed paths outside src/**\/*.js (wrangler.toml, package.json,
 *       migrations, the frontend);
 *     narrowImports: aliased specifiers are left alone, and a line shared
 *       with another statement is never deleted.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { narrowImports } from './fix-imports.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECK = path.join(HERE, 'check-move.mjs');
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029), CR = String.fromCharCode(13);

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${detail ? `\n        ${String(detail).split('\n').slice(0, 10).join('\n        ')}` : ''}`); }
};
const L = (...lines) => lines.join('\n');

// ---- fixture -------------------------------------------------------------
const ESC_COMMENT = '// Escapes text for HTML (all five specials).';
const ESC_BODY = "  return String(s).replace(/[&<>\"']/g, (c) => `&#${c.charCodeAt(0)};`);";
const escHtml = (prefix = '', body = ESC_BODY) => L(ESC_COMMENT, `${prefix}function escHtml(s) {`, body, '}');
// A template literal holding a blank line: its text IS the page output.
const page = (prefix = '', tpl = ['  return `<h1>${title}</h1>', '', '<p>end</p>`;']) => L(`${prefix}function page(title) {`, ...tpl, '}');
// A template literal holding a line that looks like a top-level declaration.
const script = (prefix = '', line = 'const ready = true;') => L(`${prefix}function script() {`, '  return `', line, '`;', '}');
const GUARD = "  if (!name) return json({ error: 'name' });";
const greet = (lines = [GUARD, '  return json({ hi: escHtml(name) });']) => L('function greet(name) {', ...lines, '}');
const DEFAULT = "export default { fetch() { return greet('x') || page('t'); } };";

const BASE = {
  'src/lib/http.js': L(
    'export function json(d) { return new Response(JSON.stringify(d)); }',
    'export function ok(d) { return json({ success: true, data: d }); }',
    'export function now() { return new Date().toISOString(); }',
    ''),
  'src/index.js': L("import { json } from './lib/http.js';", '', escHtml(), '', page(), '', script(), '', greet(), '', DEFAULT, ''),
  'wrangler.toml': L('name = "fixture"', 'main = "src/index.js"', ''),
  'package.json': L('{ "name": "fixture", "private": true }', ''),
  'migrations/0001_init.sql': L('CREATE TABLE t (id TEXT);', ''),
  'scripts/helper.js': L('export function helper() { return 1; }', ''),
  '../frontend/app.ts': L('export const app = 1;', ''),
  '../README.md': L('# Fixture', ''),
};

// The clean move: escHtml (with its comment) from index.js to a new lib/text.js.
const TEXT_HEADER = '// Text helpers (moved verbatim from index.js, #3).';
const textModule = ({ header = TEXT_HEADER, imports = [], esc = escHtml('export '), extra = [] } = {}) =>
  L(header, '', ...imports, ...(imports.length ? [''] : []), esc, ...extra.flatMap((x) => ['', x]), '');
const indexAfter = ({ imports = ["import { json } from './lib/http.js';", "import { escHtml } from './lib/text.js';"], keepPage = true, keepScript = true, greetNode = greet() } = {}) =>
  L(...imports, '', ...(keepPage ? [page(), ''] : []), ...(keepScript ? [script(), ''] : []), greetNode, '', DEFAULT, '');
const MOVE = { 'src/lib/text.js': textModule(), 'src/index.js': indexAfter() };
// A second clean move: escHtml and page both go to lib/text.js.
const MOVE_BOTH = {
  'src/lib/text.js': textModule({ extra: [page('export ')] }),
  'src/index.js': indexAfter({ imports: ["import { json } from './lib/http.js';", "import { escHtml, page } from './lib/text.js';"], keepPage: false }),
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-move-selftest-'));
const worker = path.join(root, 'worker');
const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...a], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const writeFiles = (files) => {
  for (const [p, content] of Object.entries(files)) {
    const f = path.join(worker, p);
    if (content === null) { fs.rmSync(f, { force: true }); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
};
git('init', '-q');
git('config', 'core.autocrlf', 'false');
writeFiles(BASE);
git('add', '-A');
git('commit', '-q', '-m', 'base');
const baseRef = git('rev-parse', 'HEAD').trim();

function runCase(files, move = MOVE) {
  git('reset', '-q', '--hard', baseRef);
  git('clean', '-q', '-fd');
  writeFiles({ ...move, ...files });
  const r = spawnSync(process.execPath, [CHECK, baseRef, '--worker-dir', worker], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
function expectPass(name, files, move) {
  const r = runCase(files, move);
  ok(r.status === 0, `passes: ${name}`, r.out);
}
function expectFail(name, files, reason, move) {
  const r = runCase(files, move);
  ok(r.status !== 0 && reason.test(r.out), `fails: ${name}`, r.status === 0 ? `check-move passed:\n${r.out}` : `failed, but not for ${reason}:\n${r.out}`);
}

try {
  console.log('== clean moves pass ==');
  expectPass('escHtml moved to lib/text.js, index.js gains one import', {});
  expectPass('escHtml and page (template with a blank line) moved together', {}, MOVE_BOTH);
  expectPass('the moved module imports a name its target exports', { 'src/lib/text.js': textModule({ imports: ["import { now } from './http.js';"] }) });
  expectPass('allow-listed paths change too (README, docs, scripts, test-*.mjs)', {
    '../README.md': '# Fixture\n\nMore.\n', 'docs/split.md': '# notes\n', 'scripts/new-tool.mjs': 'export {};\n', 'test-extra.mjs': '// t\n',
  });

  console.log('== round 1 / QA #1: code riding on an import line ==');
  expectFail('code after an import in a new module', { 'src/lib/text.js': textModule({ imports: ["import { now } from './http.js'; globalThis.__pwn = 1;"] }) }, /only content on its line/);
  expectFail('code after an import in index.js', { 'src/index.js': indexAfter({ imports: ["import { json } from './lib/http.js';", "import { escHtml } from './lib/text.js'; globalThis.__pwn = 1;"] }) }, /only content on its line/);
  expectFail('code before an import in index.js', { 'src/index.js': indexAfter({ imports: ["import { json } from './lib/http.js';", "globalThis.__pwn = 1; import { escHtml } from './lib/text.js';"] }) }, /only content on its line/);

  console.log('== round 1 / QA #2: import/export content ==');
  expectFail('import alias swap (json as ok, ok as json)', { 'src/index.js': indexAfter({ imports: ["import { json as ok, ok as json } from './lib/http.js';", "import { escHtml } from './lib/text.js';"] }) }, /import alias/);
  expectFail('extra side-effect import in a new module', { 'src/lib/text.js': textModule({ imports: ["import './http.js';"] }) }, /side-effect import/);
  expectFail('side-effect import of a non-route module in index.js', { 'src/index.js': indexAfter({ imports: ["import { json } from './lib/http.js';", "import { escHtml } from './lib/text.js';", "import './lib/http.js';"] }) }, /side-effect import/);
  expectFail('export alias (export { escHtml as escAlias })', { 'src/lib/text.js': textModule() + 'export { escHtml as escAlias };\n' }, /export alias/);
  expectFail('import of a name the target does not export', { 'src/lib/text.js': textModule({ imports: ["import { nope } from './http.js';"] }) }, /not exported by/);
  expectFail('default import', { 'src/lib/text.js': textModule({ imports: ["import http from './http.js';"] }) }, /default import/);
  expectFail('namespace import', { 'src/lib/text.js': textModule({ imports: ["import * as http from './http.js';"] }) }, /namespace import/);
  expectFail('new export * re-export', { 'src/lib/text.js': textModule() + "export * from './http.js';\n" }, /export \*/);
  expectFail('package import the base never had', { 'src/lib/text.js': textModule({ imports: ["import { exec } from 'node:child_process';"] }) }, /was not imported anywhere in the base/);

  console.log('== round 1 / QA #3: code hidden in a header comment ==');
  expectFail('U+2028 in the header', { 'src/lib/text.js': textModule({ header: `${TEXT_HEADER}${LS}globalThis.__pwn = 1;` }) }, /U\+2028/);
  expectFail('U+2029 in the header', { 'src/lib/text.js': textModule({ header: `${TEXT_HEADER}${PS}globalThis.__pwn = 1;` }) }, /U\+2029/);
  expectFail('bare CR in the header', { 'src/lib/text.js': textModule({ header: `${TEXT_HEADER}${CR}globalThis.__pwn = 1;` }) }, /U\+000D/);
  expectFail('U+2028 anywhere under src/ (an existing file)', { 'src/lib/http.js': BASE['src/lib/http.js'] + `// note${LS}\n` }, /U\+2028/);

  console.log('== round 1: edited code ==');
  expectFail("escHtml stops escaping ' on the way", { 'src/lib/text.js': textModule({ esc: escHtml('export ', '  return String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);') }) }, /added to a module but not removed|removed from index\.js but not found/);
  expectFail('an edited node in an existing module', { 'src/lib/http.js': BASE['src/lib/http.js'].replace('toISOString()', 'toUTCString()') }, /base code removed or edited/);
  expectFail('an edited node left in index.js', { 'src/index.js': indexAfter({ greetNode: greet(['  return json({ hi: name });']) }) }, /new, edited or reordered/);
  expectFail('an extra comment in a moved block', { 'src/lib/text.js': textModule({ esc: escHtml('export ').replace('export function escHtml', '// sneaky\nexport function escHtml') }) }, /comment added to a module/);

  console.log('== round 2 / 1: line smuggling between nodes ==');
  // The guard line leaves greet (which stays in index.js) and rides into the
  // moved escHtml, just before its closing brace: removed and added LINES
  // still match one for one, and in order.
  expectFail('a line moved out of a node that stays in index.js into a moved node', {
    'src/lib/text.js': textModule({ esc: L(ESC_COMMENT, 'export function escHtml(s) {', ESC_BODY, GUARD, '}') }),
    'src/index.js': indexAfter({ greetNode: greet(['  return json({ hi: escHtml(name) });']) }),
  }, /new, edited or reordered|added to a module but not removed/);
  // The old line check stripped an `export ` prefix from ANY added line, so a
  // line inside a moved template literal could gain one and still match.
  expectFail('`export ` slipped onto a line inside a moved template literal', {
    'src/lib/text.js': textModule({ extra: [script('export ', 'export const ready = true;')] }),
    'src/index.js': indexAfter({ imports: ["import { json } from './lib/http.js';", "import { escHtml, script } from './lib/text.js';"], keepScript: false }),
  }, /added to a module but not removed|removed from index.js but not found/);
  expectPass('the same function moved unchanged (control)', {
    'src/lib/text.js': textModule({ extra: [script('export ')] }),
    'src/index.js': indexAfter({ imports: ["import { json } from './lib/http.js';", "import { escHtml, script } from './lib/text.js';"], keepScript: false }),
  });
  expectFail('a node that stays in index.js is reordered', {
    'src/index.js': L("import { json } from './lib/http.js';", "import { escHtml } from './lib/text.js';", '', greet(), '', page(), '', script(), '', DEFAULT, ''),
  }, /new, edited or reordered/);
  expectFail('a node is deleted from an existing module', { 'src/lib/http.js': BASE['src/lib/http.js'].replace(/export function ok[^\n]*\n/, '') }, /base code removed or edited/);
  expectFail('`export` written with two spaces (not a pure prefix)', { 'src/lib/text.js': textModule({ esc: escHtml('export  ') }) }, /must be written `export <declaration>`/);

  console.log('== round 2 / 2: whitespace edits inside a moved node ==');
  expectFail('a blank line added inside a moved template literal', {
    'src/lib/text.js': textModule({ extra: [page('export ', ['  return `<h1>${title}</h1>', '', '', '<p>end</p>`;'])] }),
  }, /added to a module but not removed|removed from index\.js but not found/, MOVE_BOTH);
  expectFail('the blank line removed from a moved template literal', {
    'src/lib/text.js': textModule({ extra: [page('export ', ['  return `<h1>${title}</h1>', '<p>end</p>`;'])] }),
  }, /added to a module but not removed|removed from index\.js but not found/, MOVE_BOTH);
  expectFail('a whitespace-only line in a moved template literal', {
    'src/lib/text.js': textModule({ extra: [page('export ', ['  return `<h1>${title}</h1>', '   ', '<p>end</p>`;'])] }),
  }, /added to a module but not removed|removed from index\.js but not found/, MOVE_BOTH);
  expectFail('trailing whitespace added on a moved line', { 'src/lib/text.js': textModule({ esc: escHtml('export ', `${ESC_BODY}  `) }) }, /added to a module but not removed|removed from index\.js but not found/);

  console.log('== round 2 / 3: import targets outside the scanned modules ==');
  expectFail('a relative import from outside src/ (scripts/helper.js)', { 'src/lib/text.js': textModule({ imports: ["import { helper } from '../../scripts/helper.js';"] }) }, /must name a \.js module under src\//);
  expectFail('a relative import of a .mjs file under src/', { 'src/lib/extra.mjs': 'export function x() { globalThis.__pwn = 1; }\n', 'src/lib/text.js': textModule({ imports: ["import { x } from './extra.mjs';"] }) }, /must name a \.js module under src\//);
  expectFail('a relative import of a module that does not exist', { 'src/lib/text.js': textModule({ imports: ["import { y } from './missing.js';"] }) }, /must name a \.js module under src\//);

  console.log('== round 2 / 4: changed paths outside src/**/*.js ==');
  expectFail('wrangler.toml changed', { 'wrangler.toml': BASE['wrangler.toml'] + 'compatibility_flags = ["x"]\n' }, /wrangler\.toml: changed/);
  expectFail('package.json changed', { 'package.json': '{ "name": "fixture", "private": true, "main": "x.js" }\n' }, /package\.json: changed/);
  expectFail('a migration added', { 'migrations/0002_more.sql': 'DROP TABLE t;\n' }, /migrations\/0002_more\.sql: changed/);
  expectFail('a frontend file changed', { '../frontend/app.ts': 'export const app = 2;\n' }, /frontend\/app\.ts: changed/);
  expectFail('a non-.js file added under src/', { 'src/data.json': '{}\n' }, /src\/data\.json: changed/);
  expectFail('a baseline edited in a split PR (D4)', { 'scripts/route-baseline.json': '{"total":0}\n' }, /baseline may not change in a split PR/);
  expectFail('a script deleted in a split PR (D5)', { 'scripts/helper.js': null }, /scripts\/helper\.js: deleted/);

  console.log('== fix-imports narrowImports: only import statements change ==');
  {
    const before = L(
      "import { a, b } from './lib/x.js';",
      "import { c } from './core/y.js';",
      "import { keep } from './log-safe.js';",
      '', '', '',
      'const t = `p', '', '', '', 'q`;',
      'export default a(t, keep);', '');
    const want = L(
      "import { a } from './lib/x.js';",
      "import { keep } from './log-safe.js';",
      '', '', '',
      'const t = `p', '', '', '', 'q`;',
      'export default a(t, keep);', '');
    const got = narrowImports(before);
    ok(got.src === want && got.dropped === 2, 'narrows a, drops c, leaves blank-line runs and the template string alone', JSON.stringify(got));
  }
  {
    // `a as z` is used under its local name z; nothing in the statement may change.
    const before = L("import { a as z, unused } from './lib/x.js';", 'export default z;', '');
    const got = narrowImports(before);
    ok(got.src === before && got.dropped === 0, 'leaves an import with an aliased specifier exactly as written', JSON.stringify(got));
  }
  {
    // c is unused, but its line also holds the keep import: only c's statement goes.
    const before = L("import { c } from './core/y.js'; import { keep } from './log-safe.js';", 'export default keep;', '');
    const got = narrowImports(before);
    ok(got.src.includes("import { keep } from './log-safe.js';") && !got.src.includes("'./core/y.js'") && got.src.split('\n').length === before.split('\n').length, 'never deletes a line another statement shares', JSON.stringify(got));
  }
  // QA's narrowImports probe inputs (scripts/fixtures/qa/qa-narrow.mjs, which
  // only prints), here with the expected result asserted.
  {
    const alias = L("import { a as b, c } from './lib/x.js';", 'export default b();', '');
    let got = narrowImports(alias);
    ok(got.src === alias && got.dropped === 0, 'QA narrow: alias (a as b used, c unused) left exactly as written', JSON.stringify(got));
    const shared = L("import { gone } from './lib/g.js'; export const k = 1;", 'export default k;', '');
    got = narrowImports(shared);
    ok(got.src === L(' export const k = 1;', 'export default k;', '') && got.dropped === 1, 'QA narrow: shared line keeps the export that shares it', JSON.stringify(got));
    const braces = L('import {', '  a, // keep me', '  c, /* drop me */', "} from './lib/x.js';", 'export default a();', '');
    got = narrowImports(braces);
    ok(got.src === L("import { a } from './lib/x.js';", 'export default a();', '') && got.dropped === 1, 'QA narrow: comment inside braces, c dropped, only the import rewritten', JSON.stringify(got));
    const lookalike = L("import { z } from './core/z.js';", "import { a } from './lib/x.js';", '', '', '', 'const t = `', "import { z } from './core/z.js';", '', '', '', '`;', 'export default a(t);', '');
    got = narrowImports(lookalike);
    ok(got.src === lookalike.split('\n').slice(1).join('\n') && got.dropped === 1, 'QA narrow: a template that looks like imports, and its blank runs, untouched', JSON.stringify(got));
    const multi = L("import { keep } from './lib/k.js';", 'import {', '  gone1,', '  gone2,', "} from './domain/g.js';", "import { keep2 } from './lib/k2.js';", 'export default keep() + keep2();', '');
    got = narrowImports(multi);
    ok(got.src === L("import { keep } from './lib/k.js';", "import { keep2 } from './lib/k2.js';", 'export default keep() + keep2();', '') && got.dropped === 2, 'QA narrow: a multi-line import dropped whole, neighbours kept', JSON.stringify(got));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// ---- QA R1: a route module whose import was dropped ---------------------------
// The route is moved verbatim, but index.js no longer imports the module, so
// it would silently never register. check-move AND route-table must fail;
// the same move with the import passes both.
{
  const ROUTE_TABLE = path.join(HERE, 'route-table.mjs');
  const rRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-move-r1-'));
  const rWorker = path.join(rRoot, 'worker');
  const rgit = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...a], { cwd: rRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const rwrite = (files) => {
    for (const [p, content] of Object.entries(files)) {
      const f = path.join(rWorker, p);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    }
  };
  const ROUTE_A = "route('GET', '/api/a', () => 1, { auth: false });";
  const ROUTE_B = "route('GET', '/api/b', () => 2);";
  const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  console.log('== QA R1: a moved route module that index.js no longer imports ==');
  try {
    rgit('init', '-q');
    rgit('config', 'core.autocrlf', 'false');
    rwrite({
      'src/core/router.js': 'export function route() {}\n',
      'src/index.js': L("import { route } from './core/router.js';", '', ROUTE_A, '', ROUTE_B, '', 'export default {};', ''),
    });
    fs.mkdirSync(path.join(rWorker, 'scripts'), { recursive: true });
    const w = run(ROUTE_TABLE, ['--write', '--worker-dir', rWorker]);
    if (w.status !== 0) throw new Error(`route-table --write: ${w.stdout}${w.stderr}`);
    rgit('add', '-A');
    rgit('commit', '-q', '-m', 'base');
    const rBase = rgit('rev-parse', 'HEAD').trim();
    const routesB = L('// Route b (moved verbatim from index.js, #3).', '', "import { route } from '../core/router.js';", '', ROUTE_B, '');
    for (const [name, withImport] of [['the move with its import (control)', true], ['R1: the same move with the import removed', false]]) {
      rgit('reset', '-q', '--hard', rBase);
      rgit('clean', '-q', '-fd');
      rwrite({
        'src/routes/b.js': routesB,
        'src/index.js': L("import { route } from './core/router.js';", ...(withImport ? ["import './routes/b.js';"] : []), '', ROUTE_A, '', 'export default {};', ''),
      });
      const cm = run(CHECK, [rBase, '--worker-dir', rWorker]);
      const rt = run(ROUTE_TABLE, ['--worker-dir', rWorker]);
      if (withImport) {
        ok(cm.status === 0, `passes check-move: ${name}`, `${cm.stdout}${cm.stderr}`);
        ok(rt.status === 0, `passes route-table: ${name}`, `${rt.stdout}${rt.stderr}`);
      } else {
        ok(cm.status !== 0 && /never imports it/.test(cm.stdout), `fails check-move: ${name}`, `${cm.stdout}${cm.stderr}`);
        ok(rt.status !== 0 && /registers routes but index\.js never loads it/.test(rt.stdout), `fails route-table: ${name}`, `${rt.stdout}${rt.stderr}`);
      }
    }
  } finally {
    fs.rmSync(rRoot, { recursive: true, force: true });
  }
}

// ---- QA's fixtures, verbatim (scripts/fixtures/qa/qa-fixtures.mjs) -----------
// Its BASE and CASES are imported unchanged. Two harness choices, both from
// the review:
//  - D3 (a plain comment added between unmoved index.js nodes) is refused by
//    design: a comment like `// eslint-disable-next-line` (D2) changes what
//    the guards see, so no comment may be added there. Expected: fail.
//  - D5 deletes test-local.mjs, which QA's BASE does not contain, so the
//    deletion would be a no-op; the harness adds it to the base, as on main.
// Importing the file creates an (unused) temp dir at its top level; it is
// removed again below.
{
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('qa-fixtures-')));
  const { BASE: QA_BASE, CASES } = await import('./fixtures/qa/qa-fixtures.mjs');
  for (const n of fs.readdirSync(os.tmpdir())) if (n.startsWith('qa-fixtures-') && !before.has(n)) fs.rmSync(path.join(os.tmpdir(), n), { recursive: true, force: true });
  const EXPECT = { D3: 'exploit' };
  const qaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'check-move-qa-'));
  const qaWorker = path.join(qaRoot, 'worker');
  const qgit = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...a], { cwd: qaRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const qwrite = (files) => {
    for (const [p, content] of Object.entries(files)) {
      const f = path.join(qaWorker, p);
      if (content === null) { fs.rmSync(f, { force: true }); continue; }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    }
  };
  console.log(`== QA fixtures (${CASES.length} cases, verbatim) ==`);
  try {
    qgit('init', '-q');
    qgit('config', 'core.autocrlf', 'false');
    qwrite({ ...QA_BASE, 'test-local.mjs': '// the local suite\n' });
    qgit('add', '-A');
    qgit('commit', '-q', '-m', 'base');
    const qaBase = qgit('rev-parse', 'HEAD').trim();
    for (const [id, kind, desc, files] of CASES) {
      qgit('reset', '-q', '--hard', qaBase);
      qgit('clean', '-q', '-fd');
      qwrite(files);
      const r = spawnSync(process.execPath, [CHECK, qaBase, '--worker-dir', qaWorker], { encoding: 'utf8' });
      const want = EXPECT[id] || kind;
      const good = want === 'exploit' ? r.status !== 0 : r.status === 0;
      ok(good, `QA ${id.padEnd(4)} ${want === 'exploit' ? 'fails' : 'passes'}: ${desc}${want !== kind ? ' (refused by design)' : ''}`, `${r.stdout}${r.stderr}`);
    }
  } finally {
    fs.rmSync(qaRoot, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
