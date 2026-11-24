/**
 * Tasks & Playbook: staged checklist with owners, timings, deadlines, status.
 */
import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, statusTone, formatLabel, partnerLabel, Button, Modal, Field, Input, Select, Textarea, Spinner, EmptyState, SearchInput, Tabs, ConfirmDialog,
} from '../components/ui';
import { formatDate, daysUntilHuman } from '../utils/helpers';

const STAGES = [
  { id: 'initial_planning', label: 'Initial Planning' },
  { id: 'venue_ceremony', label: 'Venue & Ceremony' },
  { id: 'catering', label: 'Catering' },
  { id: 'outfits_rings', label: 'Outfits & Rings' },
  { id: 'stationery', label: 'Stationery' },
  { id: 'entertainment', label: 'Entertainment' },
  { id: 'flowers_decor', label: 'Flowers & Décor' },
  { id: 'photography_video', label: 'Photography & Video' },
  { id: 'transport_accommodation', label: 'Transport & Accommodation' },
  { id: 'final_confirmations', label: 'Final Confirmations' },
  { id: 'post_wedding', label: 'Post-Wedding' },
];

const STATUSES = ['not_started', 'in_progress', 'waiting', 'done', 'not_applicable'];
const OWNERS = ['partner1', 'partner2', 'together'];

export default function TasksPage() {
  const { setup, showToast } = useApp();
  const [tasks, setTasks] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | null>(null); // null = closed
  const [isNew, setIsNew] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.tasks.list();
      setTasks(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  // Filters applied per render; reload on mount and on save/status changes
  useMemo(() => { load(); /* eslint-disable-next-line */ }, []);

  const counts = useMemo(() => {
    const byStage: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    (tasks || []).forEach((t) => {
      byStage[t.stage] = (byStage[t.stage] || 0) + 1;
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    });
    return { byStage, byStatus };
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = tasks || [];
    if (activeStage !== 'all') list = list.filter((t) => t.stage === activeStage);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((t) => (t.title + ' ' + (t.description || '') + ' ' + (t.guidance || '')).toLowerCase().includes(q));
    }
    return list;
  }, [tasks, activeStage, search]);

  const openNew = () => {
    setIsNew(true);
    setForm({
      stage: activeStage !== 'all' ? activeStage : 'initial_planning',
      title: '', description: '', guidance: '', owner: 'together', status: 'not_started',
      suggested_timing_weeks_before: setup?.wedding_date ? 26 : '', agreed_deadline: '',
    });
    setEditing({ _new: true });
  };

  const openEdit = (t: any) => {
    setIsNew(false);
    setForm({
      stage: t.stage, title: t.title, description: t.description || '', guidance: t.guidance || '',
      owner: t.owner, status: t.status,
      suggested_timing_weeks_before: t.suggested_timing_weeks_before != null ? t.suggested_timing_weeks_before : '',
      agreed_deadline: t.agreed_deadline || '',
    });
    setEditing(t);
  };

  const setStatus = async (t: any, status: string) => {
    try {
      await api.tasks.update(t.id, { status });
      showToast(`"${t.title}" marked ${formatLabel(status)}`, 'success');
      load();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) { showToast('Title is required', 'error'); return; }
    try {
      const payload = {
        ...form,
        suggested_timing_weeks_before: form.suggested_timing_weeks_before === '' ? null : Number(form.suggested_timing_weeks_before),
        agreed_deadline: form.agreed_deadline || null,
      };
      if (isNew) {
        await api.tasks.create(payload);
        showToast('Task added', 'success');
      } else {
        await api.tasks.update(editing.id, payload);
        showToast('Task updated', 'success');
      }
      setEditing(null);
      load();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const handleDelete = async () => {
    try {
      await api.tasks.remove(deleting.id);
      showToast('Task deleted', 'success');
      load();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const doneCount = counts.byStatus['done'] || 0;
  const progress = tasks && tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Tasks & Playbook"
        subtitle="A complete staged checklist. Suggested deadlines derive from your wedding date; agreed deadlines take precedence for bookings."
      />

      {/* Progress overview */}
      <Card className="mb-6">
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-charcoal-500"><strong className="text-charcoal-800">{doneCount}</strong> of {tasks?.length ?? 0} done</p>
            <p className="text-sm font-medium text-charcoal-800">{progress}%</p>
          </div>
          <div className="h-2.5 bg-charcoal-100 rounded-full overflow-hidden">
            <div className="h-full bg-sage-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <Badge key={s.id} tone="neutral" className={counts.byStage[s.id] ? 'border border-sage-300 text-sage-700' : 'opacity-50'}>
                {s.label} {counts.byStage[s.id] ? `(${counts.byStage[s.id]})` : ''}
              </Badge>
            ))}
          </div>
        </div>
      </Card>

      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <Tabs
          tabs={[{ id: 'all', label: 'All' }, ...STAGES.map((s) => ({ id: s.id, label: s.label.split(' & ')[0], count: counts.byStage[s.id] }))]}
          active={activeStage}
          onChange={setActiveStage}
          className="flex-1"
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search tasks…" className="md:w-64" />
        <Button onClick={openNew} className="shrink-0">+ Add task</Button>
      </div>

      {loading && <div className="flex justify-center py-16"><Spinner size="lg" /></div>}
      {!loading && error && <Card><EmptyState title="Could not load tasks" message={error} /></Card>}
      {!loading && !error && filtered.length === 0 && (
        <Card><EmptyState title="No tasks in this view" message="Try a different stage or search term, or add a task below." /></Card>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-4">
          {filtered.map((t: any) => (
            <Card key={t.id} className="hover:shadow-md transition-shadow">
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge tone="sage">{STAGES.find((s) => s.id === t.stage)?.label || t.stage}</Badge>
                    <Badge tone={statusTone(t.status)}>{formatLabel(t.status)}</Badge>
                    {t.agreed_deadline && <Badge tone="info">agreed deadline</Badge>}
                  </div>
                  <h3 className="mt-2 text-base font-medium text-charcoal-900">{t.title}</h3>
                  {t.description && <p className="text-sm text-charcoal-500 mt-1">{t.description}</p>}
                  {t.guidance && (
                    <p className="mt-2 text-xs text-sage-700 bg-sage-50 border border-sage-100 rounded-md px-3 py-2">
                      <span className="font-semibold">Guidance: </span>{t.guidance}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal-500">
                    <span>Owner: <strong className="text-charcoal-700">{partnerLabel(t.owner, setup)}</strong></span>
                    {t.suggested_timing_weeks_before != null && (
                      <span>Suggested: {t.suggested_timing_weeks_before} weeks before</span>
                    )}
                    {t.effective_deadline && (
                      <span className={daysUntilHuman(t.effective_deadline).startsWith('Overdue') ? 'text-red-600 font-medium' : ''}>
                        {formatDate(t.effective_deadline)} · {daysUntilHuman(t.effective_deadline)}
                      </span>
                    )}
                    {!t.effective_deadline && <span className="text-charcoal-400">No deadline yet — set the wedding date in Setup</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap sm:shrink-0 sm:justify-end">
                  <Select
                    value={t.status}
                    onChange={(e) => setStatus(t, e.target.value)}
                    className="!w-auto text-sm py-1.5"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{formatLabel(s)}</option>)}
                  </Select>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(t)} className="text-red-600 hover:bg-red-50">Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Edit / create modal */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={isNew ? 'Add task' : 'Edit task'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave}>{isNew ? 'Add task' : 'Save changes'}</Button>
          </>
        }
      >
        {editing && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label="Task title *"><Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Book the photographer" /></Field>
            </div>
            <Field label="Stage">
              <Select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="Owner">
              <Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                {OWNERS.map((o) => <option key={o} value={o}>{partnerLabel(o, setup)}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{formatLabel(s)}</option>)}
              </Select>
            </Field>
            <Field label="Suggested timing (weeks before) — guidance only" hint="Overwritten when the wedding date changes">
              <Input type="number" min={0} value={form.suggested_timing_weeks_before ?? ''} onChange={(e) => setForm({ ...form, suggested_timing_weeks_before: e.target.value })} placeholder="e.g. 26" />
            </Field>
            <div className="md:col-span-2">
              <Field label="Agreed deadline (takes precedence for bookings)">
                <Input type="date" value={form.agreed_deadline || ''} onChange={(e) => setForm({ ...form, agreed_deadline: e.target.value })} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Description"><Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Practical guidance"><Textarea rows={3} value={form.guidance || ''} onChange={(e) => setForm({ ...form, guidance: e.target.value })} placeholder="What to consider before ticking this off…" /></Field>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete this task?"
        message={`"${deleting?.title}" will be permanently removed.`}
      />
    </div>
  );
}