// Household access codes and guest invitation codes (moved verbatim from
// index.js, #3).

// Per-guest invitation code, e.g. 7K2Q-M4XB. These also open the guest site
// (see findHouseholdByCode), so they come from the crypto RNG. 256 is a
// multiple of the 32-letter alphabet, so every letter is equally likely.
export function makeInvitationCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const picked = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => chars[b % chars.length]).join('');
  return `${picked.slice(0, 4)}-${picked.slice(4)}`;
}

export function normalizeAccessCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Household access codes (used across routes above): six random characters
// shown as two groups of three, e.g. 7K2-QM4 — short enough to read off an
// invitation and type. About a billion combinations; the guess limit
// (CODE_MAX_FAILS) does the rest.
export const HOUSEHOLD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

// `taken` is a Set of codes already in use, compared the way guests' typing
// is (dashes ignored); the new code is added to it.
export function makeHouseholdCode(taken) {
  for (;;) {
    const chars = [...crypto.getRandomValues(new Uint8Array(6))].map((b) => HOUSEHOLD_CODE_ALPHABET[b % HOUSEHOLD_CODE_ALPHABET.length]).join('');
    const code = `${chars.slice(0, 3)}-${chars.slice(3)}`;
    const key = normalizeAccessCode(code);
    if (taken && taken.has(key)) continue;
    if (taken) taken.add(key);
    return code;
  }
}

// A fresh, unused code.
export async function newHouseholdCode(env) {
  const rows = await env.DB.prepare('SELECT code FROM guest_qr_codes').all();
  return makeHouseholdCode(new Set((rows.results || []).map((r) => normalizeAccessCode(r.code))));
}
