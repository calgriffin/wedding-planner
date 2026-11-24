// In-app assistant chat + push notification routes (see src/chat.js,
// src/push.js, src/notify.js). All couple-only (session required).

import { route, dispatchInternal } from '../core/router.js';
import { getSession } from '../core/auth.js';
import { ok, err, readBody } from '../lib/http.js';
import { keepAlive } from '../lib/request-ctx.js';
import {
  ChatError,
  chatConfig,
  people,
  setDisplayName,
  listConversations,
  unreadSummary,
  createConversation,
  getConversation,
  updateConversation,
  postMessage,
  resolvePending,
  requestCheckin,
  skipQuestion,
} from '../chat.js';
import { allowedEndpoint, b64u, sendPush, vapidKeys } from '../push.js';
import { getNotifyPrefs, setNotifyPrefs } from '../notify.js';
import { usageReport } from '../ai-usage.js';
import { siteOrigin } from '../site.js';

const deps = (env) => ({ dispatch: (m, p, q, b) => dispatchInternal(env, m, p, q, b) });

async function who(req, env) {
  const s = await getSession(req, env);
  return { email: String((s && s.email) || '').toLowerCase(), deviceId: String(req.headers.get('x-device-id') || '').slice(0, 64) };
}

// ChatError → its status; anything else is a plain 500 (and is logged by the runtime).
const handle = (fn) => async (env, req, params, url) => {
  try {
    return await fn(env, req, params, url);
  } catch (e) {
    if (e instanceof ChatError) return err(e.message, e.status);
    throw e;
  }
};

route('GET', '/api/chat/me', handle(async (env, req, params, url) => {
  const { email } = await who(req, env);
  const cfg = chatConfig(env);
  const { couple, nameOf } = await people(env);
  const device = String(url.searchParams.get('device') || '');
  const keys = await vapidKeys(env);
  const subs = (await env.DB.prepare('SELECT id, email, device_id, label, created_at, last_success_at FROM push_subscriptions ORDER BY created_at ASC').all()).results || [];
  return ok({
    email,
    name: nameOf(email),
    can_rename: !!email,
    couple: couple.map((e) => ({ email: e, name: nameOf(e) })),
    ai: { configured: cfg.aiReady, model: cfg.model, dry_run: cfg.dryRun, checkin: cfg.checkinEnabled && cfg.aiReady, checkin_time: cfg.checkinTime },
    email_fallback: cfg.mailConfigured,
    notify: await getNotifyPrefs(env, email),
    push: {
      public_key: keys.publicKey,
      devices: subs.map((s) => ({
        id: s.id,
        label: s.label,
        name: s.email ? nameOf(s.email) : '',
        mine: !!email && s.email === email,
        this_device: !!device && s.device_id === device,
        created_at: s.created_at,
        last_success_at: s.last_success_at,
      })),
    },
  });
}));

// Your display name and/or your notification settings ({ notify: { level:
// 'all' | 'questions', quiet_start, quiet_end } }, UK times or '' for none).
route('PUT', '/api/chat/me', handle(async (env, req) => {
  const { email } = await who(req, env);
  const body = await readBody(req);
  const out = {};
  if (body.notify && typeof body.notify === 'object') {
    try {
      out.notify = await setNotifyPrefs(env, email, body.notify);
    } catch (e) {
      return err(e.message);
    }
  }
  if (body.name !== undefined) out.name = await setDisplayName(env, email, body.name);
  return ok(out);
}));

route('POST', '/api/chat/questions/:messageId/:questionId/skip', handle(async (env, req, params) => {
  const { email } = await who(req, env);
  return ok(await skipQuestion(env, { messageId: params.messageId, questionId: params.questionId, email }));
}));

// AI usage and estimated cost (src/ai-usage.js).
route('GET', '/api/ai/usage', handle(async (env) => {
  const cfg = chatConfig(env);
  const { nameOf } = await people(env);
  return ok(await usageReport(env, { defaultModel: cfg.model, nameOf }));
}));

route('GET', '/api/chat/unread', handle(async (env, req) => {
  const { email } = await who(req, env);
  return ok(await unreadSummary(env, email));
}));

route('GET', '/api/chat/conversations', handle(async (env, req, params, url) => {
  const { email } = await who(req, env);
  return ok(await listConversations(env, email, { archived: url.searchParams.get('archived') === '1' }));
}));

route('POST', '/api/chat/conversations', handle(async (env, req) => {
  const { email } = await who(req, env);
  const body = await readBody(req);
  return ok(await createConversation(env, { title: body.title, createdBy: email }));
}));

route('GET', '/api/chat/conversations/:id', handle(async (env, req, params) => {
  const { email } = await who(req, env);
  return ok(await getConversation(env, params.id, email));
}));

route('PATCH', '/api/chat/conversations/:id', handle(async (env, req, params) => {
  const body = await readBody(req);
  await updateConversation(env, params.id, { title: body.title, archived: body.archived });
  const { email } = await who(req, env);
  return ok(await getConversation(env, params.id, email, { markRead: false }));
}));

// Posts a message and waits for the assistant's reply (it can take a while:
// the model may use several planner tools). If the browser goes away, the
// reply still finishes and is saved, so the other partner sees it too.
route('POST', '/api/chat/conversations/:id/messages', handle(async (env, req, params) => {
  const { email, deviceId } = await who(req, env);
  const body = await readBody(req);
  const { work } = await postMessage(env, deps(env), {
    conversationId: params.id,
    email,
    deviceId,
    text: body.text,
    attachments: body.attachments,
    answerTo: body.answer_to,
  });
  if (work) await keepAlive(req, work);
  return ok(await getConversation(env, params.id, email));
}));

route('POST', '/api/chat/pending/:code/confirm', handle(async (env, req, params) => {
  const { email, deviceId } = await who(req, env);
  return ok(await resolvePending(env, deps(env), { code: params.code, decision: 'confirm', email, deviceId }));
}));

route('POST', '/api/chat/pending/:code/cancel', handle(async (env, req, params) => {
  const { email, deviceId } = await who(req, env);
  return ok(await resolvePending(env, deps(env), { code: params.code, decision: 'cancel', email, deviceId }));
}));

// "Any questions for us?": points to questions still waiting, or runs a
// check-in now (one at a time).
route('POST', '/api/chat/checkin', handle(async (env, req) => {
  const { email } = await who(req, env);
  const work = requestCheckin(env, deps(env), { actorEmail: email });
  return ok(await keepAlive(req, work));
}));

// ---- Push notifications ----------------------------------------------------

route('POST', '/api/push/subscriptions', handle(async (env, req) => {
  const { email, deviceId } = await who(req, env);
  const body = await readBody(req);
  const endpoint = String(body.endpoint || '');
  const keys = body.keys || {};
  if (!allowedEndpoint(endpoint, env)) return err('That browser\'s push service is not supported.');
  let p256dh;
  let auth;
  try {
    p256dh = b64u.decode(keys.p256dh);
    auth = b64u.decode(keys.auth);
  } catch {
    return err('The browser sent unreadable notification keys.');
  }
  if (p256dh.length !== 65 || auth.length < 16) return err('The browser sent unreadable notification keys.');
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint != ?').bind(endpoint).first();
  if (count && count.n >= 20) return err('Notifications are already on for 20 devices. Turn them off on one first.', 409);
  const label = String(body.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const device = String(body.device_id || deviceId || '').slice(0, 64);
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, email, device_id, endpoint, p256dh, auth, label) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET email = excluded.email, device_id = excluded.device_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, failures = 0`
  )
    .bind(crypto.randomUUID(), email, device, endpoint, keys.p256dh, keys.auth, label)
    .run();
  return ok({ subscribed: true });
}));

route('POST', '/api/push/unsubscribe', handle(async (env, req) => {
  const body = await readBody(req);
  if (body.id) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(String(body.id)).run();
  if (body.endpoint) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(String(body.endpoint)).run();
  return ok({ unsubscribed: true });
}));

// Sends a test notification to this device only.
route('POST', '/api/push/test', handle(async (env, req) => {
  const body = await readBody(req);
  const sub = await env.DB.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(String(body.endpoint || '')).first();
  if (!sub) return err('Notifications are not on for this device.', 404);
  const r = await sendPush(
    env,
    sub,
    { title: 'Notifications are on', body: "You'll get your planner's questions and chat updates here.", url: `${siteOrigin('plan', env)}/assistant`, tag: 'test', kind: 'test' },
    { keys: await vapidKeys(env), subject: siteOrigin('plan', env) }
  );
  if (r.gone) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
  return r.ok ? ok({ sent: true }) : err(`The push service refused it${r.status ? ` (${r.status})` : ''}.`, 502);
}));
