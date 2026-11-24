/**
 * Web Push, hand-rolled on Web Crypto (no dependencies):
 * - RFC 8291 message encryption ("aes128gcm" content coding, RFC 8188), so
 *   only the subscribed browser can read a notification's text;
 * - RFC 8292 VAPID: each push carries a short-lived ES256 JWT signed with the
 *   planner's own key, so push services know it comes from us.
 *
 * The VAPID key pair is generated on first use and kept in settings
 * (`push_vapid`), never in the repo, and is excluded from the backup export.
 * The public half is what browsers subscribe with.
 *
 * Only well-known push services are ever contacted: a subscription endpoint
 * comes from a browser, so it is checked against an allow-list before the
 * Worker sends anything to it.
 */

export const VAPID_SETTING = 'push_vapid';

const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

// Push services browsers actually use. Anything else is refused, so a
// tampered subscription cannot make the Worker POST to an arbitrary host.
const PUSH_HOST_SUFFIXES = ['.googleapis.com', '.push.apple.com', '.mozilla.com', '.mozaws.net', '.notify.windows.com'];

/** Is this a push endpoint the Worker may send to? */
export function allowedEndpoint(endpoint, env = {}) {
  let url;
  try {
    url = new URL(String(endpoint || ''));
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  // Local tests only: PUSH_ALLOW_HOSTS names extra hosts (http allowed there).
  const extra = String(env.PUSH_ALLOW_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (extra.includes(host)) return url.protocol === 'https:' || url.protocol === 'http:';
  if (url.protocol !== 'https:') return false;
  return PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

/** The planner's VAPID keys: { publicKey (base64url, raw P-256 point), privateJwk }. */
export async function vapidKeys(env) {
  const read = async () => {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(VAPID_SETTING).first();
    if (!row) return null;
    try {
      const v = JSON.parse(row.value);
      return v && v.publicKey && v.privateJwk ? v : null;
    } catch {
      return null;
    }
  };
  const existing = await read();
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64u.encode(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  // INSERT OR IGNORE: if two requests race, both end up using the first key.
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
    .bind(VAPID_SETTING, JSON.stringify({ publicKey, privateJwk }))
    .run();
  return read();
}

/** `Authorization` header value for one push (RFC 8292). */
export async function vapidAuthorization(endpoint, keys, subject) {
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }))
  );
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // Web Crypto's ECDSA signature is already the raw r||s form a JWT needs.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/**
 * Encrypts one push message for a subscription (RFC 8291). `opts` lets the
 * unit test pin the sender key and salt; real sends always use fresh ones.
 */
export async function encryptPayload(p256dh, authSecret, plaintext, opts = {}) {
  const uaPublic = b64u.decode(p256dh);
  const auth = b64u.decode(authSecret);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error('bad subscription keys');
  const sender = opts.senderKeys || (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));

  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const body = typeof plaintext === 'string' ? enc.encode(plaintext) : new Uint8Array(plaintext);
  const padded = concat(body, new Uint8Array([2])); // 0x02: the last (and only) record
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded));

  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/**
 * Sends one notification. Resolves to { ok, gone, status }; `gone` means the
 * browser unsubscribed (404/410) and the subscription should be deleted.
 * Never throws.
 */
export async function sendPush(env, sub, message, { keys, subject }) {
  if (!allowedEndpoint(sub.endpoint, env)) return { ok: false, gone: true, status: 0 };
  try {
    const payload = JSON.stringify(message);
    const body = await encryptPayload(sub.p256dh, sub.auth, payload.length > 3000 ? JSON.stringify({ ...message, body: String(message.body || '').slice(0, 1500) }) : payload);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(sub.endpoint, keys, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'high',
      },
      body,
    });
    await res.arrayBuffer().catch(() => {});
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch {
    return { ok: false, gone: false, status: 0 };
  }
}
