/**
 * Wedding Planner - Cloudflare Worker
 *
 * Single self-contained worker:
 *  - Password-protected REST API backed by D1
 *  - Serves the built React SPA from inlined assets (see assets.js)
 *
 * Auth model:
 *  - Cloudflare Access (Zero Trust) when ACCESS_TEAM_DOMAIN + ACCESS_AUD are
 *    set: the Access JWT is the session and the password routes are off
 *  - Otherwise: one shared password for the couple (free tier, private planner)
 *  - Password hash: PBKDF2-SHA256(salt, 100k iters) stored in settings
 *  - Sessions: HMAC-SHA256 signed cookie (stateless), 30-day expiry
 *  - POST /api/auth/init  : set the password on first run
 *  - POST /api/auth/login : verify password -> session cookie
 *  - All /api routes except /api/auth/* and /api/health require a session
 */

import { assets } from './assets.js';
import { configureSite, siteDomain, siteHost, siteOrigin, isApexHost, cookieDomainAttr } from './site.js';
import { configureBrand, brand, fillBrand } from './brand.js';
import { handleMcp, MCP_TOKENS_SETTING, newMcpToken, hashMcpToken, parseTokenList } from './mcp.js';
import { assistantConfig, assistantStatus, runAssistant, sendBrief, writeBrief } from './assistant.js';
import { buildMessage, smtpSendMany } from './mailbox.js';
import { redact, redactError, isSecretPath, withQuietLogs } from './log-safe.js';
import { isFamilyHost, familyHost, handleFamily, loadFamilyPlan, renderFamilyPage, familyHtmlResponse } from './family.js';
import {
  FAMILY_MEMBER_LIMIT, listFamilyMembers, coupleEmails, addFamilyMember, removeFamilyMember,
  syncFamilyPolicy, getSyncStatus, syncConfig,
} from './family-access.js';
import { json, ok, err, readBody, uuid, now, int, nullableText, cleanLink, familyFlag, cleanLabel, sha256Hex } from './lib/http.js';
import { toCSV, humanTerm, fmtDate, daysUntil, safeJsonParse, escHtml, escapeAttr } from './lib/text.js';
import { CODE_MAX_FAILS, CODE_FAIL_WINDOW_MS, CODE_LOCK_MS, SETTING_CODE_GUESS_PREFIX } from './core/config.js';
import { getSetting, setSetting } from './core/db.js';
import { getSetup, isoDateOffset, recalcTaskDeadlines, recalcBudgetItemActuals, recalcBudget } from './core/setup.js';
import { seedIfEmpty } from './core/seed.js';
import { makeHouseholdCode, newHouseholdCode, makeInvitationCode, normalizeAccessCode } from './core/codes.js';
import { route, matchRoute, dispatchInternal } from './core/router.js';
import { isRsvpOpen, loadGuestSettings, modeForHost, effectiveLiveMode, guestWindowPayload } from './domain/guest-settings.js';
import { pendingPlusOnes, plusOnePlaceholderName, isPlusOnePlaceholderName } from './domain/guests.js';
import './routes/system.js';
import { ensureAuthSecret, getSession } from './core/auth.js';
import './routes/auth.js';
import './routes/chat.js';
import { askFromEmail, scheduledCheckins } from './chat.js';
import { flushHeldNotifications } from './notify.js';
import { rememberContext } from './lib/request-ctx.js';
import { previewEndedPage, comingSoonPage } from './pages/preview-ended.js';
import { countdownPage } from './pages/countdown.js';
import { weddingDayPage } from './pages/wedding-day.js';
import { thankYouPage } from './pages/thank-you.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth - password hashing (PBKDF2 via Web Crypto)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth - sessions (HMAC-signed cookie)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth - Cloudflare Access (Zero Trust)
// ---------------------------------------------------------------------------
//
// When ACCESS_TEAM_DOMAIN and ACCESS_AUD are set (wrangler.toml [vars]),
// Cloudflare Access is the ONLY way into the plan portal: the edge does the
// sign-in and forwards a signed JWT (Cf-Access-Jwt-Assertion), which is
// verified here against the team's public keys. The password endpoints are
// switched off. Verifying in the Worker (not just at the edge) means the
// workers.dev URL or any host missing from the Access app can't be used to
// slip past the login. Unset either var and the password login comes back.

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Application logic (shared calculations)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Seed data: default playbook tasks & budget categories
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Registered routes (API)
// ---------------------------------------------------------------------------

// ---- Auth ----------------------------------------------------------------

// ---- Setup ---------------------------------------------------------------
// ---- AI assistant (MCP) connection links -----------------------------------
// One link per person/assistant so each can be revoked on its own. Only the
// SHA-256 of a token is stored; the full link is shown once, on creation.
function publicMcpToken(t) {
  return { id: t.id, name: t.name, prefix: t.prefix, created_at: t.created_at, last_used_at: t.last_used_at || null };
}

// Optional dedicated hostname for the MCP endpoint (MCP_PUBLIC_ORIGIN, e.g.
// "https://mcp.example.com"), attached to this Worker as a Custom Domain and
// kept OUTSIDE Cloudflare Access so AI clients can reach it. New links use it;
// on that host the Worker serves only /mcp — never the portal or guest site.
function mcpPublicOrigin(env) {
  const raw = String((env && env.MCP_PUBLIC_ORIGIN) || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function mcpPublicHost(env) {
  const origin = mcpPublicOrigin(env);
  if (!origin) return '';
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

route('GET', '/api/mcp/tokens', async (env) => {
  const tokens = parseTokenList(await getSetting(env, MCP_TOKENS_SETTING));
  return ok(tokens.map(publicMcpToken));
});

route('POST', '/api/mcp/tokens', async (env, req, params, url) => {
  const body = await readBody(req);
  const name = String(body.name || '').trim().slice(0, 60);
  if (!name) {
    const setup = await getSetup(env);
    const example = (setup && (setup.partner2_name || setup.partner1_name)) || 'Alex';
    return err(`Give the connection a name, e.g. "${example} – Claude".`);
  }
  const tokens = parseTokenList(await getSetting(env, MCP_TOKENS_SETTING));
  if (tokens.length >= 20) return err('That is a lot of connections — revoke some old ones first.');
  const token = newMcpToken();
  const entry = { id: uuid(), name, hash: await hashMcpToken(token), prefix: token.slice(0, 10), created_at: now(), last_used_at: null };
  tokens.push(entry);
  await setSetting(env, MCP_TOKENS_SETTING, JSON.stringify(tokens));
  return ok({ ...publicMcpToken(entry), token, url: `${mcpPublicOrigin(env) || url.origin}/mcp/${token}` });
});

route('DELETE', '/api/mcp/tokens/:id', async (env, req, params) => {
  const tokens = parseTokenList(await getSetting(env, MCP_TOKENS_SETTING));
  const next = tokens.filter((t) => t.id !== params.id);
  if (next.length === tokens.length) return err('Connection not found', 404);
  await setSetting(env, MCP_TOKENS_SETTING, JSON.stringify(next));
  return ok({ deleted: true });
});

route('GET', '/api/setup', async (env) => {
  const setup = await getSetup(env);
  if (!setup) {
    // Create default setup row
    await env.DB.prepare(
      "INSERT INTO setup (id, created_at, updated_at) VALUES ('main', ?, ?)"
    )
      .bind(now(), now())
      .run();
    return ok(await getSetup(env));
  }
  return ok(setup);
});

route('PUT', '/api/setup', async (env, req) => {
  const body = await readBody(req);
  const setup = await getSetup(env);
  if (!setup) {
    await env.DB.prepare("INSERT INTO setup (id, created_at, updated_at) VALUES ('main', ?, ?)")
      .bind(now(), now())
      .run();
  }
  const fields = [
    'partner1_name',
    'partner2_name',
    'wedding_date',
    'ceremony_venue',
    'reception_venue',
    'budget_ceiling',
    'contingency_percent',
    'guest_target',
    'priority_1',
    'priority_2',
    'priority_3',
    'non_negotiable_1',
    'non_negotiable_2',
    'non_negotiable_3',
  ];
  const current = await getSetup(env);
  const merged = { ...current, ...body };
  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => {
    const v = merged[f];
    if (f === 'budget_ceiling' || f === 'contingency_percent') return v == null ? null : int(v);
    if (v === undefined || v === null) return null;
    return v;
  });
  await env.DB.prepare(`UPDATE setup SET ${setClause}, updated_at = ? WHERE id = 'main'`)
    .bind(...values, now())
    .run();
  // Wedding date changed -> recalculate suggested deadlines
  if (merged.wedding_date !== current.wedding_date) {
    await recalcTaskDeadlines(env);
  }
  return ok(await getSetup(env));
});

// ---- Dashboard -----------------------------------------------------------
route('GET', '/api/dashboard/stats', async (env) => {
  const setup = await getSetup(env);
  const today = now().slice(0, 10);

  // Tasks
  const tasks = await env.DB.prepare(
    "SELECT status, COUNT(*) as n FROM tasks WHERE status != 'not_applicable' GROUP BY status"
  ).all();
  let totalTasks = 0;
  let completedTasks = 0;
  const taskByStatus = {};
  for (const t of tasks.results) {
    taskByStatus[t.status] = int(t.n);
    totalTasks += int(t.n);
    if (t.status === 'done') completedTasks += int(t.n);
  }
  const overdueTasks = setup.wedding_date
    ? await env.DB.prepare(
        "SELECT COUNT(*) as n FROM tasks WHERE effective_deadline IS NOT NULL AND status IN ('not_started','in_progress','waiting') AND effective_deadline < ?"
      )
        .bind(today)
        .first()
    : { n: 0 };
  const dueThisWeek = setup.wedding_date
    ? await env.DB.prepare(
        "SELECT COUNT(*) as n FROM tasks WHERE effective_deadline BETWEEN ? AND ? AND status IN ('not_started','in_progress','waiting')"
      )
        .bind(today, isoDateOffset(7))
        .first()
    : { n: 0 };

  // Budget
  const ceiling = setup ? setup.budget_ceiling || 0 : 0;
  const contingencyPercent = setup ? setup.contingency_percent ?? 10 : 10;
  const contingency = Math.round((ceiling * contingencyPercent) / 100);
  const totals = await env.DB.prepare(
    'SELECT COALESCE(SUM(forecast_pence),0) AS forecast, COALESCE(SUM(actual_pence),0) AS actual FROM budget_items'
  ).first();
  const forecast = totals.forecast || 0;
  const actual = totals.actual || 0;
  const budgetForItems = Math.max(0, ceiling - contingency);
  const remainingAfterForecast = budgetForItems - forecast;
  const remainingAfterContingency = ceiling - forecast - contingency;

  // Guests
  const guestTotals = await env.DB.prepare(
    "SELECT status, attendance_type, COUNT(*) as n FROM guests GROUP BY status, attendance_type"
  ).all();
  let potential = 0, invited = 0, confirmedDay = 0, confirmedEvening = 0, declined = 0, pending = 0, eveningOnly = 0, confirmedAll = 0;
  for (const g of guestTotals.results) {
    if (g.status === 'potential') potential += int(g.n);
    if (g.status === 'invited') invited += int(g.n);
    if (g.status === 'declined') declined += int(g.n);
    if (g.status === 'evening_only') eveningOnly += int(g.n);
    if (g.status === 'confirmed' || g.status === 'evening_only' || g.status === 'invited') pending += 0;
    if (g.status === 'invited') pending += int(g.n);
    if (
      g.status === 'confirmed' &&
      (g.attendance_type === 'day' || g.attendance_type === 'both')
    )
      confirmedDay += int(g.n);
    if (
      g.status === 'confirmed' &&
      (g.attendance_type === 'evening' || g.attendance_type === 'both')
    )
      confirmedEvening += int(g.n);
    if (g.status === 'confirmed') confirmedAll += int(g.n);
  }
  // Plus-ones offered but not yet answered count alongside their host: with
  // the potentials before the host is invited, awaiting a reply after.
  const plusOnesPending = await pendingPlusOnes(env);
  let plusOnesInvited = 0;
  for (const p of plusOnesPending) {
    if (!p.status || p.status === 'potential') potential += 1;
    else {
      pending += 1;
      plusOnesInvited += 1;
    }
  }
  const dietary = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM guests WHERE status = 'confirmed' AND dietary_needs != ''"
  ).first();
  const accessibility = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM guests WHERE status = 'confirmed' AND accessibility_requests != ''"
  ).first();

  // Payments
  const overduePay = await env.DB.prepare(
    "SELECT COUNT(*) as n, COALESCE(SUM(amount_pence),0) as total FROM payments WHERE status = 'pending' AND due_date IS NOT NULL AND due_date < ?"
  )
    .bind(today)
    .first();
  const duePay = await env.DB.prepare(
    "SELECT COUNT(*) as n, COALESCE(SUM(amount_pence),0) as total FROM payments WHERE status = 'pending' AND due_date BETWEEN ? AND ?"
  )
    .bind(today, isoDateOffset(7))
    .first();

  // Decisions
  const decisions = await env.DB.prepare(
    "SELECT status, COUNT(*) as n FROM decisions GROUP BY status"
  ).all();
  let openDecisions = 0, decidedDecisions = 0, overdueDecisions = 0;
  for (const d of decisions.results) {
    if (d.status === 'open') openDecisions += int(d.n);
    if (d.status === 'decided') decidedDecisions += int(d.n);
    if (d.status === 'overdue' || (d.status === 'open' && d.deadline && d.deadline < today))
      overdueDecisions += int(d.n);
  }

  // RSVP
  const rsvp = await env.DB.prepare(
    "SELECT match_status, review_status, COUNT(*) as n FROM rsvp_imports GROUP BY match_status, review_status"
  ).all();
  let pendingReview = 0, unmatched = 0;
  for (const r of rsvp.results) {
    if (r.review_status === 'pending' || r.review_status === 'flagged') pendingReview += int(r.n);
    if (r.match_status === 'unmatched') unmatched += int(r.n);
  }
  const lastImportRow = await env.DB.prepare(
    "SELECT MAX(created_at) as last FROM rsvp_imports"
  ).first();

  return ok({
    tasks: {
      total: totalTasks,
      completed: completedTasks,
      overdue: int(overdueTasks.n),
      due_this_week: int(dueThisWeek.n),
      by_status: taskByStatus,
    },
    budget: {
      ceiling_pence: ceiling,
      contingency_pence: contingency,
      forecast_pence: forecast,
      actual_pence: actual,
      remaining_pence: remainingAfterForecast,
      remaining_after_contingency_pence: remainingAfterContingency,
    },
    guests: {
      total_potential: potential,
      total_invited: invited + confirmedDay + confirmedEvening + eveningOnly + plusOnesInvited,
      plus_ones_pending: plusOnesPending.length,
      confirmed_day: confirmedDay,
      confirmed_evening: confirmedEvening,
      declined: declined,
      pending: pending,
      // Per-guest response metrics (status-based; the confirmed_day/evening
      // buckets above count attendances and can double-count 'both' guests,
      // so the response-rate card uses these instead).
      coming: confirmedAll + eveningOnly,
      responded: confirmedAll + eveningOnly + declined,
      response_pct:
        confirmedAll + eveningOnly + declined + pending > 0
          ? Math.round(((confirmedAll + eveningOnly + declined) / (confirmedAll + eveningOnly + declined + pending)) * 100)
          : 0,
      dietary_count: int(dietary.n),
      accessibility_count: int(accessibility.n),
    },
    payments: {
      overdue_count: int(overduePay.n),
      overdue_total_pence: overduePay.total || 0,
      due_this_week_count: int(duePay.n),
      due_this_week_total_pence: duePay.total || 0,
    },
    decisions: {
      open: openDecisions,
      decided: decidedDecisions,
      overdue: overdueDecisions,
    },
    rsvp: {
      last_import: lastImportRow && lastImportRow.last ? lastImportRow.last : null,
      pending_review: pendingReview,
      unmatched: unmatched,
    },
    setup: setup ? { wedding_date: setup.wedding_date, guest_target: setup.guest_target, budget_ceiling: setup.budget_ceiling } : null,
  });
});

route('GET', '/api/dashboard/upcoming-tasks', async (env, req, params, url) => {
  const limit = int(url.searchParams.get('limit'), 10);
  const setup = await getSetup(env);
  if (!setup || !setup.wedding_date) return ok([]);
  const res = await env.DB.prepare(
    "SELECT * FROM tasks WHERE effective_deadline IS NOT NULL AND status IN ('not_started','in_progress','waiting') ORDER BY effective_deadline ASC LIMIT ?"
  )
    .bind(limit)
    .all();
  return ok(res.results);
});

route('GET', '/api/dashboard/overdue-payments', async (env) => {
  const today = now().slice(0, 10);
  const res = await env.DB.prepare(
    "SELECT p.*, b.name as item_name, b.category_id FROM payments p LEFT JOIN budget_items b ON b.id = p.budget_item_id WHERE p.status = 'pending' AND p.due_date IS NOT NULL AND p.due_date < ? ORDER BY p.due_date ASC"
  )
    .bind(today)
    .all();
  return ok(res.results);
});

route('GET', '/api/dashboard/outstanding-decisions', async (env) => {
  const res = await env.DB.prepare(
    "SELECT * FROM decisions WHERE status = 'open' ORDER BY deadline ASC NULLS LAST"
  ).all();
  return ok(res.results);
});

// ---- Tasks ---------------------------------------------------------------
route('GET', '/api/tasks', async (env, req, params, url) => {
  const stage = url.searchParams.get('stage');
  const status = url.searchParams.get('status');
  let query = 'SELECT * FROM tasks';
  const where = [];
  const bind = [];
  if (stage) {
    where.push('stage = ?');
    bind.push(stage);
  }
  if (status) {
    where.push('status = ?');
    bind.push(status);
  }
  if (where.length) query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY order_index ASC, created_at ASC';
  const res = await env.DB.prepare(query).bind(...bind).all();
  return ok(res.results);
});

route('GET', '/api/tasks/:id', async (env, req, params) => {
  const r = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(params.id).first();
  return r ? ok(r) : err('Task not found', 404);
});

route('POST', '/api/tasks', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  const setup = await getSetup(env);
  let suggested = null;
  if (setup && setup.wedding_date && body.suggested_timing_weeks_before != null) {
    const d = new Date(setup.wedding_date);
    d.setDate(d.getDate() - int(body.suggested_timing_weeks_before) * 7);
    suggested = d.toISOString().slice(0, 10);
  }
  const effective = body.agreed_deadline || suggested;
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage, order_index, title, description, guidance, owner, status, suggested_timing_weeks_before, suggested_deadline, agreed_deadline, effective_deadline, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.stage || 'initial_planning',
      int(body.order_index, 0),
      body.title || 'Untitled task',
      body.description || '',
      body.guidance || '',
      body.owner || 'together',
      body.status || 'not_started',
      body.suggested_timing_weeks_before != null ? int(body.suggested_timing_weeks_before) : null,
      suggested,
      body.agreed_deadline || null,
      effective,
      body.completed_at || null,
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  return ok(r);
});

route('PUT', '/api/tasks/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Task not found', 404);
  const body = await readBody(req);
  const setup = await getSetup(env);
  let suggested = existing.suggested_deadline;
  const timing = body.suggested_timing_weeks_before !== undefined ? body.suggested_timing_weeks_before : existing.suggested_timing_weeks_before;
  const agreed = body.agreed_deadline !== undefined ? body.agreed_deadline : existing.agreed_deadline;
  if (setup && setup.wedding_date && timing != null) {
    const d = new Date(setup.wedding_date);
    d.setDate(d.getDate() - int(timing) * 7);
    suggested = d.toISOString().slice(0, 10);
  }
  const effective = agreed || suggested;
  const completedAt =
    body.status === 'done' && existing.status !== 'done' ? now() : body.completed_at !== undefined ? body.completed_at : existing.completed_at;
  await env.DB.prepare(
    `UPDATE tasks SET stage = ?, order_index = ?, title = ?, description = ?, guidance = ?, owner = ?, status = ?,
      suggested_timing_weeks_before = ?, suggested_deadline = ?, agreed_deadline = ?, effective_deadline = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.stage !== undefined ? body.stage : existing.stage,
      body.order_index !== undefined ? int(body.order_index) : existing.order_index,
      body.title !== undefined ? body.title : existing.title,
      body.description !== undefined ? body.description : existing.description,
      body.guidance !== undefined ? body.guidance : existing.guidance,
      body.owner !== undefined ? body.owner : existing.owner,
      body.status !== undefined ? body.status : existing.status,
      timing,
      suggested,
      agreed,
      effective,
      completedAt,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(params.id).first();
  return ok(r);
});

route('DELETE', '/api/tasks/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

route('POST', '/api/tasks/reorder', async (env, req) => {
  const body = await readBody(req);
  const ids = Array.isArray(body.taskIds) ? body.taskIds : [];
  await env.DB.batch(
    ids.map((id, idx) =>
      env.DB.prepare('UPDATE tasks SET order_index = ?, updated_at = ? WHERE id = ?').bind(idx, now(), id)
    )
  );
  return ok({ reordered: ids.length });
});

route('POST', '/api/tasks/recalculate', async (env, req) => {
  const body = await readBody(req);
  if (body.weddingDate) {
    await env.DB.prepare("UPDATE setup SET wedding_date = ?, updated_at = ? WHERE id = 'main'")
      .bind(body.weddingDate, now())
      .run();
  }
  const result = await recalcTaskDeadlines(env);
  return ok(result);
});

// ---- Budget categories ----------------------------------------------------
route('GET', '/api/budget/categories', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM budget_categories ORDER BY order_index ASC').all();
  const items = await env.DB.prepare(
    'SELECT category_id, COALESCE(SUM(forecast_pence),0) as forecast, COALESCE(SUM(actual_pence),0) as actual FROM budget_items GROUP BY category_id'
  ).all();
  const byCat = {};
  for (const it of items.results) byCat[it.category_id] = { forecast: it.forecast, actual: it.actual };
  return ok(
    res.results.map((c) => ({
      ...c,
      forecast_pence: byCat[c.id] ? byCat[c.id].forecast : 0,
      actual_pence: byCat[c.id] ? byCat[c.id].actual : 0,
    }))
  );
});

route('POST', '/api/budget/categories', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  const maxOrder = await env.DB.prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM budget_categories').first();
  await env.DB.prepare(
    'INSERT INTO budget_categories (id, name, order_index, allowance_pence, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, body.name || 'New category', int(body.order_index, int(maxOrder.m) + 1), int(body.allowance_pence), body.notes || '', now(), now())
    .run();
  const r = await env.DB.prepare('SELECT * FROM budget_categories WHERE id = ?').bind(id).first();
  return ok(r);
});

route('PUT', '/api/budget/categories/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM budget_categories WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Category not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    'UPDATE budget_categories SET name = ?, order_index = ?, allowance_pence = ?, notes = ?, updated_at = ? WHERE id = ?'
  )
    .bind(
      body.name !== undefined ? body.name : existing.name,
      body.order_index !== undefined ? int(body.order_index) : existing.order_index,
      body.allowance_pence !== undefined ? int(body.allowance_pence) : existing.allowance_pence,
      body.notes !== undefined ? body.notes : existing.notes,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM budget_categories WHERE id = ?').bind(params.id).first();
  return ok(r);
});

route('DELETE', '/api/budget/categories/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM budget_categories WHERE id = ?').bind(params.id).run();
  await recalcBudget(env);
  return ok({ deleted: true });
});

route('POST', '/api/budget/categories/reorder', async (env, req) => {
  const body = await readBody(req);
  const ids = Array.isArray(body.categoryIds) ? body.categoryIds : [];
  await env.DB.batch(
    ids.map((id, idx) =>
      env.DB.prepare('UPDATE budget_categories SET order_index = ?, updated_at = ? WHERE id = ?').bind(idx, now(), id)
    )
  );
  return ok({ reordered: ids.length });
});

// ---- Budget items ---------------------------------------------------------
route('GET', '/api/budget/items', async (env, req, params, url) => {
  const categoryId = url.searchParams.get('category_id');
  const query = categoryId
    ? 'SELECT * FROM budget_items WHERE category_id = ? ORDER BY order_index ASC'
    : 'SELECT * FROM budget_items ORDER BY order_index ASC';
  const res = await env.DB.prepare(query).bind(...(categoryId ? [categoryId] : [])).all();
  const ids = res.results.map((r) => r.id);
  const payments = ids.length
    ? await env.DB.prepare(
        `SELECT budget_item_id, COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_pence ELSE 0 END),0) as paid,
                COALESCE(SUM(CASE WHEN type = 'refund' AND status IN ('refunded','paid') THEN amount_pence ELSE 0 END),0) as refunds
         FROM payments WHERE budget_item_id IN (${ids.map(() => '?').join(',')}) GROUP BY budget_item_id`
      )
        .bind(...ids)
        .all()
    : { results: [] };
  const payMap = {};
  for (const p of payments.results) {
    payMap[p.budget_item_id] = (p.paid || 0) - (p.refunds || 0);
  }
  return ok(
    res.results.map((it) => ({
      ...it,
      actual_pence: payMap[it.id] || 0,
      remaining_pence: (it.forecast_pence || 0) - (payMap[it.id] || 0),
      is_priced: it.estimate_pence != null || it.agreed_price_pence != null,
    }))
  );
});

route('POST', '/api/budget/items', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  const forecast =
    body.agreed_price_pence != null ? int(body.agreed_price_pence) : body.estimate_pence != null ? int(body.estimate_pence) : 0;
  // category_id is NOT NULL REFERENCES — reject a blank one with a readable
  // message instead of letting the FK error surface as a 500.
  if (String(body.category_id || '').trim() === '') {
    return err('Pick a budget category for this item.', 400);
  }
  await env.DB.prepare(
    `INSERT INTO budget_items (id, category_id, name, supplier_id, estimate_pence, agreed_price_pence, forecast_pence, notes, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.category_id,
      body.name || 'Untitled item',
      body.supplier_id || null,
      body.estimate_pence != null ? int(body.estimate_pence) : null,
      body.agreed_price_pence != null ? int(body.agreed_price_pence) : null,
      forecast,
      body.notes || '',
      int(body.order_index, 0),
      now(),
      now()
    )
    .run();
  await recalcBudgetItemActuals(env);
  const r = await env.DB.prepare('SELECT * FROM budget_items WHERE id = ?').bind(id).first();
  return ok({ ...r, actual_pence: 0, remaining_pence: forecast, is_priced: forecast > 0 });
});

route('PUT', '/api/budget/items/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM budget_items WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Item not found', 404);
  const body = await readBody(req);
  const estimate =
    body.estimate_pence !== undefined
      ? body.estimate_pence != null
        ? int(body.estimate_pence)
        : null
      : existing.estimate_pence;
  const agreed =
    body.agreed_price_pence !== undefined
      ? body.agreed_price_pence != null
        ? int(body.agreed_price_pence)
        : null
      : existing.agreed_price_pence;
  const forecast = agreed != null ? agreed : estimate != null ? estimate : 0;
  await env.DB.prepare(
    `UPDATE budget_items SET category_id = ?, name = ?, supplier_id = ?, estimate_pence = ?, agreed_price_pence = ?, forecast_pence = ?, notes = ?, order_index = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      // category_id is NOT NULL REFERENCES: a blank '' would 500 the save, so
      // fall back to the existing value when the form sends an empty string.
      body.category_id === undefined || String(body.category_id).trim() === '' ? existing.category_id : body.category_id,
      body.name !== undefined ? body.name : existing.name,
      nullableText(body.supplier_id, existing.supplier_id),
      estimate,
      agreed,
      forecast,
      body.notes !== undefined ? body.notes : existing.notes,
      body.order_index !== undefined ? int(body.order_index) : existing.order_index,
      now(),
      params.id
    )
    .run();
  await recalcBudgetItemActuals(env);
  const r = await env.DB.prepare('SELECT * FROM budget_items WHERE id = ?').bind(params.id).first();
  const actual = await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_pence ELSE 0 END),0) as paid, " +
      "COALESCE(SUM(CASE WHEN type = 'refund' AND status = 'paid' THEN amount_pence ELSE 0 END),0) as refunds " +
      'FROM payments WHERE budget_item_id = ?'
  )
    .bind(params.id)
    .first();
  const paid = (actual.paid || 0) - (actual.refunds || 0);
  return ok({ ...r, actual_pence: paid, remaining_pence: forecast - paid, is_priced: forecast > 0 });
});

route('DELETE', '/api/budget/items/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM budget_items WHERE id = ?').bind(params.id).run();
  await recalcBudget(env);
  return ok({ deleted: true });
});

route('POST', '/api/budget/items/recalculate', async (env) => {
  return ok(await recalcBudget(env));
});

// ---- Payments -------------------------------------------------------------
route('GET', '/api/payments', async (env, req, params, url) => {
  const itemId = url.searchParams.get('budget_item_id');
  const query = itemId
    ? 'SELECT p.*, b.name as item_name FROM payments p LEFT JOIN budget_items b ON b.id = p.budget_item_id WHERE p.budget_item_id = ? ORDER BY p.due_date IS NULL, p.due_date ASC'
    : 'SELECT p.*, b.name as item_name, c.name as category_name FROM payments p LEFT JOIN budget_items b ON b.id = p.budget_item_id LEFT JOIN budget_categories c ON c.id = b.category_id ORDER BY p.due_date IS NULL, p.due_date ASC';
  const res = await env.DB.prepare(query).bind(...(itemId ? [itemId] : [])).all();
  return ok(res.results);
});

route('POST', '/api/payments', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  if (String(body.budget_item_id || '').trim() === '') {
    return err('Pick a budget item for this payment.', 400);
  }
  // Invoice link (usually a OneDrive/SharePoint share URL).
  const invoiceUrl = cleanLink(body.invoice_url);
  if (invoiceUrl === null) {
    return err('That invoice link doesn\u2019t look like a valid web address \u2014 it must start with https://', 400);
  }
  const isRefund = body.type === 'refund';
  const resolvedStatus = body.paid_date
    ? isRefund
      ? 'refunded'
      : 'paid'
    : body.status || 'pending';
  await env.DB.prepare(
    `INSERT INTO payments (id, budget_item_id, type, due_date, amount_pence, paid_date, status, reference, notes, invoice_url, invoice_label, family_visible, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.budget_item_id,
      body.type || 'instalment',
      body.due_date || null,
      int(body.amount_pence),
      body.paid_date || null,
      isRefund && body.paid_date ? 'refunded' : resolvedStatus,
      body.reference || '',
      body.notes || '',
      invoiceUrl || '',
      invoiceUrl ? cleanLabel(body.invoice_label, '') || '' : '',
      familyFlag(body.family_visible, 1),
      now(),
      now()
    )
    .run();
  await recalcBudgetItemActuals(env);
  const r = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(id).first();
  return ok(r);
});

route('PUT', '/api/payments/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Payment not found', 404);
  const body = await readBody(req);
  // Invoice link: blank clears it, undefined leaves it alone. A bad scheme is
  // rejected outright rather than silently dropped, so a typo is visible.
  const invoiceUrl = cleanLink(body.invoice_url);
  if (invoiceUrl === null) {
    return err('That invoice link doesn\u2019t look like a valid web address \u2014 it must start with https://', 400);
  }
  const nextInvoiceUrl = invoiceUrl === undefined ? existing.invoice_url || '' : invoiceUrl;
  const isRefund =
    body.type !== undefined ? body.type === 'refund' : existing.type === 'refund';
  const resolvedStatus = body.paid_date !== undefined ? (body.paid_date ? (isRefund ? 'refunded' : 'paid') : 'pending') : existing.status;
  await env.DB.prepare(
    `UPDATE payments SET budget_item_id = ?, type = ?, due_date = ?, amount_pence = ?, paid_date = ?, status = ?, reference = ?, notes = ?, invoice_url = ?, invoice_label = ?, family_visible = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.budget_item_id === undefined || String(body.budget_item_id).trim() === '' ? existing.budget_item_id : body.budget_item_id,
      body.type !== undefined ? body.type : existing.type,
      body.due_date !== undefined ? body.due_date : existing.due_date,
      body.amount_pence !== undefined ? int(body.amount_pence) : existing.amount_pence,
      body.paid_date !== undefined ? body.paid_date : existing.paid_date,
      resolvedStatus,
      body.reference !== undefined ? body.reference : existing.reference,
      body.notes !== undefined ? body.notes : existing.notes,
      nextInvoiceUrl,
      // A label without a link is meaningless and would resurface on the next
      // link, so clearing the link clears its label too.
      !nextInvoiceUrl
        ? ''
        : cleanLabel(body.invoice_label, '') === undefined
          ? existing.invoice_label
          : cleanLabel(body.invoice_label, ''),
      familyFlag(body.family_visible, existing.family_visible ?? 1),
      now(),
      params.id
    )
    .run();
  await recalcBudgetItemActuals(env);
  const r = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(params.id).first();
  return ok(r);
});

route('PATCH', '/api/payments/:id/paid', async (env, req, params) => {
  const body = await readBody(req);
  const existing = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Payment not found', 404);
  const paidDate = body.paid_date || now().slice(0, 10);
  const isRefund = existing.type === 'refund';
  await env.DB.prepare(
    'UPDATE payments SET paid_date = ?, status = ?, updated_at = ? WHERE id = ?'
  )
    .bind(paidDate, isRefund ? 'refunded' : 'paid', now(), params.id)
    .run();
  await recalcBudgetItemActuals(env);
  const r = await env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(params.id).first();
  return ok(r);
});

// GET /api/family/preview — the couple's own look at the family portal,
// rendered exactly as family see it (same query, same template) but behind
// the plan session instead of Cloudflare Access.
route('GET', '/api/family/preview', async (env) => {
  const [plan, setup] = await Promise.all([loadFamilyPlan(env), getSetup(env)]);
  return familyHtmlResponse(renderFamilyPage({ plan, setup, viewer: null, preview: true }));
});

// ---- Family access list ---------------------------------------------------
// Who may open the family portal. D1 is the source of truth; every change is
// mirrored into the Cloudflare Access "Family" policy (see family-access.js).
// A failed or unconfigured sync never loses the change — `sync.state` tells
// the UI whether it is live in Cloudflare yet. Deliberately not exposed
// through the MCP tools.
async function familyAccessPayload(env, sync) {
  const [members, couple] = await Promise.all([listFamilyMembers(env), coupleEmails(env)]);
  return {
    members,
    couple_count: couple.length,
    limit: FAMILY_MEMBER_LIMIT,
    portal_url: `https://${familyHost(env)}`,
    sync_configured: !!syncConfig(env),
    sync: sync || (await getSyncStatus(env)),
  };
}

route('GET', '/api/family/members', async (env) => ok(await familyAccessPayload(env)));

route('POST', '/api/family/members', async (env, req) => {
  const body = await readBody(req);
  const added = await addFamilyMember(env, { email: body.email, label: body.label }, { id: uuid(), now: now() });
  if (added.error) return err(added.error, added.status);
  const sync = await syncFamilyPolicy(env);
  return ok({ member: added.member, ...(await familyAccessPayload(env, sync)) });
});

route('DELETE', '/api/family/members/:id', async (env, req, params) => {
  if (!(await removeFamilyMember(env, params.id))) return err('That person is not on the list.', 404);
  const sync = await syncFamilyPolicy(env);
  return ok({ deleted: true, ...(await familyAccessPayload(env, sync)) });
});

// "Sync now" — re-send the current list after a failed sync.
route('POST', '/api/family/sync', async (env) => ok(await familyAccessPayload(env, await syncFamilyPolicy(env))));

route('DELETE', '/api/payments/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(params.id).run();
  await recalcBudgetItemActuals(env);
  return ok({ deleted: true });
});

// ---- Households -----------------------------------------------------------
route('GET', '/api/households', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM households ORDER BY name ASC').all();
  const guestCounts = await env.DB.prepare('SELECT household_id, COUNT(*) as n FROM guests GROUP BY household_id').all();
  const counts = {};
  for (const g of guestCounts.results) counts[g.household_id] = g.n;
  const plusOnes = {};
  for (const p of await pendingPlusOnes(env)) plusOnes[p.household_id] = (plusOnes[p.household_id] || 0) + 1;
  return ok(
    res.results.map((h) => ({
      ...h,
      guest_count: counts[h.id] || 0,
      plus_ones_pending: plusOnes[h.id] || 0,
    }))
  );
});

route('POST', '/api/households', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO households (id, name, address_line1, address_line2, city, postcode, country, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      id,
      body.name || 'New household',
      body.address_line1 || '',
      body.address_line2 || '',
      body.city || '',
      body.postcode || '',
      body.country || '',
      body.notes || '',
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM households WHERE id = ?').bind(id).first();
  return ok({ ...r, guest_count: 0 });
});

route('PUT', '/api/households/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM households WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Household not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    `UPDATE households SET name = ?, address_line1 = ?, address_line2 = ?, city = ?, postcode = ?, country = ?, notes = ?, updated_at = ? WHERE id = ?`
  )
    .bind(
      body.name !== undefined ? body.name : existing.name,
      body.address_line1 !== undefined ? body.address_line1 : existing.address_line1,
      body.address_line2 !== undefined ? body.address_line2 : existing.address_line2,
      body.city !== undefined ? body.city : existing.city,
      body.postcode !== undefined ? body.postcode : existing.postcode,
      body.country !== undefined ? body.country : existing.country,
      body.notes !== undefined ? body.notes : existing.notes,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM households WHERE id = ?').bind(params.id).first();
  return ok(r);
});

route('DELETE', '/api/households/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM households WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// ---- Guests ---------------------------------------------------------------

route('GET', '/api/guests', async (env, req, params, url) => {
  const status = url.searchParams.get('status');
  const householdId = url.searchParams.get('household_id');
  let query = 'SELECT g.*, h.name as household_name FROM guests g LEFT JOIN households h ON h.id = g.household_id';
  const where = [];
  const bind = [];
  if (status) {
    where.push('g.status = ?');
    bind.push(status);
  }
  if (householdId) {
    where.push('g.household_id = ?');
    bind.push(householdId);
  }
  if (where.length) query += ' WHERE ' + where.join(' AND ');
  query += ' ORDER BY g.last_name ASC, g.first_name ASC';
  const res = await env.DB.prepare(query).bind(...bind).all();
  const pendingIds = new Set((await pendingPlusOnes(env)).map((p) => p.id));
  const linked = await env.DB.prepare(
    "SELECT plus_one_of, first_name, last_name FROM guests WHERE plus_one_of IS NOT NULL AND plus_one_of != '' ORDER BY created_at DESC"
  ).all();
  const plusOneNames = {};
  for (const p of linked.results) plusOneNames[p.plus_one_of] = `${p.first_name} ${p.last_name}`.trim();
  const guests = res.results.map((g) => ({
    ...g,
    is_primary: !!g.is_primary,
    plus_one_allowed: !!g.plus_one_allowed,
    plus_one_pending: pendingIds.has(g.id),
    plus_one_name: plusOneNames[g.id] || '',
    accommodation_needed: !!g.accommodation_needed,
    accommodation_booked: !!g.accommodation_booked,
    gift_received: !!g.gift_received,
    thank_you_sent: !!g.thank_you_sent,
  }));
  return ok(guests);
});

route('GET', '/api/guests/:id', async (env, req, params) => {
  const r = await env.DB.prepare('SELECT * FROM guests WHERE id = ?').bind(params.id).first();
  return r
    ? ok({
        ...r,
        is_primary: !!r.is_primary,
        plus_one_allowed: !!r.plus_one_allowed,
        accommodation_needed: !!r.accommodation_needed,
        accommodation_booked: !!r.accommodation_booked,
        gift_received: !!r.gift_received,
        thank_you_sent: !!r.thank_you_sent,
      })
    : err('Guest not found', 404);
});

route('POST', '/api/guests', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  const code = body.invitation_code || makeInvitationCode();
  await env.DB.prepare(
    `INSERT INTO guests (id, household_id, is_primary, first_name, last_name, email, phone, invitation_code, status, attendance_type, dietary_needs, accessibility_requests, accommodation_needed, accommodation_booked, accommodation_details, gift_received, gift_description, thank_you_sent, thank_you_date, plus_one_of, plus_one_allowed, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.household_id || null,
      body.is_primary ? 1 : 0,
      body.first_name || '',
      body.last_name || '',
      body.email || '',
      body.phone || '',
      code,
      body.status || 'potential',
      body.attendance_type || 'none',
      body.dietary_needs || '',
      body.accessibility_requests || '',
      body.accommodation_needed ? 1 : 0,
      body.accommodation_booked ? 1 : 0,
      body.accommodation_details || '',
      body.gift_received ? 1 : 0,
      body.gift_description || '',
      body.thank_you_sent ? 1 : 0,
      body.thank_you_date || null,
      body.plus_one_of || null,
      body.plus_one_allowed ? 1 : 0,
      body.notes || '',
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM guests WHERE id = ?').bind(id).first();
  return ok({ ...r, is_primary: !!r.is_primary, plus_one_allowed: !!r.plus_one_allowed });
});

route('PUT', '/api/guests/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM guests WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Guest not found', 404);
  const body = await readBody(req);
  const plusOneAllowed = body.plus_one_allowed !== undefined ? (body.plus_one_allowed ? 1 : 0) : existing.plus_one_allowed || 0;
  // Offering a plus-one afresh clears an earlier "not bringing anyone" answer.
  const plusOneResponse = plusOneAllowed && !existing.plus_one_allowed ? '' : existing.plus_one_response || '';
  await env.DB.prepare(
    `UPDATE guests SET household_id = ?, is_primary = ?, first_name = ?, last_name = ?, email = ?, phone = ?, invitation_code = ?, status = ?, attendance_type = ?,
      dietary_needs = ?, accessibility_requests = ?, accommodation_needed = ?, accommodation_booked = ?, accommodation_details = ?, gift_received = ?, gift_description = ?, thank_you_sent = ?, thank_you_date = ?, plus_one_of = ?, plus_one_allowed = ?, plus_one_response = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nullableText(body.household_id, existing.household_id),
      body.is_primary !== undefined ? (body.is_primary ? 1 : 0) : existing.is_primary,
      body.first_name !== undefined ? body.first_name : existing.first_name,
      body.last_name !== undefined ? body.last_name : existing.last_name,
      body.email !== undefined ? body.email : existing.email,
      body.phone !== undefined ? body.phone : existing.phone,
      body.invitation_code !== undefined ? body.invitation_code : existing.invitation_code,
      body.status !== undefined ? body.status : existing.status,
      body.attendance_type !== undefined ? body.attendance_type : existing.attendance_type,
      body.dietary_needs !== undefined ? body.dietary_needs : existing.dietary_needs,
      body.accessibility_requests !== undefined ? body.accessibility_requests : existing.accessibility_requests,
      body.accommodation_needed !== undefined ? (body.accommodation_needed ? 1 : 0) : existing.accommodation_needed,
      body.accommodation_booked !== undefined ? (body.accommodation_booked ? 1 : 0) : existing.accommodation_booked,
      body.accommodation_details !== undefined ? body.accommodation_details : existing.accommodation_details,
      body.gift_received !== undefined ? (body.gift_received ? 1 : 0) : existing.gift_received,
      body.gift_description !== undefined ? body.gift_description : existing.gift_description,
      body.thank_you_sent !== undefined ? (body.thank_you_sent ? 1 : 0) : existing.thank_you_sent,
      nullableText(body.thank_you_date, existing.thank_you_date),
      nullableText(body.plus_one_of, existing.plus_one_of),
      plusOneAllowed,
      plusOneResponse,
      body.notes !== undefined ? body.notes : existing.notes,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM guests WHERE id = ?').bind(params.id).first();
  return ok({ ...r, is_primary: !!r.is_primary, plus_one_allowed: !!r.plus_one_allowed });
});

route('DELETE', '/api/guests/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM seating_assignments WHERE guest_id = ?').bind(params.id).run();
  await env.DB.prepare('DELETE FROM guests WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

route('POST', '/api/guests/import', async (env, req) => {
  const body = await readBody(req);
  const guests = Array.isArray(body.guests) ? body.guests : [];
  const created = [];
  for (const g of guests) {
    const id = uuid();
    await env.DB.prepare(
      `INSERT INTO guests (id, household_id, is_primary, first_name, last_name, email, phone, invitation_code, status, attendance_type, dietary_needs, accessibility_requests, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        g.household_id || null,
        g.is_primary ? 1 : 0,
        g.first_name || '',
        g.last_name || '',
        g.email || '',
        g.phone || '',
        g.invitation_code || makeInvitationCode(),
        g.status || 'potential',
        g.attendance_type || 'none',
        g.dietary_needs || '',
        g.accessibility_requests || '',
        g.notes || '',
        now(),
        now()
      )
      .run();
    created.push(id);
  }
  return ok({ created: created.length });
});

// ---- Suppliers ------------------------------------------------------------
route('GET', '/api/suppliers', async (env, req, params, url) => {
  const category = url.searchParams.get('category');
  const query = category
    ? 'SELECT * FROM suppliers WHERE category = ? ORDER BY name ASC'
    : 'SELECT * FROM suppliers ORDER BY name ASC';
  const res = await env.DB.prepare(query).bind(...(category ? [category] : [])).all();
  return ok(
    res.results.map((s) => ({
      ...s,
      availability_confirmed: !!s.availability_confirmed,
    }))
  );
});

route('POST', '/api/suppliers', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO suppliers (id, category, name, contact_name, email, phone, website, address, quote_pence, inclusions, capacity, availability_confirmed, booking_status, contract_link, questions_to_ask, notes, deadline, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.category || 'other',
      body.name || 'New supplier',
      body.contact_name || '',
      body.email || '',
      body.phone || '',
      body.website || '',
      body.address || '',
      body.quote_pence != null ? int(body.quote_pence) : null,
      body.inclusions || '',
      body.capacity != null ? int(body.capacity) : null,
      body.availability_confirmed ? 1 : 0,
      body.booking_status || 'researching',
      body.contract_link || '',
      body.questions_to_ask || '',
      body.notes || '',
      body.deadline || null,
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first();
  return ok({ ...r, availability_confirmed: !!r.availability_confirmed });
});

route('PUT', '/api/suppliers/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Supplier not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    `UPDATE suppliers SET category = ?, name = ?, contact_name = ?, email = ?, phone = ?, website = ?, address = ?, quote_pence = ?, inclusions = ?, capacity = ?,
      availability_confirmed = ?, booking_status = ?, contract_link = ?, questions_to_ask = ?, notes = ?, deadline = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.category !== undefined ? body.category : existing.category,
      body.name !== undefined ? body.name : existing.name,
      body.contact_name !== undefined ? body.contact_name : existing.contact_name,
      body.email !== undefined ? body.email : existing.email,
      body.phone !== undefined ? body.phone : existing.phone,
      body.website !== undefined ? body.website : existing.website,
      body.address !== undefined ? body.address : existing.address,
      body.quote_pence !== undefined ? (body.quote_pence != null ? int(body.quote_pence) : null) : existing.quote_pence,
      body.inclusions !== undefined ? body.inclusions : existing.inclusions,
      body.capacity !== undefined ? (body.capacity != null ? int(body.capacity) : null) : existing.capacity,
      body.availability_confirmed !== undefined ? (body.availability_confirmed ? 1 : 0) : existing.availability_confirmed,
      body.booking_status !== undefined ? body.booking_status : existing.booking_status,
      body.contract_link !== undefined ? body.contract_link : existing.contract_link,
      body.questions_to_ask !== undefined ? body.questions_to_ask : existing.questions_to_ask,
      body.notes !== undefined ? body.notes : existing.notes,
      body.deadline !== undefined ? (body.deadline || null) : existing.deadline,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(params.id).first();
  return ok({ ...r, availability_confirmed: !!r.availability_confirmed });
});

route('DELETE', '/api/suppliers/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM suppliers WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// ---- Decisions ------------------------------------------------------------
route('GET', '/api/decisions', async (env, req, params, url) => {
  const category = url.searchParams.get('category');
  const query = category
    ? 'SELECT * FROM decisions WHERE category = ? ORDER BY deadline ASC NULLS LAST'
    : 'SELECT * FROM decisions ORDER BY deadline ASC NULLS LAST';
  const res = await env.DB.prepare(query).bind(...(category ? [category] : [])).all();
  return ok(
    res.results.map((d) => {
      let options = [];
      let links = [];
      try {
        options = d.options ? JSON.parse(d.options) : [];
      } catch {}
      try {
        links = d.inspiration_links ? JSON.parse(d.inspiration_links) : [];
      } catch {}
      return { ...d, options, inspiration_links: links };
    })
  );
});

route('POST', '/api/decisions', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO decisions (id, category, title, description, options, chosen_option, inspiration_links, decision_owner, deadline, decided_at, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.category || 'other',
      body.title || 'New decision',
      body.description || '',
      JSON.stringify(body.options || []),
      body.chosen_option || null,
      JSON.stringify(body.inspiration_links || []),
      body.decision_owner || 'together',
      body.deadline || null,
      body.decided_at || null,
      body.status || 'open',
      body.notes || '',
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM decisions WHERE id = ?').bind(id).first();
  return ok({ ...r, options: body.options || [], inspiration_links: body.inspiration_links || [] });
});

route('PUT', '/api/decisions/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM decisions WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Decision not found', 404);
  const body = await readBody(req);
  const decidedAt =
    body.status === 'decided' && existing.status !== 'decided'
      ? now().slice(0, 10)
      : body.decided_at !== undefined
      ? body.decided_at
      : existing.decided_at;
  await env.DB.prepare(
    `UPDATE decisions SET category = ?, title = ?, description = ?, options = ?, chosen_option = ?, inspiration_links = ?, decision_owner = ?, deadline = ?, decided_at = ?, status = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.category !== undefined ? body.category : existing.category,
      body.title !== undefined ? body.title : existing.title,
      body.description !== undefined ? body.description : existing.description,
      JSON.stringify(body.options !== undefined ? body.options : JSON.parse(existing.options || '[]')),
      body.chosen_option !== undefined ? body.chosen_option : existing.chosen_option,
      JSON.stringify(body.inspiration_links !== undefined ? body.inspiration_links : JSON.parse(existing.inspiration_links || '[]')),
      body.decision_owner !== undefined ? body.decision_owner : existing.decision_owner,
      body.deadline !== undefined ? body.deadline : existing.deadline,
      decidedAt,
      body.status !== undefined ? body.status : existing.status,
      body.notes !== undefined ? body.notes : existing.notes,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM decisions WHERE id = ?').bind(params.id).first();
  let options = [];
  let links = [];
  try {
    options = r.options ? JSON.parse(r.options) : [];
  } catch {}
  try {
    links = r.inspiration_links ? JSON.parse(r.inspiration_links) : [];
  } catch {}
  return ok({ ...r, options, inspiration_links: links });
});

route('DELETE', '/api/decisions/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM decisions WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// ---- Tables & Seating -----------------------------------------------------
route('GET', '/api/seating/tables', async (env) => {
  const tables = await env.DB.prepare('SELECT * FROM tables ORDER BY name ASC').all();
  const assignments = await env.DB.prepare(
    `SELECT sa.*, g.first_name, g.last_name, g.status FROM seating_assignments sa
     LEFT JOIN guests g ON g.id = sa.guest_id ORDER BY sa.seat_number ASC`
  ).all();
  // Everyone except the declined is seatable: guests are routinely added and
  // planned for before they RSVP, so 'potential'/'invited' stay in the pool.
  // `accepted` still counts firm yeses only, for the headline stat.
  const guests = await env.DB.prepare(
    "SELECT * FROM guests WHERE status IS NULL OR status != 'declined' ORDER BY last_name ASC"
  ).all();
  const seatable = guests.results;
  const accepted = seatable.filter(
    (g) => g.status === 'confirmed' || g.status === 'evening_only'
  );
  const seated = assignments.results.map((a) => a.guest_id);
  const unseated = seatable.filter((g) => !seated.includes(g.id));
  const plusOnesPending = await pendingPlusOnes(env);
  return ok({
    tables: tables.results.map((t) => ({
      ...t,
      assigned: assignments.results.filter((a) => a.table_id === t.id).length,
      assignments: assignments.results
        .filter((a) => a.table_id === t.id)
        .map((a) => ({ ...a, guest_name: `${a.first_name} ${a.last_name}` })),
      overcapacity: assignments.results.filter((a) => a.table_id === t.id).length > (t.capacity || 0),
    })),
    unseated_guests: unseated.map((g) => ({
      id: g.id,
      name: `${g.first_name} ${g.last_name}`,
      status: g.status,
      attendance_type: g.attendance_type,
      household_id: g.household_id,
    })),
    totals: {
      accepted: accepted.length,
      seatable: seatable.length,
      seated: seated.length,
      unseated: unseated.length,
      // Offered plus-ones nobody has answered yet: places to keep free, but
      // nobody to seat until the host RSVPs.
      plus_ones_pending: plusOnesPending.length,
      capacity_total: tables.results.reduce((sum, t) => sum + (t.capacity || 0), 0),
    },
  });
});

route('POST', '/api/seating/tables', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  // Auto-place new tables on the room plan in a simple grid so they don't
  // all pile up at (0,0); the couple drags them into place afterwards.
  const count = await env.DB.prepare('SELECT COUNT(*) as n FROM tables').first();
  const slot = int(count ? count.n : 0);
  const AUTO_GAP = 190;
  const posX = ((slot % 3) + 1) * AUTO_GAP;
  const posY = (Math.floor(slot / 3) + 1) * AUTO_GAP;
  await env.DB.prepare(
    'INSERT INTO tables (id, name, capacity, shape, location, notes, pos_x, pos_y, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, body.name || 'New table', int(body.capacity, 8), body.shape || 'round', body.location || '', body.notes || '', body.pos_x !== undefined ? Math.max(0, Math.min(20000, int(body.pos_x, 0))) : posX, body.pos_y !== undefined ? Math.max(0, Math.min(20000, int(body.pos_y, 0))) : posY, now(), now())
    .run();
  const r = await env.DB.prepare('SELECT * FROM tables WHERE id = ?').bind(id).first();
  return ok({ ...r, assigned: 0, assignments: [], overcapacity: false });
});

route('PUT', '/api/seating/tables/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM tables WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Table not found', 404);
  const body = await readBody(req);
  // pos_x/pos_y power the room-plan view: integers clamped to a generous
  // canvas; they are preserved whatever else is (not) being updated.
  const posX = body.pos_x !== undefined ? Math.max(0, Math.min(20000, int(body.pos_x, 0))) : existing.pos_x;
  const posY = body.pos_y !== undefined ? Math.max(0, Math.min(20000, int(body.pos_y, 0))) : existing.pos_y;
  await env.DB.prepare(
    'UPDATE tables SET name = ?, capacity = ?, shape = ?, location = ?, notes = ?, pos_x = ?, pos_y = ?, updated_at = ? WHERE id = ?'
  )
    .bind(
      body.name !== undefined ? body.name : existing.name,
      body.capacity !== undefined ? int(body.capacity) : existing.capacity,
      body.shape !== undefined ? body.shape : existing.shape,
      body.location !== undefined ? body.location : existing.location,
      body.notes !== undefined ? body.notes : existing.notes,
      posX,
      posY,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM tables WHERE id = ?').bind(params.id).first();
  return ok(r);
});

// Room-plan canvas size (settings-backed; defaults 1200x700).
route('GET', '/api/seating/room', async (env) => {
  const width = int(await getSetting(env, 'seating_room_w'), 1200) || 1200;
  const height = int(await getSetting(env, 'seating_room_h'), 700) || 700;
  return ok({ width, height });
});

route('PUT', '/api/seating/room', async (env, req) => {
  const body = await readBody(req);
  const width = Math.max(400, Math.min(4000, int(body.width, 1200))) || 1200;
  const height = Math.max(300, Math.min(3000, int(body.height, 700))) || 700;
  await setSetting(env, 'seating_room_w', String(width));
  await setSetting(env, 'seating_room_h', String(height));
  return ok({ width, height });
});

route('DELETE', '/api/seating/tables/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM tables WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// Seating assignments
route('GET', '/api/seating/assignments', async (env) => {
  const res = await env.DB.prepare(
    `SELECT sa.*, g.first_name, g.last_name, g.status FROM seating_assignments sa
     LEFT JOIN guests g ON g.id = sa.guest_id ORDER BY sa.created_at ASC`
  ).all();
  return ok(res.results);
});

route('POST', '/api/seating/assignments', async (env, req) => {
  const body = await readBody(req);
  const existing = await env.DB.prepare(
    'SELECT * FROM seating_assignments WHERE guest_id = ?'
  )
    .bind(body.guest_id)
    .first();
  if (existing) {
    await env.DB.prepare(
      'UPDATE seating_assignments SET table_id = ?, seat_number = ?, updated_at = ? WHERE id = ?'
    )
      .bind(
        nullableText(body.table_id, existing.table_id),
        body.seat_number != null ? int(body.seat_number) : null,
        now(),
        existing.id
      )
      .run();
    return ok({ updated: true, id: existing.id });
  }
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO seating_assignments (id, table_id, guest_id, seat_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, nullableText(body.table_id, null), body.guest_id, body.seat_number != null ? int(body.seat_number) : null, now(), now())
    .run();
  return ok({ created: true, id });
});

route('PUT', '/api/seating/assignments/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM seating_assignments WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Assignment not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    'UPDATE seating_assignments SET table_id = ?, seat_number = ?, updated_at = ? WHERE id = ?'
  )
    .bind(nullableText(body.table_id, existing.table_id), body.seat_number !== undefined ? (body.seat_number != null ? int(body.seat_number) : null) : existing.seat_number, now(), params.id)
    .run();
  const r = await env.DB.prepare('SELECT * FROM seating_assignments WHERE id = ?').bind(params.id).first();
  return ok(r);
});

route('DELETE', '/api/seating/assignments/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM seating_assignments WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

route('POST', '/api/seating/assignments/bulk', async (env, req) => {
  const body = await readBody(req);
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  const stmts = assignments.map((a) => {
    const existing = null;
    return {
      stmt: env.DB.prepare(
        `INSERT INTO seating_assignments (id, table_id, guest_id, seat_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (guest_id) DO UPDATE SET table_id = excluded.table_id, seat_number = excluded.seat_number, updated_at = excluded.updated_at`
      ),
      bind: [uuid(), a.table_id, a.guest_id, a.seat_number != null ? int(a.seat_number) : null, now(), now()],
    };
  });
  // ON CONFLICT requires a UNIQUE constraint on guest_id - add it via migration if missing.
  await env.DB.batch(stmts.map((s) => s.stmt.bind(...s.bind)));
  return ok({ assigned: assignments.length });
});

route('DELETE', '/api/seating/assignments/table/:tableId', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM seating_assignments WHERE table_id = ?').bind(params.tableId).run();
  return ok({ cleared: true });
});

// ---- Logistics ------------------------------------------------------------
route('GET', '/api/logistics', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM logistics ORDER BY created_at ASC').all();
  return ok(
    res.results.map((l) => ({
      ...l,
      confirmed: !!l.confirmed,
      details: (() => {
        try {
          return l.details ? JSON.parse(l.details) : {};
        } catch {
          return {};
        }
      })(),
    }))
  );
});

route('POST', '/api/logistics', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO logistics (id, type, name, description, supplier_id, cost_pence, confirmed, details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      id,
      body.type || 'other',
      body.name || 'New item',
      body.description || '',
      body.supplier_id || null,
      body.cost_pence != null ? int(body.cost_pence) : null,
      body.confirmed ? 1 : 0,
      JSON.stringify(body.details || {}),
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM logistics WHERE id = ?').bind(id).first();
  return ok({ ...r, confirmed: !!r.confirmed, details: body.details || {} });
});

route('PUT', '/api/logistics/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM logistics WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Item not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    'UPDATE logistics SET type = ?, name = ?, description = ?, supplier_id = ?, cost_pence = ?, confirmed = ?, details = ?, updated_at = ? WHERE id = ?'
  )
    .bind(
      body.type !== undefined ? body.type : existing.type,
      body.name !== undefined ? body.name : existing.name,
      body.description !== undefined ? body.description : existing.description,
      body.supplier_id !== undefined ? body.supplier_id : existing.supplier_id,
      body.cost_pence !== undefined ? (body.cost_pence != null ? int(body.cost_pence) : null) : existing.cost_pence,
      body.confirmed !== undefined ? (body.confirmed ? 1 : 0) : existing.confirmed,
      JSON.stringify(body.details !== undefined ? body.details : (() => {
        try {
          return existing.details ? JSON.parse(existing.details) : {};
        } catch {
          return {};
        }
      })()),
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM logistics WHERE id = ?').bind(params.id).first();
  return ok({ ...r, confirmed: !!r.confirmed });
});

route('DELETE', '/api/logistics/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM logistics WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// ---- Wedding Day: Run sheet, contacts, packing -----------------------------
route('GET', '/api/wedding-day/run-sheet', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM run_sheet ORDER BY order_index ASC, time ASC').all();
  return ok(
    res.results.map((r) => ({ ...r, is_critical: !!r.is_critical }))
  );
});

route('POST', '/api/wedding-day/run-sheet', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  const maxOrder = await env.DB.prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM run_sheet').first();
  await env.DB.prepare(
    `INSERT INTO run_sheet (id, time, end_time, title, description, location, responsible_person, supplier_id, is_critical, contingency_notes, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.time || '09:00',
      body.end_time || null,
      body.title || 'New entry',
      body.description || '',
      body.location || '',
      body.responsible_person || 'coordinator',
      body.supplier_id || null,
      body.is_critical ? 1 : 0,
      body.contingency_notes || '',
      int(body.order_index, int(maxOrder.m) + 1),
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM run_sheet WHERE id = ?').bind(id).first();
  return ok({ ...r, is_critical: !!r.is_critical });
});

route('PUT', '/api/wedding-day/run-sheet/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM run_sheet WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Entry not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    `UPDATE run_sheet SET time = ?, end_time = ?, title = ?, description = ?, location = ?, responsible_person = ?, supplier_id = ?, is_critical = ?, contingency_notes = ?, order_index = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.time !== undefined ? body.time : existing.time,
      body.end_time !== undefined ? body.end_time : existing.end_time,
      body.title !== undefined ? body.title : existing.title,
      body.description !== undefined ? body.description : existing.description,
      body.location !== undefined ? body.location : existing.location,
      body.responsible_person !== undefined ? body.responsible_person : existing.responsible_person,
      body.supplier_id !== undefined ? body.supplier_id : existing.supplier_id,
      body.is_critical !== undefined ? (body.is_critical ? 1 : 0) : existing.is_critical,
      body.contingency_notes !== undefined ? body.contingency_notes : existing.contingency_notes,
      body.order_index !== undefined ? int(body.order_index) : existing.order_index,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM run_sheet WHERE id = ?').bind(params.id).first();
  return ok({ ...r, is_critical: !!r.is_critical });
});

route('DELETE', '/api/wedding-day/run-sheet/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM run_sheet WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

route('POST', '/api/wedding-day/run-sheet/reorder', async (env, req) => {
  const body = await readBody(req);
  const ids = Array.isArray(body.itemIds) ? body.itemIds : [];
  await env.DB.batch(
    ids.map((id, idx) => env.DB.prepare('UPDATE run_sheet SET order_index = ?, updated_at = ? WHERE id = ?').bind(idx, now(), id))
  );
  return ok({ reordered: ids.length });
});

// Contacts
route('GET', '/api/wedding-day/contacts', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM contacts ORDER BY is_emergency DESC, order_index ASC').all();
  return ok(res.results.map((c) => ({ ...c, is_emergency: !!c.is_emergency })));
});

route('POST', '/api/wedding-day/contacts', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  const maxOrder = await env.DB.prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM contacts').first();
  await env.DB.prepare(
    'INSERT INTO contacts (id, name, role, phone, email, notes, is_emergency, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, body.name || 'New contact', body.role || '', body.phone || '', body.email || '', body.notes || '', body.is_emergency ? 1 : 0, int(body.order_index, int(maxOrder.m) + 1), now(), now())
    .run();
  const r = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first();
  return ok({ ...r, is_emergency: !!r.is_emergency });
});

route('PUT', '/api/wedding-day/contacts/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Contact not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    'UPDATE contacts SET name = ?, role = ?, phone = ?, email = ?, notes = ?, is_emergency = ?, order_index = ?, updated_at = ? WHERE id = ?'
  )
    .bind(
      body.name !== undefined ? body.name : existing.name,
      body.role !== undefined ? body.role : existing.role,
      body.phone !== undefined ? body.phone : existing.phone,
      body.email !== undefined ? body.email : existing.email,
      body.notes !== undefined ? body.notes : existing.notes,
      body.is_emergency !== undefined ? (body.is_emergency ? 1 : 0) : existing.is_emergency,
      body.order_index !== undefined ? int(body.order_index) : existing.order_index,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(params.id).first();
  return ok({ ...r, is_emergency: !!r.is_emergency });
});

route('DELETE', '/api/wedding-day/contacts/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// Packing list
route('GET', '/api/wedding-day/packing', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM packing_list ORDER BY category ASC, order_index ASC').all();
  return ok(res.results.map((p) => ({ ...p, packed: !!p.packed })));
});

route('POST', '/api/wedding-day/packing', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  const maxOrder = await env.DB.prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM packing_list').first();
  await env.DB.prepare(
    'INSERT INTO packing_list (id, category, item, quantity, responsible_person, packed, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, body.category || 'other', body.item || 'New item', int(body.quantity, 1), body.responsible_person || 'together', body.packed ? 1 : 0, body.notes || '', int(body.order_index, int(maxOrder.m) + 1), now(), now())
    .run();
  const r = await env.DB.prepare('SELECT * FROM packing_list WHERE id = ?').bind(id).first();
  return ok({ ...r, packed: !!r.packed });
});

route('PUT', '/api/wedding-day/packing/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM packing_list WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Item not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    'UPDATE packing_list SET category = ?, item = ?, quantity = ?, responsible_person = ?, packed = ?, notes = ?, order_index = ?, updated_at = ? WHERE id = ?'
  )
    .bind(
      body.category !== undefined ? body.category : existing.category,
      body.item !== undefined ? body.item : existing.item,
      body.quantity !== undefined ? int(body.quantity) : existing.quantity,
      body.responsible_person !== undefined ? body.responsible_person : existing.responsible_person,
      body.packed !== undefined ? (body.packed ? 1 : 0) : existing.packed,
      body.notes !== undefined ? body.notes : existing.notes,
      body.order_index !== undefined ? int(body.order_index) : existing.order_index,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM packing_list WHERE id = ?').bind(params.id).first();
  return ok({ ...r, packed: !!r.packed });
});

route('DELETE', '/api/wedding-day/packing/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM packing_list WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// ---- Other Events & Honeymoon ----------------------------------------------
route('GET', '/api/events', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM events ORDER BY date ASC NULLS LAST').all();
  return ok(
    res.results.map((e) => {
      let tasks = [];
      try {
        tasks = e.tasks ? JSON.parse(e.tasks) : [];
      } catch {}
      return { ...e, tasks };
    })
  );
});

route('POST', '/api/events', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  await env.DB.prepare(
    'INSERT INTO events (id, title, type, date, venue, description, guest_count, budget_link_id, tasks, status, notes, guest_visible, start_time, end_time, guest_description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      id,
      body.title || 'New event',
      body.type || 'other',
      body.date || null,
      body.venue || '',
      body.description || '',
      body.guest_count != null ? int(body.guest_count) : null,
      body.budget_link_id || null,
      JSON.stringify(body.tasks || []),
      body.status || 'planning',
      body.notes || '',
      body.guest_visible ? 1 : 0,
      body.start_time || '',
      body.end_time || '',
      body.guest_description || '',
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first();
  return ok({ ...r, tasks: body.tasks || [] });
});

route('PUT', '/api/events/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Event not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    `UPDATE events SET title = ?, type = ?, date = ?, venue = ?, description = ?, guest_count = ?, budget_link_id = ?, tasks = ?, status = ?, notes = ?, guest_visible = ?, start_time = ?, end_time = ?, guest_description = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.title !== undefined ? body.title : existing.title,
      body.type !== undefined ? body.type : existing.type,
      body.date !== undefined ? body.date : existing.date,
      body.venue !== undefined ? body.venue : existing.venue,
      body.description !== undefined ? body.description : existing.description,
      body.guest_count !== undefined ? (body.guest_count != null ? int(body.guest_count) : null) : existing.guest_count,
      body.budget_link_id !== undefined ? body.budget_link_id : existing.budget_link_id,
      JSON.stringify(body.tasks !== undefined ? body.tasks : (() => {
        try {
          return existing.tasks ? JSON.parse(existing.tasks) : [];
        } catch {
          return [];
        }
      })()),
      body.status !== undefined ? body.status : existing.status,
      body.notes !== undefined ? body.notes : existing.notes,
      body.guest_visible !== undefined ? (body.guest_visible ? 1 : 0) : existing.guest_visible,
      body.start_time !== undefined ? (body.start_time || '') : existing.start_time,
      body.end_time !== undefined ? (body.end_time || '') : existing.end_time,
      body.guest_description !== undefined ? (body.guest_description || '') : existing.guest_description,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(params.id).first();
  let tasks = [];
  try {
    tasks = r.tasks ? JSON.parse(r.tasks) : [];
  } catch {}
  return ok({ ...r, tasks });
});

route('DELETE', '/api/events/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM events WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// ---- Master Timeline & Appointments -----------------------------------------
route('GET', '/api/appointments', async (env) => {
  const res = await env.DB.prepare(
    'SELECT * FROM appointments ORDER BY date ASC NULLS LAST, time ASC NULLS LAST'
  ).all();
  return ok(res.results);
});

route('POST', '/api/appointments', async (env, req) => {
  const body = await readBody(req);
  if (!body.date) return err('Appointment date required');
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO appointments (id, title, date, time, location, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.title || 'Appointment',
      body.date,
      body.time || null,
      body.location || '',
      body.notes || '',
      now(),
      now()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(id).first();
  return ok(r);
});

route('PUT', '/api/appointments/:id', async (env, req, params) => {
  const existing = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(params.id).first();
  if (!existing) return err('Appointment not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    `UPDATE appointments SET title = ?, date = ?, time = ?, location = ?, notes = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.title !== undefined ? body.title : existing.title,
      body.date !== undefined ? body.date : existing.date,
      body.time !== undefined ? body.time : existing.time,
      body.location !== undefined ? body.location : existing.location,
      body.notes !== undefined ? body.notes : existing.notes,
      now(),
      params.id
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM appointments WHERE id = ?').bind(params.id).first();
  return ok(r);
});

route('DELETE', '/api/appointments/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM appointments WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// Master Timeline: one calendar across every dated thing in the planner.
// Pure read aggregation — no writes, no live-row mutations. Items carry
// { id, type, date, time, title, subtitle, status, overdue } so the calendar
// page can render everything with zero client-side joins.
route('GET', '/api/timeline', async (env) => {
  const today = new Date().toISOString().slice(0, 10);
  const human = (s) =>
    String(s || '').replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const items = [];

  // Tasks with an effective deadline (suggested or agreed), still open.
  {
    const res = await env.DB.prepare(
      `SELECT id, title, status, effective_deadline AS date FROM tasks
       WHERE effective_deadline IS NOT NULL AND status NOT IN ('done','not_applicable')`
    ).all();
    for (const t of res.results)
      items.push({ id: t.id, type: 'task', date: t.date, time: null, title: t.title, subtitle: human(t.status), status: t.status, overdue: t.date < today });
  }

  // Payments still to pay (due date set, not paid).
  {
    const res = await env.DB.prepare(
      `SELECT p.id, p.type, p.due_date AS date, p.status, p.amount_pence, b.name AS item_name
       FROM payments p LEFT JOIN budget_items b ON b.id = p.budget_item_id
       WHERE p.due_date IS NOT NULL AND p.status IN ('pending','overdue')
       ORDER BY p.due_date ASC`
    ).all();
    for (const p of res.results)
      items.push({
        id: p.id, type: 'payment', date: p.date, time: null,
        title: `${p.item_name || 'Payment'} — ${human(p.type)}`,
        subtitle: `£${(p.amount_pence / 100).toFixed(2)}`,
        status: p.status, amount_pence: p.amount_pence, overdue: p.date < today,
      });
  }

  // Supplier confirm-by deadlines.
  {
    const res = await env.DB.prepare(
      `SELECT id, name, booking_status AS status, deadline AS date FROM suppliers
       WHERE deadline IS NOT NULL ORDER BY deadline ASC`
    ).all();
    for (const s of res.results)
      items.push({ id: s.id, type: 'supplier', date: s.date, time: null, title: `Confirm: ${s.name}`, subtitle: human(s.status), status: s.status, overdue: s.date < today });
  }

  // Appointments (couple-managed).
  {
    const res = await env.DB.prepare(
      'SELECT * FROM appointments ORDER BY date ASC, time ASC NULLS LAST'
    ).all();
    for (const a of res.results)
      items.push({ id: a.id, type: 'appointment', date: a.date, time: a.time || null, title: a.title, subtitle: a.location || '', status: 'appointment', location: a.location, notes: a.notes, overdue: false });
  }

  // Other events & honeymoon.
  {
    const res = await env.DB.prepare(
      `SELECT id, title, type, venue, status, date FROM events
       WHERE date IS NOT NULL AND status NOT IN ('cancelled','not_applicable')
       ORDER BY date ASC`
    ).all();
    for (const e of res.results)
      items.push({ id: e.id, type: 'event', date: e.date, time: null, title: e.title, subtitle: [human(e.type), e.venue].filter(Boolean).join(' · '), status: e.status, overdue: false });
  }

  // Decisions still open/deferred with a deadline.
  {
    const res = await env.DB.prepare(
      `SELECT id, title, status, deadline AS date FROM decisions
       WHERE deadline IS NOT NULL AND status IN ('open','deferred')
       ORDER BY deadline ASC`
    ).all();
    for (const d of res.results)
      items.push({ id: d.id, type: 'decision', date: d.date, time: null, title: d.title, subtitle: human(d.status), status: d.status, overdue: d.date < today });
  }

  // RSVP windows and the big day itself.
  {
    const s = await loadGuestSettings(env);
    if (s.rsvp_opens_at) {
      const d = s.rsvp_opens_at.slice(0, 10);
      items.push({ id: 'rsvp-open', type: 'rsvp', date: d, time: null, title: 'RSVP window opens', subtitle: '', status: 'rsvp', overdue: false });
    }
    if (s.rsvp_closes_at) {
      const d = s.rsvp_closes_at.slice(0, 10);
      items.push({ id: 'rsvp-close', type: 'rsvp', date: d, time: null, title: 'RSVP deadline — responses in by', subtitle: '', status: 'rsvp', overdue: d < today });
    }
    const windows = await env.DB.prepare('SELECT id, label, opens_at, closes_at FROM rsvp_event_windows').all();
    for (const w of windows.results || []) {
      if (w.opens_at) items.push({ id: `rsvp-open-${w.id}`, type: 'rsvp', date: w.opens_at.slice(0, 10), time: null, title: `RSVP opens (${w.label || 'event'})`, subtitle: '', status: 'rsvp', overdue: false });
      if (w.closes_at) {
        const d = w.closes_at.slice(0, 10);
        items.push({ id: `rsvp-close-${w.id}`, type: 'rsvp', date: d, time: null, title: `RSVP deadline (${w.label || 'event'})`, subtitle: '', status: 'rsvp', overdue: d < today });
      }
    }
    const setup = await getSetup(env);
    if (setup && setup.wedding_date)
      items.push({ id: 'wedding-day', type: 'event', date: setup.wedding_date, time: null, title: 'The big day', subtitle: [setup.partner1_name, setup.partner2_name].filter(Boolean).join(' & '), status: 'weddingday', overdue: false });
  }

  // Stable sort: date first, then a fixed type order.
  const TYPE_ORDER = { task: 0, payment: 1, supplier: 2, appointment: 3, event: 4, decision: 5, rsvp: 6 };
  items.sort((a, b) =>
    a.date > b.date ? 1 : a.date < b.date ? -1 : (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)
  );
  return ok({ items, today });
});

// ---- RSVP Inbox -------------------------------------------------------------
route('GET', '/api/rsvp', async (env, req, params, url) => {
  const status = url.searchParams.get('status');
  const query = status
    ? 'SELECT * FROM rsvp_imports WHERE review_status = ? ORDER BY submitted_at DESC'
    : 'SELECT * FROM rsvp_imports ORDER BY submitted_at DESC';
  const res = await env.DB.prepare(query).bind(...(status ? [status] : [])).all();
  return ok(res.results);
});

route('GET', '/api/rsvp/last-import', async (env) => {
  const row = await env.DB.prepare('SELECT MAX(created_at) as last FROM rsvp_imports').first();
  return ok({ last_import: row && row.last ? row.last : null });
});

route('POST', '/api/rsvp/import', async (env, req) => {
  const body = await readBody(req);
  const responses = Array.isArray(body.responses) ? body.responses : [];
  if (responses.length === 0) return err('No responses provided');
  const guests = await env.DB.prepare(
    'SELECT id, invitation_code, first_name, last_name, status, attendance_type, dietary_needs, accessibility_requests FROM guests'
  ).all();
  const results = [];
  for (const r of responses) {
    const id = uuid();
    const code = String(r.invitation_code || '').trim().toUpperCase();
    const name = String(r.guest_name || '').trim().toLowerCase();

    // Match logic: by invitation code first, then by name
    const byCode = guests.results.filter((g) => g.invitation_code && g.invitation_code.toUpperCase() === code);
    const byName = guests.results.filter((g) =>
      `${g.first_name} ${g.last_name}`.toLowerCase() === name
    );
    let matchedGuestId = null;
    let matchStatus = 'unmatched';
    const matchPool = byCode.length ? byCode : byName;
    if (matchPool.length === 1) {
      matchedGuestId = matchPool[0].id;
      matchStatus = 'matched';
    } else if (matchPool.length > 1) {
      matchStatus = 'duplicate'; // ambiguous match needs review
    }
    // Detect duplicates: same invitation code already imported. Guests with no
    // invitation code (code === '') share an intentionally blank key — two
    // different people both submitting empty codes must NOT be flagged as
    // duplicates of each other, so the check only runs for real codes.
    let dup = null;
    if (code !== '') {
      dup = await env.DB.prepare(
        "SELECT * FROM rsvp_imports WHERE invitation_code = ? AND review_status IN ('pending','accepted') ORDER BY created_at DESC"
      )
        .bind(code)
        .first();
    }
    if (dup) {
      // Mark this new one as conflicting duplicate, do NOT overwrite
      await env.DB.prepare(
        `UPDATE rsvp_imports SET review_status = 'flagged', match_status = 'conflict', notes = 'Possible duplicate of import ' || ? || ' (' || ? || '); never overwrites accepted RSVPs', reviewed_at = ?, updated_at = ? WHERE id = ?`
      )
        .bind(dup.id, dup.guest_name, now(), now(), dup.id)
        .run();
      continue;
    }
    await env.DB.prepare(
      `INSERT INTO rsvp_imports (id, invitation_code, guest_name, attendance, dietary_needs, accessibility_requests, travel_requests, submitted_at, matched_guest_id, match_status, review_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
      .bind(
        id,
        code,
        String(r.guest_name || ''),
        String(r.attendance || 'yes'),
        String(r.dietary_needs || ''),
        String(r.accessibility_requests || ''),
        String(r.travel_requests || ''),
        r.submitted_at || now(),
        matchedGuestId,
        matchStatus,
        now()
      )
      .run();
    results.push({ id, match_status: matchStatus, matched_guest_id: matchedGuestId });
  }
  return ok({ imported: results.length, results });
});

route('PATCH', '/api/rsvp/:id/match', async (env, req, params) => {
  const body = await readBody(req);
  const entry = await env.DB.prepare('SELECT * FROM rsvp_imports WHERE id = ?').bind(params.id).first();
  if (!entry) return err('Import not found', 404);
  await env.DB.prepare(
    'UPDATE rsvp_imports SET matched_guest_id = ?, match_status = ?, updated_at = ? WHERE id = ?'
  )
    .bind(body.guest_id, 'matched', now(), params.id)
    .run();
  return ok({ matched: true });
});

// Apply a reviewed response to the guest record (manual, doesn't overwrite silently)
route('PATCH', '/api/rsvp/:id/review', async (env, req, params) => {
  const body = await readBody(req);
  const entry = await env.DB.prepare('SELECT * FROM rsvp_imports WHERE id = ?').bind(params.id).first();
  if (!entry) return err('Import not found', 404);
  const action = body.action; // accepted | rejected | flagged
  if (!['accepted', 'rejected', 'flagged'].includes(action)) return err('Invalid action');

  if (action === 'accepted') {
    if (!entry.matched_guest_id) return err('Cannot accept an unmatched response - match it first');
    const guest = await env.DB.prepare('SELECT * FROM guests WHERE id = ?').bind(entry.matched_guest_id).first();
    if (!guest) return err('Matched guest no longer exists');
    // Apply RSVP result to guest record
    const attendanceType =
      entry.attendance === 'evening_only' ? 'evening' : entry.attendance === 'no' ? 'none' : guest.attendance_type && guest.attendance_type !== 'none' ? guest.attendance_type : 'both';
    const status = entry.attendance === 'no' ? 'declined' : 'confirmed';
    await env.DB.prepare(
      `UPDATE guests SET status = ?, attendance_type = ?, dietary_needs = ?, accessibility_requests = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        status,
        attendanceType,
        entry.dietary_needs || guest.dietary_needs || '',
        entry.accessibility_requests || guest.accessibility_requests || '',
        now(),
        entry.matched_guest_id
      )
      .run();
  }

  await env.DB.prepare(
    'UPDATE rsvp_imports SET review_status = ?, reviewed_at = ?, reviewed_by = ?, notes = ?, updated_at = ? WHERE id = ?'
  )
    .bind(action, now(), body.reviewed_by || 'couple', body.notes !== undefined ? body.notes : entry.notes, now(), params.id)
    .run();
  return ok({ reviewed: action });
});

route('POST', '/api/rsvp/bulk-review', async (env, req) => {
  const body = await readBody(req);
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const action = body.action;
  const results = [];
  for (const id of ids) {
    const entry = await env.DB.prepare('SELECT * FROM rsvp_imports WHERE id = ?').bind(id).first();
    if (!entry) continue;
    if (action === 'accepted' && entry.matched_guest_id) {
      const guest = await env.DB.prepare('SELECT * FROM guests WHERE id = ?').bind(entry.matched_guest_id).first();
      if (guest) {
        const attendanceType = entry.attendance === 'evening_only' ? 'evening' : entry.attendance === 'no' ? 'none' : guest.attendance_type && guest.attendance_type !== 'none' ? guest.attendance_type : 'both';
        await env.DB.prepare(
          'UPDATE guests SET status = ?, attendance_type = ?, dietary_needs = ?, accessibility_requests = ?, updated_at = ? WHERE id = ?'
        )
          .bind(entry.attendance === 'no' ? 'declined' : 'confirmed', attendanceType, entry.dietary_needs || guest.dietary_needs || '', entry.accessibility_requests || guest.accessibility_requests || '', now(), entry.matched_guest_id)
          .run();
      }
    }
    await env.DB.prepare(
      'UPDATE rsvp_imports SET review_status = ?, reviewed_at = ?, updated_at = ? WHERE id = ?'
    )
      .bind(action, now(), now(), id)
      .run();
    results.push(id);
  }
  return ok({ reviewed: results.length });
});

// ---- CSV exports ------------------------------------------------------------

route('GET', '/api/export/guests', async (env) => {
  const res = await env.DB.prepare(
    `SELECT g.first_name, g.last_name, h.name as household, g.email, g.phone, g.invitation_code, g.status, g.attendance_type, g.dietary_needs, g.accessibility_requests, g.accommodation_needed, g.gift_received, g.thank_you_sent
     FROM guests g LEFT JOIN households h ON h.id = g.household_id ORDER BY g.last_name ASC`
  ).all();
  const csv = toCSV(res.results, [
    'first_name', 'last_name', 'household', 'email', 'phone', 'invitation_code', 'status', 'attendance_type', 'dietary_needs', 'accessibility_requests', 'accommodation_needed', 'gift_received', 'thank_you_sent',
  ]);
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="guest-list.csv"' },
  });
});

route('GET', '/api/export/budget', async (env) => {
  const res = await env.DB.prepare(
    `SELECT c.name as category, b.name as item, b.estimate_pence, b.agreed_price_pence, b.forecast_pence, b.actual_pence
     FROM budget_items b LEFT JOIN budget_categories c ON c.id = b.category_id ORDER BY c.order_index ASC, b.order_index ASC`
  ).all();
  const csv = toCSV(res.results, ['category', 'item', 'estimate_pence', 'agreed_price_pence', 'forecast_pence', 'actual_pence']);
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="budget.csv"' },
  });
});

route('GET', '/api/export/run-sheet', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM run_sheet ORDER BY order_index ASC').all();
  const csv = toCSV(res.results, ['time', 'end_time', 'title', 'description', 'location', 'responsible_person', 'is_critical', 'contingency_notes']);
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="run-sheet.csv"' },
  });
});

route('GET', '/api/export/contacts', async (env) => {
  const res = await env.DB.prepare('SELECT * FROM contacts ORDER BY is_emergency DESC, order_index ASC').all();
  const csv = toCSV(res.results, ['name', 'role', 'phone', 'email', 'notes', 'is_emergency']);
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="contacts.csv"' },
  });
});

route('GET', '/api/export/all', async (env) => {
  // Full backup archive: every table, every column, read-only SELECTs only.
  // Passwords and API keys are excluded from the SETTINGS section so the
  // downloaded file can be stored anywhere (they are recoverable/regenerable).
  const parts = [
    `${brand().backupTitle} — full backup (passwords & API keys excluded)\nGenerated: ${now()}\n\n`,
  ];
  const add = (name, rows, cols = '*') => parts.push(`--- ${name} ---\n${toCSV(rows, cols)}\n`);
  const rows = async (sql) => (await env.DB.prepare(sql).all()).results;

  // Day-of essentials first (same curated column subsets as the singles).
  add('RUN_SHEET', await rows('SELECT * FROM run_sheet ORDER BY order_index ASC'), ['time', 'end_time', 'title', 'description', 'location', 'responsible_person', 'is_critical', 'contingency_notes']);
  add('CONTACTS', await rows('SELECT * FROM contacts ORDER BY is_emergency DESC, order_index ASC'), ['name', 'role', 'phone', 'email', 'notes', 'is_emergency']);
  add('PACKING_LIST', await rows('SELECT * FROM packing_list ORDER BY order_index ASC'), ['category', 'item', 'quantity', 'responsible_person', 'packed', 'notes']);
  add('EVENTS', await rows('SELECT * FROM events ORDER BY date ASC'), ['title', 'type', 'date', 'venue', 'status', 'notes']);

  // Everything else — full rows, all columns.
  add('SETUP', await rows('SELECT * FROM setup'));
  add('HOUSEHOLDS', await rows('SELECT * FROM households ORDER BY name ASC'));
  add('GUESTS', await rows('SELECT * FROM guests ORDER BY last_name ASC'));
  add('SUPPLIERS', await rows('SELECT * FROM suppliers ORDER BY name ASC'));
  add('BUDGET_CATEGORIES', await rows('SELECT * FROM budget_categories ORDER BY name ASC'));
  add('BUDGET_ITEMS', await rows('SELECT * FROM budget_items ORDER BY order_index ASC'));
  add('PAYMENTS', await rows('SELECT * FROM payments ORDER BY due_date ASC'));
  add('FAMILY_MEMBERS', await rows('SELECT * FROM family_members ORDER BY created_at ASC'));
  add('TASKS', await rows('SELECT * FROM tasks ORDER BY effective_deadline ASC'));
  add('DECISIONS', await rows('SELECT * FROM decisions ORDER BY created_at ASC'));
  add('RSVP_IMPORTS', await rows('SELECT * FROM rsvp_imports ORDER BY created_at ASC'));
  add('RSVP_QUESTIONS', await rows('SELECT * FROM rsvp_questions ORDER BY order_index ASC'));
  add('RSVP_ANSWERS', await rows('SELECT * FROM rsvp_answers ORDER BY created_at ASC'));
  add('GUEST_TAGS', await rows('SELECT * FROM guest_tags ORDER BY name ASC'));
  add('GUEST_TAG_ASSIGNMENTS', await rows('SELECT * FROM guest_tag_assignments'));
  add('GUEST_QR_CODES', await rows('SELECT * FROM guest_qr_codes'));
  add('RSVP_JOURNEYS', await rows('SELECT * FROM rsvp_journeys ORDER BY created_at ASC'));
  add('RSVP_EVENT_WINDOWS', await rows('SELECT * FROM rsvp_event_windows ORDER BY event_key ASC'));
  add('TABLES', await rows('SELECT * FROM tables ORDER BY name ASC'));
  add('SEATING_ASSIGNMENTS', await rows('SELECT * FROM seating_assignments ORDER BY created_at ASC'));
  add('APPOINTMENTS', await rows('SELECT * FROM appointments ORDER BY date ASC'));
  add('LOGISTICS', await rows('SELECT * FROM logistics ORDER BY created_at ASC'));
  add('EMAIL_CAMPAIGNS', await rows('SELECT * FROM email_campaigns ORDER BY created_at ASC'));
  add('EMAIL_LOG', await rows('SELECT * FROM email_log ORDER BY created_at ASC'));
  add('CHAT_CONVERSATIONS', await rows('SELECT * FROM chat_conversations ORDER BY created_at ASC'));
  add('CHAT_MESSAGES', await rows('SELECT * FROM chat_messages ORDER BY created_at ASC'), ['conversation_id', 'role', 'author_email', 'text', 'status', 'actions', 'attachments', 'questions', 'reply_to', 'created_at']);
  add('CHAT_PENDING', await rows('SELECT * FROM chat_pending ORDER BY created_at ASC'), ['conversation_id', 'summary', 'status', 'result', 'resolved_by', 'created_at', 'resolved_at']);

  const settingsRows = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key NOT IN ('auth_secret','password_hash','resend_api_key','email_api_key','preview_tokens','mcp_tokens','push_vapid') AND key NOT LIKE 'code_guess:%' AND key NOT LIKE 'chat_notify_held:%' ORDER BY key ASC"
  ).all();
  add('SETTINGS', settingsRows.results, ['key', 'value']);

  const filename = `${brand().slugBase}-backup-${now().slice(0, 10)}.txt`;
  return new Response(parts.join(''), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// ---------------------------------------------------------------------------
// Guest-facing portal (Feature #1) — public + additive admin routes
//
// SAFETY: Everything here is additive. Public guest routes use { auth: false }
// and never expose more than the owning household's own data, gated by an
// access/QR code. Admin additions are additive CRUD + UPDATE/INSERT only:
// no DROPs, no DELETEs, no renames, no column-type changes, no wiping.
// Config knobs live in the key/value `settings` table (additive by nature).
// ---------------------------------------------------------------------------

// Settings keys used by the guest portal:
//   guest_mode        -> 'teaser' | 'countdown' | 'rsvp' | 'weddingday' | 'thankyou'  (live guest homepage)
//   teaser_live_at    -> ISO timestamp or '' (teaser goes live automatically)
//   countdown_live_at -> ISO timestamp or '' (countdown goes live automatically)
//   rsvp_live_at      -> ISO timestamp or '' (RSVP goes live automatically)
//   weddingday_live_at-> ISO timestamp or '' (wedding-day/v4 goes live automatically)
//   thankyou_live_at  -> ISO timestamp or '' (thank-you/v5 goes live automatically)
//   rsvp_open         -> no longer read: RSVPs are open while the RSVP (v3)
//                        site is the live one (see rsvpOpenFor)
//   rsvp_opens_at     -> ISO timestamp or '' (optional: not before this)
//   rsvp_closes_at    -> ISO timestamp or '' (optional: reply-by deadline)
//   go_public_date    -> ISO date or '' (countdown "see you there" target)
//   preview_tokens    -> JSON [{ token, host, expires_at }]
//   rsvp_reminder_log -> JSON [ { at, household_id, household_name, note } ]

// ---------------------------------------------------------------------------
// PUBLIC guest home: status for the guest homepage / details page
// ---------------------------------------------------------------------------
route('GET', '/api/guest/home', async (env, req, params, url) => {
  const hostname = (url && url.hostname) || '';
  const s = await loadGuestSettings(env);
  const setup = await getSetup(env);
  const mode = modeForHost(hostname) || effectiveLiveMode(s, setup);
  const couple = {
    name_one: (setup && setup.partner1_name) || '',
    name_two: (setup && setup.partner2_name) || '',
  };
  const weddingDate = (setup && setup.wedding_date) || '';
  const venue = (setup && setup.venue) || '';
  // Countdown target: explicit go-public date, else wedding date.
  const target = s.go_public_date || weddingDate || '';
  let rsvpOpen;
  try {
    rsvpOpen = await isRsvpOpen(env);
  } catch {
    rsvpOpen = false;
  }
  // Preview tokens (device whitelist for v1/v2/v3 leak protection)
  const hostIsPreview = /^v[123]\./.test(hostname);
  let previewEnded = false;
  if (hostIsPreview) {
    const tokens = safeJsonParse(s.preview_tokens, []);
    const qp = url && url.searchParams ? url.searchParams.get('pt') : null;
    const okTok = (qp && tokens.some((x) => x.token === qp && (!x.host || x.host === hostname) && (!x.expires_at || x.expires_at > new Date().toISOString()))) || false;
    // The fetch handler has already allowed a valid plan-site session through
    // the preview gate. Keep the SPA state aligned with that access decision.
    const session = await getSession(req, env);
    previewEnded = !okTok && !session;
  }
  return ok({
    mode,
    couple,
    wedding_date: weddingDate,
    venue,
    countdown_target: target,
    rsvp_open: rsvpOpen,
    rsvp_opens_at: s.rsvp_opens_at,
    rsvp_closes_at: s.rsvp_closes_at,
    go_public_date: s.go_public_date,
    preview_ended: previewEnded,
    access_required: mode === 'rsvp',
  });
}, { auth: false });

// ---------------------------------------------------------------------------
// Guest website (v3 RSVP site) — content model, draft/publish, public API.
// Content is settings-stored JSON. The draft is only ever served to the
// couple's own session; the public API only ever serves the PUBLISHED
// snapshot. Everything here is additive: no guest rows, no codes, nothing
// private.
// ---------------------------------------------------------------------------

const GUEST_SITE_DEFAULTS = {
  hero: { heading: '', welcome: '', photo_url: '', photo_alt: '' },
  travel: {
    ceremony_address: '', reception_address: '',
    ceremony_map_url: '', reception_map_url: '',
    ceremony_w3w: '', reception_w3w: '',
    arrival: '', parking: '', transport: '', accommodation: '', accessibility: '',
  },
  expect: { dress_code: '', weather: '', food_drink: '', children: '', plus_ones: '' },
  menu: { title: '', body: '' },
  faqs: [],
  gifts: { note: '', registry_url: '' },
  contact: { email: '' },
  search_index: false,
};

const DEFAULT_MEAL_OPTIONS = ['dinner', 'salad', 'vegetarian', 'vegan'];

function clampStr(v, max) { return String(v ?? '').slice(0, max); }

function sanitizeSiteContent(input) {
  const src = input && typeof input === 'object' ? input : {};
  const str = (v, max = 2000) => clampStr(v, max);
  const url = (v) => {
    const s = clampStr(v, 500).trim();
    if (!s) return '';
    if (/^(https?:\/\/|\/media\/)/i.test(s)) return s;
    // A link typed without its scheme ("maps.app.goo.gl/abc") is kept as https
    // rather than silently dropped; anything else (javascript:, data:) still is.
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#]\S*)?$/i.test(s) ? `https://${s}` : '';
  };
  const out = {
    hero: {
      heading: str(src.hero && src.hero.heading, 200),
      welcome: str(src.hero && src.hero.welcome, 2000),
      photo_url: url(src.hero && src.hero.photo_url),
      photo_alt: str(src.hero && src.hero.photo_alt, 200),
    },
    travel: {
      ceremony_address: str(src.travel && src.travel.ceremony_address, 500),
      reception_address: str(src.travel && src.travel.reception_address, 500),
      ceremony_map_url: url(src.travel && src.travel.ceremony_map_url),
      reception_map_url: url(src.travel && src.travel.reception_map_url),
      ceremony_w3w: str(src.travel && src.travel.ceremony_w3w, 100),
      reception_w3w: str(src.travel && src.travel.reception_w3w, 100),
      arrival: str(src.travel && src.travel.arrival),
      parking: str(src.travel && src.travel.parking),
      transport: str(src.travel && src.travel.transport),
      accommodation: str(src.travel && src.travel.accommodation),
      accessibility: str(src.travel && src.travel.accessibility),
    },
    expect: {
      dress_code: str(src.expect && src.expect.dress_code, 1000),
      weather: str(src.expect && src.expect.weather, 1000),
      food_drink: str(src.expect && src.expect.food_drink, 1000),
      children: str(src.expect && src.expect.children, 1000),
      plus_ones: str(src.expect && src.expect.plus_ones, 1000),
    },
    menu: { title: str(src.menu && src.menu.title, 200), body: str(src.menu && src.menu.body, 4000) },
    faqs: (Array.isArray(src.faqs) ? src.faqs : [])
      .slice(0, 60)
      .map((f) => ({
        id: clampStr(f && f.id, 64) || uuid(),
        question: clampStr(f && f.question, 300),
        answer: clampStr(f && f.answer, 2000),
        visible: !f || f.visible !== false,
      })),
    gifts: { note: str(src.gifts && src.gifts.note, 1000), registry_url: url(src.gifts && src.gifts.registry_url) },
    contact: { email: str(src.contact && src.contact.email, 254) },
    search_index: !!(src && src.search_index),
    // Ceremony and reception share one location: the guest site then shows a
    // single "Venue" instead of separate Ceremony/Reception blocks.
    same_venue: !!(src && src.same_venue),
  };
  if (out.contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.contact.email)) out.contact.email = '';
  return out;
}

function sanitizeMealOptions(input) {
  const list = Array.isArray(input) ? input : [];
  const clean = list.map((v) => clampStr(String(v ?? '').trim(), 60)).filter(Boolean).slice(0, 20);
  return clean.length ? clean : DEFAULT_MEAL_OPTIONS;
}

async function loadGuestSite(env) {
  const rows = await env.DB.prepare('SELECT key, value FROM settings WHERE key IN (?,?,?,?,?,?)')
    .bind('guest_site_draft', 'guest_site_published', 'guest_site_published_at', 'guest_site_views', 'guest_meal_options', 'rsvp_started')
    .all();
  const s = {};
  for (const r of (rows.results || [])) s[r.key] = r.value;
  return {
    draft: sanitizeSiteContent(safeJsonParse(s.guest_site_draft, null) || {}),
    published: sanitizeSiteContent(safeJsonParse(s.guest_site_published, null) || {}),
    published_at: s.guest_site_published_at || '',
    views: int(s.guest_site_views, 0),
    rsvp_started: int(s.rsvp_started, 0),
    meal_options: sanitizeMealOptions(safeJsonParse(s.guest_meal_options, DEFAULT_MEAL_OPTIONS)),
  };
}

// ---- Media (R2): guest-site hero photos --------------------------------
// Uploads land in the MEDIA R2 bucket (wrangler.toml) under guest-site/photo-*
// and are served same-origin from /media/* on EVERY host (apex, plan and the
// v1-v5 previews) and in every live mode — the "cross-mode pass-through".

const MEDIA_TYPES = {
  'image/jpeg': { ext: 'jpg' },
  'image/png': { ext: 'png' },
  'image/webp': { ext: 'webp' },
  'image/gif': { ext: 'gif' },
};
const MEDIA_MAX_BYTES = 5 * 1024 * 1024; // 5MB

function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

// Validates + normalises a /media/<key> pathname. Returns the R2 key or null.
function mediaKeyFromPath(pathname) {
  try {
    const key = decodeURIComponent(pathname.slice('/media/'.length));
    if (!key || key.length > 300) return null;
    if (key.includes('..') || key.includes('\\') || key.includes('//')) return null;
    if (key.startsWith('/') || key.endsWith('/')) return null;
    return key;
  } catch {
    return null;
  }
}

function mediaTypeFromKey(key) {
  const ext = key.substring(key.lastIndexOf('.')).toLowerCase();
  const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  return map[ext] || 'application/octet-stream';
}

async function serveMedia(env, pathname) {
  if (!env.MEDIA) return null;
  const key = mediaKeyFromPath(pathname);
  if (!key) {
    return new Response('Not found', { status: 404 });
  }
  const obj = await env.MEDIA.get(key);
  if (!obj) return null; // caller falls through to the normal 404
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata && obj.httpMetadata.contentType ? obj.httpMetadata.contentType : mediaTypeFromKey(key),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': obj.httpEtag || '',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

route('POST', '/api/guest-site/photo', async (env, req) => {
  if (!env.MEDIA) return err('Media storage is not configured yet.', 503);
  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  if (!MEDIA_TYPES[contentType]) return err('Unsupported file type — JPEG, PNG, WEBP or GIF only.');
  const len = Number(req.headers.get('content-length') || 0);
  if (!len) return err('Empty upload.');
  if (len > MEDIA_MAX_BYTES) return err('Image must be 5MB or smaller.', 413);
  let buf;
  try {
    buf = new Uint8Array(await req.arrayBuffer());
  } catch {
    return err('Could not read the upload.');
  }
  const kind = sniffImage(buf);
  if (!kind || kind !== contentType) return err('File contents do not match its declared type.');
  const key = `guest-site/photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${MEDIA_TYPES[kind].ext}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: kind } });
  // Best-effort: retire the previous hero photo(s) referenced by the draft or
  // the published site so re-uploads don't pile up in the bucket.
  try {
    const site = await loadGuestSite(env);
    const seen = new Set([`/${key}`]);
    for (const heroUrl of [site.draft.hero && site.draft.hero.photo_url, site.published && site.published.hero && site.published.hero.photo_url]) {
      if (typeof heroUrl !== 'string') continue;
      const p = heroUrl.startsWith('/media/') ? heroUrl : null;
      if (!p || seen.has(p)) continue;
      seen.add(p);
      const old = mediaKeyFromPath(p);
      if (old && old.startsWith('guest-site/photo-')) await env.MEDIA.delete(old);
    }
  } catch { /* non-fatal */ }
  return ok({ path: `/media/${key}` });
});

// ---- Admin (couple session) ------------------------------------------------
route('GET', '/api/guest-site', async (env) => {
  const site = await loadGuestSite(env);
  const ev = await env.DB.prepare(
    'SELECT id, title, type, date, venue, guest_visible, start_time, end_time, guest_description, status FROM events ORDER BY date ASC, created_at ASC'
  ).all();
  return ok({
    ...site,
    events: (ev.results || []).map((e) => ({ ...e, guest_visible: !!e.guest_visible })),
  });
});

route('PUT', '/api/guest-site', async (env, req) => {
  const body = await readBody(req);
  const current = await loadGuestSite(env);
  const draft = body.draft !== undefined ? sanitizeSiteContent(body.draft) : current.draft;
  const mealOptions = body.meal_options !== undefined ? sanitizeMealOptions(body.meal_options) : current.meal_options;
  await setSetting(env, 'guest_site_draft', JSON.stringify(draft));
  await setSetting(env, 'guest_meal_options', JSON.stringify(mealOptions));
  return ok({ draft, meal_options: mealOptions });
});

route('POST', '/api/guest-site/publish', async (env) => {
  const site = await loadGuestSite(env);
  await setSetting(env, 'guest_site_published', JSON.stringify(site.draft));
  await setSetting(env, 'guest_site_published_at', now());
  return ok({ published: site.draft, published_at: now() });
});

// ---- Public guest site payload (published content only) --------------------
// Builds the FULL guest-site payload (published content + venues + events +
// meal options). Draft previews (couple session) and guest unlocks share it.
async function buildGuestSitePayload(env, url, opts = {}) {
  const { useDraft = false, countView = false } = opts;
  const hostname = (url && url.hostname) || '';
  const s = await loadGuestSettings(env);
  const setup = await getSetup(env);
  const mode = modeForHost(hostname) || effectiveLiveMode(s, setup);
  let siteState = await loadGuestSite(env);
  if (useDraft && siteState.draft) siteState = { ...siteState, published: siteState.draft };
  // Anonymous approximate view counter (public fetches only; no per-visitor
  // tracking, and draft previews / unlocks never count).
  if (countView) {
    try { await setSetting(env, 'guest_site_views', String(siteState.views + 1)); } catch { /* non-fatal */ }
  }
  const ev = await env.DB.prepare(
    `SELECT id, title, type, date, venue, guest_description, start_time, end_time
     FROM events WHERE guest_visible = 1 AND status NOT IN ('cancelled','not_applicable')
     ORDER BY date ASC, start_time ASC`
  ).all();
  // Guests only ever receive displayable content: FAQs must be marked visible
  // AND have both a question and an answer.
  const content = JSON.parse(JSON.stringify(siteState.published || {}));
  content.faqs = (content.faqs || []).filter(
    (f) => f.visible && (f.question || '').trim() && (f.answer || '').trim()
  );
  let rsvpOpen;
  try { rsvpOpen = await isRsvpOpen(env); } catch { rsvpOpen = false; }
  return {
    mode,
    couple: {
      name_one: (setup && setup.partner1_name) || '',
      name_two: (setup && setup.partner2_name) || '',
    },
    wedding_date: (setup && setup.wedding_date) || '',
    ceremony_venue: (setup && setup.ceremony_venue) || '',
    reception_venue: (setup && setup.reception_venue) || '',
    rsvp_open: rsvpOpen,
    rsvp_opens_at: s.rsvp_opens_at,
    rsvp_closes_at: s.rsvp_closes_at,
    content: content,
    meal_options: siteState.meal_options,
    events: (ev.results || []).map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      date: e.date,
      venue: e.venue,
      description: e.guest_description || '',
      start_time: e.start_time || '',
      end_time: e.end_time || '',
    })),
  };
}

// The PUBLIC /api/guest/site payload: the couples' names, the wedding date
// and the RSVP window — nothing else. Venue, travel, schedule, menus, FAQs
// and gift details stay behind the RSVP access code.
async function buildLockedSitePayload(env, url, opts = {}) {
  const { countView = false } = opts;
  const hostname = (url && url.hostname) || '';
  const s = await loadGuestSettings(env);
  const setup = await getSetup(env);
  const mode = modeForHost(hostname) || effectiveLiveMode(s, setup);
  if (countView) {
    try {
      const st = await loadGuestSite(env);
      await setSetting(env, 'guest_site_views', String(st.views + 1));
    } catch { /* non-fatal */ }
  }
  let rsvpOpen;
  try { rsvpOpen = await isRsvpOpen(env); } catch { rsvpOpen = false; }
  return {
    mode,
    couple: {
      name_one: (setup && setup.partner1_name) || '',
      name_two: (setup && setup.partner2_name) || '',
    },
    wedding_date: (setup && setup.wedding_date) || '',
    rsvp_open: rsvpOpen,
    rsvp_opens_at: s.rsvp_opens_at,
    rsvp_closes_at: s.rsvp_closes_at,
    locked: true,
  };
}

route('GET', '/api/guest/site', async (env, req, params, url) => {
  const wantsDraft = !!(url && url.searchParams && url.searchParams.get('draft') === '1');
  // Draft preview: only for the couple's own session (e.g. the v3 preview).
  if (wantsDraft) {
    const session = await getSession(req, env);
    if (session) {
      return ok(await buildGuestSitePayload(env, url, { useDraft: true, countView: false }));
    }
  }
  // Public: couples' names + the date + the RSVP window only. The details
  // need an RSVP access code (see POST /api/guest/site/unlock).
  return ok(await buildLockedSitePayload(env, url, { countView: true }));
}, { auth: false });

// ---------------------------------------------------------------------------
// Access-code guess limit (see CODE_MAX_FAILS). State lives in the settings
// table, one short-lived row per visitor who has entered a wrong code.
// ---------------------------------------------------------------------------
async function codeGuessKey(env, req) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const secret = await ensureAuthSecret(env);
  return SETTING_CODE_GUESS_PREFIX + (await sha256Hex(`${secret}:${ip}`)).slice(0, 32);
}

// The couple's own connection(s), listed in CODE_GUESS_EXEMPT_IPS (comma or
// space separated), are never counted or timed out — for testing the site.
function codeGuessExempt(env, req) {
  const ip = req.headers.get('CF-Connecting-IP') || '';
  if (!ip || !env.CODE_GUESS_EXEMPT_IPS) return false;
  return String(env.CODE_GUESS_EXEMPT_IPS).split(/[\s,]+/).filter(Boolean).includes(ip);
}

function codeLockedResponse(until) {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  return err(`Too many incorrect codes. Please wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`, 429);
}

// Call before checking a code: a 429 response while the visitor is timed out,
// otherwise null.
async function codeGuessBlocked(env, req) {
  if (codeGuessExempt(env, req)) return null;
  const state = safeJsonParse(await getSetting(env, await codeGuessKey(env, req)), null);
  return state && state.until > Date.now() ? codeLockedResponse(state.until) : null;
}

// Call when a code was wrong: records it and returns the 429 response if that
// was one guess too many, otherwise null.
async function codeGuessFailed(env, req) {
  if (codeGuessExempt(env, req)) return null;
  const key = await codeGuessKey(env, req);
  const nowMs = Date.now();
  const prev = safeJsonParse(await getSetting(env, key), null);
  const fails = (prev && Array.isArray(prev.fails) ? prev.fails : []).filter((t) => nowMs - t < CODE_FAIL_WINDOW_MS);
  fails.push(nowMs);
  const until = fails.length >= CODE_MAX_FAILS ? nowMs + CODE_LOCK_MS : 0;
  await setSetting(env, key, JSON.stringify({ fails: until ? [] : fails, until }));
  if (!until) return null;
  // Tidy up rows left by visitors whose window and timeout are long over.
  try {
    await env.DB.prepare('DELETE FROM settings WHERE key LIKE ? AND updated_at < ?')
      .bind(`${SETTING_CODE_GUESS_PREFIX}%`, new Date(nowMs - 24 * 60 * 60 * 1000).toISOString())
      .run();
  } catch { /* non-fatal */ }
  return codeLockedResponse(until);
}

// ---------------------------------------------------------------------------
// PUBLIC guest unlock: an RSVP access code unlocks the full site details.
// The payload is the same shape as the draft-preview site (published only; no
// household data — that still belongs to /api/guest/access for the RSVP form).
// ---------------------------------------------------------------------------
route('POST', '/api/guest/site/unlock', async (env, req, params, url) => {
  const body = await readBody(req);
  const code = normalizeAccessCode(body.code || body.access_code);
  if (!code) return err('Please enter your access code.');
  const blocked = await codeGuessBlocked(env, req);
  if (blocked) return blocked;
  const household = await findHouseholdByCode(env, code);
  if (!household) return (await codeGuessFailed(env, req)) || err('That code wasn\u2019t found. Please double-check it (codes ignore dashes/spaces).');
  return ok({
    unlocked: true,
    site: await buildGuestSitePayload(env, url, { useDraft: false, countView: false }),
  });
}, { auth: false });

// ---------------------------------------------------------------------------
// PUBLIC guest access: code/QR -> masked household + guests + questions
// ---------------------------------------------------------------------------
// Shared by /api/guest/access (household RSVP data) and /api/guest/site/unlock
// (site details). Codes match guest QR codes, per-guest access codes or
// per-guest invitation codes; dashes/spaces are ignored.
async function findHouseholdByCode(env, code) {
  const row = await env.DB.prepare(
    `SELECT h.id AS household_id, h.name AS household_name, h.address_line1, h.address_line2, h.city, h.postcode, h.country
     FROM guest_qr_codes gc
     JOIN households h ON h.id = gc.household_id
     WHERE REPLACE(UPPER(gc.code), '-', '') = ?
     LIMIT 1`
  )
    .bind(code)
    .first();
  if (row) return row;
  // Fall back to per-guest access_code / invitation_code match
  const g = await env.DB.prepare(
    `SELECT household_id FROM guests WHERE REPLACE(UPPER(access_code), '-', '') = ? OR REPLACE(UPPER(invitation_code), '-', '') = ? LIMIT 1`
  )
    .bind(code, code)
    .first();
  if (g) {
    const h = await env.DB.prepare('SELECT id AS household_id, name AS household_name, address_line1, address_line2, city, postcode, country FROM households WHERE id = ?')
      .bind(g.household_id)
      .first();
    if (h) return h;
  }
  return null;
}

route('POST', '/api/guest/access', async (env, req) => {
  const body = await readBody(req);
  const code = normalizeAccessCode(body.code || body.access_code);
  if (!code) return err('Please enter your access code.');
  const blocked = await codeGuessBlocked(env, req);
  if (blocked) return blocked;
  const household = await findHouseholdByCode(env, code);
  if (!household) return (await codeGuessFailed(env, req)) || err('That code wasn\u2019t found. Please double-check it (codes ignore dashes/spaces).');
  const guests = await env.DB.prepare(
    `SELECT id, first_name, last_name, is_primary, status, attendance_type, email, phone, dietary_needs, dietary_choice, song_request, accessibility_requests, plus_one_of, plus_one_allowed, plus_one_response, rsvp_message
     FROM guests WHERE household_id = ? ORDER BY is_primary DESC, first_name ASC`
  )
    .bind(household.household_id)
    .all();
  const questions = await env.DB.prepare(
    `SELECT id, question, field_type, options, required, order_index
     FROM rsvp_questions ORDER BY order_index ASC, created_at ASC`
  )
    .all();
  let rsvpOpen;
  try {
    rsvpOpen = await isRsvpOpen(env);
  } catch {
    rsvpOpen = false;
  }
  const s = await loadGuestSettings(env);
  const journey = await env.DB.prepare('SELECT rsvp_submitted_at FROM rsvp_journeys WHERE household_id = ? LIMIT 1')
    .bind(household.household_id)
    .first();
  const siteState = await loadGuestSite(env);
  const hostById = new Map(guests.results.map((g) => [g.id, g]));
  const t = new Date().toISOString();
  let window_state = 'closed';
  if (rsvpOpen) window_state = 'open';
  else if (s.rsvp_opens_at && s.rsvp_opens_at > t) window_state = 'not_yet_open';
  // Anonymous approximate "started" counter — a household reached the form.
  try { await setSetting(env, 'rsvp_started', String(siteState.rsvp_started + 1)); } catch { /* non-fatal */ }
  return ok({
    household: {
      id: household.household_id,
      name: household.household_name,
      address_line1: household.address_line1 || '',
      address_line2: household.address_line2 || '',
      city: household.city || '',
      postcode: household.postcode || '',
      country: household.country || '',
    },
    guests: guests.results.map((g) => ({
      id: g.id,
      first_name: g.first_name,
      last_name: g.last_name,
      is_primary: !!g.is_primary,
      status: g.status,
      attendance_type: g.attendance_type,
      email: g.email || '',
      phone: g.phone || '',
      dietary_needs: g.dietary_needs,
      dietary_choice: g.dietary_choice,
      song_request: g.song_request,
      accessibility_requests: g.accessibility_requests,
      plus_one_of: g.plus_one_of,
      // The couple offered this guest a plus-one to add on the form, and
      // what they said last time ('' | 'accepted' | 'declined').
      plus_one_allowed: !!g.plus_one_allowed,
      plus_one_response: g.plus_one_response || '',
      // A plus-one saved without a name: the form shows the name as blank.
      name_pending: !!(g.plus_one_of && hostById.has(g.plus_one_of) && isPlusOnePlaceholderName(g, hostById.get(g.plus_one_of))),
      // The guest's own message. guests.notes is the couple's private note
      // and is never sent to guests.
      rsvp_message: g.rsvp_message || '',
    })),
    questions: (questions.results || []).map((q) => ({
      id: q.id,
      question: q.question,
      question_type: q.field_type,
      options: safeJsonParse(q.options, []),
      is_required: !!q.required,
      order_index: q.order_index,
    })),
    rsvp_open: rsvpOpen,
    rsvp_opens_at: s.rsvp_opens_at,
    rsvp_closes_at: s.rsvp_closes_at,
    // Deploy 2 (RSVP journey): configured meal choices, window state and the
    // household's previous response (for the "change your response" path).
    meal_options: siteState.meal_options,
    window_state,
    already_responded: !!(journey && journey.rsvp_submitted_at),
    rsvp_submitted_at: (journey && journey.rsvp_submitted_at) || '',
  });
}, { auth: false });

// ---------------------------------------------------------------------------
// PUBLIC guest access: quick QR-code lookup -> just valid/invalid
// ---------------------------------------------------------------------------
route('POST', '/api/guest/qr-lookup', async (env, req) => {
  const body = await readBody(req);
  const code = normalizeAccessCode(body.code || body.access_code);
  if (!code) return err('Missing code.');
  const blocked = await codeGuessBlocked(env, req);
  if (blocked) return blocked;
  const row = await env.DB.prepare("SELECT household_id FROM guest_qr_codes WHERE REPLACE(UPPER(code), '-', '') = ? LIMIT 1").bind(code).first();
  if (!row) {
    const g = await env.DB.prepare("SELECT household_id FROM guests WHERE REPLACE(UPPER(access_code), '-', '') = ? LIMIT 1").bind(code).first();
    if (!g) {
      const locked = await codeGuessFailed(env, req);
      if (locked) return locked;
    }
    return ok({ valid: !!g, household_id: g ? g.household_id : null });
  }
  return ok({ valid: true, household_id: row.household_id });
}, { auth: false });

// What the public RSVP form may send. A status or attendance type outside
// these is refused, and guests' free text is cut to these lengths, before
// anything is written. The attendance type saved always follows the status.
const RSVP_STATUSES = ['confirmed', 'declined'];
const RSVP_ATTENDANCE_TYPES = ['dinner', 'not_attending'];
const RSVP_TEXT_MAX = { dietary_needs: 500, dietary_choice: 80, song_request: 200, accessibility_requests: 500, rsvp_message: 1000 };
const RSVP_ANSWER_MAX = 1000;

function rsvpText(v, max) {
  return typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '';
}

// Statements that save a guest's answer to "are you bringing a plus-one?".
// Bringing someone creates (or updates) the plus-one's own guest row; not
// bringing anyone, or the host declining, marks an existing row declined.
// Nothing is deleted, so the household can change its mind while RSVPs are
// open. Returned rather than run, so the RSVP is saved as one batch.
async function rsvpPlusOneStatements(env, host, householdId, p, status, t) {
  const bringing = status !== 'declined' && !!p.bringing;
  const existing = await env.DB.prepare('SELECT id FROM guests WHERE plus_one_of = ? ORDER BY created_at ASC LIMIT 1')
    .bind(host.id)
    .first();
  const stmts = [];
  if (bringing) {
    let firstName = rsvpText(p.first_name, 200).trim().slice(0, 80);
    let lastName = rsvpText(p.last_name, 200).trim().slice(0, 80);
    if (!firstName && !lastName) ({ first_name: firstName, last_name: lastName } = plusOnePlaceholderName(host));
    const dietaryNeeds = rsvpText(p.dietary_needs, RSVP_TEXT_MAX.dietary_needs);
    const dietaryChoice = rsvpText(p.dietary_choice, RSVP_TEXT_MAX.dietary_choice);
    if (existing) {
      stmts.push(env.DB.prepare(
        `UPDATE guests SET first_name = ?, last_name = ?, status = ?, attendance_type = 'dinner', dietary_needs = ?, dietary_choice = ?, updated_at = ?
         WHERE id = ?`
      ).bind(firstName, lastName, status, dietaryNeeds, dietaryChoice, t, existing.id));
    } else {
      stmts.push(env.DB.prepare(
        `INSERT INTO guests (id, household_id, is_primary, first_name, last_name, invitation_code, status, attendance_type, dietary_needs, dietary_choice, plus_one_of, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, 'dinner', ?, ?, ?, ?, ?)`
      ).bind(uuid(), householdId, firstName, lastName, makeInvitationCode(), status, dietaryNeeds, dietaryChoice, host.id, t, t));
    }
  } else if (existing) {
    stmts.push(env.DB.prepare("UPDATE guests SET status = 'declined', attendance_type = 'not_attending', updated_at = ? WHERE id = ?")
      .bind(t, existing.id));
  }
  stmts.push(env.DB.prepare('UPDATE guests SET plus_one_response = ? WHERE id = ?')
    .bind(bringing ? 'accepted' : 'declined', host.id));
  return stmts;
}

// ---------------------------------------------------------------------------
// PUBLIC guest RSVP submit (household-level: one RSVP for the party)
// ---------------------------------------------------------------------------
// Everything is checked first and then written as one D1 batch (a single
// transaction), so a failure part-way never leaves a half-saved household.
route('POST', '/api/guest/rsvp', async (env, req) => {
  const body = await readBody(req);
  const code = normalizeAccessCode(body.code || body.access_code);
  if (!code) return err('Missing access code.');
  const blocked = await codeGuessBlocked(env, req);
  if (blocked) return blocked;
  // Resolve household
  const row = await env.DB.prepare(
    `SELECT gc.household_id, h.name AS household_name
     FROM guest_qr_codes gc JOIN households h ON h.id = gc.household_id
     WHERE REPLACE(UPPER(gc.code), '-', '') = ? LIMIT 1`
  )
    .bind(code)
    .first();
  let householdId = row && row.household_id;
  if (!householdId) {
    const g = await env.DB.prepare("SELECT household_id FROM guests WHERE REPLACE(UPPER(access_code), '-', '') = ? LIMIT 1").bind(code).first();
    if (g) householdId = g.household_id;
  }
  if (!householdId) return (await codeGuessFailed(env, req)) || err('That code wasn’t found.');

  let rsvpOpen;
  try {
    rsvpOpen = await isRsvpOpen(env);
  } catch {
    rsvpOpen = false;
  }
  if (!rsvpOpen) return err('The RSVP window is currently closed. Please check back soon — see you at the wedding ✨');

  const responses = Array.isArray(body.responses) ? body.responses : [];
  if (!responses.length) return err('Please RSVP for at least one guest.');
  const t = new Date().toISOString();

  // Verify every guest belongs to this household, once each, before any write.
  const mine = await env.DB.prepare('SELECT id, first_name, last_name, is_primary, plus_one_allowed FROM guests WHERE household_id = ? ORDER BY created_at ASC').bind(householdId).all();
  const mineById = new Map((mine.results || []).map((g) => [g.id, g]));
  const seen = new Set();
  for (const r of responses) {
    if (!r || typeof r !== 'object' || !r.guest_id || !mineById.has(r.guest_id)) return err('One or more guests do not belong to this household.');
    if (seen.has(r.guest_id)) return err('Each guest can only be answered for once.');
    seen.add(r.guest_id);
  }

  // Household contact (email + mobile) is asked ONCE per household and stored
  // on the primary guest.
  const contact = body.contact && typeof body.contact === 'object' ? body.contact : {};
  const contactEmail = String(contact.email || '').trim().slice(0, 254);
  const contactPhone = String(contact.phone || '').trim().slice(0, 40);
  if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
    return err('That email address doesn’t look right — please check it and try again.');
  }

  // The household may correct its name and postal address. Same rule as the
  // guest details below: tidied before any write, a blank never replaces a
  // saved value.
  const hh = body.household && typeof body.household === 'object' ? body.household : {};
  const householdLimits = { name: 120, address_line1: 120, address_line2: 120, city: 80, postcode: 20, country: 80 };
  const householdEdits = {};
  for (const [field, max] of Object.entries(householdLimits)) {
    const v = typeof hh[field] === 'string' ? hh[field].trim().slice(0, max) : '';
    if (v) householdEdits[field] = v;
  }

  // Each guest's answer, tidied and validated. Guests may also correct their
  // own name and add their own email / mobile; a blank never replaces what is
  // already saved (guests may fill in only some of the fields).
  const clean = [];
  for (const r of responses) {
    const status = r.status != null && r.status !== '' ? r.status : r.attending ? 'confirmed' : 'declined';
    if (!RSVP_STATUSES.includes(status)) return err('Please choose whether each guest is coming.');
    if (r.attendance_type != null && r.attendance_type !== '' && !RSVP_ATTENDANCE_TYPES.includes(r.attendance_type)) {
      return err('Please choose whether each guest is coming.');
    }
    const d = {
      first_name: typeof r.first_name === 'string' ? r.first_name.trim().slice(0, 80) : '',
      last_name: typeof r.last_name === 'string' ? r.last_name.trim().slice(0, 80) : '',
      email: typeof r.email === 'string' ? r.email.trim().slice(0, 254) : '',
      phone: typeof r.phone === 'string' ? r.phone.trim().slice(0, 40) : '',
    };
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) {
      return err('One of the email addresses doesn’t look right — please check it and try again.');
    }
    const text = {};
    for (const [field, max] of Object.entries(RSVP_TEXT_MAX)) text[field] = rsvpText(r[field], max);
    // Forms loaded before rsvp_message existed still send their box as `notes`.
    if (r.rsvp_message === undefined) text.rsvp_message = rsvpText(r.notes, RSVP_TEXT_MAX.rsvp_message);
    // One answer per question (the last one wins).
    const answers = new Map();
    for (const a of Array.isArray(r.answers) ? r.answers : []) {
      if (a && typeof a === 'object' && typeof a.question_id === 'string' && a.question_id) {
        answers.set(a.question_id, rsvpText(a.answer, RSVP_ANSWER_MAX));
      }
    }
    clean.push({ r, status, attendanceType: status === 'declined' ? 'not_attending' : 'dinner', d, text, answers });
  }

  // Everything the writes depend on is read before the batch.
  const questionIds = new Set(((await env.DB.prepare('SELECT id FROM rsvp_questions').all()).results || []).map((q) => q.id));
  const savedAnswers = await env.DB.prepare(
    'SELECT a.id, a.guest_id, a.question_id FROM rsvp_answers a JOIN guests g ON g.id = a.guest_id WHERE g.household_id = ?'
  ).bind(householdId).all();
  const answerIdByKey = new Map((savedAnswers.results || []).map((a) => [`${a.guest_id}:${a.question_id}`, a.id]));
  const journey = await env.DB.prepare('SELECT id FROM rsvp_journeys WHERE household_id = ? LIMIT 1')
    .bind(householdId)
    .first();

  const stmts = [];
  for (const { r, status, attendanceType, d, text, answers } of clean) {
    stmts.push(env.DB.prepare(
      `UPDATE guests SET
         status = ?,
         attendance_type = ?,
         dietary_needs = ?,
         dietary_choice = ?,
         song_request = ?,
         accessibility_requests = ?,
         rsvp_message = ?,
         first_name = COALESCE(NULLIF(?, ''), first_name),
         last_name = COALESCE(NULLIF(?, ''), last_name),
         email = COALESCE(NULLIF(?, ''), email),
         phone = COALESCE(NULLIF(?, ''), phone),
         updated_at = ?
       WHERE id = ? AND household_id = ?`
    ).bind(
      status, attendanceType,
      text.dietary_needs, text.dietary_choice, text.song_request, text.accessibility_requests, text.rsvp_message,
      d.first_name, d.last_name, d.email, d.phone,
      t, r.guest_id, householdId
    ));
    // A plus-one is only ever saved for a guest the couple offered one to.
    const host = mineById.get(r.guest_id);
    if (host.plus_one_allowed && r.plus_one && typeof r.plus_one === 'object') {
      stmts.push(...(await rsvpPlusOneStatements(env, host, householdId, r.plus_one, status, t)));
    }
    // Custom question answers (additive: UPDATE existing, else INSERT). An
    // answer to a question the couple has since removed is dropped.
    for (const [questionId, val] of answers) {
      if (!questionIds.has(questionId)) continue;
      const existingId = answerIdByKey.get(`${r.guest_id}:${questionId}`);
      stmts.push(existingId
        ? env.DB.prepare('UPDATE rsvp_answers SET answer = ?, updated_at = ? WHERE id = ?').bind(val, t, existingId)
        : env.DB.prepare('INSERT INTO rsvp_answers (id, guest_id, question_id, answer) VALUES (?, ?, ?, ?)').bind(uuid(), r.guest_id, questionId, val));
    }
  }

  // Household name / address edits (field names come from householdLimits).
  for (const [field, v] of Object.entries(householdEdits)) {
    stmts.push(env.DB.prepare(`UPDATE households SET ${field} = ?, updated_at = ? WHERE id = ?`).bind(v, t, householdId));
  }

  // The household contact goes on the primary guest (else the first guest).
  if (contactEmail || contactPhone) {
    const list = mine.results || [];
    const target = list.find((g) => g.is_primary) || list[0];
    if (target) {
      stmts.push(env.DB.prepare(
        "UPDATE guests SET email = COALESCE(NULLIF(?, ''), email), phone = COALESCE(NULLIF(?, ''), phone), updated_at = ? WHERE id = ?"
      ).bind(contactEmail, contactPhone, t, target.id));
    }
  }

  // Record the completed journey (additive upsert).
  stmts.push(journey
    ? env.DB.prepare('UPDATE rsvp_journeys SET rsvp_submitted_at = ?, updated_at = ? WHERE id = ?').bind(t, t, journey.id)
    : env.DB.prepare('INSERT INTO rsvp_journeys (id, household_id, rsvp_submitted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(uuid(), householdId, t, t, t));

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    console.error('guest RSVP save failed', redactError(e));
    return err('Sorry — your RSVP couldn’t be saved, so nothing has changed. Please try again.', 500);
  }

  return ok({ submitted_at: t, mode: 'rsvp', message: 'Thank you — your RSVP is saved. See you at the wedding ✨' });
}, { auth: false });

// ---------------------------------------------------------------------------
// Admin additive: tags CRUD + assignment
// ---------------------------------------------------------------------------
route('GET', '/api/guest-tags', async (env) => {
  const r = await env.DB.prepare('SELECT * FROM guest_tags ORDER BY name ASC').all();
  return ok(r.results);
});

route('POST', '/api/guest-tags', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  await env.DB.prepare('INSERT INTO guest_tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, String(body.name || '').trim(), String(body.color || '#8B5E3C'), new Date().toISOString(), new Date().toISOString())
    .run();
  const r = await env.DB.prepare('SELECT * FROM guest_tags WHERE id = ?').bind(id).first();
  return ok(r);
});

route('PUT', '/api/guest-tags/:id', async (env, req, params) => {
  const r = await env.DB.prepare('SELECT * FROM guest_tags WHERE id = ?').bind(params.id).first();
  if (!r) return err('Tag not found', 404);
  const body = await readBody(req);
  await env.DB.prepare('UPDATE guest_tags SET name = ?, color = ?, updated_at = ? WHERE id = ?')
    .bind(
      body.name != null ? String(body.name).trim() : r.name,
      body.color != null ? String(body.color) : r.color,
      new Date().toISOString(),
      params.id
    )
    .run();
  const rr = await env.DB.prepare('SELECT * FROM guest_tags WHERE id = ?').bind(params.id).first();
  return ok(rr);
});

route('DELETE', '/api/guest-tags/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM guest_tag_assignments WHERE tag_id = ?').bind(params.id).run();
  await env.DB.prepare('DELETE FROM guest_tags WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

route('GET', '/api/guest-tags/assignments', async (env) => {
  const r = await env.DB.prepare(
    `SELECT gta.guest_id, gta.tag_id, gt.name, gt.color
     FROM guest_tag_assignments gta
     JOIN guest_tags gt ON gt.id = gta.tag_id
     ORDER BY gt.name ASC`
  ).all();
  return ok(r.results);
});

route('POST', '/api/guests/:id/tags', async (env, req, params) => {
  const body = await readBody(req);
  const tagIds = Array.isArray(body.tag_ids) ? body.tag_ids.filter(Boolean) : [];
  const guest = await env.DB.prepare('SELECT id FROM guests WHERE id = ?').bind(params.id).first();
  if (!guest) return err('Guest not found', 404);
  for (const tid of tagIds) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO guest_tag_assignments (guest_id, tag_id) VALUES (?, ?)'
    )
      .bind(params.id, tid)
      .run();
  }
  // Remove previously-assigned tags not in the new list (assignment-only cleanup)
  const existing = await env.DB.prepare('SELECT tag_id FROM guest_tag_assignments WHERE guest_id = ?').bind(params.id).all();
  for (const e of (existing.results || [])) {
    if (!tagIds.includes(e.tag_id)) {
      await env.DB.prepare('DELETE FROM guest_tag_assignments WHERE guest_id = ? AND tag_id = ?').bind(params.id, e.tag_id).run();
    }
  }
  return ok({ updated: true });
});

// ---------------------------------------------------------------------------
// Admin additive: custom RSVP questions CRUD
// ---------------------------------------------------------------------------
route('GET', '/api/rsvp-questions', async (env) => {
  const r = await env.DB.prepare('SELECT * FROM rsvp_questions ORDER BY order_index ASC, created_at ASC').all();
  return ok(r.results);
});

route('POST', '/api/rsvp-questions', async (env, req) => {
  const body = await readBody(req);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO rsvp_questions (id, question, field_type, options, required, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      String(body.question || '').trim(),
      body.field_type || body.question_type || 'text',
      JSON.stringify(Array.isArray(body.options) ? body.options : []),
      body.required != null ? (body.required ? 1 : 0) : (body.is_required ? 1 : 0),
      body.order_index != null ? body.order_index : 0,
      new Date().toISOString(),
      new Date().toISOString()
    )
    .run();
  const r = await env.DB.prepare('SELECT * FROM rsvp_questions WHERE id = ?').bind(id).first();
  return ok(r);
});

route('PUT', '/api/rsvp-questions/:id', async (env, req, params) => {
  const r = await env.DB.prepare('SELECT * FROM rsvp_questions WHERE id = ?').bind(params.id).first();
  if (!r) return err('Question not found', 404);
  const body = await readBody(req);
  await env.DB.prepare(
    `UPDATE rsvp_questions SET question = ?, field_type = ?, options = ?, required = ?, order_index = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.question != null ? String(body.question).trim() : r.question,
      body.field_type != null ? body.field_type : body.question_type != null ? body.question_type : r.field_type,
      body.options != null ? JSON.stringify(body.options) : r.options,
      body.required != null ? (body.required ? 1 : 0) : body.is_required != null ? (body.is_required ? 1 : 0) : r.required,
      body.order_index != null ? body.order_index : r.order_index,
      new Date().toISOString(),
      params.id
    )
    .run();
  const rr = await env.DB.prepare('SELECT * FROM rsvp_questions WHERE id = ?').bind(params.id).first();
  return ok(rr);
});

route('DELETE', '/api/rsvp-questions/:id', async (env, req, params) => {
  await env.DB.prepare('DELETE FROM rsvp_answers WHERE question_id = ?').bind(params.id).run();
  await env.DB.prepare('DELETE FROM rsvp_questions WHERE id = ?').bind(params.id).run();
  return ok({ deleted: true });
});

// Admin additive: guest song requests — surfaces guests.song_request, which
// guests submit through their RSVP form (one song per guest). Read-only,
// newest first. Song text is live data captured via the portal, never seeded.
route('GET', '/api/rsvp/songs', async (env) => {
  const r = await env.DB.prepare(
    `SELECT g.id as guest_id, g.first_name, g.last_name, g.status, g.attendance_type, g.song_request, g.updated_at,
            h.name as household_name
     FROM guests g
     LEFT JOIN households h ON h.id = g.household_id
     WHERE g.song_request IS NOT NULL AND g.song_request != ''
     ORDER BY g.updated_at DESC, g.last_name ASC, g.first_name ASC`
  ).all();
  return ok(
    (r.results || []).map((g) => ({
      guest_id: g.guest_id,
      guest_name: `${g.first_name} ${g.last_name}`.trim() || 'Guest',
      household_name: g.household_name || '',
      status: g.status,
      attendance_type: g.attendance_type,
      song_request: g.song_request,
      updated_at: g.updated_at,
    }))
  );
});

// Admin additive: the caterer dietary & allergy matrix. One row per guest,
// grouped by their seated table (falling back to the household) so the venue /
// caterer can be handed a single sheet 4-6 weeks out. Read-only aggregation
// over live guest data — nothing is stored here.
route('GET', '/api/rsvp/dietary-matrix', async (env) => {
  const r = await env.DB.prepare(
    `SELECT g.id, g.first_name, g.last_name, g.email, g.phone, g.status, g.attendance_type,
            g.is_primary, g.dietary_needs, g.dietary_choice,
            h.id AS household_id, h.name AS household_name,
            t.name AS table_name, sa.seat_number
     FROM guests g
     LEFT JOIN households h ON h.id = g.household_id
     LEFT JOIN seating_assignments sa ON sa.guest_id = g.id
     LEFT JOIN tables t ON t.id = sa.table_id
     ORDER BY t.name ASC, sa.seat_number ASC, g.last_name ASC, g.first_name ASC`
  ).all();

  const guests = (r.results || []).map((g) => ({
    id: g.id,
    name: `${g.first_name} ${g.last_name}`.trim() || 'Guest',
    household_name: g.household_name || '',
    is_primary: !!g.is_primary,
    status: g.status || '',
    attending: g.status === 'confirmed' || g.status === 'evening_only',
    attendance_type: g.attendance_type || '',
    email: g.email || '',
    phone: g.phone || '',
    meal: g.dietary_choice || '',
    dietary: g.dietary_needs || '',
    table_name: g.table_name || '',
    seat_number: g.seat_number == null ? null : Number(g.seat_number),
  }));

  // Group by table; unseated guests collapse into one trailing group, then any
  // remaining households keep their own group so nothing is ever hidden.
  const groups = [];
  const byKey = new Map();
  for (const g of guests) {
    let key;
    let label;
    if (g.table_name) {
      key = `table:${g.table_name}`;
      label = g.table_name;
    } else if (g.household_name) {
      key = `household:${g.household_name}`;
      label = `${g.household_name} (unseated)`;
    } else {
      key = 'other';
      label = 'Unassigned';
    }
    if (!byKey.has(key)) {
      const grp = { key, label, guests: [] };
      byKey.set(key, grp);
      groups.push(grp);
    }
    byKey.get(key).guests.push(g);
  }

  const attending = guests.filter((g) => g.attending);
  const meals = {};
  for (const g of attending) {
    const key = (g.meal || '').trim() || 'tbc';
    meals[key] = (meals[key] || 0) + 1;
  }

  return ok({
    groups,
    guests,
    summary: {
      total: guests.length,
      attending: attending.length,
      with_dietary: attending.filter((g) => (g.dietary || '').trim() !== '').length,
      with_contact: attending.filter((g) => (g.email || '').trim() !== '' || (g.phone || '').trim() !== '').length,
      seated: guests.filter((g) => !!g.table_name).length,
      meals,
    },
  });
});

// ---------------------------------------------------------------------------
// Admin additive: RSVP window (open/close) + live guest site (mode + go-live)
// ---------------------------------------------------------------------------

route('GET', '/api/rsvp/window', async (env) => {
  const s = await loadGuestSettings(env);
  return ok(guestWindowPayload(s, await getSetup(env)));
});

route('PUT', '/api/rsvp/window', async (env, req) => {
  const body = await readBody(req);
  const set = (key, val) =>
    env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).bind(key, val).run();
  if (body.rsvp_opens_at !== undefined) await set('rsvp_opens_at', body.rsvp_opens_at || '');
  if (body.rsvp_closes_at !== undefined) await set('rsvp_closes_at', body.rsvp_closes_at || '');
  if (body.guest_mode !== undefined) await set('guest_mode', body.guest_mode);
  if (body.teaser_live_at !== undefined) await set('teaser_live_at', body.teaser_live_at || '');
  if (body.countdown_live_at !== undefined) await set('countdown_live_at', body.countdown_live_at || '');
  if (body.rsvp_live_at !== undefined) await set('rsvp_live_at', body.rsvp_live_at || '');
  if (body.weddingday_live_at !== undefined) await set('weddingday_live_at', body.weddingday_live_at || '');
  if (body.thankyou_live_at !== undefined) await set('thankyou_live_at', body.thankyou_live_at || '');
  if (body.go_public_date !== undefined) await set('go_public_date', body.go_public_date || '');
  const ns = await loadGuestSettings(env);
  return ok(guestWindowPayload(ns, await getSetup(env)));
});

// ---------------------------------------------------------------------------
// Admin additive: household QR codes + access codes + printable sheet
// ---------------------------------------------------------------------------
route('GET', '/api/rsvp/qr-sheet', async (env, req, params, url) => {
  const households = await env.DB.prepare(
    `SELECT h.id, h.name,
            (SELECT COUNT(*) FROM guests g WHERE g.household_id = h.id) AS guest_count,
            (SELECT COUNT(*) FROM guests g WHERE g.household_id = h.id AND g.status = 'confirmed') AS confirmed_count,
            (SELECT COUNT(*) FROM guests g WHERE g.household_id = h.id AND g.status = 'declined') AS declined_count
     FROM households h
     ORDER BY h.name ASC`
  ).all();
  const codes = await env.DB.prepare('SELECT * FROM guest_qr_codes').all();
  const codeByHouse = {};
  for (const c of (codes.results || [])) codeByHouse[c.household_id] = c;
  const taken = new Set((codes.results || []).map((c) => normalizeAccessCode(c.code)));
  const host = (url && url.hostname) || '';
  const base = host && host.startsWith('plan.') ? (siteDomain() || host) : host;
  const newCodes = [];
  const rows = (households.results || []).map((h) => {
    let code = codeByHouse[h.id] ? codeByHouse[h.id].code : null;
    let payload = codeByHouse[h.id] ? codeByHouse[h.id].qr_payload : null;
    if (!code) {
      code = makeHouseholdCode(taken);
      payload = `https://${base}/?c=${code}`;
      // Lazy-create the QR record when the sheet is (re)generated. Saved
      // below, before responding: a code the planner shows must already work.
      newCodes.push(
        env.DB.prepare(
          'INSERT OR IGNORE INTO guest_qr_codes (household_id, code, qr_svg, qr_payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(h.id, code, '', payload, new Date().toISOString(), new Date().toISOString())
      );
    }
    return {
      household_id: h.id,
      household_name: h.name,
      guest_count: h.guest_count,
      confirmed_count: h.confirmed_count,
      declined_count: h.declined_count,
      access_code: code,
      qr_payload: payload || `https://${base}/?c=${code}`,
      rsvp_link: payload || `https://${base}/?c=${code}`,
    };
  });
  if (newCodes.length) await env.DB.batch(newCodes);
  return ok({ households: rows });
});

route('POST', '/api/households/:id/qr', async (env, req, params, url) => {
  const h = await env.DB.prepare('SELECT id, name FROM households WHERE id = ?').bind(params.id).first();
  if (!h) return err('Household not found', 404);
  const host = (url && url.hostname) || '';
  const base = host && host.startsWith('plan.') ? (siteDomain() || host) : host;
  const existing = await env.DB.prepare('SELECT household_id FROM guest_qr_codes WHERE household_id = ?').bind(params.id).first();
  const code = await newHouseholdCode(env);
  const payload = `https://${base}/?c=${code}`;
  if (existing) {
    await env.DB.prepare('UPDATE guest_qr_codes SET code = ?, qr_payload = ?, qr_svg = ?, updated_at = ? WHERE household_id = ?')
      .bind(code, payload, '', new Date().toISOString(), params.id)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO guest_qr_codes (household_id, code, qr_svg, qr_payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(params.id, code, '', payload, new Date().toISOString(), new Date().toISOString())
      .run();
  }
  return ok({ access_code: code, qr_payload: payload, rsvp_link: payload });
});

route('GET', '/api/households/:id/qr', async (env, req, params, url) => {
  const h = await env.DB.prepare('SELECT id, name FROM households WHERE id = ?').bind(params.id).first();
  if (!h) return err('Household not found', 404);
  const host = (url && url.hostname) || '';
  const base = host && host.startsWith('plan.') ? (siteDomain() || host) : host;
  const existing = await env.DB.prepare('SELECT * FROM guest_qr_codes WHERE household_id = ?').bind(params.id).first();
  if (!existing) {
    const code = await newHouseholdCode(env);
    const payload = `https://${base}/?c=${code}`;
    await env.DB.prepare(
      'INSERT INTO guest_qr_codes (household_id, code, qr_svg, qr_payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(params.id, code, '', payload, new Date().toISOString(), new Date().toISOString())
      .run();
    return ok({ access_code: code, qr_payload: payload, rsvp_link: payload });
  }
  return ok({
    access_code: existing.code,
    qr_payload: existing.qr_payload,
    rsvp_link: existing.qr_payload || `https://${base}/?c=${existing.code}`,
  });
});

route('POST', '/api/households/:id/copy-link', async (env, req, params, url) => {
  const h = await env.DB.prepare('SELECT id, name FROM households WHERE id = ?').bind(params.id).first();
  if (!h) return err('Household not found', 404);
  const host = (url && url.hostname) || '';
  const base = host && host.startsWith('plan.') ? (siteDomain() || host) : host;
  const existing = await env.DB.prepare('SELECT * FROM guest_qr_codes WHERE household_id = ?').bind(params.id).first();
  const code = existing ? existing.code : await newHouseholdCode(env);
  if (!existing) {
    const payload = `https://${base}/?c=${code}`;
    await env.DB.prepare(
      'INSERT INTO guest_qr_codes (household_id, code, qr_svg, qr_payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(h.id, code, '', payload, new Date().toISOString(), new Date().toISOString())
      .run();
  }
  return ok({ rsvp_link: `https://${base}/?c=${code}`, access_code: code });
});

// ---------------------------------------------------------------------------
// Admin additive: reminders + log
// ---------------------------------------------------------------------------
route('GET', '/api/rsvp/reminders', async (env) => {
  const s = await loadGuestSettings(env);
  const log = safeJsonParse(s.rsvp_reminder_log, []);
  // Households never reminded, whose access code exists (RSVP pending)
  const pending = await env.DB.prepare(
    `SELECT h.id, h.name,
            (SELECT COUNT(*) FROM guests g WHERE g.household_id = h.id AND (g.status IS NULL OR g.status = 'potential' OR g.status = 'invited')) AS pending_count
     FROM households h
     WHERE EXISTS (SELECT 1 FROM guest_qr_codes gc WHERE gc.household_id = h.id)
     ORDER BY h.name ASC`
  ).all();
  return ok({
    log,
    pending: (pending.results || [])
      .filter((p) => (p.pending_count || 0) > 0)
      .map((p) => ({ household_id: p.id, household_name: p.name, pending_count: p.pending_count })),
  });
});

route('POST', '/api/rsvp/reminders', async (env, req) => {
  const body = await readBody(req);
  const householdIds = Array.isArray(body.household_ids) ? body.household_ids : [];
  if (!householdIds.length) return err('No households selected for a reminder.');
  const s = await loadGuestSettings(env);
  const log = safeJsonParse(s.rsvp_reminder_log, []);
  const note = String(body.note || '').trim();
  const t = new Date().toISOString();

  // Reminders log + mark as before. Real emails only go out when Email
  // settings are configured (or simulation mode is on) — never otherwise.
  const cfg = await loadEmailConfig(env);
  const canEmail = cfg.configured;
  const setup = await getSetup(env);
  const bodyTemplate = [
    note ? `${note}` : '',
    `This is a gentle nudge that we are still waiting for your RSVP for ${brand().weddingPhrase}.`,
    '{rsvp_button}',
    '',
    'Thanks so much!',
  ].filter(Boolean).join('\n');
  const sends = [];
  let previewReminderHtml = '';
  for (const hid of householdIds) {
    const h = await env.DB.prepare('SELECT id, name FROM households WHERE id = ?').bind(hid).first();
    if (!h) continue;
    await env.DB.prepare('UPDATE guests SET rsvp_reminded_at = ?, updated_at = ? WHERE household_id = ?')
      .bind(t, t, hid)
      .run();
    log.unshift({ at: t, household_id: hid, household_name: h.name, note });
    if (canEmail) {
      const r = await householdRecipient(env, hid);
      if (r && r.email) {
        const subj = 'RSVP reminder — please reply';
        const p = personalise({ name: r.name, code: r.code || '' }, subj, bodyTemplate, '', setup);
        if (!previewReminderHtml) previewReminderHtml = p.html;
        const send = await sendEmail(env, cfg, { to: r.email, name: r.name, subject: p.subject, text: p.text, html: p.html });
        sends.push({
          to_email: r.email, to_name: r.name, subject: p.subject,
          status: send.ok ? 'sent' : 'failed', provider_id: send.id || '', error: send.error || '',
        });
      }
    }
  }
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
    .bind('rsvp_reminder_log', JSON.stringify(log.slice(0, 500)))
    .run();
  if (canEmail && sends.length) {
    await recordCampaign(
      env, 'rsvp_reminder', 'RSVP reminder — please reply', bodyTemplate, previewReminderHtml, 'household', null,
      sends.length, sends.every((x) => x.status === 'sent') ? 'sent' : 'partial', '', cfg.dryRun, sends
    );
  }
  return ok({
    status: 'sent', sent_at: t, count: householdIds.length,
    emailed: canEmail
      ? {
          attempted: sends.length,
          sent: sends.filter((x) => x.status === 'sent').length,
          failed: sends.filter((x) => x.status === 'failed').length,
        }
      : null,
  });
});

// ---------------------------------------------------------------------------
// Email & reminders: guest emails, RSVP nudges, the daily brief and the email
// assistant all send from one mailbox (see src/assistant.js, src/mailbox.js).
// Everything is configured with Worker variables and secrets (listed in
// wrangler.toml) — nothing in the database or this repo. EMAIL_DRY_RUN=1 is
// "simulation": sends are logged with provider_id 'dry-*' and nothing leaves.
// ---------------------------------------------------------------------------

const EMAIL_AUDIENCES = ['all', 'unresponded', 'confirmed', 'declined', 'household'];
const EMAIL_NOT_CONFIGURED = 'Email is not set up — add the mailbox settings to the Worker in Cloudflare (or set EMAIL_DRY_RUN=1 to simulate).';

async function loadEmailConfig(env) {
  const assistant = assistantConfig(env);
  const dryRun = env.EMAIL_DRY_RUN === '1';
  return {
    assistant,
    mail: assistant.mail,
    mailConfigured: assistant.mailConfigured,
    configured: assistant.mailConfigured || dryRun,
    fromName: String(env.EMAIL_FROM_NAME || '').trim() || 'Wedding Team',
    fromAddress: assistant.mail.user,
    coupleEmail: assistant.allowed[0] || '',
    coupleEmails: assistant.allowed,
    dryRun,
    digestEnabled: env.DAILY_BRIEF !== 'off',
    digestTime: /^\d{2}:\d{2}$/.test(env.DAILY_BRIEF_TIME || '') ? env.DAILY_BRIEF_TIME : '08:00',
    lastDigestDate: (await getSetting(env, 'digest_last_date')) || '',
  };
}

function emailConfigSummary(cfg) {
  return {
    configured: cfg.configured,
    dry_run: cfg.dryRun,
    from_name: cfg.fromName,
    from_address: cfg.fromAddress,
    couple_emails: cfg.coupleEmails,
    digest_enabled: cfg.digestEnabled,
    digest_time: cfg.digestTime,
    assistant: { configured: cfg.assistant.configured, model: cfg.assistant.model, dry_run: cfg.assistant.dryRun },
  };
}

function textToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ---------------------------------------------------------------------------
// HTML email templates — bulletproof 600px table layouts with inline styles
// only (Gmail/Outlook strip most <style> blocks), Georgia serif display +
// system sans body, sage/ivory/charcoal to match the planner UI. Every send
// keeps its plain-text fallback (deliverability + spam scoring). No personal
// data here: names, dates and RSVP codes are merged at send time.
// ---------------------------------------------------------------------------

const EMAIL_UI = {
  bg: '#F6F4EE', card: '#FFFFFF', border: '#E7E4DC',
  sage: '#738671', sageSoft: '#5F705C', ink: '#2D3748', muted: '#718096',
  rose: '#B4544C', roseBg: '#FAEDEB', roseBorder: '#EFD6D2',
  amber: '#9A6A2A', amberBg: '#FBF3E7', amberBorder: '#EBE0C8',
};

function escUrl(u) {
  return String(u || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Bulletproof CTA button: VML for Outlook desktop, styled anchor elsewhere.
function bulletButton(text, url) {
  const href = escUrl(url);
  const label = escHtml(text);
  return `<!--[if mso]>
  <table role="presentation" width="100%"><tr><td align="center" style="padding:14px 0;"><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:250px;" arcsize="12%" strokecolor="${EMAIL_UI.sage}" fillcolor="${EMAIL_UI.sage}">
    <center style="color:#FFFFFF;font-family:Georgia, serif;font-size:15px;font-weight:bold;">${label}</center>
  </v:roundrect></td></tr></table>
<![endif]-->
<!--[if !mso]><!-->
  <table role="presentation" width="100%"><tr><td align="center" style="padding:14px 0;">
    <a href="${href}" style="display:inline-block;background:${EMAIL_UI.sage};color:#FFFFFF;font-family:Georgia, 'Times New Roman', serif;font-size:15px;font-weight:bold;line-height:46px;padding:0 32px;border-radius:23px;text-decoration:none;">${label}</a>
  </td></tr></table>
<!--<![endif]-->`;
}

// Light sanitisation of couple-authored HTML: drop script/iframe + event attrs.
function sanitizeHtml(h) {
  return String(h || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

// A styled text link. `href` and `label` must already be HTML-escaped.
function emailTextLink(href, label = href) {
  return `<a href="${href}" style="color:${EMAIL_UI.sageSoft};text-decoration:underline;">${label}</a>`;
}

// Plain-text message body -> styled email HTML. Order matters:
//  1. escape everything the couple typed;
//  2. link the bare URLs THEY typed and turn line breaks into <br/> (plain
//     text only, so this can never reach inside markup);
//  3. only then insert the merge-tag markup via `replace` ({rsvp_button},
//     a linked {rsvp_url}). Doing 3 before 2 auto-linked the URL inside the
//     button's own href, giving href="<a href=…", and put <br/> in its markup.
// A typed URL may carry the value tags ({name}, {code}, {rsvp_url}), e.g.
// "https://x.example/rsvp?c={code}&n={name}": `urlTags` fills them inside the
// link itself, URL-encoded in the href and HTML-escaped in the label. Any
// other "{" (such as {rsvp_button}) ends the URL. Trailing sentence
// punctuation (". , : ! ? )") is left outside the link.
const URL_IN_TEXT = /https?:\/\/(?:[^\s<{]|\{(?:name|code|rsvp_url)\})+/g;
const URL_VALUE_TAG = /\{(name|code|rsvp_url)\}/g;
function linkTypedUrl(match, urlTags) {
  const trail = (match.match(/[.,:!?)]+$/) || [''])[0];
  const url = trail ? match.slice(0, -trail.length) : match;
  const tags = urlTags || {};
  // Values never carry a live "{", so they cannot turn into another tag later.
  const href = url.replace(URL_VALUE_TAG, (m, k) => escHtml(encodeURIComponent(String(tags[k] ?? ''))));
  const label = url.replace(URL_VALUE_TAG, (m, k) => escHtml(String(tags[k] ?? '')).replace(/\{/g, '&#123;'));
  return emailTextLink(href, label) + trail;
}
function plainToHtml(body, replace, urlTags) {
  return escHtml(body)
    .split(/\n{2,}/)
    .map((p) => {
      const linked = p
        .replace(URL_IN_TEXT, (u) => linkTypedUrl(u, urlTags))
        .replace(/\n/g, '<br/>');
      return `<p style="margin:0 0 14px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${EMAIL_UI.ink};">${replace ? replace(linked) : linked}</p>`;
    })
    .join('');
}

// The shared brand shell: preheader, sage stripe, serif header + body card.
function emailBodyShell({ preheader = '', tagline = '', dateLine = '', title = '', html = '', footerNote = '' }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" />
<title>${escHtml(title)}</title></head>
<body style="margin:0;padding:0;background:${EMAIL_UI.bg};color:${EMAIL_UI.ink};-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${EMAIL_UI.bg};">${escHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL_UI.bg};"><tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td align="center" style="padding:0 0 16px 0;">
        <div style="font-family:Georgia, 'Times New Roman', serif;font-size:22px;color:#556B52;letter-spacing:0.4px;">${escHtml(tagline)}</div>
        ${dateLine ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:${EMAIL_UI.muted};margin-top:4px;">${escHtml(dateLine)}</div>` : ''}
      </td></tr>
      <tr><td style="background:${EMAIL_UI.card};border:1px solid ${EMAIL_UI.border};border-radius:12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:${EMAIL_UI.sage};height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:24px 30px 8px 30px;">
            <div style="font-family:Georgia, 'Times New Roman', serif;font-size:20px;font-weight:bold;color:${EMAIL_UI.ink};line-height:1.35;">${escHtml(title)}</div>
          </td></tr>
          <tr><td style="padding:6px 30px 24px 30px;">${html}</td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:18px 20px 8px 20px;">
        ${footerNote ? `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${EMAIL_UI.muted};">${escHtml(footerNote)}</div>` : ''}
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:${EMAIL_UI.muted};margin-top:6px;">Sent by <a href="${siteOrigin()}" style="color:${EMAIL_UI.sageSoft};text-decoration:none;">${siteHost()}</a> &middot; <a href="${siteOrigin('plan')}" style="color:${EMAIL_UI.sageSoft};text-decoration:none;">plan site</a></div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// Guest-facing stationery shell (header + RSVP footer note).
function guestEmailShell({ title, dateLine, html, snippet, footerNote = 'Questions? Just reply to this email — it comes straight to us.' }) {
  return emailBodyShell({ preheader: snippet, tagline: brand().name, dateLine, title, html, footerNote });
}

// Digest widgets: KPI stat cell, bullet list, section wrapper.
function emailStat(label, value, fg, bg, border) {
  return `<td width="33%" style="background:${bg};border:1px solid ${border};border-radius:8px;padding:14px 6px;text-align:center;">
    <div style="font-family:Georgia, 'Times New Roman', serif;font-size:26px;font-weight:bold;color:${fg};line-height:1.1;">${value}</div>
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:${EMAIL_UI.muted};text-transform:uppercase;letter-spacing:0.4px;margin-top:4px;">${escHtml(label)}</div>
  </td>`;
}

function emailBullets(rows, dot) {
  return rows.map((li) => `
    <div style="padding:8px 0;border-bottom:1px solid ${EMAIL_UI.border};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:${EMAIL_UI.ink};"><span style="color:${dot};font-weight:bold;">&bull;</span>&nbsp; ${li}</div>`).join('');
}

function emailSection(title, color, inner) {
  return `
    <div style="margin:0 0 20px 0;">
      <div style="font-family:Georgia, 'Times New Roman', serif;font-size:16px;font-weight:bold;color:${color};margin-bottom:8px;">${escHtml(title)}</div>
      ${inner}
    </div>`;
}

function emailNoteBox(text) {
  return `<div style="background:${EMAIL_UI.amberBg};border:1px solid ${EMAIL_UI.amberBorder};border-radius:8px;padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#8A6A3C;margin:0 0 20px 0;">${escHtml(text)}</div>`;
}

// HTML version of the couple digest (mirrors buildDigest's text layout).
function buildDigestHtml(d) {
  const { today, overdue, coming, repliedH, total, counts, rsvpIsOpen, gs, setup, daysToGo } = d;
  const rows = [];
  rows.push(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${emailStat('Overdue', overdue.length, EMAIL_UI.rose, EMAIL_UI.roseBg, EMAIL_UI.roseBorder)}
      ${emailStat('Coming up', coming.length, EMAIL_UI.amber, EMAIL_UI.amberBg, EMAIL_UI.amberBorder)}
      ${emailStat('Days to go', daysToGo != null && daysToGo >= 0 ? daysToGo : '—', EMAIL_UI.sage, '#EDF1EA', '#D4DECF')}
    </tr></table>`);

  if (overdue.length) {
    rows.push(emailSection('Overdue', EMAIL_UI.rose, emailBullets(overdue.map((l) => escHtml(l)), EMAIL_UI.rose)));
  }
  if (coming.length) {
    rows.push(emailSection('Coming up (next 14 days)', EMAIL_UI.sageSoft, emailBullets(coming.map((l) => escHtml(l)), EMAIL_UI.sage)));
  }
  if (!overdue.length && !coming.length) rows.push(emailNoteBox('Nothing overdue or due in the next two weeks — enjoy the calm before the storm.'));

  if (rsvpIsOpen) {
    const waiting = Math.max(0, total - repliedH);
    const lines = [];
    lines.push(repliedH > 0
      ? `${repliedH} of ${total} households have replied (${counts.confirmed || 0} coming · ${counts.declined || 0} can't make it)`
      : `${total} households invited · none replied yet`);
    lines.push(waiting > 0 ? `${waiting} household${waiting === 1 ? '' : 's'} still to reply` : 'Everyone has replied! 🎉');
    if (gs && gs.rsvp_closes_at) lines.push(`RSVPs close ${fmtDate(gs.rsvp_closes_at.slice(0, 10))}`);
    rows.push(emailSection('Guests & RSVPs', EMAIL_UI.sage,
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:${EMAIL_UI.ink};padding:12px 16px;background:#EEF2EC;border:1px solid #D4DECF;border-radius:8px;">${lines.map((l) => escHtml(l)).join('<br/>')}</div>`));
  }

  if (setup && setup.wedding_date) {
    const dd = daysUntil(setup.wedding_date);
    rows.push(`
      <div style="background:${EMAIL_UI.sage};border-radius:8px;padding:16px 18px;text-align:center;margin:0 0 8px 0;">
        <div style="font-family:Georgia, 'Times New Roman', serif;font-size:18px;font-weight:bold;color:#FFFFFF;">${escHtml(fmtDate(setup.wedding_date))}</div>
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#EDF1EA;margin-top:4px;">${dd != null && dd >= 0 ? `${dd} day${dd === 1 ? '' : 's'} to go` : 'The big day!'}</div>
      </div>`);
  }

  rows.push(bulletButton('Open the wedding planner', siteOrigin('plan')));

  return emailBodyShell({
    preheader: `${overdue.length ? `${overdue.length} overdue` : 'all clear'} · ${coming.length ? `${coming.length} coming up` : 'nothing due'}`,
    tagline: brand().name,
    dateLine: fmtDate(today),
    title: 'Your daily planner digest',
    html: rows.join(''),
    footerNote: 'Your wedding planner keeps you on track — overdue payments, tasks, suppliers and the RSVP fight for attention.',
  });
}

// Sends a batch of emails ({ to, subject, text, html }) from the mailbox and
// resolves to one { ok, id, dryRun, error } per email, in order.
async function sendEmails(env, cfg, emails) {
  const out = emails.map(() => null);
  const queue = [];
  emails.forEach((email, i) => {
    if (!email.to || !String(email.to).includes('@')) out[i] = { ok: false, error: 'No recipient address.' };
    else if (cfg.dryRun) out[i] = { ok: true, id: `dry-${uuid()}`, dryRun: true };
    else if (!cfg.mailConfigured) out[i] = { ok: false, error: EMAIL_NOT_CONFIGURED };
    else {
      const built = buildMessage({
        from: cfg.fromAddress,
        fromName: cfg.fromName,
        to: [email.to],
        subject: String(email.subject || ''),
        text: String(email.text || ''),
        html: String(email.html || '') || textToHtml(email.text),
      });
      queue.push({ i, id: built.messageId, message: { to: [email.to], raw: built.raw } });
    }
  });
  // One connection per 20 emails keeps a big guest send well inside the
  // Worker's connection limits.
  for (let n = 0; n < queue.length; n += 20) {
    const chunk = queue.slice(n, n + 20);
    const results = await smtpSendMany(cfg.mail, chunk.map((q) => q.message));
    chunk.forEach((q, k) => {
      out[q.i] = results[k].ok ? { ok: true, id: q.id, dryRun: false } : { ok: false, error: results[k].error };
    });
  }
  return out;
}

async function sendEmail(env, cfg, email) {
  return (await sendEmails(env, cfg, [email]))[0];
}

// Households + their guests, collapsed to ONE recipient per household: the
// chosen email (primary guest first) and a greeting of every member's first
// name — households reply as one family / couple.
async function collectHouseholds(env) {
  const rows = (
    await env.DB.prepare(
      `SELECT h.id AS household_id, h.name AS household_name,
              g.first_name, g.last_name, g.email, g.is_primary, g.status
       FROM households h
       LEFT JOIN guests g ON g.household_id = h.id
       ORDER BY h.name ASC, g.is_primary DESC, g.first_name ASC, g.last_name ASC`
    ).all()
  ).results || [];
  const codes = (await env.DB.prepare('SELECT household_id, code FROM guest_qr_codes').all()).results || [];
  const codeBy = {};
  for (const c of codes) codeBy[c.household_id] = c.code;
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.household_id)) {
      byId.set(r.household_id, { household_id: r.household_id, household_name: r.household_name || '', emails: [], first_names: [], statuses: [] });
    }
    const h = byId.get(r.household_id);
    if (r.first_name) h.first_names.push(r.first_name);
    if (r.email && String(r.email).trim()) h.emails.push({ email: String(r.email).trim(), primary: !!r.is_primary });
    if (r.status) h.statuses.push(r.status);
  }
  const out = [];
  for (const h of byId.values()) {
    if (!h.first_names.length) continue; // stray household with no guests
    const sorted = [...h.emails].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
    let status = 'pending';
    if (h.statuses.includes('confirmed')) status = 'confirmed';
    else if (h.statuses.includes('declined')) status = 'declined';
    out.push({
      household_id: h.household_id,
      household_name: h.household_name,
      email: sorted.length ? sorted[0].email : '',
      name: h.first_names.join(' & '),
      status,
      code: codeBy[h.household_id] || '',
    });
  }
  return out;
}

function filterAudience(households, audience, householdId) {
  let list = households;
  if (audience === 'unresponded') list = list.filter((h) => h.status === 'pending');
  else if (audience === 'confirmed') list = list.filter((h) => h.status === 'confirmed');
  else if (audience === 'declined') list = list.filter((h) => h.status === 'declined');
  else if (audience === 'household') list = list.filter((h) => h.household_id === householdId);
  const skipped = list.filter((h) => !h.email);
  const recipients = list
    .filter((h) => h.email)
    .map((h) => ({ email: h.email, name: h.name, household_id: h.household_id, household_name: h.household_name, status: h.status, code: h.code }));
  return { recipients, skipped };
}

async function householdRecipient(env, householdId) {
  const households = await collectHouseholds(env);
  return households.find((h) => h.household_id === householdId) || null;
}

function personalise(recipient, subject, body, bodyHtml, setup) {
  const name = recipient.name || '';
  const code = recipient.code || '';
  const rsvpUrl = code ? `${siteOrigin()}/?c=${encodeURIComponent(code)}` : '';
  const dateLine = setup && setup.wedding_date ? fmtDate(setup.wedding_date) : '';
  const textRep = (s) => String(s)
    .replace(/\{name\}/g, name)
    .replace(/\{code\}/g, code)
    .replace(/\{rsvp_url\}/g, rsvpUrl)
    .replace(/\{rsvp_button\}/g, rsvpUrl ? `RSVP online here: ${rsvpUrl}` : '');
  // Couple-written HTML: {rsvp_url} is the bare escaped URL, so it works both
  // as text and inside their own href="{rsvp_url}".
  const htmlRep = (s) => String(s)
    .replace(/\{name\}/g, escHtml(name))
    .replace(/\{code\}/g, escHtml(code))
    .replace(/\{rsvp_url\}/g, escUrl(rsvpUrl))
    .replace(/\{rsvp_button\}/g, rsvpUrl ? bulletButton('View details & RSVP', rsvpUrl) : '');
  // Plain-text mode: the link is built here (plainToHtml links only what the
  // couple typed, never inserted markup), so {rsvp_url} becomes a real link.
  const plainRep = (s) => String(s)
    .replace(/\{name\}/g, escHtml(name))
    .replace(/\{code\}/g, escHtml(code))
    .replace(/\{rsvp_url\}/g, rsvpUrl ? emailTextLink(escUrl(rsvpUrl)) : '')
    .replace(/\{rsvp_button\}/g, rsvpUrl ? bulletButton('View details & RSVP', rsvpUrl) : '');
  const text = textRep(body);
  const html = sanitizeHtml(bodyHtml && bodyHtml.trim() ? htmlRep(bodyHtml) : plainToHtml(body, plainRep, { name, code, rsvp_url: rsvpUrl }));
  const htmlFull = guestEmailShell({
    title: textRep(subject),
    dateLine,
    html,
    snippet: String(body || '')
      .replace(/\{name\}/g, 'you')
      .replace(/\{code\}/g, 'the RSVP link')
      .replace(/\{rsvp_button\}/g, 'RSVP online')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 110),
  });
  return { subject: textRep(subject), text, html: htmlFull };
}

async function recordCampaign(env, kind, subject, body, bodyHtml, audience, householdId, recipientCount, status, error, dryRun, sends) {
  const id = uuid();
  const t = now();
  await env.DB.prepare(
    `INSERT INTO email_campaigns (id, kind, subject, body, body_html, audience, household_id, recipient_count, status, error, dry_run, sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, kind, subject, body, bodyHtml || '', audience, householdId || null, recipientCount, status, String(error || '').slice(0, 1000), dryRun ? 1 : 0, t, t, t)
    .run();
  for (const s of sends || []) {
    await env.DB.prepare(
      `INSERT INTO email_log (id, campaign_id, to_email, to_name, subject, status, provider_id, error, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(s.provider_id || uuid(), id, s.to_email, s.to_name || '', s.subject || '', s.status || 'sent', s.provider_id || '', String(s.error || '').slice(0, 1000), t, t)
      .run();
  }
  return id;
}

async function buildDigest(env) {
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const setup = await getSetup(env);
  const overdue = [];
  const coming = [];
  const left = (d) => {
    const n = daysUntil(d);
    if (n == null) return '';
    return n < 0 ? `${-n} day${-n === 1 ? '' : 's'} overdue` : `${n} day${n === 1 ? '' : 's'} away`;
  };
  const bucket = (date, line) => {
    if (!date) return;
    if (date < today) overdue.push(line);
    else if (date <= soon) coming.push(line);
  };

  // Payments still to pay
  {
    const res = await env.DB.prepare(
      `SELECT p.type, p.due_date, p.amount_pence, b.name AS item_name
       FROM payments p LEFT JOIN budget_items b ON b.id = p.budget_item_id
       WHERE p.due_date IS NOT NULL AND p.status IN ('pending','overdue')`
    ).all();
    for (const p of res.results || []) {
      bucket(p.due_date, `£${(p.amount_pence / 100).toFixed(2)} — ${p.item_name || 'Payment'} (${humanTerm(p.type)}) · due ${fmtDate(p.due_date)} · ${left(p.due_date)}`);
    }
  }
  // Open tasks with a deadline
  {
    const res = await env.DB.prepare(
      `SELECT title, status, effective_deadline AS date FROM tasks
       WHERE effective_deadline IS NOT NULL AND status NOT IN ('done','not_applicable')`
    ).all();
    for (const t of res.results || []) {
      bucket(t.date, `${t.title} (${humanTerm(t.status)}) · due ${fmtDate(t.date)} · ${left(t.date)}`);
    }
  }
  // Supplier confirm-by deadlines
  {
    const res = await env.DB.prepare(
      'SELECT name, booking_status AS status, deadline AS date FROM suppliers WHERE deadline IS NOT NULL'
    ).all();
    for (const s of res.results || []) {
      bucket(s.date, `Confirm ${s.name} (${humanTerm(s.status)}) · deadline ${fmtDate(s.date)} · ${left(s.date)}`);
    }
  }
  // Open/deferred decisions with a deadline
  {
    const res = await env.DB.prepare(
      `SELECT title, status, deadline AS date FROM decisions
       WHERE deadline IS NOT NULL AND status IN ('open','deferred')`
    ).all();
    for (const d of res.results || []) {
      bucket(d.date, `Decide: ${d.title} (${humanTerm(d.status)}) · by ${fmtDate(d.date)} · ${left(d.date)}`);
    }
  }
  // Appointments + events coming up only (never overdue)
  {
    const apps = (await env.DB.prepare(
      'SELECT title, date, location FROM appointments WHERE date BETWEEN ? AND ? ORDER BY date ASC'
    ).bind(today, soon).all()).results || [];
    for (const a of apps) coming.push(`Appointment: ${a.title}${a.location ? ` @ ${a.location}` : ''} · ${fmtDate(a.date)}`);
  }
  {
    const evs = (await env.DB.prepare(
      `SELECT title, type, venue, date FROM events
       WHERE date IS NOT NULL AND date BETWEEN ? AND ? AND status NOT IN ('cancelled','not_applicable')
       ORDER BY date ASC`
    ).bind(today, soon).all()).results || [];
    for (const e of evs) coming.push(`${e.title}${e.venue ? ` @ ${e.venue}` : ''} · ${fmtDate(e.date)}`);
  }

  // RSVP numbers
  const gs = await loadGuestSettings(env);
  const total = ((await env.DB.prepare('SELECT COUNT(*) AS n FROM households').first()) || {}).n || 0;
  const repliedH = ((await env.DB.prepare(
    `SELECT COUNT(DISTINCT h.id) AS n FROM households h JOIN guests g ON g.household_id = h.id
     WHERE g.status IN ('confirmed','declined')`
  ).first()) || {}).n || 0;
  const counts = {};
  {
    const res = await env.DB.prepare(`SELECT status, COUNT(*) AS n FROM guests WHERE status IN ('confirmed','declined') GROUP BY status`).all();
    for (const c of res.results || []) counts[c.status] = c.n || 0;
  }

  const txt = [];
  txt.push(`Hello — here is your wedding planner digest for ${fmtDate(today)}.`);
  txt.push('');
  overdue.sort();
  if (overdue.length) {
    txt.push(`OVERDUE (${overdue.length})`);
    for (const l of overdue) txt.push(`• ${l}`);
    txt.push('');
  }
  coming.sort();
  if (coming.length) {
    txt.push('COMING UP (next 14 days)');
    for (const l of coming) txt.push(`• ${l}`);
    txt.push('');
  }
  if (!overdue.length && !coming.length) txt.push('Nothing overdue or due in the next two weeks — enjoy the calm before the storm.');
  txt.push('');

  // Only show RSVP section when the RSVP window is actually live
  const rsvpIsOpen = await isRsvpOpen(env);
  if (rsvpIsOpen) {
    txt.push('GUESTS & RSVPs');
    if (repliedH > 0) txt.push(`• ${repliedH} of ${total} households have replied (${counts.confirmed || 0} coming · ${counts.declined || 0} can't make it)`);
    else txt.push(`• ${total} households invited · none replied yet`);
    const waiting = Math.max(0, total - repliedH);
    txt.push(waiting > 0 ? `• ${waiting} household${waiting === 1 ? '' : 's'} still to reply` : '• Everyone has replied! 🎉');
    if (gs.rsvp_closes_at) txt.push(`• RSVPs close ${fmtDate(gs.rsvp_closes_at.slice(0, 10))}`);
    txt.push('');
  }
  if (setup && setup.wedding_date) {
    const d = daysUntil(setup.wedding_date);
    txt.push('THE BIG DAY');
    txt.push(d != null && d >= 0 ? `• ${fmtDate(setup.wedding_date)} — ${d} day${d === 1 ? '' : 's'} to go` : `• ${fmtDate(setup.wedding_date)}`);
    txt.push('');
  }
  txt.push(`Plan site: ${siteOrigin('plan')}`);
  const text = txt.join('\n');
  const subject = `Wedding planner digest — ${overdue.length ? `${overdue.length} overdue` : 'all clear'}${coming.length ? ` · ${coming.length} coming up` : ''}`;
  const html = buildDigestHtml({
    today, overdue, coming, repliedH, total, counts, rsvpIsOpen, gs, setup,
    daysToGo: setup && setup.wedding_date ? daysUntil(setup.wedding_date) : null,
  });
  return { subject, text, html };
}

// Today's brief for the couple. Claude writes it from the planner when the
// assistant is set up; otherwise (or if the model is unavailable) it is the
// plain digest.
async function buildBrief(env, cfg) {
  const d = await buildDigest(env);
  let text = '';
  try {
    text = await writeBrief(cfg.assistant, { dispatch: (m, p, q, b) => dispatchInternal(env, m, p, q, b) }, d.text, env);
  } catch (e) {
    console.error('brief failed', redactError(e));
  }
  if (!text) return d;
  const setup = await getSetup(env);
  const today = new Date().toISOString().slice(0, 10);
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;";
  const html = emailBodyShell({
    preheader: text.split('\n').find((l) => l.trim()) || '',
    tagline: brand().name,
    dateLine: setup && setup.wedding_date ? fmtDate(setup.wedding_date) : '',
    title: `Your wedding plan — ${fmtDate(today)}`,
    html: text
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 14px 0;${font}color:${EMAIL_UI.ink};">${escHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('') + bulletButton('Open the wedding planner', siteOrigin('plan')),
    footerNote: 'Reply to this email to tell your planner what is done or what has changed.',
  });
  return { subject: `Your wedding plan — ${fmtDate(today)}`, text, html };
}

// Emails the brief to the couple from the mailbox (so it can be replied to)
// and records it in the email history.
async function sendBriefToCouple(env, cfg) {
  const d = await buildBrief(env, cfg);
  let status = 'sent';
  let error = '';
  if (!cfg.dryRun) {
    try {
      await sendBrief(env, cfg.assistant, d);
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const sends = cfg.coupleEmails.map((email) => ({ to_email: email, to_name: 'You two', subject: d.subject, status, provider_id: cfg.dryRun ? `dry-${uuid()}` : '', error }));
  await recordCampaign(env, 'couple_reminder', d.subject, d.text, d.html, 'self', null, sends.length, status, error, cfg.dryRun, sends);
  return { subject: d.subject, count: sends.length, status, dry_run: cfg.dryRun, provider_id: sends[0] ? sends[0].provider_id : '', error };
}

async function handleScheduledDigest(env) {
  try {
    const cfg = await loadEmailConfig(env);
    if (!cfg.digestEnabled) return 'off';
    if (!cfg.configured || !cfg.coupleEmails.length) return 'not configured';
    // UK date and time. Cron runs can start a minute or two late, so the
    // brief goes out on the first run at or after the configured time,
    // once per UK day, rather than only on an exact-minute match.
    const uk = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value])
    );
    const hhmm = `${uk.hour}:${uk.minute}`;
    const today = `${uk.year}-${uk.month}-${uk.day}`;
    if (hhmm < cfg.digestTime) return 'not due yet'; // not time yet today
    if (cfg.lastDigestDate === today) return 'already sent today';
    // Claimed before sending: a slow or failed send must not repeat every 15 minutes.
    await setSetting(env, 'digest_last_date', today);
    const sent = await sendBriefToCouple(env, cfg);
    return `sent: ${sent.status}, ${sent.count} recipient(s)${sent.dry_run ? ', dry run' : ''}`;
  } catch (e) {
    // A scheduled run must never crash the isolate.
    console.error('scheduled brief failed', redactError(e));
    return 'failed';
  }
}

// ---- Email assistant (see src/assistant.js) -------------------------------
// askCouple: the email assistant's questions also appear in the app chat
// (src/chat.js), with a notification.
function assistantDeps(env) {
  return {
    dispatch: (m, p, q, b) => dispatchInternal(env, m, p, q, b),
    askCouple: (question) => askFromEmail(env, question),
  };
}
route('GET', '/api/assistant/status', async (env) => ok(await assistantStatus(env)));

// Check the mailbox now instead of waiting for the next 15-minute run.
route('POST', '/api/assistant/run', async (env) => {
  return ok(await runAssistant(env, assistantDeps(env)));
});

route('GET', '/api/email/config', async (env) => {
  return ok(emailConfigSummary(await loadEmailConfig(env)));
});

route('POST', '/api/email/test', async (env, req) => {
  const cfg = await loadEmailConfig(env);
  if (!cfg.configured) return err(EMAIL_NOT_CONFIGURED);
  const body = await readBody(req);
  const to = String(body.to || '').trim();
  const sendBoth = body.send_to_both === true;
  const recipients = to ? [to] : (sendBoth ? cfg.coupleEmails : [cfg.coupleEmails[0]]).filter(Boolean);
  if (!recipients.length) return err('No recipient — set a couple email address or pass a "to" address.');
  const setup = await getSetup(env);
  const testHtml = emailBodyShell({
    preheader: 'Your wedding planner email is wired up',
    tagline: brand().name,
    dateLine: setup && setup.wedding_date ? fmtDate(setup.wedding_date) : '',
    title: 'Test — your wedding planner email is wired up',
    html: `<p style="margin:0 0 14px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${EMAIL_UI.ink};">This is a test email from your wedding planner. If you can read this, everything is working.</p>
    <p style="margin:0 0 14px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${EMAIL_UI.ink};">You'll see styled digest and guest emails here once you press send.</p>` + bulletButton('Open the wedding planner', siteOrigin('plan')),
    footerNote: brand().emailFooter,
  });
  const results = [];
  for (const email of recipients) {
    const send = await sendEmail(env, cfg, {
      to: email,
      subject: 'Test — your wedding planner email is wired up',
      text: 'This is a test email from your wedding planner. If you can read this, everything is working.\n\nPlan site: ' + siteOrigin('plan'),
      html: testHtml,
    });
    results.push({ to: email, ok: send.ok, id: send.id || '', dry_run: !!cfg.dryRun, error: send.error || '' });
  }
  return ok({ results, all_ok: results.every(r => r.ok) });
});

route('GET', '/api/email/digest', async (env) => {
  return ok(await buildBrief(env, await loadEmailConfig(env)));
});

route('POST', '/api/email/digest', async (env) => {
  const cfg = await loadEmailConfig(env);
  if (!cfg.configured) return err(EMAIL_NOT_CONFIGURED);
  if (!cfg.coupleEmails.length) return err('No couple email addresses are set (ASSISTANT_ALLOWED_EMAILS).');
  return ok(await sendBriefToCouple(env, cfg));
});

route('GET', '/api/email/audience', async (env, req, params, url) => {
  const audience = url.searchParams.get('audience') || 'all';
  const householdId = url.searchParams.get('household_id') || '';
  if (!EMAIL_AUDIENCES.includes(audience)) return err('Unknown audience.');
  if (audience === 'household' && !householdId) return err('household_id required for that audience.');
  const all = await collectHouseholds(env);
  const { recipients, skipped } = filterAudience(all, audience, householdId);
  return ok({
    audience,
    total: recipients.length,
    skipped_count: skipped.length,
    skipped: skipped.map((s) => ({ household_id: s.household_id, household_name: s.household_name })),
    recipients: recipients.slice(0, 200),
  });
});

route('POST', '/api/email/campaigns', async (env, req) => {
  const body = await readBody(req);
  const subject = String(body.subject || '').trim();
  const message = String(body.body || '').trim();
  const bodyHtml = String(body.body_html || '').trim();
  const audience = String(body.audience || '');
  const householdId = String(body.household_id || '');
  if (!subject) return err('A subject is required.');
  if (!message && !bodyHtml) return err('A message is required.');
  if (!EMAIL_AUDIENCES.includes(audience)) return err('Unknown audience.');
  if (audience === 'household' && !householdId) return err('household_id required for that audience.');
  const cfg = await loadEmailConfig(env);
  if (!cfg.configured) return err(EMAIL_NOT_CONFIGURED);
  const all = await collectHouseholds(env);
  const { recipients } = filterAudience(all, audience, householdId);
  if (!recipients.length) return err('No recipients with an email address for that audience.');
  const setup = await getSetup(env);
  const sends = [];
  let previewHtml = '';
  const personalised = recipients.map((r) => personalise(r, subject, message, bodyHtml, setup));
  if (personalised.length) previewHtml = personalised[0].html;
  const results = await sendEmails(env, cfg, recipients.map((r, i) => ({ to: r.email, subject: personalised[i].subject, text: personalised[i].text, html: personalised[i].html })));
  recipients.forEach((r, i) => {
    const send = results[i];
    sends.push({ to_email: r.email, to_name: r.name, subject: personalised[i].subject, status: send.ok ? 'sent' : 'failed', provider_id: send.id || '', error: send.error || '' });
  });
  const sentCount = sends.filter((s) => s.status === 'sent').length;
  const failedCount = sends.length - sentCount;
  const status = failedCount === 0 ? 'sent' : sentCount === 0 ? 'failed' : 'partial';
  const error = failedCount ? `${failedCount} of ${sends.length} failed` : '';
  const campaignId = await recordCampaign(env, 'guest_campaign', subject, message, previewHtml, audience, audience === 'household' ? householdId : null, sends.length, status, error, cfg.dryRun, sends);
  return ok({ campaign_id: campaignId, count: sends.length, sent: sentCount, failed: failedCount, status, dry_run: !!cfg.dryRun });
});

route('GET', '/api/email/campaigns', async (env) => {
  const res = await env.DB.prepare(
    `SELECT id, kind, subject, audience, recipient_count, status, dry_run, error, sent_at, created_at
     FROM email_campaigns ORDER BY created_at DESC LIMIT 60`
  ).all();
  return ok(res.results || []);
});

route('GET', '/api/email/campaigns/:id', async (env, req, params) => {
  const c = await env.DB.prepare('SELECT * FROM email_campaigns WHERE id = ?').bind(params.id).first();
  if (!c) return err('Campaign not found.', 404);
  const log = (await env.DB.prepare('SELECT * FROM email_log WHERE campaign_id = ? ORDER BY created_at ASC').bind(params.id).all()).results || [];
  return ok({ campaign: c, log });
});

// Render a draft exactly as a guest would see it (sample merge data, never
// sent, never recorded) — powers the compose-card live preview.
route('POST', '/api/email/campaigns/preview', async (env, req) => {
  const body = await readBody(req);
  const subject = String(body.subject || '').trim() || 'Preview subject';
  const message = String(body.body || '').trim();
  const bodyHtml = String(body.body_html || '').trim();
  if (!message && !bodyHtml) return err('A message is required.');
  const setup = await getSetup(env);
  const p = personalise({ name: 'Sample Guest', code: `${brand().codePrefix}-DEMO` }, subject, message, bodyHtml, setup);
  return ok({ subject: p.subject, text: p.text, html: p.html });
});

// Send the exact draft currently in the compose editor to the couple's own
// inboxes (sample merge data), so they can check it on their phones before
// emailing real guests. Recorded as a self-directed campaign+log like the
// couple digest.
route('POST', '/api/email/campaigns/test-draft', async (env, req) => {
  const cfg = await loadEmailConfig(env);
  if (!cfg.configured) return err(EMAIL_NOT_CONFIGURED);
  if (!cfg.coupleEmails.length) return err('No couple email addresses are set (ASSISTANT_ALLOWED_EMAILS).');
  const body = await readBody(req);
  const subject = String(body.subject || '').trim();
  const message = String(body.body || '').trim();
  const bodyHtml = String(body.body_html || '').trim();
  if (!subject) return err('A subject is required.');
  if (!message && !bodyHtml) return err('A message is required.');
  const setup = await getSetup(env);
  const p = personalise({ name: 'Sample Guest', code: `${brand().codePrefix}-DEMO` }, subject, message, bodyHtml, setup);
  const logEntries = [];
  for (const email of cfg.coupleEmails) {
    const send = await sendEmail(env, cfg, { to: email, name: 'You two', subject: p.subject, text: p.text, html: p.html });
    logEntries.push({ to_email: email, to_name: 'You two', subject: p.subject, status: send.ok ? 'sent' : 'failed', provider_id: send.id || '', error: send.error || '' });
  }
  const status = logEntries.every(l => l.status === 'sent') ? 'sent' : logEntries.some(l => l.status === 'sent') ? 'partial' : 'failed';
  await recordCampaign(env, 'guest_campaign', p.subject, p.text, p.html, 'self', null, cfg.coupleEmails.length, status, '', cfg.dryRun, logEntries);
  return ok({ subject: p.subject, count: cfg.coupleEmails.length, status, dry_run: !!cfg.dryRun });
});

// ---------------------------------------------------------------------------
// Static asset serving (SPA)
// ---------------------------------------------------------------------------

const ASSET_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function serveAsset(pathname) {
  let asset = assets[pathname];
  if (!asset && !pathname.startsWith('/api/') && !pathname.startsWith('/assets/')) {
    // SPA fallback: serve index.html for client-side routes. Never for a
    // missing /assets/* file: a stale chunk from before a deploy must 404,
    // not come back as HTML labelled text/javascript.
    asset = assets['/index.html'] || assets['/'];
  }
  if (!asset) return null;
  let body;
  let type;
  if (asset.b64) {
    const ext = pathname.substring(pathname.lastIndexOf('.'));
    type = ASSET_TYPES[ext] || 'application/octet-stream';
    body = Uint8Array.from(atob(asset.content), (c) => c.charCodeAt(0));
  } else {
    const ext = pathname.substring(pathname.lastIndexOf('.'));
    const fallbackExt = pathname.startsWith('/api/') ? '' : '.html';
    type = ASSET_TYPES[ext] || ASSET_TYPES[fallbackExt] || 'text/plain; charset=utf-8';
    body = asset.content;
  }
  return { body, type };
}

// Injects Open Graph + Twitter meta into the SPA HTML shell so shared links
// show a proper card. The shell is served to everyone, so the card carries
// only what the locked site shows: the couple's names. The published welcome
// text, heading and hero photo stay behind the RSVP access code. Never blocks
// page serving.

async function injectOpenGraph(html, env, origin) {
  if (!html.includes('<head>') || html.includes('og:title')) return html;
  try {
    const setup = await getSetup(env);
    const names = [setup && setup.partner1_name, setup && setup.partner2_name].filter(Boolean).join(' & ');
    const title = names ? `${names}' wedding` : 'Our wedding';
    const desc = 'Our wedding website. Enter the access code from your invitation to see the details and RSVP.';
    const tags = [
      '<meta property="og:type" content="website">',
      `<meta property="og:url" content="${escapeAttr(origin + '/')}">`,
      `<meta property="og:site_name" content="${escapeAttr(names || 'Wedding')}">`,
      `<meta property="og:title" content="${escapeAttr(title)}">`,
      `<meta property="og:description" content="${escapeAttr(String(desc).slice(0, 200))}">`,
      '<meta name="twitter:card" content="summary">',
      `<meta name="twitter:title" content="${escapeAttr(title)}">`,
      `<meta name="twitter:description" content="${escapeAttr(String(desc).slice(0, 200))}">`,
    ]
      .filter(Boolean)
      .join('\n    ');
    return html.replace('</head>', `    ${tags}\n  </head>`);
  } catch {
    return html;
  }
}

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------

async function handleFetch(request, env) {
    const url = new URL(request.url);
    configureSite(env, url.hostname);
    configureBrand(env);
    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    // Dedicated MCP host: the token-authenticated endpoint and nothing else.
    const mcpHost = mcpPublicHost(env);
    if (mcpHost && (url.hostname || '').toLowerCase() === mcpHost) {
      if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
        return handleMcp(request, env, pathname, {
          getSetting,
          setSetting,
          dispatch: (m, p, q, b) => dispatchInternal(env, m, p, q, b),
        });
      }
      return json({ error: 'Not found' }, 404);
    }

    // Preview hard gate — v1…v5.<SITE_DOMAIN> are couple-only.
    // The device whitelist IS the plan-site login: under Cloudflare Access the
    // preview hosts sit in the same Access app, so a valid Access JWT
    // qualifies; in password mode the session cookie is Domain-scoped to
    // .<SITE_DOMAIN>, so a valid plan-site session does. Everyone else gets
    // the "Preview ended" screen — and never the SPA bundle itself.
    // Family payment portal — its own host and its own auth layer
    // (Cloudflare Access JWT, see src/family.js + src/access.js). Handled
    // before everything else so that host never serves the API, MCP, media
    // or the plan SPA, and never consults the plan session cookie.
    if (isFamilyHost(url.hostname, env)) {
      return handleFamily(request, env, url, { getSetup });
    }

    const hostIsPreview = /^v[1-5]\./.test((url.hostname || '').toLowerCase());
    if (hostIsPreview) {
      const session = await getSession(request, env);
      if (!session) {
        if (pathname.startsWith('/api/')) {
          return json({ success: false, data: null, error: 'Preview ended — see you at the wedding ✨' }, 403);
        }
        return previewEndedPage();
      }
    }

    // AI assistant (MCP) endpoint — token-authenticated, independent of the
    // session cookie. See src/mcp.js.
    // MCP clients (claude.ai, ChatGPT) probe OAuth discovery before
    // connecting. The SPA fallback would answer these with 200 + index.html,
    // which clients read as "OAuth is configured" and then fail to parse.
    // A clean 404 tells them the link itself is the credential.
    if (pathname.startsWith('/.well-known/')) {
      return json({ error: 'Not found' }, 404);
    }
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return handleMcp(request, env, pathname, {
        getSetting,
        setSetting,
        dispatch: (m, p, q, b) => dispatchInternal(env, m, p, q, b),
      });
    }

    // Media (R2) — same-origin guest-site photos on every host and mode.
    // Works for preview hosts too (a valid session has already passed the
    // gate above; without one the gate already returned the preview screen).
    if (pathname.startsWith('/media/')) {
      const media = await serveMedia(env, pathname);
      if (media) return media;
      return new Response('Not found', { status: 404 });
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      const match = matchRoute(method, pathname);
      if (!match) {
        return json({ success: false, data: null, error: 'Not found' }, 404);
      }
      // Auth middleware
      if (match.auth) {
        const session = await getSession(request, env);
        if (!session) {
          if (pathname === '/api/auth/check') {
            return json({ success: false, data: null, error: 'Unauthorized' }, 401);
          }
          return json({ success: false, data: null, error: 'Unauthorized' }, 401);
        }
        // Seed default playbook + budget categories on first authenticated use
        try {
          await seedIfEmpty(env);
        } catch {
          // Non-fatal: seeding should never block requests
        }
      }
      return match.handler(env, request, match.params, url);
    }

    // Teaser (v1), Countdown (v2), Wedding Day (v4) and Thank You (v5) serve
    // static pages — on their private preview hosts and on the public apex
    // whenever that mode is live.
    const hostname = (url.hostname || '').toLowerCase();
    if (hostname.startsWith('v1.')) {
      const setup = await getSetup(env);
      return comingSoonPage(method, {
        partner1_name: (setup && setup.partner1_name) || '',
        partner2_name: (setup && setup.partner2_name) || '',
      });
    }
    if (hostname.startsWith('v2.')) {
      const setup = await getSetup(env);
      return countdownPage(method, {
        partner1_name: (setup && setup.partner1_name) || '',
        partner2_name: (setup && setup.partner2_name) || '',
        wedding_date: (setup && setup.wedding_date) || '',
      });
    }
    if (hostname.startsWith('v4.')) {
      const setup = await getSetup(env);
      return weddingDayPage(method, {
        partner1_name: (setup && setup.partner1_name) || '',
        partner2_name: (setup && setup.partner2_name) || '',
        wedding_date: (setup && setup.wedding_date) || '',
        ceremony_venue: (setup && setup.ceremony_venue) || '',
        reception_venue: (setup && setup.reception_venue) || '',
      });
    }
    if (hostname.startsWith('v5.')) {
      const setup = await getSetup(env);
      return thankYouPage(method, {
        partner1_name: (setup && setup.partner1_name) || '',
        partner2_name: (setup && setup.partner2_name) || '',
        wedding_date: (setup && setup.wedding_date) || '',
      });
    }
    if (isApexHost(hostname)) {
      const settings = await loadGuestSettings(env);
      const setup = await getSetup(env);
      const mode = effectiveLiveMode(settings, setup);
      if (mode === 'teaser') {
        return comingSoonPage(method, {
          partner1_name: (setup && setup.partner1_name) || '',
          partner2_name: (setup && setup.partner2_name) || '',
        });
      }
      if (mode === 'countdown') {
        return countdownPage(method, {
          partner1_name: (setup && setup.partner1_name) || '',
          partner2_name: (setup && setup.partner2_name) || '',
          wedding_date: (setup && setup.wedding_date) || '',
        });
      }
      if (mode === 'weddingday') {
        return weddingDayPage(method, {
          partner1_name: (setup && setup.partner1_name) || '',
          partner2_name: (setup && setup.partner2_name) || '',
          wedding_date: (setup && setup.wedding_date) || '',
          ceremony_venue: (setup && setup.ceremony_venue) || '',
          reception_venue: (setup && setup.reception_venue) || '',
        });
      }
      if (mode === 'thankyou') {
        return thankYouPage(method, {
          partner1_name: (setup && setup.partner1_name) || '',
          partner2_name: (setup && setup.partner2_name) || '',
          wedding_date: (setup && setup.wedding_date) || '',
        });
      }
    }

    // Static assets (SPA). The HTML shell gets OG/Twitter meta injected from
    // the published guest site (falls back to setup details; never blocks).
    const asset = serveAsset(pathname);
    if (asset) {
      const headers = { 'Content-Type': asset.type };
      // The service worker + web manifest must always be revalidated (never
      // heuristically cached) so PWA updates propagate to phones.
      if (pathname === '/sw.js' || pathname === '/manifest.webmanifest') {
        headers['Cache-Control'] = 'no-cache';
      }
      if (pathname === '/manifest.webmanifest' && typeof asset.body === 'string') {
        return new Response(fillBrand(asset.body, 'json'), { headers });
      }
      if (pathname === '/sw.js' && typeof asset.body === 'string') {
        return new Response(fillBrand(asset.body, 'js'), { headers });
      }
      if (asset.type && asset.type.startsWith('text/html') && typeof asset.body === 'string') {
        const html = await injectOpenGraph(fillBrand(asset.body, 'html'), env, url.origin);
        return new Response(html, { headers });
      }
      return new Response(asset.body, { headers });
    }

    return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    rememberContext(request, ctx);
    // /mcp/<token>: the path is the secret, and Workers Logs stores the URL
    // with every console line written during a request. So nothing logs, from
    // any code, and an unexpected error becomes a plain 500 instead of an
    // uncaught exception (whose record would carry the URL too).
    if (isSecretPath(new URL(request.url).pathname)) {
      return withQuietLogs(() => handleFetch(request, env)).catch(
        () => new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return handleFetch(request, env);
  },
  // Cron trigger (see wrangler.toml): fires every 15 minutes. Sends the
  // couple digest only when the UK clock matches the configured digest time,
  // and checks the email assistant's mailbox on every run.
  async scheduled(event, env, ctx) {
    configureSite(env);
    configureBrand(env);
    // One summary line per job and run: counts and states only, never content.
    ctx.waitUntil(handleScheduledDigest(env).then((r) => console.log('cron digest:', r)));
    ctx.waitUntil(
      runAssistant(env, assistantDeps(env)).then((s) =>
        console.log('cron assistant:', JSON.stringify({ ...s, error: s.error ? redact(s.error, 200) : undefined }))
      )
    );
    // The app chat's own questions: a one-off launch review on the first run
    // with this code, then a daily check-in (src/chat.js).
    ctx.waitUntil(
      scheduledCheckins(env, { dispatch: (m, p, q, b) => dispatchInternal(env, m, p, q, b) }).then((s) => console.log('cron check-in:', s))
    );
    // Notifications held during someone's quiet hours go out once they end.
    ctx.waitUntil(flushHeldNotifications(env).then((s) => console.log('cron held notifications:', s)));
  },
};
