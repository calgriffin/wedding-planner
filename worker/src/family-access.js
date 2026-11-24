/**
 * Family access list — who may open the family payment portal.
 *
 * D1 (`family_members`, migration 0010) is the source of truth; the couple
 * edit it from the plan portal. Two locks read it:
 *  1. Cloudflare Access: after every change the full list is mirrored into
 *     the reusable "Family" Access policy through the Cloudflare API, so only
 *     listed addresses are offered a sign-in code at all.
 *  2. The Worker: family.js checks the signed-in email against the list on
 *     every request, so a removal bites immediately even while an Access
 *     session issued earlier is still valid.
 *
 * The couple are always allowed and always kept in the policy. Their
 * addresses are never stored in this repo or in family_members: they come
 * from the plan's email settings (couple_email / couple_email_2) plus the
 * optional ACCESS_ALLOWED_EMAILS variable.
 *
 * Sync configuration (Worker secrets, set in Cloudflare — never in the repo):
 *  - CF_API_TOKEN                account-scoped token, permission
 *                                "Access: Apps and Policies → Edit" only
 *  - CF_ACCOUNT_ID               the Cloudflare account id
 *  - CF_ACCESS_FAMILY_POLICY_ID  id of the reusable "Family" policy
 * With any of them missing the list still saves and the Worker's own check
 * still applies; the sync just reports "not configured".
 */

export const FAMILY_MEMBER_LIMIT = 50;
const SYNC_STATUS_SETTING = 'family_sync_status';
const CF_API = 'https://api.cloudflare.com/client/v4';
const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

// Policy fields a PUT would otherwise reset; carried over from the GET.
const PASS_THROUGH = [
  'session_duration', 'approval_groups', 'approval_required', 'isolation_required',
  'purpose_justification_prompt', 'purpose_justification_required', 'mfa_config', 'connection_rules',
];

/** Trimmed, lower-cased address, or null when it isn't a plausible email. */
export function normaliseEmail(v) {
  const e = String(v ?? '').trim().toLowerCase();
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

/** "someone@example.com" → "s***@e***.com" — safe for logs and status text. */
export function maskEmail(v) {
  const e = String(v ?? '');
  const at = e.lastIndexOf('@');
  if (at < 1) return '***';
  const domain = e.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return `${e[0]}***@${domain[0] || ''}***${dot > 0 ? domain.slice(dot) : ''}`;
}

async function setting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

/** The couple's own addresses — always allowed, always kept in the policy. */
export async function coupleEmails(env) {
  const out = new Set();
  for (const key of ['couple_email', 'couple_email_2']) {
    let v = null;
    try { v = await setting(env, key); } catch { /* settings unreadable → none */ }
    const e = normaliseEmail(v);
    if (e) out.add(e);
  }
  for (const raw of String((env && env.ACCESS_ALLOWED_EMAILS) || '').split(',')) {
    const e = normaliseEmail(raw);
    if (e) out.add(e);
  }
  return [...out];
}

export async function listFamilyMembers(env) {
  const res = await env.DB.prepare('SELECT id, email, label, created_at FROM family_members ORDER BY created_at ASC, email ASC').all();
  return (res && res.results) || [];
}

/**
 * The Worker's own lock: is this signed-in email the couple or on the list?
 * Fails closed — an unreadable table means only the couple get in.
 */
export async function isFamilyAllowed(env, email) {
  const e = normaliseEmail(email);
  if (!e) return false;
  if ((await coupleEmails(env)).includes(e)) return true;
  try {
    const row = await env.DB.prepare('SELECT 1 AS ok FROM family_members WHERE email = ?').bind(e).first();
    return !!row;
  } catch {
    return false;
  }
}

export function syncConfig(env) {
  const token = String((env && env.CF_API_TOKEN) || '').trim();
  const accountId = String((env && env.CF_ACCOUNT_ID) || '').trim();
  const policyId = String((env && env.CF_ACCESS_FAMILY_POLICY_ID) || '').trim();
  if (!token || !accountId || !policyId) return null;
  return { token, accountId, policyId };
}

/** One `{ email: { email } }` rule per address: the couple first, then family. */
export function buildInclude(couple, members) {
  const seen = new Set();
  const include = [];
  for (const raw of [...couple, ...members]) {
    const e = normaliseEmail(raw);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    include.push({ email: { email: e } });
  }
  return include;
}

export async function getSyncStatus(env) {
  try {
    const raw = await setting(env, SYNC_STATUS_SETTING);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

async function saveSyncStatus(env, status) {
  try {
    await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      .bind(SYNC_STATUS_SETTING, JSON.stringify(status), status.at)
      .run();
  } catch {
    // The status is a convenience for the UI; never fail a save over it.
  }
  return status;
}

function apiError(body, status) {
  const first = body && Array.isArray(body.errors) && body.errors[0];
  const msg = first && first.message ? String(first.message) : '';
  // Cloudflare can echo request values back; keep addresses out of the status.
  return `Cloudflare said ${status}${msg ? `: ${msg.replace(/[^\s@]+@[^\s@]+/g, '[email]').slice(0, 160)}` : ''}`;
}

/**
 * Mirrors the couple + family list into the reusable Access policy.
 * Never throws. Resolves to the stored status:
 *   { state: 'synced' | 'failed' | 'not_configured', ok, at, count, message }
 * Refuses (state 'failed', nothing sent) when it would send an empty include
 * list, when the couple's addresses are unknown, or when the policy is not an
 * Allow policy — so a bad sync can never widen or empty the policy.
 */
export async function syncFamilyPolicy(env, { fetchImpl = fetch } = {}) {
  const at = new Date().toISOString();
  const done = (state, message, count = null) => saveSyncStatus(env, { state, ok: state === 'synced', at, count, message });

  const cfg = syncConfig(env);
  if (!cfg) return done('not_configured', 'Saved here. Automatic sync to Cloudflare isn’t set up yet.');

  let couple;
  let members;
  try {
    couple = await coupleEmails(env);
    members = (await listFamilyMembers(env)).map((m) => m.email);
  } catch {
    return done('failed', 'Could not read the family list.');
  }
  if (!couple.length) {
    return done('failed', 'Add your own email addresses under Email & Reminders first — the couple must always stay on the list.');
  }
  const include = buildInclude(couple, members);
  if (!include.length) return done('failed', 'Nothing to send — the list would be empty.');

  const endpoint = `${CF_API}/accounts/${encodeURIComponent(cfg.accountId)}/access/policies/${encodeURIComponent(cfg.policyId)}`;
  const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' };
  try {
    const getRes = await fetchImpl(endpoint, { method: 'GET', headers });
    const getBody = await getRes.json().catch(() => null);
    if (!getRes.ok || !getBody || !getBody.success || !getBody.result) {
      console.error('family sync: policy read failed', getRes.status);
      return done('failed', apiError(getBody, getRes.status));
    }
    const policy = getBody.result;
    if (policy.decision !== 'allow') {
      console.error('family sync: refusing, policy decision is not allow');
      return done('failed', 'The Family policy in Cloudflare is not an “Allow” policy, so it was left untouched.');
    }
    const body = {
      name: policy.name,
      decision: 'allow',
      include,
      exclude: Array.isArray(policy.exclude) ? policy.exclude : [],
      require: Array.isArray(policy.require) ? policy.require : [],
    };
    for (const k of PASS_THROUGH) if (policy[k] !== undefined && policy[k] !== null) body[k] = policy[k];

    const putRes = await fetchImpl(endpoint, { method: 'PUT', headers, body: JSON.stringify(body) });
    const putBody = await putRes.json().catch(() => null);
    if (!putRes.ok || !putBody || !putBody.success) {
      console.error('family sync: policy update failed', putRes.status);
      return done('failed', apiError(putBody, putRes.status));
    }
    return done('synced', `Live in Cloudflare — ${include.length} address${include.length === 1 ? '' : 'es'} (you two + ${include.length - couple.length} family).`, include.length);
  } catch (e) {
    console.error('family sync: request failed', String((e && e.name) || 'error'));
    return done('failed', 'Could not reach Cloudflare. Try “Sync now” in a moment.');
  }
}

/** Adds an address. Returns { member } or { error, status }. */
export async function addFamilyMember(env, { email, label }, { id, now }) {
  const e = normaliseEmail(email);
  if (!e) return { error: 'Enter a valid email address.', status: 400 };
  if ((await coupleEmails(env)).includes(e)) return { error: 'That’s one of you two — you’re always on the list.', status: 409 };
  const existing = await env.DB.prepare('SELECT id FROM family_members WHERE email = ?').bind(e).first();
  if (existing) return { error: 'That address is already on the list.', status: 409 };
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM family_members').first();
  if (((count && count.n) || 0) >= FAMILY_MEMBER_LIMIT) {
    return { error: `The list is full (${FAMILY_MEMBER_LIMIT}). Remove someone first.`, status: 400 };
  }
  const member = { id, email: e, label: String(label ?? '').trim().slice(0, 60) || null, created_at: now };
  await env.DB.prepare('INSERT INTO family_members (id, email, label, created_at) VALUES (?, ?, ?, ?)')
    .bind(member.id, member.email, member.label, member.created_at)
    .run();
  return { member };
}

/** Removes an address by id. Returns true when a row was deleted. */
export async function removeFamilyMember(env, id) {
  const row = await env.DB.prepare('SELECT id FROM family_members WHERE id = ?').bind(id).first();
  if (!row) return false;
  await env.DB.prepare('DELETE FROM family_members WHERE id = ?').bind(id).run();
  return true;
}
