/**
 * Family payment portal — family.<SITE_DOMAIN> (or FAMILY_HOST)
 *
 * A read-only "what's due next" view of the payment plan for family who are
 * helping out. Deliberately separate from the plan portal:
 *  - its own host, served before every other route, so the family host never
 *    serves /api, /mcp, /media or the plan SPA bundle;
 *  - its own authentication layer: Cloudflare Access (see access.js), not the
 *    plan password — family never learn it. The couple manage who is let in
 *    from the plan portal (family-access.js); the signed-in email is checked
 *    against that list here on every request, so removing someone takes
 *    effect at once;
 *  - server-rendered HTML with a strict CSP and no JavaScript;
 *  - a minimal projection of each payment: what it is for, the supplier,
 *    amount, due date and status. References, notes and invoice links stay in
 *    the plan, and any payment the couple untick ("Show on family portal")
 *    never appears.
 */

import { verifyAccess } from './access.js';
import { siteHost } from './site.js';
import { isFamilyAllowed, maskEmail } from './family-access.js';

// family.<SITE_DOMAIN> unless FAMILY_HOST names another host; '' when neither is known.
export function familyHost(env) {
  return String((env && env.FAMILY_HOST) || siteHost('family', env)).toLowerCase();
}

export function isFamilyHost(hostname, env) {
  const want = familyHost(env);
  if (!want) return false;
  return String(hostname || '').toLowerCase() === want;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Today's date in the UK (YYYY-MM-DD) — due/overdue is judged on the
// couple's calendar, not UTC.
export function ukToday(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

function money(pence) {
  const n = (Number(pence) || 0) / 100;
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function longDate(iso) {
  if (!iso) return 'Date to be confirmed';
  const t = Date.parse(`${iso}T12:00:00Z`);
  if (isNaN(t)) return 'Date to be confirmed';
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const TYPE_LABEL = { deposit: 'Deposit', instalment: 'Instalment', final: 'Final balance', refund: 'Refund' };

/**
 * Loads the family-visible payment plan. Only the columns listed here ever
 * leave the database for this portal.
 */
export async function loadFamilyPlan(env, today = ukToday()) {
  const res = await env.DB.prepare(
    `SELECT p.id, p.type, p.due_date, p.amount_pence, p.paid_date, p.status,
            b.name AS item_name, c.name AS category_name, s.name AS supplier_name
       FROM payments p
       LEFT JOIN budget_items b ON b.id = p.budget_item_id
       LEFT JOIN budget_categories c ON c.id = b.category_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE COALESCE(p.family_visible, 1) = 1
      ORDER BY p.due_date IS NULL, p.due_date ASC`
  ).all();
  const rows = (res && res.results) || [];

  const upcoming = rows
    .filter((p) => p.status === 'pending' && p.type !== 'refund')
    .map((p) => {
      const days = p.due_date ? daysBetween(today, p.due_date) : null;
      return { ...p, days, overdue: days !== null && days < 0 };
    });
  const paid = rows
    .filter((p) => p.status === 'paid' && p.type !== 'refund')
    .sort((a, b) => String(b.paid_date || '').localeCompare(String(a.paid_date || '')));

  const sum = (list) => list.reduce((s, p) => s + (Number(p.amount_pence) || 0), 0);
  const within = (n) => upcoming.filter((p) => p.days !== null && p.days <= n);
  return {
    today,
    upcoming,
    recentlyPaid: paid.slice(0, 5),
    totals: {
      outstanding: sum(upcoming),
      next30: sum(within(30)),
      overdue: sum(upcoming.filter((p) => p.overdue)),
      paid: sum(paid),
    },
  };
}

function dueText(p) {
  if (p.days === null) return 'No date yet';
  if (p.days < 0) return `${-p.days} day${p.days === -1 ? '' : 's'} overdue`;
  if (p.days === 0) return 'Due today';
  if (p.days === 1) return 'Due tomorrow';
  if (p.days <= 60) return `Due in ${p.days} days`;
  const weeks = Math.round(p.days / 7);
  return `Due in ${weeks} weeks`;
}

function label(p) {
  return esc(p.item_name || p.category_name || 'Wedding payment');
}

function sub(p) {
  const bits = [];
  if (p.supplier_name && p.supplier_name !== p.item_name) bits.push(esc(p.supplier_name));
  bits.push(esc(TYPE_LABEL[p.type] || 'Payment'));
  return bits.join(' · ');
}

export function renderFamilyPage({ plan, setup, viewer, preview = false }) {
  const n1 = esc((setup && setup.partner1_name) || '');
  const n2 = esc((setup && setup.partner2_name) || '');
  const couple = n1 && n2 ? `${n1} &amp; ${n2}` : n1 || n2 || 'The wedding';
  const wedding = setup && setup.wedding_date;
  const toGo = wedding ? daysBetween(plan.today, wedding) : null;

  const next = plan.upcoming[0];
  const rest = plan.upcoming.slice(1);

  const hero = next
    ? `<section class="hero ${next.overdue ? 'late' : ''}">
        <p class="eyebrow">Next payment</p>
        <p class="amount">${money(next.amount_pence)}</p>
        <p class="what">${label(next)}</p>
        <p class="meta">${sub(next)}</p>
        <p class="when"><strong>${esc(dueText(next))}</strong> · ${esc(longDate(next.due_date))}</p>
      </section>`
    : `<section class="hero done"><p class="eyebrow">Next payment</p><p class="what">Nothing outstanding 🎉</p><p class="meta">Every payment on the plan is settled.</p></section>`;

  const row = (p) => `<li class="${p.overdue ? 'late' : ''}">
      <div class="l"><span class="t">${label(p)}</span><span class="s">${sub(p)}</span></div>
      <div class="r"><span class="a">${money(p.amount_pence)}</span><span class="d">${esc(p.due_date ? longDate(p.due_date) : 'Date TBC')}<br>${esc(dueText(p))}</span></div>
    </li>`;

  const paidRow = (p) => `<li class="paid">
      <div class="l"><span class="t">${label(p)}</span><span class="s">${sub(p)}</span></div>
      <div class="r"><span class="a">${money(p.amount_pence)}</span><span class="d">Paid ${esc(p.paid_date ? longDate(p.paid_date) : '')}</span></div>
    </li>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Payment plan · ${couple}</title>
<style>
  :root { --bg:#fbf6ee; --card:#fffdf8; --ink:#3d342b; --muted:#857767; --line:#ecdfca; --accent:#6f8a6a; --late:#b4513e; --late-bg:#fbebe6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#1d1a17; --card:#27231f; --ink:#f1e9dd; --muted:#b3a593; --line:#3a332c; --accent:#9cb896; --late:#f08f78; --late-bg:#3a2520; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 28px 16px 48px; }
  header { text-align:center; margin-bottom: 22px; }
  h1 { font-family: ui-serif, Georgia, serif; font-weight: 500; font-size: 28px; margin: 0; }
  header p { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
  .banner { background: var(--late-bg); color: var(--late); border-radius: 10px; padding: 8px 12px; font-size: 13px; text-align:center; margin-bottom: 16px; }
  .hero { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 22px; text-align: center; }
  .hero.late { border-color: var(--late); }
  .eyebrow { margin:0; text-transform: uppercase; letter-spacing: .08em; font-size: 12px; color: var(--muted); }
  .amount { margin: 6px 0 2px; font-family: ui-serif, Georgia, serif; font-size: 44px; line-height: 1.1; }
  .what { margin: 0; font-size: 18px; font-weight: 600; }
  .meta { margin: 2px 0 0; color: var(--muted); font-size: 14px; }
  .when { margin: 12px 0 0; }
  .hero.late .when strong { color: var(--late); }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0 26px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px; text-align: center; }
  .stat b { display:block; font-size: 18px; }
  .stat span { font-size: 12px; color: var(--muted); }
  .stat.late b { color: var(--late); }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); font-weight: 600; margin: 26px 0 8px; }
  ul { list-style: none; margin: 0; padding: 0; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 12px 14px; border-top: 1px solid var(--line); }
  li:first-child { border-top: 0; }
  li.late { background: var(--late-bg); }
  li.late .d { color: var(--late); }
  .l, .r { display: flex; flex-direction: column; min-width: 0; }
  .r { text-align: right; flex-shrink: 0; }
  .t { font-weight: 600; overflow-wrap: anywhere; }
  .s, .d { font-size: 13px; color: var(--muted); }
  .a { font-weight: 600; font-variant-numeric: tabular-nums; }
  li.paid .a { color: var(--accent); }
  .empty { color: var(--muted); font-size: 14px; }
  footer { margin-top: 32px; text-align: center; font-size: 13px; color: var(--muted); }
  footer a { color: inherit; }
  @media (max-width: 420px) { .stats { grid-template-columns: 1fr 1fr; } .stats .stat:last-child { grid-column: span 2; } .amount { font-size: 38px; } }
</style>
</head>
<body>
<main>
  ${preview ? '<p class="banner">Preview — this is exactly what family see on the family portal.</p>' : ''}
  <header>
    <h1>${couple}</h1>
    <p>Wedding payment plan${toGo !== null && toGo >= 0 ? ` · ${toGo === 0 ? 'the big day is today!' : `${toGo} day${toGo === 1 ? '' : 's'} to go`}` : ''}</p>
  </header>

  ${hero}

  <div class="stats">
    <div class="stat"><b>${money(plan.totals.next30)}</b><span>Due in next 30 days</span></div>
    <div class="stat"><b>${money(plan.totals.outstanding)}</b><span>Still to pay</span></div>
    ${plan.totals.overdue > 0
      ? `<div class="stat late"><b>${money(plan.totals.overdue)}</b><span>Overdue</span></div>`
      : `<div class="stat"><b>${money(plan.totals.paid)}</b><span>Paid so far</span></div>`}
  </div>

  <h2>Coming up after that</h2>
  ${rest.length ? `<ul>${rest.map(row).join('')}</ul>` : '<p class="empty">Nothing else scheduled yet.</p>'}

  <h2>Recently paid</h2>
  ${plan.recentlyPaid.length ? `<ul>${plan.recentlyPaid.map(paidRow).join('')}</ul>` : '<p class="empty">No payments made yet.</p>'}

  <footer>
    ${viewer ? `Signed in as ${esc(viewer)} · <a href="/cdn-cgi/access/logout">Sign out</a>` : ''}
  </footer>
</main>
</body>
</html>`;
  return html;
}

const SECURITY_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export function familyHtmlResponse(html, status = 200) {
  return new Response(html, { status, headers: SECURITY_HEADERS });
}

function messagePage(title, message, status) {
  return familyHtmlResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#fbf6ee;color:#3d342b;font:16px/1.5 system-ui,sans-serif;text-align:center}
@media (prefers-color-scheme: dark){body{background:#1d1a17;color:#f1e9dd}}
div{max-width:420px}h1{font-family:ui-serif,Georgia,serif;font-weight:500}a{color:inherit}</style></head>
<body><div><h1>${esc(title)}</h1><p>${message}</p></div></body></html>`,
    status
  );
}

/**
 * Entry point for every request on the family host. `deps.getSetup` is the
 * plan's Setup loader (names + wedding date for the header).
 */
export async function handleFamily(request, env, url, deps, opts = {}) {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (url.pathname !== '/') {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const auth = await verifyAccess(request, env, opts);
  if (!auth.ok) {
    if (auth.reason === 'not_configured') {
      return messagePage('Almost ready', 'The family payment portal isn’t switched on yet. Check back soon.', 503);
    }
    if (auth.reason === 'certs_unavailable') {
      return messagePage('Try again in a moment', 'We couldn’t confirm your sign-in just now. Please refresh the page.', 503);
    }
    return messagePage('Please sign in', 'This page is just for family. <a href="/">Sign in</a>', 403);
  }

  // Second lock: a valid Access identity is not enough — the email must be
  // the couple or on the family list right now.
  if (!(await isFamilyAllowed(env, auth.email))) {
    console.log('family portal: signed-in email not on the list', maskEmail(auth.email));
    return messagePage('Not on the list', `This page is just for family. If you think that’s a mistake, ask the couple to add you. <a href="/cdn-cgi/access/logout">Sign out</a>`, 403);
  }

  const [plan, setup] = await Promise.all([loadFamilyPlan(env), deps.getSetup(env)]);
  const html = renderFamilyPage({ plan, setup, viewer: auth.email });
  return familyHtmlResponse(method === 'HEAD' ? null : html);
}
