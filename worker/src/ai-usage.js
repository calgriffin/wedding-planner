/**
 * AI usage and cost: every model run (chat reply, check-in, email handled,
 * morning brief) is logged with its tokens in ai_usage (migration 0015), and
 * the report prices them here.
 *
 * Prices are Anthropic's first-party list prices in US dollars per million
 * tokens (what the Anthropic invoice is in), as of November 2026. Cache writes
 * (5-minute) cost 1.25x input; cache reads cost a model-specific fraction of
 * input. Claude Haiku 5.5's price is for prompts up to 100K tokens, which is
 * all the planner sends. A model not in the table is reported without a cost.
 */

export const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};
export const PRICES_AS_OF = '2026-11';
const CACHE_WRITE_MULTIPLIER = 1.25;

/** US dollars for a set of tokens on a model, or null if the model's price is unknown. */
export function costUsd(model, t) {
  const p = PRICES[model];
  if (!p) return null;
  return (
    ((t.input || 0) * p.input + (t.cacheWrite || 0) * p.input * CACHE_WRITE_MULTIPLIER + (t.cacheRead || 0) * p.cacheRead + (t.output || 0) * p.output) / 1e6
  );
}

/**
 * Logs one model run. `usage` is converse()'s { input (all input, cache
 * included), output, cacheWrite, cacheRead }. Never throws: a logging
 * problem must not break the reply.
 */
export async function recordUsage(env, { source, ref, model, usage, actorEmail = '' }) {
  try {
    const cacheWrite = usage.cacheWrite || 0;
    const cacheRead = usage.cacheRead || 0;
    const input = Math.max(0, (usage.input || 0) - cacheWrite - cacheRead);
    if (!input && !cacheWrite && !cacheRead && !usage.output) return;
    await env.DB.prepare(
      'INSERT OR IGNORE INTO ai_usage (id, source, ref, model, actor_email, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), source, ref || crypto.randomUUID(), model || '', String(actorEmail || '').toLowerCase(), input, cacheWrite, cacheRead, usage.output || 0)
      .run();
  } catch (e) {
    console.error('ai usage not recorded:', (e && e.message) || e);
  }
}

const SOURCES = ['chat', 'checkin', 'email', 'brief'];

function blank() {
  return { runs: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0, unpriced: 0 };
}
function add(into, row, cost) {
  into.runs += row.runs;
  into.input += row.input;
  into.cacheWrite += row.cache_write;
  into.cacheRead += row.cache_read;
  into.output += row.output;
  if (cost === null) into.unpriced += row.runs;
  else into.cost += cost;
}

/**
 * The usage report: totals for today, this month, the last 30 days and all
 * time, each split by source and by person, plus a month-by-month list.
 * Days and months are UK dates. Rows logged without a model (backfilled
 * history) are priced at `defaultModel`, the model the assistant uses now.
 */
export async function usageReport(env, { defaultModel, nameOf = (e) => e }) {
  const res = await env.DB.prepare(
    `SELECT created_at, source, model, actor_email, 1 AS runs, input_tokens AS input, cache_write_tokens AS cache_write,
            cache_read_tokens AS cache_read, output_tokens AS output
     FROM ai_usage ORDER BY created_at ASC`
  ).all();
  const ukDay = (iso) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const today = ukDay(new Date().toISOString());
  const month = today.slice(0, 7);
  const since30 = ukDay(new Date(Date.now() - 29 * 86400000).toISOString());

  const periods = { today: null, month: null, last30: null, all: null };
  for (const k of Object.keys(periods)) periods[k] = { total: blank(), bySource: Object.fromEntries(SOURCES.map((s) => [s, blank()])), byPerson: {} };
  const byMonth = {};
  const byModel = {};
  let estimatedRuns = 0;

  for (const row of res.results || []) {
    const model = row.model || defaultModel;
    if (!row.model) estimatedRuns++;
    const cost = costUsd(model, { input: row.input, cacheWrite: row.cache_write, cacheRead: row.cache_read, output: row.output });
    const day = ukDay(row.created_at);
    const inPeriod = { today: day === today, month: day.slice(0, 7) === month, last30: day >= since30, all: true };
    for (const [k, yes] of Object.entries(inPeriod)) {
      if (!yes) continue;
      const p = periods[k];
      add(p.total, row, cost);
      add(p.bySource[row.source] || (p.bySource[row.source] = blank()), row, cost);
      if (row.actor_email && (row.source === 'chat' || row.source === 'checkin' || row.source === 'email')) {
        const who = nameOf(row.actor_email);
        add(p.byPerson[who] || (p.byPerson[who] = blank()), row, cost);
      }
    }
    add(byMonth[day.slice(0, 7)] || (byMonth[day.slice(0, 7)] = blank()), row, cost);
    add(byModel[model] || (byModel[model] = blank()), row, cost);
  }

  return {
    currency: 'USD',
    prices_as_of: PRICES_AS_OF,
    default_model: defaultModel,
    prices: PRICES,
    estimated_runs: estimatedRuns,
    periods,
    by_month: Object.entries(byMonth).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([m, v]) => ({ month: m, ...v })),
    by_model: Object.entries(byModel).map(([m, v]) => ({ model: m, priced: !!PRICES[m], ...v })),
  };
}
