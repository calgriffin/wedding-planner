/** AI usage and estimated cost: chat, check-ins, the email assistant and the morning brief. */
import React, { useEffect, useState } from 'react';
import { chatApi, type UsagePeriod, type UsageReport, type UsageTotals } from '../../api/chat';
import { Card, Spinner } from '../ui';

const SOURCE_LABELS: Record<string, string> = {
  chat: 'Chat in the app',
  checkin: 'Check-in questions',
  email: 'Email assistant',
  brief: 'Morning brief',
};

const PERIODS: { id: keyof UsageReport['periods']; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'today', label: 'Today' },
  { id: 'all', label: 'All time' },
];

/** Dollars with enough precision for tiny amounts: $0.0042, $1.37. */
export function usd(v: number) {
  if (!v) return '$0.00';
  if (v < 0.0001) return '<$0.0001';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

const tokens = (t: UsageTotals) => t.input + t.cacheWrite + t.cacheRead + t.output;
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

function Rows({ rows }: { rows: [string, UsageTotals][] }) {
  if (!rows.length) return <p className="text-sm text-charcoal-500 py-2">Nothing in this period.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-charcoal-500 border-b border-charcoal-100">
          <th className="py-1.5 font-medium">&nbsp;</th>
          <th className="py-1.5 font-medium text-right">Runs</th>
          <th className="py-1.5 font-medium text-right">Tokens</th>
          <th className="py-1.5 font-medium text-right">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, t]) => (
          <tr key={label} className="border-b border-charcoal-50 last:border-0">
            <td className="py-1.5 text-charcoal-800">{label}</td>
            <td className="py-1.5 text-right tabular-nums text-charcoal-600">{t.runs}</td>
            <td className="py-1.5 text-right tabular-nums text-charcoal-600" title={`Input ${t.input}, cache writes ${t.cacheWrite}, cache reads ${t.cacheRead}, output ${t.output}`}>
              {compact(tokens(t))}
            </td>
            <td className="py-1.5 text-right tabular-nums font-medium text-charcoal-900">
              {usd(t.cost)}
              {t.unpriced ? '*' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UsageCard() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<keyof UsageReport['periods']>('month');

  useEffect(() => {
    chatApi.usage().then(setReport).catch((e) => setError(e.message));
  }, []);

  if (error) return <Card title="AI usage & cost"><p className="p-5 text-sm text-red-600">{error}</p></Card>;
  if (!report) return <Card title="AI usage & cost"><div className="py-6 flex justify-center"><Spinner /></div></Card>;

  const p: UsagePeriod = report.periods[period];
  const sources = Object.entries(p.bySource).filter(([, t]) => t.runs > 0).map(([k, t]) => [SOURCE_LABELS[k] || k, t] as [string, UsageTotals]);
  const people = Object.entries(p.byPerson).sort((a, b) => b[1].cost - a[1].cost);
  const anyUnpriced = report.by_model.some((m) => !m.priced && m.runs > 0);

  return (
    <Card title="AI usage & cost" subtitle="Every time the assistant runs: chats, check-ins, emails it handled and the morning brief.">
      <div className="p-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {PERIODS.map((x) => (
          <button
            key={x.id}
            onClick={() => setPeriod(x.id)}
            className={`text-left rounded-lg border px-3 py-2 transition-colors ${period === x.id ? 'border-sage-400 bg-sage-50' : 'border-charcoal-200 hover:bg-charcoal-50'}`}
          >
            <p className="text-[11px] uppercase tracking-wide text-charcoal-500">{x.label}</p>
            <p className="text-lg font-semibold text-charcoal-900 tabular-nums">{usd(report.periods[x.id].total.cost)}</p>
            <p className="text-xs text-charcoal-500">{report.periods[x.id].total.runs} run{report.periods[x.id].total.runs === 1 ? '' : 's'}</p>
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500 mb-1">By feature</p>
          <Rows rows={sources} />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500 mb-1">By who asked</p>
          <Rows rows={people} />
          <p className="mt-1 text-xs text-charcoal-400">Chats, check-ins you started and emails you sent. The morning brief and scheduled check-ins are for both of you.</p>
        </div>
      </div>

      {report.by_month.length > 1 && (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500 mb-1">By month</p>
          <Rows rows={report.by_month.slice(0, 12).map((m) => [new Date(`${m.month}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), m])} />
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-charcoal-100 text-xs text-charcoal-500 space-y-1">
        <p>
          Estimated from token counts at Anthropic's list prices ({report.prices_as_of}), in US dollars as Anthropic bills. Your Anthropic invoice is the final word.
          {report.by_model.filter((m) => m.runs).map((m) => {
            const pr = report.prices[m.model];
            return pr ? ` ${m.model}: $${pr.input} in / $${pr.output} out per million tokens.` : '';
          })}
        </p>
        {report.estimated_runs > 0 && (
          <p>{report.estimated_runs} earlier run{report.estimated_runs === 1 ? ' was' : 's were'} logged before cache use was tracked, so {report.estimated_runs === 1 ? 'it is' : 'they are'} costed at the full input price (an upper estimate).</p>
        )}
        {anyUnpriced && <p>* Some runs used a model with no known price and aren't included in the cost.</p>}
      </div>
      </div>
    </Card>
  );
}
