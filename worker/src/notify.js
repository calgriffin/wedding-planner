/**
 * Notifications for the in-app assistant chat: a Web Push to every device
 * that turned notifications on, and a short email from the planner mailbox
 * to whoever of the couple has no device that took the push.
 *
 * - Recipients are only ever the couple's own addresses
 *   (ASSISTANT_ALLOWED_EMAILS) and their own subscribed devices.
 * - The person (or device) who caused the activity is not pinged about it.
 * - Each partner chooses: everything, or questions only; and optional quiet
 *   hours (UK time). During quiet hours notifications are held and sent as
 *   one "while you were away" summary once they end (the cron checks every
 *   15 minutes). Settings live in settings.chat_notify_prefs; held
 *   notifications in settings.chat_notify_held:<email>.
 * - Chat activity emails are throttled to one per chat per person per hour;
 *   questions always go out.
 * - Never throws: a notification problem never breaks the chat.
 */
import { assistantConfig } from './assistant.js';
import { sendPush, vapidKeys } from './push.js';
import { buildMessage, smtpSend } from './mailbox.js';
import { siteOrigin } from './site.js';
import { redactError } from './log-safe.js';

const EMAIL_THROTTLE_MS = 60 * 60 * 1000;
const FROM_NAME = 'Wedding Planner';
const PREFS_SETTING = 'chat_notify_prefs';
const HELD_PREFIX = 'chat_notify_held:';
const DEFAULT_PREFS = { level: 'all', quiet_start: '', quiet_end: '' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function chatLink(env, conversationId) {
  return `${siteOrigin('plan', env)}/assistant${conversationId ? `?c=${encodeURIComponent(conversationId)}` : ''}`;
}

const lower = (s) => String(s || '').trim().toLowerCase();

function ukTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/** Is `hhmm` inside the quiet window? Windows may cross midnight (22:00–07:30). */
export function inQuietHours(prefs, hhmm = ukTime()) {
  const { quiet_start: start, quiet_end: end } = prefs || {};
  if (!HHMM.test(start || '') || !HHMM.test(end || '') || start === end) return false;
  return start < end ? hhmm >= start && hhmm < end : hhmm >= start || hhmm < end;
}

async function readJson(env, key, fallback) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(env, key, value) {
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

/** One person's notification settings ('' = the shared settings in password mode). */
export async function getNotifyPrefs(env, email) {
  return prefsFor({ prefs: await readJson(env, PREFS_SETTING, {}) }, lower(email));
}

/** Saves one person's settings. Throws a plain Error with a readable message if invalid. */
export async function setNotifyPrefs(env, email, input) {
  const level = input.level === 'questions' ? 'questions' : input.level === 'all' || input.level === undefined ? 'all' : null;
  if (!level) throw new Error('Choose "all" or "questions".');
  const start = String(input.quiet_start || '');
  const end = String(input.quiet_end || '');
  if ((start || end) && (!HHMM.test(start) || !HHMM.test(end))) throw new Error('Quiet hours need a start and end time, like 22:00 and 07:30.');
  if (start && start === end) throw new Error('Quiet hours need different start and end times.');
  const all = await readJson(env, PREFS_SETTING, {});
  all[lower(email)] = { level, quiet_start: start, quiet_end: end };
  await writeJson(env, PREFS_SETTING, all);
  return all[lower(email)];
}

// A person's settings. In password mode the planner can't tell you apart, so
// settings saved there (under '') stand for both of you.
function prefsFor(ctx, person) {
  return { ...DEFAULT_PREFS, ...(ctx.prefs[person] || ctx.prefs[''] || {}) };
}

async function loadContext(env) {
  const cfg = assistantConfig(env);
  const subs = (await env.DB.prepare('SELECT * FROM push_subscriptions').all()).results || [];
  const prefs = await readJson(env, PREFS_SETTING, {});
  return { cfg, subs, prefs, keys: null, anonymousReached: false };
}

/**
 * Pushes to one person's devices, then emails them if no device took it.
 * Updates `out` counts. `throttle` limits chat activity emails.
 */
async function deliverTo(env, ctx, person, message, { deviceId = '', conversationId = '', emailFallback = true, throttle = false }, out) {
  let reached = false;
  const targets = ctx.subs.filter((s) => s.email === person && !(deviceId && s.device_id === deviceId));
  if (targets.length) {
    ctx.keys = ctx.keys || (await vapidKeys(env));
    const subject = siteOrigin('plan', env);
    for (const s of targets) {
      const r = await sendPush(env, s, message, { keys: ctx.keys, subject });
      if (r.ok) {
        out.pushed++;
        reached = true;
        await env.DB.prepare('UPDATE push_subscriptions SET failures = 0, last_success_at = ? WHERE id = ?').bind(new Date().toISOString(), s.id).run();
      } else if (r.gone || s.failures >= 9) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run();
        out.failed++;
      } else {
        await env.DB.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').bind(s.id).run();
        out.failed++;
      }
    }
  }
  // In password mode devices aren't tied to a person, so a push that reached
  // any of them counts for both of you.
  if (!person && reached) ctx.anonymousReached = true;
  if (reached || !person || ctx.anonymousReached || !emailFallback) return;
  if (!ctx.cfg.mailConfigured || !ctx.cfg.allowed.includes(person)) return;

  const now = Date.now();
  if (throttle && conversationId) {
    const last = await env.DB.prepare('SELECT sent_at FROM chat_email_notices WHERE email = ? AND conversation_id = ?').bind(person, conversationId).first();
    if (last && now - Date.parse(last.sent_at) < EMAIL_THROTTLE_MS) return;
  }
  if (env.EMAIL_DRY_RUN !== '1') {
    const text = `${message.body}\n\nOpen the chat: ${message.url}\n\n--\nWedding planner assistant. Turn on notifications in the planner's Assistant page to get these on your phone instead.`;
    const { raw } = buildMessage({ from: ctx.cfg.mail.user, fromName: FROM_NAME, to: [person], subject: String(message.title || 'Wedding planner').slice(0, 200), text });
    try {
      await smtpSend(ctx.cfg.mail, { to: [person], raw });
    } catch (e) {
      console.error('chat email notice failed', redactError(e));
      out.failed++;
      return;
    }
  }
  out.emailed++;
  if (conversationId) {
    await env.DB.prepare('INSERT OR REPLACE INTO chat_email_notices (email, conversation_id, sent_at) VALUES (?, ?, ?)').bind(person, conversationId, new Date(now).toISOString()).run();
  }
}

// Everyone who might be notified: the couple, anyone with a device, and ''
// (password-mode devices) first, so its "reached anyone" rule applies.
function recipients(ctx) {
  const set = new Set([...ctx.subs.map((s) => s.email), ...ctx.cfg.allowed]);
  return [...set].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
}

async function hold(env, person, { kind, title, body, conversationId }) {
  const key = HELD_PREFIX + person;
  const held = await readJson(env, key, { questions: 0, updates: 0, items: [], conversations: [] });
  if (kind === 'question') held.questions++;
  else held.updates++;
  held.items = [...held.items, { kind, title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 200) }].slice(-5);
  if (conversationId && !held.conversations.includes(conversationId)) held.conversations = [...held.conversations, conversationId].slice(-20);
  await writeJson(env, key, held);
}

/**
 * kind: 'question' | 'activity'. actorEmail / deviceId: who caused it (they
 * are skipped). Resolves to counts only: { pushed, emailed, held, failed }.
 */
export async function notifyCouple(env, { kind = 'activity', title, body, conversationId = '', actorEmail = '', deviceId = '', emailFallback = true }) {
  const out = { pushed: 0, emailed: 0, held: 0, failed: 0 };
  try {
    const ctx = await loadContext(env);
    const actor = lower(actorEmail);
    const message = { title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 1500), url: chatLink(env, conversationId), tag: `chat-${conversationId || 'general'}`, kind };
    for (const person of recipients(ctx)) {
      if (actor && person === actor) continue;
      const prefs = prefsFor(ctx, person);
      if (kind !== 'question' && prefs.level === 'questions') continue;
      if (inQuietHours(prefs)) {
        await hold(env, person, { kind, title, body, conversationId });
        out.held++;
        continue;
      }
      await deliverTo(env, ctx, person, message, { deviceId, conversationId, emailFallback, throttle: kind !== 'question' }, out);
    }
  } catch (e) {
    console.error('chat notify failed', redactError(e));
  }
  return out;
}

/**
 * Cron: for anyone whose quiet hours have ended, sends what was held as one
 * summary notification. Never throws. Resolves to a short status line.
 */
export async function flushHeldNotifications(env) {
  try {
    // ORDER BY key: the shared ('') entry comes first, as in notifyCouple.
    const rows = (await env.DB.prepare('SELECT key, value FROM settings WHERE key LIKE ? ORDER BY key ASC').bind(`${HELD_PREFIX}%`).all()).results || [];
    if (!rows.length) return 'nothing held';
    const ctx = await loadContext(env);
    const out = { pushed: 0, emailed: 0, held: 0, failed: 0 };
    let sent = 0;
    for (const row of rows) {
      const person = row.key.slice(HELD_PREFIX.length);
      const prefs = prefsFor(ctx, person);
      if (inQuietHours(prefs)) continue;
      let held;
      try {
        held = JSON.parse(row.value);
      } catch {
        held = null;
      }
      // Claimed first, so an overlapping run can't send it twice.
      const claim = await env.DB.prepare('DELETE FROM settings WHERE key = ? AND value = ?').bind(row.key, row.value).run();
      if (!held || !claim.meta || claim.meta.changes !== 1) continue;
      const parts = [];
      if (held.questions) parts.push(`${held.questions} question${held.questions === 1 ? '' : 's'}`);
      if (held.updates) parts.push(`${held.updates} chat update${held.updates === 1 ? '' : 's'}`);
      const single = held.conversations.length === 1 ? held.conversations[0] : '';
      const message = {
        title: `While you were away: ${parts.join(', ') || 'updates'}`,
        body: held.items.map((i) => `- ${i.title}${i.body ? `: ${i.body}` : ''}`).join('\n'),
        url: chatLink(env, single),
        tag: 'chat-summary',
        kind: held.questions ? 'question' : 'activity',
      };
      await deliverTo(env, ctx, person, message, { conversationId: single, emailFallback: true, throttle: false }, out);
      sent++;
    }
    return `sent ${sent} summary(ies): ${JSON.stringify(out)}`;
  } catch (e) {
    console.error('held notifications failed', redactError(e));
    return 'failed';
  }
}
