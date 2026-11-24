/**
 * Post-deploy smoke check against the live site. Exits non-zero on any
 * mismatch, so it can gate a deploy or run from CI.
 *
 *   LIVE_DOMAIN=example.com node verify-live.mjs
 *   node verify-live.mjs example.com
 *
 * LIVE_DOMAIN (or the first argument) is required: no domain is hardcoded.
 * Optional:
 *   LIVE_MCP_HOST   the Worker's dedicated MCP hostname, i.e. the host in its
 *                   MCP_PUBLIC_ORIGIN setting. It is NOT derived from the
 *                   domain (it can live on another domain); unset = skipped
 *   VERIFY_ATTEMPTS tries per target before failing (default 3, 5 s apart:
 *                   a deploy has a brief window of transient 5xx)
 *
 * Expectations (routing is in src/index.js; Cloudflare Access sits in front
 * of the portal, preview and family hosts, so those answer with a redirect to
 * the Access login before the Worker runs):
 *   apex                 public guest site          -> 200 text/html with og:title
 *   apex /api/guest/home public guest API           -> 200 JSON with "mode"
 *   plan.<domain>        the planner, behind Access -> 302 to cloudflareaccess.com
 *   v1..v5.<domain>      couple-only previews       -> 302 to cloudflareaccess.com
 *   family.<domain>      family portal, own Access  -> 302 to cloudflareaccess.com
 *   www.<domain>         Cloudflare Redirect Rule   -> 301 to the apex, path + query kept
 *   <mcp host>/mcp       token-only MCP endpoint    -> 401 with this Worker's
 *                        JSON-RPC error -32001 (a bare 401 or a Bearer
 *                        challenge would be some other service)
 */
const DOMAIN = (process.env.LIVE_DOMAIN || process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(DOMAIN)) {
  console.error('verify-live: set LIVE_DOMAIN (or pass the domain as the first argument), e.g. LIVE_DOMAIN=example.com');
  process.exit(2);
}
const ATTEMPTS = Math.max(1, Number(process.env.VERIFY_ATTEMPTS || 3));
const MCP_HOST = (process.env.LIVE_MCP_HOST || '').trim().toLowerCase();

const access = { desc: 'redirect to Cloudflare Access', check: (r) => r.status === 302 && /(^|\.)cloudflareaccess\.com$/.test(hostOf(r.location)) };
const status = (code, desc, bodyCheck) => ({
  desc: desc || `HTTP ${code}`,
  check: (r) => r.status === code && (!bodyCheck || bodyCheck(r)),
});
const json = (r) => { try { return JSON.parse(r.body); } catch { return null; } };
// A Cloudflare Redirect Rule (no Worker involved): exact 301 target.
const redirect301 = (to) => ({ desc: `301 to ${to}`, check: (r) => r.status === 301 && r.location === to });
function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }

const targets = [
  { url: `https://${DOMAIN}/`, note: 'apex (public guest site)', expect: status(200, 'HTTP 200 text/html with og:title', (r) => /^text\/html/i.test(r.contentType) && r.body.includes('og:title')) },
  { url: `https://${DOMAIN}/api/guest/home`, note: 'apex guest API (public)', expect: status(200, 'HTTP 200 JSON with "mode"', (r) => typeof json(r)?.mode === 'string') },
  { url: `https://plan.${DOMAIN}/`, note: 'planner (behind Access)', expect: access },
  { url: `https://plan.${DOMAIN}/api/guest/home`, note: 'planner host API (behind Access, not public)', expect: access },
  ...[1, 2, 3, 4, 5].flatMap((n) => [
    { url: `https://v${n}.${DOMAIN}/`, note: `v${n} preview root (couple only)`, expect: access },
    { url: `https://v${n}.${DOMAIN}/api/guest/home`, note: `v${n} preview API (couple only)`, expect: access },
  ]),
  { url: `https://family.${DOMAIN}/`, note: 'family portal (own Access app)', expect: access },
  { url: `https://www.${DOMAIN}/`, note: 'www redirects to the apex', expect: redirect301(`https://${DOMAIN}/`) },
  { url: `https://www.${DOMAIN}/rsvp/abc?x=1&y=two`, note: 'www keeps path and query', expect: redirect301(`https://${DOMAIN}/rsvp/abc?x=1&y=two`) },
];
if (MCP_HOST) {
  targets.push({ url: `https://${MCP_HOST}/mcp`, note: 'MCP host (token only)', expect: status(401, 'HTTP 401 with JSON-RPC error -32001', (r) => json(r)?.error?.code === -32001) });
} else {
  console.log('SKIP  MCP host check (set LIVE_MCP_HOST to the host in MCP_PUBLIC_ORIGIN)');
}

async function probe(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location') || '', contentType: res.headers.get('content-type') || '', body: text };
  } catch (e) {
    return { status: 0, location: '', contentType: '', body: '', error: e.cause?.code || e.message };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const describe = (r) => (r.error ? `error ${r.error}` : `HTTP ${r.status}${r.location ? ` -> ${r.location.length > 160 ? `${r.location.slice(0, 160)}...` : r.location}` : ''}${r.contentType ? ` (${r.contentType.split(';')[0]}, ${r.body.length} bytes)` : ''}`);

let failed = 0;
for (const t of targets) {
  let r;
  for (let i = 1; i <= ATTEMPTS; i++) {
    r = await probe(t.url);
    if (t.expect.check(r)) break;
    if (i < ATTEMPTS) await sleep(5000);
  }
  const ok = t.expect.check(r);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.url}  [${t.note}]  expected: ${t.expect.desc}${ok ? '' : `, got: ${describe(r)}`}`);
}

console.log(`\nverify-live: ${targets.length - failed}/${targets.length} passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
