// Setup row and the shared recalculations (moved verbatim from index.js, #3).

import { int, now } from '../lib/http.js';

export async function getSetup(env) {
  const row = await env.DB.prepare('SELECT * FROM setup WHERE id = ?').bind('main').first();
  if (!row) return null;
  return {
    id: row.id,
    partner1_name: row.partner1_name || '',
    partner2_name: row.partner2_name || '',
    wedding_date: row.wedding_date || null,
    ceremony_venue: row.ceremony_venue || '',
    reception_venue: row.reception_venue || '',
    budget_ceiling: row.budget_ceiling || 0,
    contingency_percent: row.contingency_percent ?? 10,
    guest_target: row.guest_target ?? null,
    priority_1: row.priority_1 || '',
    priority_2: row.priority_2 || '',
    priority_3: row.priority_3 || '',
    non_negotiable_1: row.non_negotiable_1 || '',
    non_negotiable_2: row.non_negotiable_2 || '',
    non_negotiable_3: row.non_negotiable_3 || '',
  };
}

export function isoDateOffset(daysOffset, fromIso = null) {
  const base = fromIso ? new Date(fromIso) : new Date();
  const d = new Date(base);
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

export async function recalcTaskDeadlines(env) {
  const setup = await getSetup(env);
  if (!setup || !setup.wedding_date) return { count: 0 };
  const wedding = new Date(setup.wedding_date);
  const tasks = await env.DB.prepare(
    'SELECT id, suggested_timing_weeks_before, agreed_deadline FROM tasks'
  ).all();
  let count = 0;
  for (const t of tasks.results) {
    let suggested = null;
    if (t.suggested_timing_weeks_before != null && t.suggested_timing_weeks_before !== '') {
      const d = new Date(wedding);
      d.setDate(d.getDate() - int(t.suggested_timing_weeks_before) * 7);
      suggested = d.toISOString().slice(0, 10);
    }
    const effective = t.agreed_deadline || suggested;
    if (suggested !== t.suggested_deadline || effective !== t.effective_deadline) {
      await env.DB.prepare(
        'UPDATE tasks SET suggested_deadline = ?, effective_deadline = ?, updated_at = ? WHERE id = ?'
      )
        .bind(suggested, effective, now(), t.id)
        .run();
      count++;
    }
  }
  return { count };
}

export async function recalcBudgetForecasts(env) {
  const items = await env.DB.prepare('SELECT id, estimate_pence, agreed_price_pence FROM budget_items').all();
  let count = 0;
  for (const it of items.results) {
    const forecast =
      it.agreed_price_pence != null ? it.agreed_price_pence : it.estimate_pence != null ? it.estimate_pence : 0;
    await env.DB.prepare('UPDATE budget_items SET forecast_pence = ?, updated_at = ? WHERE id = ?')
      .bind(forecast, now(), it.id)
      .run();
    count++;
  }
  return { count };
}

export async function recalcBudgetItemActuals(env) {
  const items = await env.DB.prepare('SELECT id FROM budget_items').all();
  let count = 0;
  for (const it of items.results) {
    const pay = await env.DB.prepare(
      "SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_pence ELSE 0 END),0) AS paid, " +
        "COALESCE(SUM(CASE WHEN type = 'refund' AND status IN ('refunded','paid') THEN amount_pence ELSE 0 END),0) AS refunds " +
        'FROM payments WHERE budget_item_id = ?'
    )
      .bind(it.id)
      .first();
    const actual = (pay.paid || 0) - (pay.refunds || 0);
    await env.DB.prepare('UPDATE budget_items SET actual_pence = ? WHERE id = ?').bind(actual, it.id).run();
    count++;
  }
  return { count };
}

export async function recalcBudget(env) {
  const forecasts = await recalcBudgetForecasts(env);
  const actuals = await recalcBudgetItemActuals(env);
  return {
    forecasts: forecasts && forecasts.count ? forecasts.count : 0,
    actuals: actuals && actuals.count ? actuals.count : 0,
    recalculated: true,
  };
}
