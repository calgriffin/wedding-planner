/**
 * Setup: names, date, locations, budget, contingency, guest target, priorities.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api, McpConnection } from '../api/client';
import { PageHeader, Card, Field, Input, Select, Textarea, Button, Spinner, ConfirmDialog } from '../components/ui';
import { formatCurrency, parseCurrency, formatDate } from '../utils/helpers';
import { brand } from '../utils/brand';

/**
 * AI assistant access: mints per-person MCP connection links so Claude /
 * ChatGPT can read and edit the plan. The full link is only shown once.
 */
function AiAccessCard() {
  const { showToast, setup } = useApp();
  const examplePartner = setup?.partner2_name || setup?.partner1_name || 'Alex';
  const [connections, setConnections] = useState<McpConnection[] | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newLink, setNewLink] = useState<{ name: string; url: string } | null>(null);
  const [revoking, setRevoking] = useState<McpConnection | null>(null);

  const load = async () => {
    try {
      setConnections(await api.mcp.list());
    } catch (e: any) {
      showToast(e.message || 'Failed to load AI connections', 'error');
      setConnections([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const c = await api.mcp.create(name.trim());
      setNewLink({ name: c.name, url: c.url });
      setName('');
      await load();
    } catch (e: any) {
      showToast(e.message || 'Could not create the link', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink.url);
      showToast('Link copied.', 'success');
    } catch {
      showToast('Copy failed — select the link and copy it manually.', 'error');
    }
  };

  const handleRevoke = async () => {
    if (!revoking) return;
    try {
      await api.mcp.revoke(revoking.id);
      showToast(`Revoked “${revoking.name}”.`, 'success');
      await load();
    } catch (e: any) {
      showToast(e.message || 'Could not revoke', 'error');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card title="AI assistant access" subtitle="Let Claude or ChatGPT read and update the plan">
      <div className="px-5 py-4 space-y-3">
        <p className="text-sm text-charcoal-600">
          Create one private link per person, then add it to your AI as a custom connector. Anyone with the link can see and edit the plan, so treat it like a password.
        </p>

        {newLink && (
          <div className="bg-sage-50 border border-sage-200 rounded-lg px-3 py-3 space-y-2">
            <p className="text-sm font-medium text-charcoal-700">Link for “{newLink.name}” — copy it now, it won't be shown again</p>
            <Input readOnly value={newLink.url} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCopy}>Copy link</Button>
              <Button size="sm" variant="outline" onClick={() => setNewLink(null)}>Done</Button>
            </div>
            <ul className="text-xs text-charcoal-600 space-y-1 list-disc list-inside">
              <li><strong>Claude:</strong> Settings → Connectors → Add custom connector → paste the link.</li>
              <li><strong>ChatGPT:</strong> Settings → Apps & Connectors → Advanced → Developer mode on, then Create → paste the link, authentication “No authentication”.</li>
            </ul>
          </div>
        )}

        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${examplePartner} – Claude`} maxLength={60} />
          <Button variant="outline" onClick={handleCreate} loading={creating} disabled={!name.trim()}>Create link</Button>
        </div>

        {connections === null ? (
          <Spinner size="sm" />
        ) : connections.length === 0 ? (
          <p className="text-xs text-charcoal-400">No AI connections yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-100 border border-charcoal-200 rounded-lg">
            {connections.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-charcoal-700 truncate">{c.name}</p>
                  <p className="text-xs text-charcoal-400">
                    Created {formatDate(c.created_at)} · {c.last_used_at ? `last used ${formatDate(c.last_used_at)}` : 'never used'}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setRevoking(c)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={handleRevoke}
        title="Revoke this AI connection?"
        message={revoking ? `“${revoking.name}” will stop working immediately. You can always create a new link.` : ''}
        confirmLabel="Revoke"
      />
    </Card>
  );
}

export default function SetupPage() {
  const { refreshSetup, showToast, changePassword, temporary, authProvider, userEmail } = useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.setup.get();
        setForm({
          ...s,
          budget_ceiling_input: s.budget_ceiling ? formatCurrency(s.budget_ceiling) : '',
        });
      } catch (e: any) {
        showToast(e.message || 'Failed to load setup', 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        partner1_name: form.partner1_name,
        partner2_name: form.partner2_name,
        wedding_date: form.wedding_date || null,
        ceremony_venue: form.ceremony_venue,
        reception_venue: form.reception_venue,
        budget_ceiling: form.budget_ceiling_input ? parseCurrency(String(form.budget_ceiling_input)) : 0,
        contingency_percent: form.contingency_percent != null ? Number(form.contingency_percent) : 10,
        guest_target: form.guest_target != null && form.guest_target !== '' ? Number(form.guest_target) : null,
        priority_1: form.priority_1,
        priority_2: form.priority_2,
        priority_3: form.priority_3,
        non_negotiable_1: form.non_negotiable_1,
        non_negotiable_2: form.non_negotiable_2,
        non_negotiable_3: form.non_negotiable_3,
      };
      await api.setup.update(payload);
      await refreshSetup();
      showToast('Setup saved. Task deadlines recalculated if the date changed.', 'success');
    } catch (e: any) {
      showToast(e.message || 'Failed to save setup', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  const handlePassword = async () => {
    setPwError(null);
    if (newPw.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('New passwords do not match.');
      return;
    }
    setSavingPw(true);
    try {
      await changePassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      showToast('Password updated.', 'success');
    } catch (e: any) {
      setPwError(e.message || 'Could not change password.');
    } finally {
      setSavingPw(false);
    }
  };

  const ceiling = form.budget_ceiling_input ? parseCurrency(String(form.budget_ceiling_input)) : 0;
  const contingencyPct = form.contingency_percent != null ? Number(form.contingency_percent) : 10;
  const contingencyAmount = Math.round((ceiling * contingencyPct) / 100);
  const availableAfter = Math.max(0, ceiling - contingencyAmount);

  return (
    <div>
      <PageHeader
        title="Setup"
        subtitle="The couple's master settings. Everything else in this system reads from here."
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card title="About you">
            <div className="px-5 py-4 grid md:grid-cols-2 gap-4">
              <Field label="Partner 1 name"><Input value={form.partner1_name || ''} onChange={(e) => set('partner1_name', e.target.value)} placeholder="e.g. Alex" /></Field>
              <Field label="Partner 2 name"><Input value={form.partner2_name || ''} onChange={(e) => set('partner2_name', e.target.value)} placeholder="e.g. Sam" /></Field>
            </div>
          </Card>

          <Card title="Date & locations" subtitle="Leave the date blank until you've decided — the playbook adapts.">
            <div className="px-5 py-4 grid md:grid-cols-2 gap-4">
              <Field label="Wedding date (leave blank until decided)" hint={form.wedding_date ? `Suggestions will be calculated from ${formatDate(form.wedding_date)}` : 'Suggested task deadlines appear once set'}>
                <Input type="date" value={form.wedding_date || ''} onChange={(e) => set('wedding_date', e.target.value)} />
              </Field>
              <Field label="Guest target (leave blank until decided)">
                <Input type="number" min={0} value={form.guest_target ?? ''} onChange={(e) => set('guest_target', e.target.value === '' ? null : e.target.value)} placeholder="e.g. 100" />
              </Field>
              <Field label="Ceremony venue"><Input value={form.ceremony_venue || ''} onChange={(e) => set('ceremony_venue', e.target.value)} placeholder="Venue name or TBC" /></Field>
              <Field label="Reception venue"><Input value={form.reception_venue || ''} onChange={(e) => set('reception_venue', e.target.value)} placeholder="Venue name or TBC" /></Field>
            </div>
          </Card>

          <Card title="Budget ceiling" subtitle="Set your overall ceiling; contingency is kept separate from forecast spending.">
            <div className="px-5 py-4 grid md:grid-cols-3 gap-4">
              <Field label="Total budget ceiling (£)"><Input value={form.budget_ceiling_input || ''} onChange={(e) => set('budget_ceiling_input', e.target.value)} placeholder="e.g. £20,000" /></Field>
              <Field label="Contingency %"><Select value={form.contingency_percent ?? 10} onChange={(e) => set('contingency_percent', e.target.value)}>
                {[0, 5, 10, 15, 20].map((p) => <option key={p} value={p}>{p}%</option>)}
              </Select></Field>
              <div className="md:mt-6">
                <div className="bg-ivory-100 border border-charcoal-200 rounded-lg px-4 py-3 space-y-1 text-sm">
                  <p className="flex justify-between"><span className="text-charcoal-500">Contingency</span><span className="font-medium">{formatCurrency(contingencyAmount)}</span></p>
                  <p className="flex justify-between"><span className="text-charcoal-500">Available for costs</span><span className="font-medium">{formatCurrency(availableAfter)}</span></p>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Priorities & non-negotiables" subtitle="Agree these together — they should guide every decision.">
            <div className="px-5 py-4 space-y-4">
              <div>
                <p className="text-sm font-medium text-charcoal-700 mb-2">Your top three priorities</p>
                {[1, 2, 3].map((n) => (
                  <div key={n} className="mb-2 flex items-center gap-3">
                    <span className="w-6 h-6 shrink-0 rounded-full bg-sage-100 text-sage-700 text-xs font-semibold flex items-center justify-center">{n}</span>
                    <Input value={form[`priority_${n}`] || ''} onChange={(e) => set(`priority_${n}`, e.target.value)} placeholder={`e.g. Great food & drink`} />
                  </div>
                ))}
              </div>
              <div>
                <p className="text-sm font-medium text-charcoal-700 mb-2">Non-negotiables (things you will not compromise on)</p>
                {[1, 2, 3].map((n) => (
                  <div key={n} className="mb-2 flex items-center gap-3">
                    <span className="w-6 h-6 shrink-0 rounded-full bg-charcoal-100 text-charcoal-600 text-xs font-semibold flex items-center justify-center">{n}</span>
                    <Input value={form[`non_negotiable_${n}`] || ''} onChange={(e) => set(`non_negotiable_${n}`, e.target.value)} placeholder="e.g. Immediate family at the ceremony" />
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSave} loading={saving}>Save Setup</Button>
          </div>
        </div>

        <div className="space-y-6">
          <Card title="How this works">
            <ul className="text-sm text-charcoal-600 space-y-2.5 px-5 py-4">
              <li className="flex gap-2"><span className="text-sage-500">✓</span> Budget ceiling is the total. Contingency is calculated separately and never counted as spend.</li>
              <li className="flex gap-2"><span className="text-sage-500">✓</span> The Budget tab compares forecast (estimates / agreed prices) against your ceiling minus contingency.</li>
              <li className="flex gap-2"><span className="text-sage-500">✓</span> Tasks get suggested deadlines relative to the wedding date. Agreed deadlines for contractual bookings always win.</li>
              <li className="flex gap-2"><span className="text-sage-500">✓</span> Guests are marked day/evening/potential and RSVP results feed the guest totals.</li>
              <li className="flex gap-2"><span className="text-sage-500">✓</span> Set the RSVP form allowance checking step on the RSVP Inbox tab.</li>
            </ul>
          </Card>

          <Card title="Weekly routine">
            <div className="px-5 py-4 text-sm text-charcoal-600 space-y-2">
              <p>Keep a short weekly review, e.g. Sunday evening:</p>
              <ol className="list-decimal list-inside space-y-1.5 text-charcoal-600">
                <li>Review the Dashboard</li>
                <li>Reconcile spending against receipts</li>
                <li>Process new RSVP responses</li>
                <li>Agree each partner's next 1–3 actions</li>
              </ol>
            </div>
          </Card>

          {authProvider === 'cloudflare-access' ? (
          <Card title="Sign-in & access">
            <div className="px-5 py-4 space-y-2 text-sm text-charcoal-600">
              <p>
                Sign-in is handled by <strong>Cloudflare Access</strong>
                {userEmail ? <> — you're signed in as <strong>{userEmail}</strong></> : null}.
              </p>
              <p className="text-xs text-charcoal-500">
                Add or remove who can get in from the Cloudflare dashboard: Zero Trust → Access → Applications → the planner's policy.
              </p>
            </div>
          </Card>
          ) : (
          <Card title="Password & access">
            <div className="px-5 py-4 space-y-3">
              {temporary && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  You're using the <strong>temporary sign-in password</strong> — set your own real one now.
                </p>
              )}
              <Field label="Current password">
                <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
              </Field>
              <Field label="New password (min 8 characters)">
                <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
              </Field>
              <Field label="Confirm new password">
                <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
              </Field>
              {pwError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pwError}</p>}
              <Button onClick={handlePassword} loading={savingPw} variant="outline">Change password</Button>
            </div>
          </Card>
          )}

          <AiAccessCard />

          <Card title="Data & backups" subtitle="Everything in one downloadable file">
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-charcoal-600">
                Your database has point-in-time restore built in (D1 Time Travel — the last 30 days, always on, automatic). For an off-site copy, download the full archive: every table, every column, with passwords and API keys excluded.
              </p>
              <a
                href="/api/export/all"
                download={`${brand.slug}-backup-${new Date().toISOString().slice(0, 10)}.txt`}
                className="inline-flex items-center justify-center rounded-lg bg-sage-500 px-4 py-2 text-sm font-medium text-ivory-50 transition-colors hover:bg-sage-600 focus:outline-none focus:ring-2 focus:ring-sage-500 focus:ring-offset-1"
              >
                Download full backup
              </a>
              <p className="text-xs text-charcoal-400">
                Keep a copy outside Cloudflare (e.g. a personal cloud drive) — good practice ahead of the final month.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}