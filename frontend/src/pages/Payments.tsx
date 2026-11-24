/**
 * Payments: deposits, instalments, final payments and refunds against budget items.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, statusTone, formatLabel, Button, Modal, Field, Input, Select, Spinner, EmptyState, ConfirmDialog,
} from '../components/ui';
import { formatCurrency, formatDate, isOverdue } from '../utils/helpers';
import FamilyAccessCard from '../components/FamilyAccessCard';

export default function PaymentsPage() {
  const { showToast } = useApp();
  const [payments, setPayments] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);
  const [income, setIncome] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [p, i] = await Promise.all([api.payments.list(), api.budget.items()]);
      setPayments(p);
      setItems(i);
      // income per item for the add form
      const inc: Record<string, any> = {};
      i.forEach((it: any) => { inc[it.id] = { name: it.name, forecast: it.forecast_pence, paid: it.actual_pence }; });
      setIncome(inc);
    } catch (e: any) {
      showToast(e.message || 'Failed to load payments', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = (payments || []).filter((p) => {
    if (filter === 'overdue') return p.status === 'pending' && isOverdue(p.due_date);
    if (filter === 'pending') return p.status === 'pending';
    if (filter === 'paid') return p.status === 'paid' || p.status === 'refunded';
    return true;
  });

  const totalPending = (payments || []).filter((p) => p.status === 'pending').reduce((s, p) => s + (p.amount_pence || 0), 0);
  const totalPaid = (payments || []).filter((p) => p.status === 'paid').reduce((s, p) => s + (p.amount_pence || 0), 0);
  const overdueCount = (payments || []).filter((p) => p.status === 'pending' && isOverdue(p.due_date)).length;
  const refunds = (payments || []).filter((p) => p.type === 'refund' && (p.status === 'refunded' || p.status === 'paid')).reduce((s, p) => s + (p.amount_pence || 0), 0);

  const openNew = () => {
    setIsNew(true);
    setForm({ budget_item_id: items[0]?.id || '', type: 'deposit', due_date: '', amount_input: '', paid_date: '', reference: '', notes: '', invoice_url: '', invoice_label: '', family_visible: true });
    setEditing({ _new: true });
  };
  const openEdit = (p: any) => {
    setIsNew(false);
    setForm({
      budget_item_id: p.budget_item_id, type: p.type, due_date: p.due_date || '', amount_input: p.amount_pence ? formatCurrency(p.amount_pence) : '',
      paid_date: p.paid_date || '', reference: p.reference || '', notes: p.notes || '',
      invoice_url: p.invoice_url || '', invoice_label: p.invoice_label || '',
      family_visible: p.family_visible !== 0,
    });
    setEditing(p);
  };

  // OneDrive/SharePoint share URLs are enormous, so pasting beats typing.
  const pasteInvoice = async () => {
    try {
      const text = await navigator.clipboard.readText();
      // Functional update: the user may have edited other fields while the
      // clipboard permission prompt was open, so don't use the stale `form`.
      if (text && text.trim()) setForm((f: any) => ({ ...f, invoice_url: text.trim() }));
      else showToast('Clipboard is empty', 'error');
    } catch {
      showToast('Could not read the clipboard — paste into the box instead', 'error');
    }
  };

  const save = async () => {
    const amount = parseAmount(form.amount_input);
    if (!amount) { showToast('Enter a valid amount', 'error'); return; }
    const url = (form.invoice_url || '').trim();
    if (url) {
      let parsed: URL | null = null;
      try { parsed = new URL(url); } catch { parsed = null; }
      if (!parsed || !/^https?:$/.test(parsed.protocol)) {
        showToast('That invoice link doesn\u2019t look right \u2014 it must start with https://', 'error');
        return;
      }
    }
    try {
      const payload = {
        budget_item_id: form.budget_item_id, type: form.type,
        due_date: form.due_date || null, amount_pence: amount,
        paid_date: form.paid_date || null, reference: form.reference || '', notes: form.notes || '',
        invoice_url: url, invoice_label: url ? (form.invoice_label || '').trim() : '',
        family_visible: !!form.family_visible,
      };
      if (isNew) await api.payments.create(payload);
      else await api.payments.update(editing.id, payload);
      showToast('Payment saved', 'success');
      setEditing(null); load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const markPaid = async (p: any) => {
    try {
      await api.payments.markPaid(p.id, new Date().toISOString().slice(0, 10));
      showToast('Marked as paid', 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => {
    try {
      await api.payments.remove(deleting.id);
      showToast('Payment deleted', 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  if (loading && !payments) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Deposits and instalments add to the budget item's paid total; refunds subtract. Completed payments feed the Budget tab."
        actions={
          <>
            <Button variant="outline" title="See exactly what family see on the family payment portal" onClick={() => window.open('/api/family/preview', '_blank', 'noopener')}>
              Family view
            </Button>
            <Button onClick={openNew}>+ Record payment</Button>
          </>
        }
      />

      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <StatValue label="Pending total" value={formatCurrency(totalPending)} />
        <StatValue label="Paid total" value={formatCurrency(totalPaid)} />
        <StatValue label="Refunds" value={formatCurrency(refunds)} />
        <StatValue label="Overdue" value={`${overdueCount}`} danger={overdueCount > 0} />
      </div>

      <Card>
        <div className="px-5 py-3 flex gap-2 border-b border-charcoal-100 flex-wrap">
          {['all', 'pending', 'paid', 'overdue'].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-sage-100 text-sage-700' : 'text-charcoal-500 hover:bg-charcoal-100'}`}>
              {formatLabel(f)}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No payments found" message="Record deposits, instalments and final payments against budget items." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Budget item</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Type</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Due</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Amount</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Paid</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Status</th>
                  <th className="text-right px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p: any) => (
                  <tr key={p.id} className="border-t border-charcoal-100 hover:bg-ivory-50">
                    <td className="px-5 py-3">
                      <span className="font-medium text-charcoal-800">{p.item_name || '—'}</span>
                      {p.reference && <p className="text-xs text-charcoal-400">{p.reference}</p>}
                      {p.family_visible === 0 && <p className="text-xs text-charcoal-400">Hidden from family</p>}
                      {p.invoice_url && (
                        <a
                          href={p.invoice_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-sage-600 hover:text-sage-700 hover:underline"
                          title={p.invoice_url}
                        >
                          <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                          </svg>
                          {p.invoice_label || 'Invoice'}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3"><Badge tone={p.type === 'refund' ? 'info' : p.type === 'deposit' ? 'sage' : 'neutral'}>{formatLabel(p.type)}</Badge></td>
                    <td className="px-4 py-3 text-charcoal-600">{formatDate(p.due_date)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCurrency(p.amount_pence)}</td>
                    <td className="px-4 py-3 text-charcoal-600">{formatDate(p.paid_date)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(p.status)}>{formatLabel(p.status)}</Badge>
                      {p.status === 'pending' && isOverdue(p.due_date) && <Badge tone="danger" className="ml-1">late</Badge>}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {p.status === 'pending' && (
                        <Button variant="outline" size="sm" onClick={() => markPaid(p)} className="mr-2">Mark paid</Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(p)} className="text-red-600 hover:bg-red-50">Del</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={isNew ? 'Record payment' : 'Edit payment'}
        size="md"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}
      >
        {editing && (
          <div className="space-y-4">
            <Field label="Budget item">
              <Select value={form.budget_item_id} onChange={(e) => setForm({ ...form, budget_item_id: e.target.value })}>
                {items.map((it: any) => (
                  <option key={it.id} value={it.id}>{it.name} — {formatCurrency(it.forecast_pence)}</option>
                ))}
              </Select>
              {income[form.budget_item_id] && (
                <p className="mt-1 text-xs text-charcoal-400">
                  Forecast {formatCurrency(income[form.budget_item_id].forecast)} · already paid {formatCurrency(income[form.budget_item_id].paid)}
                </p>
              )}
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Type">
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="deposit">Deposit</option>
                  <option value="instalment">Instalment</option>
                  <option value="final">Final payment</option>
                  <option value="refund">Refund</option>
                </Select>
              </Field>
              <Field label="Amount (£)"><Input value={form.amount_input || ''} onChange={(e) => setForm({ ...form, amount_input: e.target.value })} placeholder="e.g. £500" /></Field>
              <Field label="Due date"><Input type="date" value={form.due_date || ''} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
              <Field label="Paid date" hint="Leave blank if not yet paid"><Input type="date" value={form.paid_date || ''} onChange={(e) => setForm({ ...form, paid_date: e.target.value })} /></Field>
            </div>
            <Field label="Reference"><Input value={form.reference || ''} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. Invoice #1234" /></Field>
            <div className="md:col-span-2 rounded-lg border border-charcoal-200 bg-ivory-50 p-3">
              <Field
                label="Invoice link"
                hint="Paste the share link from OneDrive, SharePoint, Google Drive or anywhere else. Leave blank if there isn't one."
              >
                <div className="flex gap-2">
                  <Input
                    value={form.invoice_url || ''}
                    onChange={(e) => setForm({ ...form, invoice_url: e.target.value })}
                    placeholder="https://…"
                    inputMode="url"
                    className="text-xs"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={pasteInvoice} className="shrink-0">
                    Paste
                  </Button>
                </div>
              </Field>
              {!!(form.invoice_url || '').trim() && (
                <Field label="Link label" hint="Optional — what the button should say in the table." className="mt-3">
                  <Input
                    value={form.invoice_label || ''}
                    onChange={(e) => setForm({ ...form, invoice_label: e.target.value })}
                    placeholder="e.g. Venue invoice (Aug)"
                    className="text-xs"
                  />
                </Field>
              )}
            </div>
            <Field label="Notes"><Input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <label className="flex items-start gap-2 text-sm text-charcoal-700">
              <input type="checkbox" className="mt-0.5 rounded border-charcoal-300 text-sage-600 focus:ring-sage-500" checked={!!form.family_visible} onChange={(e) => setForm({ ...form, family_visible: e.target.checked })} />
              <span>
                Show on family portal
                <span className="block text-xs text-charcoal-400">Family see what it's for, the amount and due date — never the reference, notes or invoice.</span>
              </span>
            </label>
          </div>
        )}
      </Modal>

      <FamilyAccessCard />

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={doDelete} title="Delete this payment?" message="The budget item's paid total will be recalculated." />
    </div>
  );
}

function StatValue({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <Card className={`px-5 py-4 ${danger ? 'bg-red-50 border-red-200' : ''}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold font-serif ${danger ? 'text-red-600' : 'text-charcoal-900'}`}>{value}</p>
    </Card>
  );
}

function parseAmount(input: string): number {
  const cleaned = String(input || '').replace(/[£,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n * 100);
}