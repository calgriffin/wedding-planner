/**
 * Log redaction. Workers Logs stores every console line with Cloudflare, so
 * anything logged from an error (a stack, a mail-server reply such as
 * "550 <someone@example.com> rejected") goes through here first:
 *  - email addresses are masked, including URL-encoded (%40) and HTML-entity
 *    (&#64; &#x40; &commat;) forms;
 *  - secrets are scrubbed: /mcp/<token> links, pt= preview tokens, Bearer
 *    tokens and Anthropic API keys (sk-ant-…);
 *  - the text is capped.
 * Both functions never throw: a value that cannot be stringified logs as
 * "[unloggable]". Callers still never pass names, message bodies, tokens or
 * secrets in the first place.
 */
import { maskEmail } from './family-access.js';

const UNLOGGABLE = '[unloggable]';
// "@" in its plain, URL-encoded and HTML-entity spellings.
const AT = '(?:@|%40|&#0*64;|&#x0*40;|&commat;)';
// Bounded quantifiers (RFC 5321 limits: local part <= 64, domain <= 253) keep
// the scan linear: an unbounded `+` re-scans the whole run from every start
// position, which made a 64 KB line cost ~6 s of CPU.
const EMAIL_RE = new RegExp(`[A-Za-z0-9._%+-]{1,64}${AT}[A-Za-z0-9.-]{1,253}\\.[A-Za-z]{2,24}`, 'gi');
const DELIMITERS = new Set([' ', '\t', '\n', '\r', '<', '>', '"', "'", '(', ')', ',', ';']);

// Longer than any address (64 + 1 + 253 + 1 + 24, with entity spellings).
const MAX_ADDRESS_TOKEN = 400;
const AT_RE = new RegExp(AT, 'i');

/**
 * The cut can split the last token. A split address no longer matches
 * EMAIL_RE, so drop that token when it could be (part of) one: it holds an
 * "@", or it is short enough to be a cut-off local part. A long token with no
 * "@" (a base64 blob, a run of one character) is kept. Secret patterns match
 * a cut-off token on their own (they key on the prefix).
 */
function dropTrailingToken(text) {
  let i = text.length;
  while (i > 0 && !DELIMITERS.has(text[i - 1])) i--;
  const token = text.slice(i);
  return token.length <= MAX_ADDRESS_TOKEN || AT_RE.test(token) ? text.slice(0, i) : text;
}
const SECRET_RES = [
  [/\/mcp\/[^\s/?#"'<>]+/g, '/mcp/[token]'],
  [/\bpt=[^\s&#"'<>]+/g, 'pt=[token]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [/\bsk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[key]'],
];

function toText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  const s = String(value); // may throw (Object.create(null), a throwing toString)
  return typeof s === 'string' ? s : UNLOGGABLE;
}

export function redact(value, max = 1500) {
  try {
    let text = toText(value);
    // Cut BEFORE any regex, so the cost is bounded by `max`, not the input.
    // The cut can split an address or token in two, and a half address no
    // longer matches EMAIL_RE, so the cut-off last token is dropped as well.
    const limit = Math.max(0, max) * 2;
    if (text.length > limit) text = `${dropTrailingToken(text.slice(0, limit))}…`;
    // Normalise the "@" so maskEmail sees a plain address.
    text = text.replace(EMAIL_RE, (m) => maskEmail(m.replace(AT_RE, '@')));
    for (const [re, sub] of SECRET_RES) text = text.replace(re, sub);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return UNLOGGABLE;
  }
}

/** An error's stack (or message), redacted. */
export function redactError(e, max = 1500) {
  try {
    return redact((e && (e.stack || e.message)) || e, max);
  } catch {
    // A throwing `stack` / `message` getter.
    return UNLOGGABLE;
  }
}

// ---- Quiet requests ---------------------------------------------------------
// Workers Logs stores every console line written DURING a request together
// with that request's URL and path. For /mcp/<token> the path IS the secret,
// so such a request must write no console line at all, from our code, shared
// helpers or a library. The console methods are wrapped once with a gate;
// withQuietLogs() closes it for the duration of the request.
// Without AsyncLocalStorage the gate is isolate-wide: while a token request is
// in flight, a concurrent request in the same isolate is silenced too. That
// fails safe (a missing log line, never a leaked token).

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
let quietDepth = 0;
let consoleGated = false;

export function installQuietConsole() {
  if (consoleGated) return;
  consoleGated = true;
  for (const level of CONSOLE_LEVELS) {
    const original = console[level];
    if (typeof original !== 'function') continue;
    console[level] = function gatedConsole(...args) {
      if (quietDepth > 0) return undefined;
      return original.apply(this, args);
    };
  }
}

/**
 * True for every path the router hands to MCP with something after "/mcp/"
 * (index.js routes `pathname.startsWith('/mcp/')`, and candidateTokens skips
 * empty segments, so /mcp//<token> and /mcp/<token>/ authenticate too). It
 * must match the router exactly, never more narrowly.
 */
export function isSecretPath(pathname) {
  return String(pathname || '').startsWith('/mcp/');
}

// A request that never settles must not silence the isolate (cron included)
// forever: each hold releases itself after this long.
export const QUIET_MAX_MS = 30_000;

/** Run fn with every console line suppressed until it settles (at most maxMs). */
export async function withQuietLogs(fn, { maxMs = QUIET_MAX_MS } = {}) {
  installQuietConsole();
  quietDepth++;
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    quietDepth--;
  };
  const timer = setTimeout(release, maxMs);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    release();
  }
}
