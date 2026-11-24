/**
 * Dashboard: upcoming tasks, overdue payments, budget position, RSVP totals, outstanding decisions.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import { PageHeader, StatCard, Card, Badge, statusTone, formatLabel, partnerLabel, Spinner, EmptyState, ProgressBar, Button } from '../components/ui';
import { formatCurrency, formatDate, daysUntilHuman } from '../utils/helpers';
import { siteHost, siteOrigin } from '../utils/site';

interface Stats {
  tasks: { total: number; completed: number; overdue: number; due_this_week: number };
  budget: { ceiling_pence: number; contingency_pence: number; forecast_pence: number; actual_pence: number; remaining_pence: number; remaining_after_contingency_pence: number };
  guests: { total_potential: number; total_invited: number; plus_ones_pending: number; confirmed_day: number; confirmed_evening: number; declined: number; pending: number; coming: number; responded: number; response_pct: number; dietary_count: number; accessibility_count: number };
  payments: { overdue_count: number; overdue_total_pence: number; due_this_week_count: number; due_this_week_total_pence: number };
  decisions: { open: number; decided: number; overdue: number };
  rsvp: { last_import: string | null; pending_review: number; unmatched: number };
  setup: { wedding_date: string | null; guest_target: number | null; budget_ceiling: number } | null;
}

export default function DashboardPage() {
  const { setup, temporary, showToast } = useApp();
  const [stats, setStats] = useState<Stats | null>(null);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [overduePay, setOverduePay] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [win, setWin] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cookieStatus, setCookieStatus] = useState<'idle' | 'checking' | 'ok' | 'missing'>('idle');

  const checkCookie = async () => {
    setCookieStatus('checking');
    try {
      // Check on plan domain (same-origin) — fetch sends cookies here
      const r = await fetch('/api/auth/check', {
        method: 'GET',
        credentials: 'include',
      });
      if (r.ok) {
        const data = await r.json();
        setCookieStatus(data.authenticated ? 'ok' : 'missing');
      } else {
        setCookieStatus('missing');
      }
    } catch {
      setCookieStatus('missing');
    }
  };

  const load = async () => {
    try {
      const [s, ut, op, od, w] = await Promise.all([
        api.dashboard.stats(),
        api.dashboard.upcomingTasks(8),
        api.dashboard.overduePayments(),
        api.dashboard.outstandingDecisions(),
        api.rsvp.window(),
      ]);
      setStats(s);
      setUpcoming(ut || []);
      setOverduePay(op || []);
      setDecisions(od || []);
      setWin(w);
    } catch (e: any) {
      showToast(e.message || 'Failed to load dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading) {
    return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  }

  const budgetPct = stats?.budget.ceiling_pence
    ? Math.round(((stats.budget.forecast_pence + stats.budget.contingency_pence) / stats.budget.ceiling_pence) * 100)
    : 0;
  const budgetTone = stats && stats.budget.remaining_after_contingency_pence < 0 ? 'danger' : budgetPct > 85 ? 'warning' : 'default';
  const taskPct = stats?.tasks.total ? Math.round((stats.tasks.completed / stats.tasks.total) * 100) : 0;
  const askedTotal = (stats?.guests.responded ?? 0) + (stats?.guests.pending ?? 0);
  const comingCount = stats?.guests.coming ?? 0;
  const declinedCount = stats?.guests.declined ?? 0;
  const pendingCount = stats?.guests.pending ?? 0;
  const comingPct = askedTotal ? Math.round((comingCount / askedTotal) * 100) : 0;
  const declinedPct = askedTotal ? Math.round((declinedCount / askedTotal) * 100) : 0;
  const pendingPct = askedTotal ? Math.max(0, 100 - comingPct - declinedPct) : 0;

  return (
    <div>
      <PageHeader
        title={`${setup?.partner1_name || 'Partner 1'} & ${setup?.partner2_name || 'Partner 2'}${setup?.wedding_date ? ` · ${formatDate(setup.wedding_date)}` : ''}`}
        subtitle={
          stats?.rsvp.last_import
            ? `Last RSVP import: ${formatDate(stats.rsvp.last_import)}`
            : 'No RSVP import yet'
        }
      />

      {temporary && (
        <div className="mb-6 bg-amber-50 border border-amber-300 rounded-xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-medium text-amber-900 text-sm">You're using the temporary sign-in password</p>
            <p className="text-amber-800 text-sm mt-0.5">
              Set your own (known only to you and your partner) on the <Link to="/setup" className="underline font-medium">Setup</Link> tab.
            </p>
          </div>
          <Link to="/setup"><Button variant="outline" size="sm">Set password</Button></Link>
        </div>
      )}

      {!setup?.wedding_date && (
        <div className="mb-6 bg-sage-50 border border-sage-200 rounded-xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-medium text-sage-800 text-sm">Let's get you started</p>
            <p className="text-sage-700 text-sm mt-0.5">
              Set your wedding date, budget and guest target on the <Link to="/setup" className="underline font-medium">Setup</Link> tab.
              Until then, suggested task deadlines appear once a date is entered.
            </p>
          </div>
          <Link to="/setup"><Button variant="outline" size="sm">Open Setup</Button></Link>
        </div>
      )}

      {/* Demo sites quick launch — only visible after setup */}
      {setup?.wedding_date && (
        <Card className="mb-6" title="Preview the guest site" subtitle="These open in a new tab using your logged-in browser (session cookie works on all subdomains).">
          <div className="flex flex-wrap gap-3 mb-3">
            <a href={`${siteOrigin('v1')}/`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-xl border border-charcoal-200 bg-white hover:border-sage-400 hover:bg-sage-50 transition-colors">
              <span className="font-medium text-charcoal-900">Teaser</span>
              <span className="text-xs font-mono text-sage-600">{siteHost('v1')}</span>
            </a>
            <a href={`${siteOrigin('v2')}/`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-xl border border-charcoal-200 bg-white hover:border-sage-400 hover:bg-sage-50 transition-colors">
              <span className="font-medium text-charcoal-900">Countdown</span>
              <span className="text-xs font-mono text-sage-600">{siteHost('v2')}</span>
            </a>
            <a href={`${siteOrigin('v3')}/`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-xl border border-charcoal-200 bg-white hover:border-sage-400 hover:bg-sage-50 transition-colors">
              <span className="font-medium text-charcoal-900">RSVP</span>
              <span className="text-xs font-mono text-sage-600">{siteHost('v3')}</span>
            </a>
            <a href={`${siteOrigin('v4')}/`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-xl border border-charcoal-200 bg-white hover:border-sage-400 hover:bg-sage-50 transition-colors">
              <span className="font-medium text-charcoal-900">Wedding Day</span>
              <span className="text-xs font-mono text-sage-600">{siteHost('v4')}</span>
            </a>
            <a href={`${siteOrigin('v5')}/`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-4 py-2 rounded-xl border border-charcoal-200 bg-white hover:border-sage-400 hover:bg-sage-50 transition-colors">
              <span className="font-medium text-charcoal-900">Thank You</span>
              <span className="text-xs font-mono text-sage-600">{siteHost('v5')}</span>
            </a>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link to="/guest-tools"><Button variant="outline" size="sm">Guest Tools: live site + go-live dates</Button></Link>
            <Button variant="outline" size="sm" onClick={checkCookie}>Check session cookie</Button>
            <span className="text-xs text-charcoal-500">
              {cookieStatus === 'checking' ? 'Checking…' :
               cookieStatus === 'ok' ? '✅ Cookie present (preview will work)' :
               cookieStatus === 'missing' ? '❌ No cookie — re-login required' : ''}
            </span>
          </div>
        </Card>
      )}

      {/* Key stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <StatCard label="Budget used" value={formatCurrency(stats?.budget.forecast_pence)} hint={`of ${formatCurrency(stats?.budget.ceiling_pence)} + ${formatCurrency(stats?.budget.contingency_pence)} contingency`} tone={budgetTone === 'danger' ? 'danger' : budgetTone === 'warning' ? 'warning' : 'default'} />
        <StatCard label="Spent" value={formatCurrency(stats?.budget.actual_pence)} hint="actual payments" tone="default" />
        <StatCard label="Remaining" value={formatCurrency(stats?.budget.remaining_after_contingency_pence)} hint="after forecast + contingency" tone={budgetTone} />
        <StatCard label="Tasks done" value={`${stats?.tasks.completed ?? 0}/${stats?.tasks.total ?? 0}`} hint={`${stats?.tasks.overdue ?? 0} overdue`} tone={stats && stats.tasks.overdue > 0 ? 'danger' : 'success'} />
        <StatCard label="Guests confirmed" value={(stats?.guests.confirmed_day ?? 0) + (stats?.guests.confirmed_evening ?? 0)} hint={`${stats?.guests.declined ?? 0} declined · ${stats?.guests.pending ?? 0} pending`} tone="default" />
        <StatCard label="Payments due" value={stats?.payments.due_this_week_count ?? 0} hint={`${formatCurrency(stats?.payments.due_this_week_total_pence)} in next 7 days · ${stats?.payments.overdue_count ?? 0} overdue`} tone={stats && stats.payments.overdue_count > 0 ? 'danger' : 'default'} />
      </div>

      {/* RSVP progress */}
      <Card
        title="RSVP progress"
        subtitle={win?.rsvp_open ? (win?.rsvp_closes_at ? `Window open · closes ${formatDate(win.rsvp_closes_at.slice(0, 10))}` : 'Window open') : 'RSVP window closed'}
        className="mb-6"
      >
        <div className="px-5 py-4">
          {askedTotal === 0 ? (
            <p className="text-sm text-charcoal-400">No guests invited yet — add guests on the <Link to="/guests" className="text-sage-600 underline">Guests</Link> page, then make the RSVP site live in <Link to="/guest-tools" className="text-sage-600 underline">Guest Tools</Link>.</p>
          ) : (
            <>
              <div className="flex items-end justify-between mb-2">
                <span className="text-sm text-charcoal-500">{stats?.guests.responded ?? 0} of {askedTotal} guests have replied</span>
                <span className="text-2xl font-bold text-charcoal-900">{stats?.guests.response_pct ?? 0}%</span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-charcoal-100">
                <div style={{ width: `${comingPct}%`, backgroundColor: '#527352' }} className="h-full" />
                <div style={{ width: `${declinedPct}%`, backgroundColor: '#B4544C' }} className="h-full" />
                <div style={{ width: `${pendingPct}%`, backgroundColor: '#D1D1D1' }} className="h-full" />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-charcoal-500">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#527352' }} />Coming {comingCount} · incl. evening</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#B4544C' }} />Declined {declinedCount}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: '#D1D1D1' }} />Pending {pendingCount}</span>
              </div>
              {(stats?.guests.plus_ones_pending ?? 0) > 0 && (
                <p className="mt-2 text-xs text-charcoal-500">Your numbers include {stats?.guests.plus_ones_pending} plus-one{stats?.guests.plus_ones_pending === 1 ? '' : 's'} offered but not confirmed yet.</p>
              )}
              {win?.rsvp_closes_at && win.rsvp_open && (
                <p className="mt-3 text-xs text-amber-700">RSVPs close {formatDate(win.rsvp_closes_at.slice(0, 10))} — use Email &amp; Reminders to nudge anyone still pending.</p>
              )}
            </>
          )}
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Upcoming tasks */}
        <Card title="Upcoming tasks" subtitle="Sorted by effective deadline (suggested or agreed)" actions={<Link to="/tasks" className="text-sm text-sage-600 hover:underline">View all →</Link>}>
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming tasks" message="When you set your wedding date, suggested deadlines for playbook tasks will appear here." />
          ) : (
            <ul className="divide-y divide-charcoal-100">
              {upcoming.map((t: any) => (
                <li key={t.id} className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-charcoal-900 truncate">{t.title}</p>
                    <p className="text-xs text-charcoal-400 mt-0.5">{daysUntilHuman(t.effective_deadline)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone={statusTone(t.status)}>{formatLabel(t.status)}</Badge>
                    <span className="text-xs text-charcoal-400 font-mono">{t.effective_deadline}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Overdue payments */}
        <Card title="Payment attention needed" subtitle="Overdue and due in the next 7 days" actions={<Link to="/payments" className="text-sm text-sage-600 hover:underline">Payments →</Link>}>
          {overduePay.length === 0 && (stats?.payments.due_this_week_count ?? 0) === 0 ? (
            <EmptyState title="All caught up" message="No overdue payments and nothing due in the next week." />
          ) : (
            <ul className="divide-y divide-charcoal-100">
              {overduePay.map((p: any) => (
                <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-charcoal-900 truncate">{p.item_name || 'Budget item'}</p>
                      <Badge tone="danger">overdue</Badge>
                    </div>
                    <p className="text-xs text-charcoal-400 mt-0.5">Due {formatDate(p.due_date)} · {formatLabel(p.type)}</p>
                  </div>
                  <span className="text-sm font-semibold text-red-600 shrink-0">{formatCurrency(p.amount_pence)}</span>
                </li>
              ))}
              {stats && stats.payments.due_this_week_count > 0 && (
                <li className="px-5 py-3 text-center">
                  <span className="text-sm text-charcoal-500">
                    {stats.payments.due_this_week_count} payment{due_this_week_plural(stats.payments.due_this_week_count)} due this week
                    ({formatCurrency(stats.payments.due_this_week_total_pence)})
                  </span>
                </li>
              )}
            </ul>
          )}
        </Card>

        {/* Budget position */}
        <Card title="Budget position" subtitle="Forecast vs contingency">
          <div className="px-5 py-4">
            <div className="flex items-end justify-between mb-2">
              <span className="text-sm text-charcoal-500">
                {formatCurrency(stats?.budget.forecast_pence)} of {formatCurrency(stats?.budget.ceiling_pence)} forecast
              </span>
              <span className="text-sm font-medium text-charcoal-800">{budgetPct}%</span>
            </div>
            <ProgressBar value={(stats?.budget.forecast_pence ?? 0) + (stats?.budget.contingency_pence ?? 0)} max={stats?.budget.ceiling_pence ?? 1} />
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xs text-charcoal-400 uppercase tracking-wide">Forecast</p>
                <p className="font-medium text-charcoal-900">{formatCurrency(stats?.budget.forecast_pence)}</p>
              </div>
              <div>
                <p className="text-xs text-charcoal-400 uppercase tracking-wide">Contingency</p>
                <p className="font-medium text-charcoal-900">{formatCurrency(stats?.budget.contingency_pence)}</p>
              </div>
              <div>
                <p className="text-xs text-charcoal-400 uppercase tracking-wide">Unpriced items</p>
                <p className="font-medium text-charcoal-900">—</p>
              </div>
            </div>
            <Link to="/budget" className="mt-4 inline-block text-sm text-sage-600 hover:underline">Open budget tracker →</Link>
          </div>
        </Card>

        {/* Outstanding decisions */}
        <Card title="Outstanding decisions" actions={<Link to="/decisions" className="text-sm text-sage-600 hover:underline">Decisions →</Link>}>
          {decisions.length === 0 ? (
            <EmptyState title="No open decisions" message="Decisions you capture on the Decisions & Ideas tab will appear here until you decide them." />
          ) : (
            <ul className="divide-y divide-charcoal-100">
              {decisions.slice(0, 6).map((d: any) => (
                <li key={d.id} className="px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-charcoal-900 truncate">{d.title}</p>
                    <p className="text-xs text-charcoal-400 mt-0.5">{d.category} · owner: {partnerLabel(d.decision_owner, setup)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {d.deadline && <Badge tone="warning">{formatDate(d.deadline)}</Badge>}
                    <Badge tone="neutral">open</Badge>
                  </div>
                </li>
              ))}
              {decisions.length > 6 && (
                <li className="px-5 py-2 text-center text-xs text-charcoal-400">{decisions.length - 6} more…</li>
              )}
            </ul>
          )}
        </Card>
      </div>

      {/* RSVP status */}
      <Card
        className="mt-6"
        title="RSVP progress"
        subtitle={stats?.rsvp.last_import ? `Last import ${formatDate(stats.rsvp.last_import)}` : 'No responses imported yet'}
        actions={<Link to="/rsvp" className="text-sm text-sage-600 hover:underline">RSVP Inbox →</Link>}
      >
        <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatBox label="Confirmed day" value={stats?.guests.confirmed_day ?? 0} />
          <StatBox label="Confirmed evening" value={stats?.guests.confirmed_evening ?? 0} />
          <StatBox label="Declined" value={stats?.guests.declined ?? 0} />
          <StatBox label="Pending review" value={stats?.rsvp.pending_review ?? 0} highlight={stats && stats.rsvp.pending_review > 0} />
          <StatBox label="Unmatched" value={stats?.rsvp.unmatched ?? 0} highlight={stats && stats.rsvp.unmatched > 0} />
        </div>
      </Card>
    </div>
  );
}

function StatBox({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <p className={`text-2xl font-semibold font-serif ${highlight ? 'text-amber-600' : 'text-charcoal-900'}`}>{value}</p>
      <p className="text-xs text-charcoal-500">{label}</p>
    </div>
  );
}

function due_this_week_plural(n: number) {
  return n === 1 ? '' : 's';
}