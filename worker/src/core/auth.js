// Auth: PBKDF2 passwords, signed session cookies and Cloudflare Access JWTs
// (moved verbatim from index.js, #3).

import { b64url, int, now, sha256Hex, uuid } from '../lib/http.js';
import { redact } from '../log-safe.js';
import { cookieDomainAttr } from '../site.js';
import { COOKIE_NAME, PBKDF2_ITERATIONS, PBKDF2_MAX_ITERATIONS, SESSION_TTL_SECONDS } from './config.js';
import { getSetting } from './db.js';

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  const iterations = PBKDF2_ITERATIONS;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$${iterations}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterStr, saltHex, hashHex] = (stored || '').split('$');
  if (scheme !== 'pbkdf2') return false;
  // Clamp: a stored hash claiming more than the platform cap must never throw
  // the PBKDF2 "not supported" error — it just fails verification.
  const iterations = Math.min(int(iterStr, PBKDF2_ITERATIONS), PBKDF2_MAX_ITERATIONS);
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHexComputed = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHexComputed === hashHex;
}

export async function getAuthSecret(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind('auth_secret')
    .first();
  return row ? row.value : null;
}

export async function ensureAuthSecret(env) {
  const existing = await getAuthSecret(env);
  if (existing) return existing;
  const secret = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  await env.DB.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('auth_secret', ?, ?)"
  )
    .bind(secret, now())
    .run();
  return secret;
}

export async function signSessionPayload(payloadB64url, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadB64url)
  );
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSessionCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  // `p` = fingerprint of the current password hash. When the password changes,
  // the fingerprint changes too, so every previously issued cookie fails
  // verification and the old session is revoked.
  const pwHash = (await getSetting(env, 'password_hash')) || '';
  const p = (await sha256Hex(pwHash)).slice(0, 16);
  const payload = b64url.encode(JSON.stringify({ v: 1, exp, i: uuid(), p }));
  const secret = await ensureAuthSecret(env);
  const sig = await signSessionPayload(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySessionCookie(req, env) {
  const cookieHeader = req.headers.get('cookie') || '';
  const cookies = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean);
  let token = null;
  for (const c of cookies) {
    const idx = c.indexOf('=');
    if (idx > 0 && c.slice(0, idx).trim() === COOKIE_NAME) {
      token = c.slice(idx + 1).trim();
      break;
    }
  }
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const secret = await getAuthSecret(env);
  if (!secret) return null;
  const expected = await signSessionPayload(payload, secret);
  if (expected !== sig) return null;
  try {
    const data = JSON.parse(b64url.decode(payload));
    if (data.exp < Math.floor(Date.now() / 1000)) return null;
    // Reject sessions issued under a different password (password changes and
    // any cookie minted before this hardening shipped carry no `p`).
    const pwHash = (await getSetting(env, 'password_hash')) || '';
    const p = (await sha256Hex(pwHash)).slice(0, 16);
    if (data.p !== p) return null;
    return data;
  } catch {
    return null;
  }
}

export function sessionCookieSet(token) {
  // Domain-scoped so the plan·site login also unlocks the preview subdomains
  // (v1…v5.<SITE_DOMAIN>) on the couple's own devices.
  // SameSite=Lax allows the cookie on cross-subdomain top-level navigations
  // (link clicks from plan.* to v1/v2/v3.*).
  return `${COOKIE_NAME}=${token}${cookieDomainAttr()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}; Secure`;
}

export function sessionCookieClear() {
  return `${COOKIE_NAME}=${cookieDomainAttr()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

export const ACCESS_CERTS_TTL_MS = 60 * 60 * 1000; // 1 hour

export const ACCESS_CERTS_MIN_REFRESH_MS = 60 * 1000; // unknown kid → refetch at most once a minute

export const ACCESS_CLOCK_SKEW_SECONDS = 60;

export let accessKeyCache = { teamUrl: '', keys: new Map(), fetchedAt: 0 };

export function accessConfig(env) {
  const rawTeam = String((env && env.ACCESS_TEAM_DOMAIN) || '').trim().replace(/\/+$/, '');
  const auds = String((env && env.ACCESS_AUD) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rawTeam || !auds.length) return null;
  const teamUrl = /^https:\/\//i.test(rawTeam) ? rawTeam : `https://${rawTeam}`;
  const allowedEmails = String((env && env.ACCESS_ALLOWED_EMAILS) || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { teamUrl, auds, allowedEmails };
}

export function accessEnabled(env) {
  return !!accessConfig(env);
}

export function b64urlToBytes(s) {
  const bin = b64url.decode(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getAccessKey(teamUrl, kid) {
  const fresh = accessKeyCache.teamUrl === teamUrl && Date.now() - accessKeyCache.fetchedAt < ACCESS_CERTS_TTL_MS;
  if (fresh && accessKeyCache.keys.has(kid)) return accessKeyCache.keys.get(kid);
  // Refetch on expiry, or on an unknown kid (Access rotates its signing keys).
  if (fresh && Date.now() - accessKeyCache.fetchedAt < ACCESS_CERTS_MIN_REFRESH_MS) return null;
  const res = await fetch(`${teamUrl}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of body.keys || []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    keys.set(jwk.kid, key);
  }
  accessKeyCache = { teamUrl, keys, fetchedAt: Date.now() };
  return keys.get(kid) || null;
}

export function readCookie(req, name) {
  const cookieHeader = req.headers.get('cookie') || '';
  for (const c of cookieHeader.split(';')) {
    const idx = c.indexOf('=');
    if (idx > 0 && c.slice(0, idx).trim() === name) return c.slice(idx + 1).trim();
  }
  return null;
}

export async function verifyAccessJwt(req, env) {
  const cfg = accessConfig(env);
  if (!cfg) return null;
  const token = req.headers.get('cf-access-jwt-assertion') || readCookie(req, 'CF_Authorization');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64url.decode(parts[0]));
    const claims = JSON.parse(b64url.decode(parts[1]));
    if (header.alg !== 'RS256' || !header.kid) return null;
    const key = await getAccessKey(cfg.teamUrl, header.kid);
    if (!key) return null;
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.iss !== cfg.teamUrl) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.some((a) => cfg.auds.includes(a))) return null;
    if (typeof claims.exp !== 'number' || claims.exp < nowSec - ACCESS_CLOCK_SKEW_SECONDS) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > nowSec + ACCESS_CLOCK_SKEW_SECONDS) return null;
    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
    // Optional second lock on top of the Access policy itself.
    if (cfg.allowedEmails.length && !cfg.allowedEmails.includes(email)) return null;
    return { v: 1, provider: 'cloudflare-access', email, exp: claims.exp };
  } catch (e) {
    console.error('Access JWT verification failed:', redact((e && e.message) || e, 300));
    return null;
  }
}

// The one session check every gate uses: Cloudflare Access when configured,
// otherwise the password session cookie.
export async function getSession(req, env) {
  if (accessEnabled(env)) return verifyAccessJwt(req, env);
  return verifySessionCookie(req, env);
}

export const ACCESS_LOGOUT_PATH = '/cdn-cgi/access/logout';

export const ACCESS_DISABLED_MSG = 'Sign-in is handled by Cloudflare Access — passwords are switched off.';
