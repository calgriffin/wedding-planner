#!/usr/bin/env node
/**
 * One-command local test run: `npm test` (from worker/).
 *
 * For each suite that needs a Worker it creates a throwaway state dir, applies
 * the D1 migrations, starts `wrangler dev --local` with the vars that suite
 * needs, waits until it answers, runs the suite, and ALWAYS stops the server.
 * Exit code is non-zero if any suite fails or anything cannot start.
 *
 * Suites (in order): test-family and test-site (unit, no server), test-local
 * (server, email dry-run), test-assistant (server + fake mailbox/Claude API,
 * SITE_DOMAIN=planner.test so its cron-brief link check proves the var is used).
 * Then the #3 split guards: routes (route set + overlap + layering,
 * scripts/route-table.mjs), lint (eslint no-undef over src), bundle (dry-run
 * size, sideEffects guard, route modules present, scripts/check-bundle.mjs),
 * move-selftest (check-move and fix-imports against a fixture repo holding
 * every known move exploit, scripts/test-check-move.mjs; always runs),
 * move (verbatim move vs the merge base; refactor/split-* branches or
 * CHECK_MOVE=1).
 * Manual: --only capture (rendered-output capture into CAPTURE_OUT).
 *
 * Options / env (CI-friendly, no prompts):
 *   --port <n>  | TEST_PORT       Worker port (default 8787; the suites'
 *                                 nip.io host checks assume the same port)
 *   --only <name[,name]>          run just these suites (family,brand,site,log-safe,push,routes,lint,move-selftest,move,bundle,local,assistant,chat,capture)
 *   --keep-state                  keep the throwaway state dir
 *   --startup-timeout <seconds>   wait for the server (default 90)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = Number(arg('port', process.env.TEST_PORT || 8787));
const ONLY = arg('only', '').split(',').filter(Boolean);
const KEEP = process.argv.includes('--keep-state');
const STARTUP_MS = Number(arg('startup-timeout', 90)) * 1000;
// The D1 database name, read from wrangler.toml (never repeated in source).
const DB_NAME = (readFileSync(join(WORKER_DIR, 'wrangler.toml'), 'utf8').match(/database_name\s*=\s*"([^"]+)"/) || [])[1];
if (!DB_NAME) throw new Error('run-tests: no database_name in wrangler.toml');
const BASE = `http://127.0.0.1:${PORT}`;

const wranglerBin = join(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

const SERVER_SUITES = {
  local: {
    file: 'test-local.mjs',
    // A test brand overrides wrangler.toml's WEDDING_* vars (configured path).
    vars: { EMAIL_DRY_RUN: '1', ASSISTANT_ALLOWED_EMAILS: 'couple@test.local', WEDDING_NAME: 'The Test Wedding', WEDDING_SHORT_NAME: 'Test', WEDDING_HASHTAG: '#TheTestWedding' },
    flags: [],
    // Exact count of a Worker log line in the dev server output. test-local
    // sends 6 unauthorized MCP requests: 5 with the token in the path (a bad
    // token as /mcp/t, /mcp//t, /mcp/t/ and /mcp/%74..., plus a revoked one:
    // they must log nothing, the path is the secret) and 1 to bare /mcp (logs
    // once, which proves Worker logs are captured at all).
    expectLogCounts: { 'mcp unauthorized': 1 },
  },
  assistant: {
    file: 'test-assistant.mjs',
    vars: {
      SITE_DOMAIN: 'planner.test',
      // Brand blanked: this suite checks the neutral fallback.
      WEDDING_NAME: '',
      WEDDING_SHORT_NAME: '',
      WEDDING_HASHTAG: '',
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8799',
      ASSISTANT_MAIL_USER: 'ai@planner.test',
      ASSISTANT_MAIL_PASSWORD: 'mailpass',
      ASSISTANT_IMAP_HOST: '127.0.0.1',
      ASSISTANT_IMAP_PORT: '1143',
      ASSISTANT_SMTP_PORT: '1025',
      ASSISTANT_MAIL_TLS: 'off',
      ASSISTANT_ALLOWED_EMAILS: 'one@couple.test,two@couple.test',
      DAILY_BRIEF_TIME: '00:00',
      // A non-default model: the assistant and the brief must use it.
      ASSISTANT_MODEL: 'claude-sonnet-5-5',
      // Canaries: the SDK would act on these if vars reached process.env
      // (wrangler.toml keeps it empty). test-assistant asserts they never do.
      ANTHROPIC_CUSTOM_HEADERS: 'x-env-canary: 1',
      ANTHROPIC_AUTH_TOKEN: 'canary-token',
      // The app chat's own check-ins are tested in the chat suite; off here so
      // this suite's cron runs make exactly the model calls it counts.
      CHAT_CHECKIN: 'off',
    },
    flags: ['--test-scheduled'],
  },
  // In-app assistant chat: fake Claude API, fake push service (decrypts what
  // it receives) and fake SMTP for the email fallback.
  chat: {
    file: 'test-chat.mjs',
    vars: {
      SITE_DOMAIN: 'planner.test',
      ANTHROPIC_API_KEY: 'chat-key',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8797',
      ASSISTANT_MODEL: 'claude-sonnet-5-5',
      ASSISTANT_ALLOWED_EMAILS: 'one@couple.test,two@couple.test',
      ASSISTANT_MAIL_USER: 'ai@planner.test',
      ASSISTANT_MAIL_PASSWORD: 'mailpass',
      ASSISTANT_IMAP_HOST: '127.0.0.1',
      ASSISTANT_SMTP_PORT: '1026',
      ASSISTANT_MAIL_TLS: 'off',
      DAILY_BRIEF: 'off',
      CHAT_CHECKIN_TIME: '00:00',
      PUSH_ALLOW_HOSTS: '127.0.0.1',
    },
    flags: ['--test-scheduled'],
  },
  // Rendered-output capture for no-behaviour-change refactors (#3). Manual:
  // runs only with --only capture, writing into CAPTURE_OUT. Compare two runs
  // with `node scripts/capture-outputs.mjs --compare <a> <b>`.
  capture: {
    file: 'scripts/capture-outputs.mjs',
    vars: { SITE_DOMAIN: 'wedding.test', EMAIL_DRY_RUN: '1', ASSISTANT_ALLOWED_EMAILS: 'couple@test.local' },
    flags: [],
    manual: true,
  },
};

const log = (m) => console.log(`[run-tests] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runWrangler(args) {
  return spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: WORKER_DIR, encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
}

/** Kill the whole process tree (wrangler spawns workerd as a child). */
function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  }
}

async function portInUse() {
  try { await fetch(BASE, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}

async function waitReady(child, getOutput) {
  const deadline = Date.now() + STARTUP_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early (code ${child.exitCode})\n${getOutput()}`);
    try {
      const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      if (r.status > 0) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`wrangler dev not ready after ${STARTUP_MS / 1000}s\n${getOutput()}`);
}

function runNode(file, args = []) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [file, ...args], { cwd: WORKER_DIR, stdio: 'inherit' });
    c.on('error', () => resolve(1));
    c.on('exit', (code) => resolve(code ?? 1));
  });
}

async function runServerSuite(name, suite) {
  const stateDir = mkdtempSync(join(tmpdir(), `wp-test-${name}-`));
  let server;
  let output = '';
  const logCounts = {};
  try {
    log(`${name}: applying migrations (state ${stateDir})`);
    const mig = runWrangler(['d1', 'migrations', 'apply', DB_NAME, '--local', '--persist-to', stateDir]);
    if (mig.status !== 0) {
      console.error(mig.stdout, mig.stderr);
      throw new Error('migrations failed');
    }
    const varArgs = Object.entries(suite.vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]);
    log(`${name}: starting wrangler dev on :${PORT}`);
    server = spawn(
      process.execPath,
      [wranglerBin, 'dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', stateDir, ...suite.flags, ...varArgs],
      { cwd: WORKER_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: !isWin, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } },
    );
    const collect = (d) => {
      output = (output + d).slice(-8000);
      for (const msg of Object.keys(suite.expectLogCounts || {})) {
        logCounts[msg] = (logCounts[msg] || 0) + String(d).split(msg).length - 1;
      }
    };
    server.stdout.on('data', collect);
    server.stderr.on('data', collect);
    await waitReady(server, () => output);
    log(`${name}: server ready, running ${suite.file}`);
    const code = await runNode(suite.file, [BASE]);
    await sleep(300); // let the last log lines flush
    let logFail = false;
    for (const [msg, want] of Object.entries(suite.expectLogCounts || {})) {
      const got = logCounts[msg] || 0;
      if (got !== want) logFail = true;
      console.log(`  ${got === want ? 'PASS' : 'FAIL'}  server log "${msg}" appears ${want}x (got ${got})`);
    }
    return code || (logFail ? 1 : 0);
  } finally {
    killTree(server);
    if (server) await sleep(500);
    if (!KEEP) {
      try { rmSync(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* best effort */ }
    }
  }
}

/** Newest modification time (ms) of the frontend inputs the bundle is built from. */
function newestFrontendInput(frontend) {
  let newest = 0;
  const visit = (p) => {
    const st = statSync(p);
    if (st.isDirectory()) { for (const name of readdirSync(p)) visit(join(p, name)); }
    else if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  for (const rel of ['src', 'public', 'index.html', 'package.json', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json']) {
    const p = join(frontend, rel);
    if (existsSync(p)) visit(p);
  }
  return newest;
}

async function main() {
  // src/assets.js is generated at deploy time (frontend build -> gen-assets)
  // and git-ignored, but the Worker imports it and the SPA checks need the real
  // bundle. Build it the same way the deploy does when it is missing (fresh
  // checkout) or older than the frontend sources (a stale bundle fails the
  // SPA checks, e.g. the lazy page chunks).
  const assetsFile = join(WORKER_DIR, 'src', 'assets.js');
  const frontend = join(WORKER_DIR, '..', 'frontend');
  const missing = !existsSync(assetsFile);
  const stale = !missing && statSync(assetsFile).mtimeMs < newestFrontendInput(frontend);
  if (missing || stale) {
    const npm = isWin ? 'npm.cmd' : 'npm';
    const sh = (cmd, args, cwd) => {
      const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin && cmd === npm });
      if (r.status !== 0) { console.error(`[run-tests] "${cmd} ${args.join(' ')}" failed`); process.exit(1); }
    };
    log(`src/assets.js ${missing ? 'missing (fresh checkout)' : 'older than the frontend sources'}: rebuilding the frontend bundle`);
    if (!existsSync(join(frontend, 'node_modules'))) sh(npm, ['ci'], frontend);
    sh(npm, ['run', 'build'], frontend);
    sh(process.execPath, ['generate-assets.js'], WORKER_DIR);
  }

  const wanted = (n) => ONLY.length === 0 || ONLY.includes(n);
  const results = [];

  if (wanted('family')) {
    log('family: unit suite');
    results.push(['family', await runNode('test-family.mjs')]);
  }
  if (wanted('brand')) {
    log('brand: unit suite');
    results.push(['brand', await runNode('test-brand.mjs')]);
  }
  if (wanted('site')) {
    log('site: unit suite');
    results.push(['site', await runNode('test-site.mjs')]);
  }
  if (wanted('log-safe')) {
    log('log-safe: unit suite');
    results.push(['log-safe', await runNode('test-log-safe.mjs')]);
  }
  if (wanted('push')) {
    log('push: Web Push encryption + VAPID unit suite');
    results.push(['push', await runNode('test-push.mjs')]);
  }
  // #3 split guards: route sets + overlaps + layering; every name resolves
  // (no-undef); bundle size, side effects and route modules present.
  if (wanted('routes')) {
    log('routes: route set, overlap and layering check');
    results.push(['routes', await runNode('scripts/route-table.mjs')]);
  }
  if (wanted('lint')) {
    log('lint: no undefined identifiers (eslint no-undef)');
    results.push(['lint', await runNode(join(WORKER_DIR, 'node_modules', 'eslint', 'bin', 'eslint.js'), ['src'])]);
  }
  // The move checker's own self-test: every known exploit must fail it.
  if (wanted('move-selftest')) {
    log('move-selftest: check-move rejects every known move exploit; fix-imports edits only imports');
    results.push(['move-selftest', await runNode('scripts/test-check-move.mjs')]);
  }
  // Verbatim-move check against the merge base. It only accepts pure moves,
  // so it runs on the split's own branches (refactor/split-*) or when forced
  // with CHECK_MOVE=1, and is skipped for ordinary feature work.
  if (wanted('move')) {
    const git = (...a) => spawnSync('git', a, { cwd: WORKER_DIR, encoding: 'utf8' });
    const branch = (git('rev-parse', '--abbrev-ref', 'HEAD').stdout || '').trim();
    if (process.env.CHECK_MOVE === '1' || branch.startsWith('refactor/split-')) {
      const mb = git('merge-base', 'HEAD', 'origin/main');
      const base = (mb.stdout || '').trim();
      if (mb.status !== 0 || !base) {
        console.error('[run-tests] move: no merge base with origin/main (fetch it first)');
        results.push(['move', 1]);
      } else {
        log(`move: verbatim move check vs merge base ${base.slice(0, 7)} (${branch})`);
        results.push(['move', await runNode('scripts/check-move.mjs', [base])]);
      }
    } else {
      log(`move: skipped on ${branch || 'detached HEAD'} (runs on refactor/split-* or with CHECK_MOVE=1)`);
    }
  }
  if (wanted('bundle')) {
    log('bundle: dry-run size, sideEffects guard, route modules present');
    results.push(['bundle', await runNode('scripts/check-bundle.mjs')]);
  }
  const serverSuites = Object.keys(SERVER_SUITES).filter((n) => (SERVER_SUITES[n].manual ? ONLY.includes(n) : wanted(n)));
  if (serverSuites.length && (await portInUse())) {
    console.error(`[run-tests] port ${PORT} is already in use; stop that server or pass --port <n>`);
    process.exit(2);
  }
  for (const name of serverSuites) {
    try {
      results.push([name, await runServerSuite(name, SERVER_SUITES[name])]);
    } catch (e) {
      console.error(`[run-tests] ${name}: ${e.message}`);
      results.push([name, 1]);
    }
  }

  console.log('\n[run-tests] summary');
  for (const [n, code] of results) console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  ${n}`);
  process.exit(results.every(([, c]) => c === 0) && results.length ? 0 : 1);
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
main().catch((e) => { console.error(e); process.exit(1); });
