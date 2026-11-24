/**
 * Cloudflare Access (Zero Trust) JWT verification.
 *
 * The family portal does NOT use the plan password or the wp_session cookie.
 * Its only credential is the identity Cloudflare Access attaches to every
 * request it lets through: a signed RS256 JWT in the `Cf-Access-Jwt-Assertion`
 * header (and the `CF_Authorization` cookie). The Worker re-verifies that
 * token itself rather than trusting "the request arrived, so Access must have
 * approved it" — a missing/misconfigured Access application, a workers.dev
 * route or a forged header all fail here instead of leaking payments.
 *
 * Configuration (Worker variables/secrets — set in the Cloudflare dashboard,
 * never in this repo):
 *  - CF_ACCESS_TEAM_DOMAIN   e.g. "yourteam.cloudflareaccess.com"
 *  - CF_ACCESS_AUD           the Access application's "Application Audience
 *                            (AUD) Tag"
 *
 * This module only proves WHO is signed in. Whether that person is on the
 * family list is a second check in family.js (see family-access.js).
 *
 * Fails closed: with either required value missing, nobody gets in.
 */

const JWKS_TTL_MS = 10 * 60 * 1000; // re-fetch signing keys every 10 minutes
const CLOCK_SKEW_SECONDS = 60;

// Module-scope cache (per isolate): { [issuer]: { at, keys } }
const jwksCache = new Map();

export function accessConfig(env) {
  const raw = String((env && env.CF_ACCESS_TEAM_DOMAIN) || '').trim();
  const aud = String((env && env.CF_ACCESS_AUD) || '').trim();
  if (!raw || !aud) return null;
  const host = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return { issuer: `https://${host}`, aud };
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

function readToken(request) {
  const header = request.headers.get('cf-access-jwt-assertion');
  if (header) return header.trim();
  const cookies = (request.headers.get('cookie') || '').split(';');
  for (const c of cookies) {
    const idx = c.indexOf('=');
    if (idx > 0 && c.slice(0, idx).trim() === 'CF_Authorization') return c.slice(idx + 1).trim();
  }
  return null;
}

async function getSigningKeys(issuer, fetchImpl, force) {
  const cached = jwksCache.get(issuer);
  if (!force && cached && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
  const res = await fetchImpl(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const body = await res.json();
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  jwksCache.set(issuer, { at: Date.now(), keys });
  return keys;
}

/**
 * Verifies the Access identity on a request.
 * Returns { ok: true, email } or { ok: false, reason } where reason is one of
 * 'not_configured' | 'missing' | 'invalid' | 'certs_unavailable'.
 */
export async function verifyAccess(request, env, { fetchImpl = fetch, nowSeconds } = {}) {
  const cfg = accessConfig(env);
  if (!cfg) return { ok: false, reason: 'not_configured' };

  const token = readToken(request);
  if (!token) return { ok: false, reason: 'missing' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid' };

  let header;
  let payload;
  try {
    header = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  // Only RS256 — never let the token pick a weaker (or "none") algorithm.
  if (!header || header.alg !== 'RS256' || !header.kid) return { ok: false, reason: 'invalid' };

  let keys;
  try {
    keys = await getSigningKeys(cfg.issuer, fetchImpl, false);
    // Unknown kid → Access may have rotated keys; refresh once.
    if (!keys.some((k) => k.kid === header.kid)) keys = await getSigningKeys(cfg.issuer, fetchImpl, true);
  } catch {
    return { ok: false, reason: 'certs_unavailable' };
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'invalid' };

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'invalid' };

  const nowS = nowSeconds !== undefined ? nowSeconds : Math.floor(Date.now() / 1000);
  const audOk = Array.isArray(payload.aud) ? payload.aud.includes(cfg.aud) : payload.aud === cfg.aud;
  if (!audOk || payload.iss !== cfg.issuer) return { ok: false, reason: 'invalid' };
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < nowS) return { ok: false, reason: 'invalid' };
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > nowS) return { ok: false, reason: 'invalid' };

  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) return { ok: false, reason: 'invalid' };
  return { ok: true, email };
}

// Test hook: drop cached signing keys.
export function _resetAccessCache() {
  jwksCache.clear();
}
