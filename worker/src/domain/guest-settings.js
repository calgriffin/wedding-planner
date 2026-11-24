// Guest-site settings: RSVP window and the live mode (moved verbatim from
// index.js, #3).

// RSVPs are open exactly while the RSVP (v3) site is the live one: there is
// no separate switch to forget. Optional open/close dates can only narrow
// that (a reply-by deadline), never open RSVPs while v3 is not live.
import { getSetup } from '../core/setup.js';

export function rsvpOpenFor(s, setup, nowValNow = null) {
  if (effectiveLiveMode(s, setup) !== 'rsvp') return false;
  const t = nowValNow || new Date().toISOString();
  const opensAt = s.rsvp_opens_at || '';
  const closesAt = s.rsvp_closes_at || '';
  if (opensAt && t < opensAt) return false;
  if (closesAt && t > closesAt) return false;
  return true;
}

export async function isRsvpOpen(env, nowValNow = null) {
  return rsvpOpenFor(await loadGuestSettings(env), await getSetup(env), nowValNow);
}

export async function loadGuestSettings(env) {
  const out = {
    guest_mode: 'countdown',
    teaser_live_at: '',
    countdown_live_at: '',
    rsvp_live_at: '',
    weddingday_live_at: '',
    thankyou_live_at: '',
    rsvp_open: '0',
    rsvp_opens_at: '',
    rsvp_closes_at: '',
    go_public_date: '',
    preview_tokens: '[]',
    rsvp_reminder_log: '[]',
  };
  const rows = await env.DB.prepare('SELECT key, value FROM settings WHERE key IN (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind('guest_mode', 'teaser_live_at', 'countdown_live_at', 'rsvp_live_at', 'weddingday_live_at', 'thankyou_live_at', 'rsvp_open', 'rsvp_opens_at', 'rsvp_closes_at', 'go_public_date', 'preview_tokens', 'rsvp_reminder_log')
    .all();
  for (const r of (rows.results || [])) out[r.key] = r.value;
  return out;
}

export function modeForHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h.startsWith('v1.')) return 'teaser';
  if (h.startsWith('v2.')) return 'countdown';
  if (h.startsWith('v3.')) return 'rsvp';
  if (h.startsWith('v4.')) return 'weddingday';
  if (h.startsWith('v5.')) return 'thankyou';
  return null; // live domain uses settings / go-live schedule
}

// The mode currently shown on the public (apex) site. Any mode whose go-live
// timestamp has arrived is a candidate; the most recently scheduled candidate
// wins, so a schedule of teaser -> countdown -> rsvp -> weddingday -> thankyou
// advances automatically. If nothing is scheduled yet, the manual guest_mode
// setting is the fallback.
//
// The calendar itself also drives the final two stages: from the start of the
// wedding day, the public site shows the Wedding Day (v4) page; from the day
// after the wedding it always lands on the Thank You (v5) page.
export function effectiveLiveMode(s, setup) {
  const order = { teaser: 0, countdown: 1, rsvp: 2, weddingday: 3, thankyou: 4 };
  const now = Date.now();
  const arrived = [];
  const schedule = [
    ['teaser', 'teaser_live_at'],
    ['countdown', 'countdown_live_at'],
    ['rsvp', 'rsvp_live_at'],
    ['weddingday', 'weddingday_live_at'],
    ['thankyou', 'thankyou_live_at'],
  ];
  for (const [modeName, key] of schedule) {
    const at = s[key];
    if (!at) continue;
    const t = new Date(at).getTime();
    if (Number.isNaN(t) || t > now) continue;
    arrived.push({ mode: order[modeName], at: t });
  }
  if (setup && setup.wedding_date) {
    const dayStart = new Date(setup.wedding_date).getTime();
    if (!Number.isNaN(dayStart)) {
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      if (now >= dayStart) arrived.push({ mode: order.weddingday, at: dayStart });
      if (now >= dayEnd) arrived.push({ mode: order.thankyou, at: dayEnd });
    }
  }
  if (arrived.length) {
    arrived.sort((a, b) => b.at - a.at || b.mode - a.mode);
    return ['teaser', 'countdown', 'rsvp', 'weddingday', 'thankyou'][arrived[0].mode];
  }
  return s.guest_mode || 'countdown';
}

export function guestWindowPayload(s, setup) {
  return {
    rsvp_open: rsvpOpenFor(s, setup),
    rsvp_opens_at: s.rsvp_opens_at,
    rsvp_closes_at: s.rsvp_closes_at,
    guest_mode: s.guest_mode,
    live_mode: effectiveLiveMode(s, setup),
    teaser_live_at: s.teaser_live_at,
    countdown_live_at: s.countdown_live_at,
    rsvp_live_at: s.rsvp_live_at,
    weddingday_live_at: s.weddingday_live_at,
    thankyou_live_at: s.thankyou_live_at,
    go_public_date: s.go_public_date,
    wedding_date: (setup && setup.wedding_date) || '',
  };
}
