/**
 * Other Events & Honeymoon: optional celebrations + travel bookings.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, statusTone, formatLabel, Button, Modal, Field, Input, Select, Textarea, Spinner, EmptyState, ConfirmDialog,
} from '../components/ui';
import { formatDate } from '../utils/helpers';

const EVENT_TYPES: Record<string, string> = {
  engagement_party: 'Engagement party',
  hen_doe: 'Hen / bach party',
  stag_doe: 'Stag / doe party',
  rehearsal_dinner: 'Rehearsal dinner',
  brunch: 'Day-after brunch',
  honeymoon: 'Honeymoon',
  other: 'Other',
};

const STATUSES = ['planning', 'booked', 'completed', 'cancelled', 'not_applicable'];

export default function EventsPage() {
  const { showToast } = useApp();
  const [events, setEvents] = useState<any[] | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);
  const [tasksText, setTasksText] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [e, b] = await Promise.all([api.events.list(), api.budget.items()]);
      setEvents(e);
      setItems(b);
    } catch (err: any) { showToast(err.message || 'Failed to load events', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openNew = () => {
    setIsNew(true);
    setForm({ title: '', type: 'other', date: '', venue: '', description: '', guest_count: '', budget_link_id: '', status: 'planning', notes: '' });
    setTasksText('');
    setEditing({ _new: true });
  };

  const openEdit = (e: any) => {
    setIsNew(false);
    setForm({
      title: e.title, type: e.type, date: e.date || '', venue: e.venue || '', description: e.description || '',
      guest_count: e.guest_count ?? '', budget_link_id: e.budget_link_id || '', status: e.status, notes: e.notes || '',
    });
    setTasksText((e.tasks || []).join('\n'));
    setEditing(e);
  };

  const save = async () => {
    if (!form.title?.trim()) { showToast('Title required', 'error'); return; }
    try {
      const tasks = tasksText.split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = {
        ...form,
        date: form.date || null,
        guest_count: form.guest_count === '' || form.guest_count == null ? null : Number(form.guest_count),
        budget_link_id: form.budget_link_id || null,
        tasks,
      };
      if (isNew) await api.events.create(payload);
      else await api.events.update(editing.id, payload);
      showToast('Event saved', 'success');
      setEditing(null); load();
    } catch (err: any) { showToast(err.message, 'error'); }
  };

  const quickStatus = async (id: string, status: string) => {
    try { await api.events.update(id, { status }); load(); }
    catch (err: any) { showToast(err.message, 'error'); }
  };

  const doDelete = async () => {
    try { await api.events.remove(deleting.id); showToast('Event deleted', 'success'); load(); }
    catch (err: any) { showToast(err.message, 'error'); }
  };

  if (loading && !events) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  const active = (events || []).filter((e) => e.status !== 'not_applicable' && e.status !== 'cancelled');
  const budgetItemsById: Record<string, string> = {};
  items.forEach((i: any) => { budgetItemsById[i.id] = i.name; });

  return (
    <div>
      <PageHeader
        title="Other Events & Honeymoon"
        subtitle="Optional celebrations and honeymoon planning. Costs link to the main Budget tab instead of duplicating."
        actions={<Button onClick={openNew}>+ Add event</Button>}
      />

      {active.length === 0 ? (
        <Card><EmptyState title="No extra events yet" message="Track engagement parties, hen/stag dos, rehearsal dinners, post-wedding brunches and the honeymoon here. Anything you don't want can be marked 'Not applicable'." action={<Button size="sm" onClick={openNew}>+ Add event</Button>} /></Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {active.map((e: any) => {
            const isHoneymoon = e.type === 'honeymoon';
            return (
              <Card key={e.id} className={isHoneymoon ? 'border-sage-300 bg-sage-50/40' : ''}>
                <div className="px-5 py-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone={isHoneymoon ? 'sage' : 'neutral'}>{EVENT_TYPES[e.type] || e.type}</Badge>
                      {e.date && <span className="text-xs text-charcoal-500">{formatDate(e.date)}</span>}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(e)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(e)} className="text-red-600 hover:bg-red-50">Del</Button>
                    </div>
                  </div>
                  <h3 className="mt-2 text-base font-medium text-charcoal-900">{e.title}</h3>
                  {e.venue && <p className="text-sm text-charcoal-500 mt-0.5">📍 {e.venue}</p>}
                  {e.description && <p className="text-sm text-charcoal-600 mt-1.5">{e.description}</p>}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Select value={e.status} onChange={(ev) => quickStatus(e.id, ev.target.value)} className="!w-auto text-xs py-1">
                      {STATUSES.map((s) => <option key={s} value={s}>{formatLabel(s)}</option>)}
                    </Select>
                    <Badge tone={statusTone(e.status)}>{formatLabel(e.status)}</Badge>
                    {e.guest_count != null && <Badge tone="neutral">{e.guest_count} guests</Badge>}
                  </div>
                  {e.budget_link_id && budgetItemsById[e.budget_link_id] && (
                    <p className="mt-2 text-xs text-sage-700 bg-sage-50 rounded-md px-2.5 py-1.5 inline-block">Linked to budget: {budgetItemsById[e.budget_link_id]}</p>
                  )}
                  {e.tasks?.length > 0 && (
                    <ul className="mt-3 text-xs text-charcoal-600 space-y-1 border-t border-charcoal-100 pt-2">
                      {e.tasks.map((t: string, i: number) => <li key={i} className="flex gap-1.5"><span className="text-sage-500">•</span>{t}</li>)}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Add event' : 'Edit event'} size="lg" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {editing && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Field label="Title *"><Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Honeymoon in Cornwall" /></Field>
            </div>
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(EVENT_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{formatLabel(s)}</option>)}
              </Select>
            </Field>
            <Field label="Date"><Input type="date" value={form.date || ''} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Venue / destination"><Input value={form.venue || ''} onChange={(e) => setForm({ ...form, venue: e.target.value })} /></Field>
            <Field label="Guest count (if a party)"><Input type="number" min={0} value={form.guest_count ?? ''} onChange={(e) => setForm({ ...form, guest_count: e.target.value })} /></Field>
            <Field label="Link to budget item" hint="Choose a budget item to keep costs in one place">
              <Select value={form.budget_link_id || ''} onChange={(e) => setForm({ ...form, budget_link_id: e.target.value })}>
                <option value="">— None —</option>
                {items.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Description"><Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="To-dos for this event (one per line)"><Textarea rows={3} value={tasksText} onChange={(e) => setTasksText(e.target.value)} placeholder={'Book flights\nBook hotel\nTransfer booking'} /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Notes"><Textarea rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={doDelete} title="Delete this event?" message="The linked budget item is kept." />
    </div>
  );
}