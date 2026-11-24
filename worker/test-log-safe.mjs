// Unit checks for src/log-safe.js: what reaches Workers Logs is redacted, and
// redaction itself never throws. Plus the MCP regression: a planner tool whose
// dispatch throws returns { ok: false } (redactError must be imported there).
import { redact, redactError, isSecretPath, withQuietLogs } from './src/log-safe.js';
import { runTool } from './src/mcp.js';

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`, got); }
}

// Emails
const smtp = redact('SMTP error: 550 5.1.1 <jane.doe+rsvp@example.co.uk> recipient rejected');
check('masks an email inside a mail-server reply', !smtp.includes('jane.doe') && !smtp.includes('example.co.uk') && smtp.includes('j***@e***.uk'), smtp);
const two = redact('a@b.com and c.d@e.org');
check('masks every email', !two.includes('a@b.com') && !two.includes('c.d@e.org'), two);
const enc = redact('GET /x?to=jane%40example.com');
check('masks a URL-encoded email', !enc.includes('jane') && !enc.includes('example.com'), enc);
const ent = redact('to jane&#64;example.com, bob&#x40;example.org, sue&commat;example.net');
check('masks HTML-entity emails', !/jane|bob|sue|example\.(com|org|net)/.test(ent), ent);
check('leaves text without emails alone', redact('IMAP LOGIN failed: NO [AUTHENTICATIONFAILED]') === 'IMAP LOGIN failed: NO [AUTHENTICATIONFAILED]');

// Secrets
const mcp = redact('fetch https://mcp.example.com/mcp/AbC123secretTOKEN failed');
check('scrubs /mcp/<token>', !mcp.includes('AbC123secretTOKEN') && mcp.includes('/mcp/[token]'), mcp);
const pt = redact('https://v1.example.com/?pt=deadbeefcafe&x=1 and /a?b=2&pt=0123abcd');
check('scrubs pt= preview tokens', !pt.includes('deadbeefcafe') && !pt.includes('0123abcd') && pt.includes('pt=[token]&x=1'), pt);
const bearer = redact('Authorization: Bearer abc.DEF-123_xyz=');
check('scrubs Bearer tokens', !bearer.includes('abc.DEF') && bearer.includes('Bearer [token]'), bearer);
const key = redact('Claude API error 401: invalid x-api-key sk-ant-api03-AAAAbbbb_cccc-dddd');
check('scrubs Anthropic keys', !key.includes('AAAAbbbb') && key.includes('sk-ant-[key]'), key);

// Shape
const capped = redact('word '.repeat(50), 10);
check('caps length', capped.length <= 11 && capped.endsWith('…') && capped.startsWith('word'), capped);
const blob = redact('a'.repeat(64 * 1024));
check('a long token with no @ is cut, not dropped', blob === `${'a'.repeat(1500)}…`, blob.length);
check('handles null/undefined', redact(null) === '' && redact(undefined) === '');
const err = new Error('send to bob@example.com failed');
const r = redactError(err);
check('redactError masks the stack', !r.includes('bob@example.com') && r.includes('Error: send to b***@e***.com failed'), r);
check('redactError on a non-Error', redactError('plain x@y.io') === 'plain x***@y***.io', redactError('plain x@y.io'));

// Never throws
let threw = false, out;
try {
  out = [
    redact(Object.create(null)),
    redact({ toString() { throw new Error('nope'); } }),
    redact({ toString() { return {}; } }),
    redactError(Object.create(null)),
    redactError({ get stack() { throw new Error('nope'); } }),
    redactError({ get message() { throw new Error('nope'); } }),
  ];
} catch (e) { threw = e; }
check('never throws on hostile values', !threw && out.every((x) => typeof x === 'string'), threw || out);
check('unloggable values log as [unloggable]', out && out[0] === '[unloggable]' && out[1] === '[unloggable]' && out[4] === '[unloggable]', out);

// Bounded cost: huge inputs (an IMAP line can be 64 KB) are cut before any
// regex. These shapes were quadratic before the fix (64 KB took ~6 s).
for (const [label, size] of [['64 KB', 64 * 1024], ['1 MB', 1024 * 1024]]) {
  const shapes = {
    'no @': 'a'.repeat(size),
    'dotted': 'a.'.repeat(size / 2),
    'many @': 'x@'.repeat(size / 2),
    'emails': 'jane.doe@example.com '.repeat(Math.floor(size / 21)),
  };
  let worst = 0, worstShape = '';
  for (const [shape, input] of Object.entries(shapes)) {
    const t = performance.now();
    redact(input);
    redactError({ stack: input });
    const ms = performance.now() - t;
    if (ms > worst) { worst = ms; worstShape = shape; }
  }
  check(`redact() on ${label} finishes in under 50 ms (worst: ${worstShape}, ${worst.toFixed(1)} ms)`, worst < 50, worst);
}
const huge = redact('jane.doe@example.com '.repeat(5000));
check('huge input is capped and still masked', huge.length <= 1501 && !huge.includes('jane.doe') && huge.includes('j***@e***.com'), huge.slice(0, 80));
// The pre-regex cut lands inside an address: the half address must not leak.
const split = redact(`${'y'.repeat(2990)} jane.doe@example.com`);
check('an address cut in half at the edge is dropped, not leaked', !split.includes('jane') && !split.includes('example'), split.slice(-40));

// MCP regression: a dispatch that throws a plain Error must not escape runTool.
const origError = console.error;
const logged = [];
console.error = (...a) => logged.push(a.join(' '));
let res, escaped = null;
try {
  res = await runTool('list_tasks', {}, async () => { throw new Error('D1 exploded for guest@example.com'); });
} catch (e) { escaped = e; }
console.error = origError;
check('runTool: throwing dispatch returns ok:false', !escaped && res && res.ok === false, escaped || res);
check('runTool: the failure log is redacted', logged.length === 1 && logged[0].includes('planner tool failed') && !logged[0].includes('guest@example.com'), logged);

// Quiet requests: nothing reaches the console while a /mcp/<token> request runs.
// (Spies go in BEFORE the first withQuietLogs, which wraps the current methods.)
// Must match every path the router hands to MCP after "/mcp/" (startsWith).
const secretPaths = ['/mcp/wpm_abc', '/mcp/x/y', '/mcp//t', '/mcp/t/', '/mcp/%74', '/mcp/', '/mcp///t//'];
const plainPaths = ['/mcp', '/api/mcp/tokens', '/mcpx/t', '/', '', undefined];
check('isSecretPath: every /mcp/... path the router routes (incl. /mcp//t, /mcp/t/, /mcp/%74)', secretPaths.every(isSecretPath), secretPaths.filter((p) => !isSecretPath(p)));
check('isSecretPath: bare /mcp and non-MCP paths are not secret', !plainPaths.some(isSecretPath), plainPaths.filter(isSecretPath));
const seen = [];
const saved = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  saved[level] = console[level];
  console[level] = (...a) => seen.push(level + ':' + a.join(' '));
}
let inner;
await withQuietLogs(async () => {
  console.log('q1'); console.warn('mcp unauthorized'); console.error('planner tool failed');
  await new Promise((r) => setTimeout(r, 5));
  console.info('q2'); console.debug('q3');
  inner = 'ran';
});
console.warn('loud-after');
const quietOk = inner === 'ran' && !seen.some((x) => /q1|q2|q3|unauthorized|planner tool/.test(x));
const resumeOk = seen.includes('warn:loud-after');
seen.length = 0;
let release;
const slow = withQuietLogs(() => new Promise((r) => { release = r; }));
await withQuietLogs(async () => { console.error('overlap-inner'); });
console.error('while-slow-open');
release();
await slow;
console.error('after-both');
const overlapOk = !seen.some((x) => /overlap-inner|while-slow-open/.test(x)) && seen.includes('error:after-both');
const overlapSeen = [...seen];
seen.length = 0;
let rethrown = false;
try { await withQuietLogs(async () => { console.error('boom-inside'); throw new Error('boom'); }); } catch (e) { rethrown = e.message === 'boom'; }
console.error('after-throw');
const throwOk = rethrown && !seen.some((x) => /boom-inside/.test(x)) && seen.includes('error:after-throw');
const throwSeen = [...seen];
seen.length = 0;
// A request that never settles: its hold releases after maxMs, so the isolate
// (cron included) is not silenced forever, and the late settle does not
// release the gate a second time.
let settleStuck;
const stuck = withQuietLogs(() => new Promise((r) => { settleStuck = r; }), { maxMs: 30 });
console.error('during-stuck');
await new Promise((r) => setTimeout(r, 60));
console.error('after-timeout');
settleStuck();
await stuck;
await withQuietLogs(async () => { console.error('still-gated-later'); });
console.error('end');
const timeoutOk = !seen.includes('error:during-stuck') && seen.includes('error:after-timeout')
  && !seen.includes('error:still-gated-later') && seen.includes('error:end');
const timeoutSeen = [...seen];
for (const level of Object.keys(saved)) console[level] = saved[level];
check('withQuietLogs: no console line inside, across awaits', quietOk);
check('withQuietLogs: logging resumes afterwards', resumeOk);
check('withQuietLogs: overlapping requests keep the gate closed until the last ends', overlapOk, overlapSeen);
check('withQuietLogs: rethrows and reopens the gate after an error', throwOk, throwSeen);
check('withQuietLogs: a never-settling request releases the gate after maxMs (no double release)', timeoutOk, timeoutSeen);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
