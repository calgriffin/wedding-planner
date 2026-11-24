#!/usr/bin/env node
/**
 * Route set + overlap + layering check for the index.js split (#3).
 *
 *   node scripts/route-table.mjs            check against scripts/route-baseline.json
 *   node scripts/route-table.mjs --write    (re)write the baseline from the current tree
 *   node scripts/route-table.mjs --json     print the collected routes as JSON
 *   … --worker-dir <dir>                    run on another checkout's worker/ (self-test)
 *
 * 1. Collects every `route(method, pattern, handler, { auth })` call in the
 *    modules index.js actually loads (its import graph, followed from
 *    src/index.js; acorn AST, not regex) and compares the per-method SETS of
 *    "pattern|auth" with the committed baseline. Order is deliberately not
 *    compared: with no overlapping patterns the first-match router cannot
 *    change which handler answers (check 2). A module that registers routes
 *    but is not imported (directly or not) from index.js fails: its routes
 *    would silently never register.
 * 2. Fails on any pair of same-method patterns that can match the same path.
 * 3. Layering: lib/ < shared root modules < core/ < domain/ < routes/, pages/
 *    < index.js. No import may point to a higher layer, no routes/ module may
 *    import another routes/ module, nothing imports index.js, and the import
 *    graph has no cycle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const wdAt = process.argv.indexOf('--worker-dir');
const WORKER_DIR = wdAt >= 0 ? path.resolve(process.argv[wdAt + 1]) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(WORKER_DIR, 'src');
const BASELINE = path.join(WORKER_DIR, 'scripts', 'route-baseline.json');

function listSources(dir = SRC) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(p));
    else if (e.name.endsWith('.js') && p !== path.join(SRC, 'assets.js')) out.push(p);
  }
  return out.sort();
}

const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');

export function collect() {
  const routes = [];
  const imports = {}; // rel -> [rel]
  for (const file of listSources()) {
    const code = fs.readFileSync(file, 'utf8');
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    const r = rel(file);
    imports[r] = [];
    for (const node of ast.body) {
      if (node.type === 'ImportDeclaration' || ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source)) {
        const spec = node.source.value;
        if (spec.startsWith('.')) imports[r].push(rel(path.resolve(path.dirname(file), spec)));
      }
    }
    walk.simple(ast, {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'route') return;
        const [m, p, , opts] = node.arguments;
        if (!m || m.type !== 'Literal' || !p || p.type !== 'Literal') return;
        let auth = true;
        if (opts && opts.type === 'ObjectExpression') {
          const a = opts.properties.find((x) => x.key && (x.key.name === 'auth' || x.key.value === 'auth'));
          if (a && a.value.type === 'Literal' && a.value.value === false) auth = false;
        }
        routes.push({ method: m.value, pattern: p.value, auth, file: r, line: node.loc.start.line });
      },
    });
  }
  // Modules index.js loads: follow its relative imports, transitively.
  const reachable = new Set();
  const stack = ['index.js'];
  while (stack.length) {
    const m = stack.pop();
    if (reachable.has(m) || !imports[m]) continue;
    reachable.add(m);
    stack.push(...imports[m]);
  }
  for (const rt of routes) rt.reachable = reachable.has(rt.file);
  return { routes, imports, reachable };
}

export function sets(routes) {
  const out = {};
  for (const r of routes) (out[r.method] ||= []).push(`${r.pattern}|${r.auth ? 'auth' : 'public'}`);
  for (const k of Object.keys(out)) out[k].sort();
  return Object.fromEntries(Object.entries(out).sort());
}

export function overlaps(routes) {
  const parts = (p) => p.split('/').filter(Boolean);
  const bad = [];
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i], b = routes[j];
      if (a.method !== b.method) continue;
      const pa = parts(a.pattern), pb = parts(b.pattern);
      if (pa.length !== pb.length) continue;
      if (pa.every((x, k) => x === pb[k] || x[0] === ':' || pb[k][0] === ':')) bad.push(`${a.method} ${a.pattern} (${a.file}:${a.line}) ~ ${b.pattern} (${b.file}:${b.line})`);
    }
  }
  return bad;
}

const layerOf = (r) => {
  if (r === 'index.js') return 9;
  const top = r.includes('/') ? r.split('/')[0] : '';
  return { lib: 0, '': 1, core: 2, domain: 3, routes: 4, pages: 4 }[top] ?? 1;
};

export function layering(imports) {
  const bad = [];
  for (const [from, tos] of Object.entries(imports)) {
    for (const to of tos) {
      if (to === 'index.js') bad.push(`${from} imports index.js`);
      else if (layerOf(to) > layerOf(from)) bad.push(`${from} (layer ${layerOf(from)}) imports higher layer ${to} (layer ${layerOf(to)})`);
      if (from.startsWith('routes/') && to.startsWith('routes/')) bad.push(`route module ${from} imports route module ${to}`);
    }
  }
  // Cycles (DFS).
  const state = {};
  const stack = [];
  const visit = (n) => {
    if (state[n] === 1) { bad.push(`import cycle: ${[...stack.slice(stack.indexOf(n)), n].join(' -> ')}`); return; }
    if (state[n] === 2) return;
    state[n] = 1; stack.push(n);
    for (const m of imports[n] || []) visit(m);
    stack.pop(); state[n] = 2;
  };
  for (const n of Object.keys(imports)) visit(n);
  return [...new Set(bad)];
}

function main() {
  const args = process.argv.slice(2);
  const { routes: all, imports } = collect();
  const routes = all.filter((rt) => rt.reachable);
  const orphans = [...new Set(all.filter((rt) => !rt.reachable).map((rt) => rt.file))];
  if (args.includes('--json')) { console.log(JSON.stringify(routes, null, 2)); return; }
  const now = sets(routes);
  if (args.includes('--write')) {
    fs.writeFileSync(BASELINE, JSON.stringify({ total: routes.length, routes: now }, null, 2) + '\n');
    console.log(`route-table: baseline written (${routes.length} routes)`);
    return;
  }
  let fail = 0;
  const report = (ok, msg, detail) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) { fail++; if (detail) console.log(`        ${[].concat(detail).join('\n        ')}`); } };
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  report(!orphans.length, 'every module that registers routes is imported (directly or not) from index.js', orphans.map((f) => `${f}: registers routes but index.js never loads it`));
  report(routes.length === base.total, `route count ${routes.length} (baseline ${base.total})`);
  for (const m of new Set([...Object.keys(base.routes), ...Object.keys(now)])) {
    const want = new Set(base.routes[m] || []), got = new Set(now[m] || []);
    const missing = [...want].filter((x) => !got.has(x)), extra = [...got].filter((x) => !want.has(x));
    report(!missing.length && !extra.length, `${m}: route set identical (${got.size})`, [...missing.map((x) => `missing ${x}`), ...extra.map((x) => `extra   ${x}`)]);
  }
  const ov = overlaps(routes);
  report(!ov.length, `no overlapping patterns (${routes.length} routes, pairwise)`, ov);
  const lay = layering(imports);
  report(!lay.length, `layering: no upward import, no route->route import, no cycle (${Object.keys(imports).length} modules)`, lay);
  console.log(`\nroute-table: ${fail ? `${fail} failed` : 'all passed'}`);
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
