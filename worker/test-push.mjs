/**
 * Web Push unit suite (no Worker needed): `node test-push.mjs`.
 *
 * Plays the browser's side: generates a subscription key pair, decrypts what
 * src/push.js encrypts (RFC 8291 / RFC 8188 aes128gcm) and verifies the VAPID
 * JWT (RFC 8292) with the planner's public key. Also checks the push-service
 * allow-list and that the VAPID key is created once and then reused.
 */
import { b64u, encryptPayload, vapidAuthorization, vapidKeys, allowedEndpoint, sendPush, VAPID_SETTING } from './src/push.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ''}`); }
}
const enc = new TextEncoder();
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

// The browser's half of RFC 8291.
async function decrypt(body, ua, authSecret) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  return { rs, idlen, delimiter: plain[plain.length - 1], text: new TextDecoder().decode(plain.slice(0, -1)) };
}

function fakeDb() {
  const settings = new Map();
  let inserts = 0;
  return {
    settings,
    get inserts() { return inserts; },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return settings.has(args[0]) ? { value: settings.get(args[0]) } : null; },
            async run() {
              if (/INSERT OR IGNORE/.test(sql)) { inserts++; if (!settings.has(args[0])) settings.set(args[0], args[1]); }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

async function main() {
  console.log('\n== Encryption (RFC 8291) ==');
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64u.encode(await crypto.subtle.exportKey('raw', ua.publicKey));
  const message = JSON.stringify({ title: 'Your planner has a question', body: 'When is the florist balance due? £1,250 — ✓', url: 'https://plan.example.com/assistant?c=x' });
  const body = await encryptPayload(p256dh, b64u.encode(authSecret), message);
  const out = await decrypt(body, ua, authSecret);
  check('the subscribed browser can decrypt it', out.text === message, out.text);
  check('header: record size 4096, 65-byte sender key', out.rs === 4096 && out.idlen === 65, out);
  check('single record ends with the 0x02 delimiter', out.delimiter === 2);
  const again = await encryptPayload(p256dh, b64u.encode(authSecret), message);
  check('fresh salt and sender key each time', b64u.encode(again.slice(0, 86)) !== b64u.encode(body.slice(0, 86)));
  const other = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  let refused = false;
  try { await decrypt(body, other, authSecret); } catch { refused = true; }
  check('another browser cannot decrypt it', refused);
  refused = false;
  try { await decrypt(body, ua, crypto.getRandomValues(new Uint8Array(16))); } catch { refused = true; }
  check('the wrong auth secret cannot decrypt it', refused);
  refused = false;
  try { await encryptPayload('AAAA', b64u.encode(authSecret), 'x'); } catch { refused = true; }
  check('malformed subscription keys are refused', refused);

  console.log('\n== VAPID (RFC 8292) ==');
  const db = fakeDb();
  const env = { DB: db };
  const keys = await vapidKeys(env);
  const keys2 = await vapidKeys(env);
  check('key pair created once, then reused', keys.publicKey === keys2.publicKey && db.inserts === 1 && db.settings.has(VAPID_SETTING));
  check('public key is a raw uncompressed P-256 point', b64u.decode(keys.publicKey).length === 65 && b64u.decode(keys.publicKey)[0] === 4);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';
  const authz = await vapidAuthorization(endpoint, keys, 'https://plan.example.com');
  const [, jwt, k] = authz.match(/^vapid t=([^,]+), k=(.+)$/) || [];
  check('Authorization: vapid t=<jwt>, k=<public key>', !!jwt && k === keys.publicKey, authz.slice(0, 40));
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(new TextDecoder().decode(b64u.decode(c)));
  const header = JSON.parse(new TextDecoder().decode(b64u.decode(h)));
  check('JWT is ES256 for the push service origin', header.alg === 'ES256' && claims.aud === 'https://fcm.googleapis.com' && claims.sub === 'https://plan.example.com', claims);
  const nowSec = Math.floor(Date.now() / 1000);
  check('JWT expires within 24 hours', claims.exp > nowSec && claims.exp <= nowSec + 24 * 3600, claims.exp - nowSec);
  const pub = await crypto.subtle.importKey('raw', b64u.decode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64u.decode(s), enc.encode(`${h}.${c}`));
  check('signature verifies with the planner public key', valid);

  console.log('\n== Push service allow-list ==');
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/QX', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
    check(`allowed: ${new URL(ok).hostname}`, allowedEndpoint(ok));
  }
  for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://googleapis.com.evil.example/x', 'https://user:pw@fcm.googleapis.com/x', 'javascript:alert(1)', '', 'https://127.0.0.1/x', 'http://127.0.0.1:8798/push']) {
    check(`refused: ${bad || '(empty)'}`, !allowedEndpoint(bad));
  }
  check('PUSH_ALLOW_HOSTS adds a test host (http allowed there only)', allowedEndpoint('http://127.0.0.1:8798/push', { PUSH_ALLOW_HOSTS: '127.0.0.1' }) && !allowedEndpoint('http://localhost:8798/push', { PUSH_ALLOW_HOSTS: '127.0.0.1' }));

  console.log('\n== Sending ==');
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('', { status: calls.length === 1 ? 201 : 410 }); };
  try {
    const sub = { endpoint, p256dh, auth: b64u.encode(authSecret) };
    const r1 = await sendPush(env, sub, { title: 't', body: 'b' }, { keys, subject: 'https://plan.example.com' });
    const sent = calls[0];
    const decoded = await decrypt(new Uint8Array(sent.init.body), ua, authSecret);
    check('sends an encrypted POST with the Web Push headers', r1.ok && sent.init.method === 'POST' && sent.init.headers['Content-Encoding'] === 'aes128gcm' && sent.init.headers.TTL && /^vapid t=/.test(sent.init.headers.Authorization), r1);
    check('the push body decrypts to the message', JSON.parse(decoded.text).title === 't');
    const r2 = await sendPush(env, sub, { title: 't' }, { keys, subject: 'x' });
    check('410 from the push service = gone (unsubscribe it)', !r2.ok && r2.gone, r2);
    const before = calls.length;
    const r3 = await sendPush(env, { ...sub, endpoint: 'https://evil.example.com/x' }, { title: 't' }, { keys, subject: 'x' });
    check('a non-push host is never contacted', calls.length === before && !r3.ok && r3.gone);
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
