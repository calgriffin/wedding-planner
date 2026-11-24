// Config constants: session cookie, PBKDF2, login and code-guess limits
// (moved verbatim from index.js, #3).

export const COOKIE_NAME = 'wp_session';

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// PBKDF2-SHA256 work factor. Cloudflare Workers' Web Crypto API throws
// "Pbkdf2 failed: iteration counts above 100000 are not supported" for any
// derivation above 100,000 iterations (observed live 2026-09-23 with the
// OWASP 600k bump — login/init worked because the stored hash is 100k, but
// change-password's re-hash at 600k crashed). The platform ceiling is ALSO
// our work factor, and every derivation is clamped below the cap so a
// poisoned stored hash can never 500 the endpoint.
export const PBKDF2_MAX_ITERATIONS = 100000;

export const PBKDF2_ITERATIONS = PBKDF2_MAX_ITERATIONS;

// Login brute-force backoff: after LOGIN_MAX_FAILS failed attempts, lock the
// endpoint for LOGIN_LOCK_MS (persisted in settings, shared across regions).
export const LOGIN_MAX_FAILS = 5;

export const LOGIN_LOCK_MS = 5 * 60 * 1000; // 5 minutes

export const SETTING_LOGIN_FAILS = 'login_fails';

export const SETTING_LOGIN_LOCK_UNTIL = 'login_locked_until';

// Guest access-code guessing: CODE_MAX_FAILS wrong codes from one visitor
// inside CODE_FAIL_WINDOW_MS shuts that visitor out of every code endpoint
// for CODE_LOCK_MS. Per visitor (hashed IP), so one person guessing never
// locks out the other guests. A correct code does not clear the count —
// otherwise a guest could alternate their own code with guesses at others'.
export const CODE_MAX_FAILS = 5;

export const CODE_FAIL_WINDOW_MS = 15 * 60 * 1000;

export const CODE_LOCK_MS = 15 * 60 * 1000; // 15 minutes

export const SETTING_CODE_GUESS_PREFIX = 'code_guess:';
