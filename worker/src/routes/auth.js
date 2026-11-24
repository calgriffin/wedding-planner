// Auth routes: status, first-run init, login, logout, check, change password
// (moved verbatim from index.js, #3).

import { ACCESS_DISABLED_MSG, ACCESS_LOGOUT_PATH, accessEnabled, createSessionCookie, ensureAuthSecret, getSession, hashPassword, sessionCookieClear, sessionCookieSet, verifyPassword } from '../core/auth.js';
import { LOGIN_LOCK_MS, LOGIN_MAX_FAILS, SETTING_LOGIN_FAILS, SETTING_LOGIN_LOCK_UNTIL } from '../core/config.js';
import { getSetting, setSetting } from '../core/db.js';
import { route } from '../core/router.js';
import { err, int, now, ok, readBody } from '../lib/http.js';
import { redact } from '../log-safe.js';

route('GET', '/api/auth/status', async (env, req) => {
  if (accessEnabled(env)) {
    const session = await getSession(req, env);
    return ok({
      initialized: true,
      authenticated: !!session,
      temporary: false,
      provider: 'cloudflare-access',
      email: (session && session.email) || '',
      logout_url: ACCESS_LOGOUT_PATH,
    });
  }
  const hash = await getSetting(env, 'password_hash');
  const temporary = (await getSetting(env, 'password_temporary')) === 'true';
  const out = { initialized: !!hash, authenticated: false, temporary, provider: 'password' };
  if (!hash) {
    // Pre-init: surface the temporary access code so the first-run page can display it.
    const shared = await getSetting(env, 'temp_password_shared');
    if (shared) out.temporary_password = shared;
  }
  return ok(out);
}, { auth: false });

route('POST', '/api/auth/init', async (env, req) => {
  if (accessEnabled(env)) return err(ACCESS_DISABLED_MSG, 410);
  const existing = await getSetting(env, 'password_hash');
  if (existing) return err('Password already set', 409);
  const body = await readBody(req);
  const password = String(body.password || '');
  if (password.length < 8) return err('Password must be at least 8 characters');
  const hash = await hashPassword(password);
  await setSetting(env, 'password_hash', hash);
  const temporary = !!body.temporary;
  await setSetting(env, 'password_temporary', temporary ? 'true' : 'false');
  if (temporary) await setSetting(env, 'temp_password_shared', password);
  await ensureAuthSecret(env);
  const token = await createSessionCookie(env);
  const res = ok({ initialized: true, temporary });
  res.headers.append('Set-Cookie', sessionCookieSet(token));
  return res;
}, { auth: false });

route('POST', '/api/auth/login', async (env, req) => {
  if (accessEnabled(env)) return err(ACCESS_DISABLED_MSG, 410);
  const hash = await getSetting(env, 'password_hash');
  if (!hash) return err('System not initialized yet', 409);
  // Brute-force backoff: N consecutive failures locks the endpoint briefly.
  const lockedUntil = int(await getSetting(env, SETTING_LOGIN_LOCK_UNTIL), 0);
  if (lockedUntil > Date.now()) {
    const waitSec = Math.ceil((lockedUntil - Date.now()) / 1000);
    return err(`Too many failed attempts — try again in ${waitSec}s.`, 429);
  }
  const body = await readBody(req);
  const valid = await verifyPassword(String(body.password || ''), hash);
  if (!valid) {
    const fails = int(await getSetting(env, SETTING_LOGIN_FAILS), 0) + 1;
    await setSetting(env, SETTING_LOGIN_FAILS, String(fails));
    if (fails >= LOGIN_MAX_FAILS) {
      await setSetting(env, SETTING_LOGIN_LOCK_UNTIL, String(Date.now() + LOGIN_LOCK_MS));
    }
    return err('Invalid password', 401);
  }
  await setSetting(env, SETTING_LOGIN_FAILS, '0');
  await setSetting(env, SETTING_LOGIN_LOCK_UNTIL, '');
  const token = await createSessionCookie(env);
  const res = ok({ authenticated: true });
  res.headers.append('Set-Cookie', sessionCookieSet(token));
  return res;
}, { auth: false });

route('POST', '/api/auth/logout', async (env) => {
  // Under Access the browser must visit the logout URL itself to drop the
  // CF_Authorization cookie; the old password cookie is cleared either way.
  const res = ok(accessEnabled(env) ? { authenticated: false, logout_url: ACCESS_LOGOUT_PATH } : { authenticated: false });
  res.headers.append('Set-Cookie', sessionCookieClear());
  return res;
});

route('GET', '/api/auth/check', async (env, req) => {
  const session = await getSession(req, env);
  return ok({ authenticated: true, email: (session && session.email) || '' });
});

route('POST', '/api/auth/change-password', async (env, req) => {
  if (accessEnabled(env)) return err(ACCESS_DISABLED_MSG, 410);
  try {
    const body = await readBody(req);
    const current = String(body.current_password || '');
    const next = String(body.new_password || '');
    if (next.length < 8) return err('New password must be at least 8 characters');
    const stored = await getSetting(env, 'password_hash');
    if (!stored) return err('System not initialized yet', 409);
    const valid = await verifyPassword(current, stored);
    if (!valid) return err('Current password is incorrect', 401);
    const newHash = await hashPassword(next);
    await setSetting(env, 'password_hash', newHash);
    await setSetting(env, 'password_temporary', 'false');
    await setSetting(env, 'temp_password_shared', '');
    // Re-issue a session cookie so the device that changed the password stays
    // signed in. Every other device's cookie (old fingerprint) is now revoked.
    const token = await createSessionCookie(env);
    const res = ok({ changed: true });
    res.headers.append('Set-Cookie', sessionCookieSet(token));
    await setSetting(env, 'diag_change_password_error', '').catch(() => {});
    return res;
  } catch (e) {
    // Never 500 blind: surface the real reason in the UI error and record it
    // in settings for diagnosis (message only — never request bodies).
    const msg = String((e && e.message) || e).slice(0, 400);
    console.error('change-password failure:', redact(msg));
    await setSetting(env, 'diag_change_password_error', msg).catch(() => {});
    await setSetting(env, 'diag_change_password_at', now()).catch(() => {});
    return err('Password change failed: ' + msg, 500);
  }
});
