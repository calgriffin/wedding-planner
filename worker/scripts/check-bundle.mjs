#!/usr/bin/env node
/**
 * Bundle + side-effects checks for the index.js split (#3).
 *
 *   node scripts/check-bundle.mjs            check against scripts/bundle-baseline.json
 *   node scripts/check-bundle.mjs --write    record the current size as the baseline
 *
 * 1. Side-effects guard: route modules register their routes as import side
 *    effects, so no package.json in the Worker build may declare
 *    "sideEffects": false (a bundler could then drop them).
 * 2. `wrangler deploy --dry-run`: the total upload size stays within ±2 KiB of
 *    the baseline (a pure move barely changes one bundled script).
 * 3. Every route registration in src/ is in the bundled output as a call with
 *    its method and path (`route("GET", "/api/health", …`, whatever the
 *    bundler renames `route` to), so no route module was left out or
 *    tree-shaken away. Matching the path text alone is not enough: the
 *    frontend bundle in assets.js holds the same path strings.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collect } from './route-table.mjs';

const WORKER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(WORKER_DIR, 'scripts', 'bundle-baseline.json');
const TOLERANCE_KIB = 2;

let fail = 0;
const report = (ok, msg, detail) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) { fail++; if (detail) console.log(`        ${[].concat(detail).join('\n        ')}`); } };

// 1. sideEffects guard
const pkgs = [path.join(WORKER_DIR, 'package.json')];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'package.json') pkgs.push(p); } };
walk(path.join(WORKER_DIR, 'src'));
const offenders = pkgs.filter((p) => JSON.parse(fs.readFileSync(p, 'utf8')).sideEffects === false);
report(!offenders.length, `no "sideEffects": false in ${pkgs.length} package.json file(s)`, offenders.map((p) => path.relative(WORKER_DIR, p)));

// 2. dry-run bundle
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-bundle-'));
const wrangler = path.join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const r = spawnSync(process.execPath, [wrangler, 'deploy', '--dry-run', '--outdir', out], { cwd: WORKER_DIR, encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
const text = `${r.stdout || ''}${r.stderr || ''}`;
const size = Number((text.match(/Total Upload:\s*([\d.]+)\s*KiB/) || [])[1]);
if (r.status !== 0 || !size) {
  report(false, 'wrangler deploy --dry-run', text.split('\n').slice(-15));
  process.exit(1);
}
if (process.argv.includes('--write')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ totalKiB: size, toleranceKiB: TOLERANCE_KIB }, null, 2) + '\n');
  console.log(`check-bundle: baseline written (${size} KiB)`);
  process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const delta = Math.round((size - base.totalKiB) * 100) / 100;
report(Math.abs(delta) <= base.toleranceKiB, `bundle ${size} KiB, baseline ${base.totalKiB} KiB (Δ ${delta >= 0 ? '+' : ''}${delta} KiB, limit ±${base.toleranceKiB})`);

// 3. every route module made it into the bundle
const bundled = fs.readdirSync(out).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n');
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, (c) => `\\${c}`);
const routeCall = (rt) => new RegExp(`[\\w$]\\(\\s*(["'\`])${escRe(rt.method)}\\1\\s*,\\s*(["'\`])${escRe(rt.pattern)}\\2\\s*,`);
const all = collect().routes;
const missing = all.filter((rt) => !routeCall(rt).test(bundled));
report(!missing.length, `every route registration is in the bundle as a call (${all.length} routes, ${new Set(all.map((rt) => rt.file)).size} module(s))`, missing.map((rt) => `${rt.file}:${rt.line}: route(${rt.method}, ${rt.pattern}) not in the bundle`));
fs.rmSync(out, { recursive: true, force: true });

console.log(`\ncheck-bundle: ${fail ? `${fail} failed` : 'all passed'}`);
process.exit(fail ? 1 : 0);
