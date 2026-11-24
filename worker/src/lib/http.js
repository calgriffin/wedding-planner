// HTTP and small value helpers, shared by every route module (moved
// verbatim from index.js, #3).

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function ok(data) {
  return json(data);
}

export function err(message, status = 400) {
  return json({ error: message }, status);
}

export async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export function uuid() {
  return crypto.randomUUID();
}

export function now() {
  return new Date().toISOString();
}

export function int(v, def = 0) {
  const n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

// Coerces a form-supplied value into a nullable SQL value: undefined -> the
// current value, blank/whitespace -> NULL, anything else -> trimmed string.
// Required because an empty string bound to a REFERENCES column (e.g.
// guests.household_id) violates the foreign key and 500s the whole request.
export function nullableText(v, current) {
  if (v === undefined) return current === undefined ? null : current;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Normalises a user-supplied link (an OneDrive/SharePoint invoice, etc) for
// storage and later rendering in an href. Only http/https survives: anything
// else (javascript:, data:, vbscript:) would be a stored-XSS vector, and a
// bare host with no scheme would be ambiguous. Blank clears the field.
export function cleanLink(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (s === '') return '';
  if (s.length > 2000) return null; // null = reject
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    return null; // not an absolute URL
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

// 0/1 for payments.family_visible. undefined keeps `current`; anything
// falsy-looking (false, 0, "0", "false", "") hides the payment.
export function familyFlag(v, current) {
  if (v === undefined || v === null) return current ? 1 : 0;
  if (v === false || v === 0 || v === '0' || v === 'false' || v === '') return 0;
  return 1;
}

// Short human label for a link, used as the payments-table button text.
export function cleanLabel(v, fallback) {
  if (v === undefined) return undefined;
  const s = String(v).trim().slice(0, 120);
  return s === '' ? fallback || '' : s;
}

export const b64url = {
  encode: (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/')),
};

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
