/**
 * Decisions & Ideas: choices, shortlists, inspiration links, owners, deadlines.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, statusTone, formatLabel, partnerLabel, Button, Modal, Field, Input, Select, Textarea, Spinner, EmptyState, Tabs, ConfirmDialog,
} from '../components/ui';
import { formatDate, isOverdue } from '../utils/helpers';

const CATEGORIES: Record<string, string> = {
  ceremony: 'Ceremony',
  clothing: 'Clothing',
  decor: 'Décor',
  food: 'Food & drink',
  music: 'Music',
  photography: 'Photography',
  other: 'Other',
};

export default function DecisionsPage() {
  const { setup, showToast } = useApp();
  const [decisions, setDecisions] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);
  const [optionsText, setOptionsText] = useState('');
  const [linksText, setLinksText] = useState('');

  const load = async () => {
    setLoading(true);
    try { setDecisions(await api.decisions.list()); }
    catch (e: any) { showToast(e.message || 'Failed to load decisions', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (decisions || []).forEach((d) => { c[d.category] = (c[d.category] || 0) + 1; });
    return c;
  }, [decisions]);

  const filtered = (decisions || []).filter((d) => filter === 'all' || d.category === filter);

  const openNew = () => {
    setIsNew(true);
    setForm({ category: 'other', title: '', description: '', chosen_option: '', decision_owner: 'together', deadline: '', status: 'open', notes: '' });
    setOptionsText(''); setLinksText('');
    setEditing({ _new: true });
  };

  const openEdit = (d: any) => {
    setIsNew(false);
    setForm({
      category: d.category, title: d.title, description: d.description || '', chosen_option: d.chosen_option || '',
      decision_owner: d.decision_owner, deadline: d.deadline || '', status: d.status, notes: d.notes || '',
    });
    setOptionsText((d.options || []).join('\n'));
    setLinksText((d.inspiration_links || []).join('\n'));
    setEditing(d);
  };

  const save = async () => {
    if (!form.title?.trim()) { showToast('Title required', 'error'); return; }
    try {
      const options = optionsText.split('\n').map((s) => s.trim()).filter(Boolean);
      const links = linksText.split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = { ...form, options, inspiration_links: links };
      if (isNew) await api.decisions.create(payload);
      else await api.decisions.update(editing.id, payload);
      showToast('Decision saved', 'success');
      setEditing(null); load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const decide = async (d: any, option: string) => {
    try {
      await api.decisions.update(d.id, { chosen_option: option, status: 'decided' });
      showToast(`Decided: ${option}`, 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const reopen = async (d: any) => {
    try { await api.decisions.update(d.id, { status: 'open' }); load(); }
    catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => {
    try { await api.decisions.remove(deleting.id); showToast('Decision deleted', 'success'); load(); }
    catch (e: any) { showToast(e.message, 'error'); }
  };

  if (loading && !decisions) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader
        title="Decisions & Ideas"
        subtitle="Capture choices, shortlist options and track who decides what — and by when."
        actions={<Button onClick={openNew}>+ New decision</Button>}
      />

      <Tabs
        tabs={[{ id: 'all', label: 'All', count: decisions?.length }, ...Object.entries(CATEGORIES).map(([id, label]) => ({ id, label, count: counts[id] }))]}
        active={filter}
        onChange={setFilter}
        className="mb-4"
      />

      {filtered.length === 0 ? (
        <Card><EmptyState title="No decisions yet" message="Add decisions for ceremony, clothing, décor, food, music and photography." action={<Button size="sm" onClick={openNew}>+ New decision</Button>} /></Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((d: any) => {
            const overdue = d.status === 'open' && d.deadline && isOverdue(d.deadline);
            return (
              <Card key={d.id} className={overdue ? 'border-amber-300 bg-amber-50/40' : ''}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone="neutral">{CATEGORIES[d.category] || d.category}</Badge>
                    <Badge tone={d.status === 'decided' ? 'success' : overdue ? 'danger' : 'warning'}>{d.status === 'decided' ? 'Decided' : overdue ? 'Overdue' : 'Open'}</Badge>
                    {d.deadline && <span className={`text-xs ${overdue ? 'text-red-600 font-medium' : 'text-charcoal-400'}`}>by {formatDate(d.deadline)}</span>}
                  </div>
                  <h3 className="mt-2 text-base font-medium text-charcoal-900">{d.title}</h3>
                  {d.description && <p className="text-sm text-charcoal-500 mt-1">{d.description}</p>}

                  {d.options?.length > 0 && d.status === 'open' && (
                    <div className="mt-3 space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Shortlist — choose one</p>
                      {d.options.map((opt: string) => (
                        <button key={opt} onClick={() => decide(d, opt)} className="w-full text-left flex items-center justify-between px-3 py-2 rounded-lg border border-charcoal-200 hover:border-sage-400 hover:bg-sage-50 transition-colors group">
                          <span className="text-sm text-charcoal-700">{opt}</span>
                          <span className="text-xs text-sage-600 opacity-0 group-hover:opacity-100">Decide →</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {d.status === 'decided' && d.chosen_option && (
                    <div className="mt-3 bg-sage-50 border border-sage-200 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-sage-700 uppercase tracking-wide">Decision made</p>
                      <p className="text-sm text-sage-800 font-medium mt-0.5">{d.chosen_option}</p>
                      {d.decided_at && <p className="text-xs text-sage-600 mt-0.5">{formatDate(d.decided_at)}</p>}
                    </div>
                  )}

                  {d.inspiration_links?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {d.inspiration_links.map((l: string, i: number) => (
                        <a key={i} href={l.startsWith('http') ? l : `https://${l}`} target="_blank" rel="noreferrer" className="text-xs text-sage-600 underline decoration-sage-300 hover:decoration-sage-600">inspiration {i + 1}</a>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between border-t border-charcoal-100 pt-3">
                    <span className="text-xs text-charcoal-400">Owner: <strong className="text-charcoal-600">{partnerLabel(d.decision_owner, setup)}</strong></span>
                    <div className="flex items-center gap-1">
                      {d.status === 'decided' && <Button variant="ghost" size="sm" onClick={() => reopen(d)}>Reopen</Button>}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(d)} className="text-red-600 hover:bg-red-50">Del</Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={isNew ? 'New decision' : 'Edit decision'}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}
      >
        {editing && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label="What needs deciding? *"><Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Choose the photographer" /></Field>
            </div>
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Decision owner">
              <Select value={form.decision_owner} onChange={(e) => setForm({ ...form, decision_owner: e.target.value })}>
                <option value="partner1">{partnerLabel('partner1', setup)}</option>
                <option value="partner2">{partnerLabel('partner2', setup)}</option>
                <option value="together">Together</option>
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Shortlist options (one per line)"><Textarea rows={4} value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder={'Vendor A\nVendor B\nVendor C'} /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Inspiration links (one per line)"><Textarea rows={3} value={linksText} onChange={(e) => setLinksText(e.target.value)} placeholder="https://pinterest.com/…" /></Field>
            </div>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="open">Open</option>
                <option value="decided">Decided</option>
                <option value="deferred">Deferred</option>
              </Select>
            </Field>
            <Field label="Deadline"><Input type="date" value={form.deadline || ''} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></Field>
            {form.status === 'decided' && (
              <div className="md:col-span-2"><Field label="Chosen option"><Input value={form.chosen_option || ''} onChange={(e) => setForm({ ...form, chosen_option: e.target.value })} /></Field></div>
            )}
            <div className="md:col-span-2">
              <Field label="Description"><Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Notes"><Textarea rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={doDelete} title="Delete this decision?" message="This decision and its shortlist will be removed." />
    </div>
  );
}