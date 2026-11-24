/**
 * Master Timeline: every dated thing — tasks, payments, supplier deadlines,
 * RSVPs, appointments, decisions and events — on one calendar.
 * Data: GET /api/timeline (worker-side aggregation). Appointments are
 * managed inline from the per-day view.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format,
  isSameMonth, isToday, startOfMonth, startOfWeek,
} from 'date-fns';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import { PageHeader, Card, Button, Modal, Field, Input, Textarea, Spinner, EmptyState } from '../components/ui';
import { cn, formatDate } from '../utils/helpers';
import type { TimelineItem } from '../types';

const TYPE_META: Record<string, { label: string; chip: string; dot: string }> = {
  task:        { label: 'Task',        chip: 'bg-sage-100 text-sage-800 border-sage-200',        dot: 'bg-sage-500' },
  payment:     { label: 'Payment',     chip: 'bg-amber-100 text-amber-800 border-amber-200',     dot: 'bg-amber-500' },
  supplier:    { label: 'Supplier',    chip: 'bg-indigo-100 text-indigo-800 border-indigo-200',  dot: 'bg-indigo-500' },
  appointment: { label: 'Appointment', chip: 'bg-rose-100 text-rose-800 border-rose-200',        dot: 'bg-rose-500' },
  event:       { label: 'Event',       chip: 'bg-violet-100 text-violet-800 border-violet-200',  dot: 'bg-violet-500' },
  decision:    { label: 'Decision',    chip: 'bg-stone-200 text-stone-700 border-stone-300',     dot: 'bg-stone-500' },
  rsvp:        { label: 'RSVP',        chip: 'bg-sky-100 text-sky-800 border-sky-200',           dot: 'bg-sky-500' },
};

const TYPE_ORDER = ['task', 'payment', 'supplier', 'appointment', 'event', 'decision', 'rsvp'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function TimelinePage() {
  const { showToast } = useApp();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [day, setDay] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', time: '', location: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api.timeline.list();
      setItems(r.items || []);
    } catch (e: any) {
      showToast(e.message || 'Failed to load timeline', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const byDate = useMemo(() => {
    const m = new Map<string, TimelineItem[]>();
    for (const it of items) {
      if (!m.has(it.date)) m.set(it.date, []);
      m.get(it.date)!.push(it);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    return m;
  }, [items]);

  const todayISO = new Date().toISOString().slice(0, 10);
  const gridDays = useMemo(() => {
    const s = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    const e = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: s, end: e });
  }, [month]);

  const overdue = useMemo(
    () => items.filter((i) => i.overdue && i.date < todayISO).sort((a, b) => a.date.localeCompare(b.date)),
    [items, todayISO]
  );
  const upcoming = useMemo(() => {
    const until = new Date();
    until.setDate(until.getDate() + 14);
    return items
      .filter((i) => i.date >= todayISO && i.date <= until.toISOString().slice(0, 10))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [items, todayISO]);

  const dayItems = day ? byDate.get(day) || [] : [];

  const openDay = (dateISO: string) => {
    setDay(dateISO);
    setForm({ title: '', time: '', location: '', notes: '' });
  };

  const addAppointment = async () => {
    if (!form.title.trim()) { showToast('Title required', 'error'); return; }
    if (!day) return;
    setSaving(true);
    try {
      await api.appointments.create({ ...form, date: day });
      showToast('Appointment added', 'success');
      setForm({ title: '', time: '', location: '', notes: '' });
      await load();
    } catch (e: any) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const deleteAppointment = async (id: string) => {
    try {
      await api.appointments.remove(id);
      showToast('Appointment removed', 'success');
      await load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  if (loading && items.length === 0) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader
        title="Master Timeline"
        subtitle="Tasks, payments, supplier deadlines, RSVPs, appointments, decisions and events — one calendar. Click any day to see what's happening and add appointments."
        actions={<Button variant="ghost" size="sm" onClick={load}>⟳ Refresh</Button>}
      />

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Calendar */}
        <Card className="lg:col-span-2">
          <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-serif text-lg font-semibold text-charcoal-900">{format(month, 'MMMM yyyy')}</h2>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setMonth(addMonths(month, -1))}>‹ Prev</Button>
              <Button variant="ghost" size="sm" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }}>Today</Button>
              <Button variant="ghost" size="sm" onClick={() => setMonth(addMonths(month, 1))}>Next ›</Button>
            </div>
          </div>
          <div className="px-5 grid grid-cols-7 gap-1 text-center text-xs font-medium text-charcoal-400">
            {WEEKDAYS.map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="px-4 pb-4 grid grid-cols-7 gap-1">
            {gridDays.map((d) => {
              const iso = format(d, 'yyyy-MM-dd');
              const dayList = byDate.get(iso) || [];
              const inMonth = isSameMonth(d, month);
              const today = isToday(d);
              return (
                <button
                  key={iso}
                  onClick={() => openDay(iso)}
                  title={dayList.length ? `${dayList.length} item${dayList.length === 1 ? '' : 's'}` : 'No items'}
                  className={cn(
                    'min-h-[80px] rounded-lg border border-charcoal-100 bg-white p-1.5 text-left flex flex-col gap-0.5 hover:border-sage-300 hover:bg-sage-50/40 transition-colors',
                    !inMonth && 'opacity-40',
                    today && 'border-sage-400 bg-sage-50',
                    day === iso && 'ring-2 ring-sage-400'
                  )}
                >
                  <span className={cn('text-xs font-semibold', today ? 'text-sage-700' : 'text-charcoal-500')}>{format(d, 'd')}</span>
                  {dayList.slice(0, 3).map((it) => (
                    <span key={it.type + it.id} className={cn('flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight truncate', TYPE_META[it.type]?.chip || 'bg-stone-100 text-stone-700')}>
                      <span className={cn('w-1.5 h-1.5 shrink-0 rounded-full', TYPE_META[it.type]?.dot || 'bg-stone-400')} />
                      <span className="truncate">{it.title}</span>
                    </span>
                  ))}
                  {dayList.length > 3 && <span className="text-[10px] text-charcoal-400 pl-0.5">+{dayList.length - 3} more</span>}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Side rail: overdue / upcoming / legend */}
        <div className="space-y-4">
          <Card>
            <div className="px-5 py-4">
              <h3 className="text-sm font-semibold text-charcoal-900 flex items-center justify-between">
                <span>⚠️ Overdue</span>
                <span className="text-xs text-charcoal-400">{overdue.length}</span>
              </h3>
              {overdue.length === 0 ? <p className="mt-2 text-sm text-charcoal-400">Nothing overdue 🎉</p> : (
                <ul className="mt-2 space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                  {overdue.map((it) => (
                    <li key={it.type + it.id} className="flex items-start gap-2 text-sm">
                      <span className={cn('mt-1 w-2 h-2 shrink-0 rounded-full', TYPE_META[it.type]?.dot || 'bg-stone-400')} />
                      <button onClick={() => openDay(it.date)} className="text-left min-w-0">
                        <span className="font-medium text-charcoal-800 block leading-snug">{it.title}</span>
                        <span className="text-xs text-red-600">{formatDate(it.date)} · {TYPE_META[it.type]?.label || it.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card>
            <div className="px-5 py-4">
              <h3 className="text-sm font-semibold text-charcoal-900 flex items-center justify-between">
                <span>Next 14 days</span>
                <span className="text-xs text-charcoal-400">{upcoming.length}</span>
              </h3>
              {upcoming.length === 0 ? <p className="mt-2 text-sm text-charcoal-400">Nothing scheduled — enjoy the calm 🤍</p> : (
                <ul className="mt-2 space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
                  {upcoming.map((it) => (
                    <li key={it.type + it.id} className="flex items-start gap-2 text-sm">
                      <span className={cn('mt-1 w-2 h-2 shrink-0 rounded-full', TYPE_META[it.type]?.dot || 'bg-stone-400')} />
                      <button onClick={() => openDay(it.date)} className="text-left min-w-0">
                        <span className="font-medium text-charcoal-800 block leading-snug">{it.title}</span>
                        <span className="text-xs text-charcoal-400">{formatDate(it.date)} · {TYPE_META[it.type]?.label || it.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card>
            <div className="px-5 py-4 flex flex-wrap gap-x-4 gap-y-1.5">
              {TYPE_ORDER.map((t) => (
                <span key={t} className="text-[11px] text-charcoal-500 flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-full', TYPE_META[t].dot)} />{TYPE_META[t].label}
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Per-day modal: add appointments + see everything on that day */}
      <Modal open={!!day} onClose={() => setDay(null)} size="lg" title={day ? formatDate(day) : ''}>
        {day && (
          <div className="space-y-4">
            <div className="rounded-xl border border-sage-200 bg-sage-50/50 p-4">
              <h4 className="text-sm font-semibold text-charcoal-900 mb-3">Add an appointment for this day</h4>
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Title *"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Dress fitting, venue walkthrough" /></Field>
                <Field label="Time"><Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
                <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Bridal boutique" /></Field>
                <div className="md:col-span-2">
                  <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={addAppointment} disabled={saving}>{saving ? 'Saving…' : '+ Add appointment'}</Button>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-charcoal-900 mb-2">On this day ({dayItems.length})</h4>
              {dayItems.length === 0 ? (
                <EmptyState title="Nothing on this day" message="Add an appointment above, or enjoy the free day." />
              ) : (
                <ul className="space-y-2">
                  {dayItems.map((it) => (
                    <li key={it.type + it.id} className="flex items-start gap-2.5 rounded-lg border border-charcoal-100 bg-white px-3 py-2.5">
                      <span className={cn('mt-1 w-2.5 h-2.5 shrink-0 rounded-full', TYPE_META[it.type]?.dot || 'bg-stone-400')} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-charcoal-900">{it.title}</p>
                        {(it.subtitle || it.time) && (
                          <p className="text-xs text-charcoal-500">{it.subtitle}{it.time ? (it.subtitle ? ' · ' : '') + it.time : ''}</p>
                        )}
                        {it.notes && <p className="text-xs text-charcoal-500 mt-0.5">{it.notes}</p>}
                        <span className={cn('inline-block mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium', TYPE_META[it.type]?.chip || 'bg-stone-100 text-stone-700')}>
                          {TYPE_META[it.type]?.label || it.type}
                        </span>
                        {it.overdue && <span className="ml-1.5 text-[10px] font-medium text-red-600">Overdue</span>}
                      </div>
                      {it.type === 'appointment' && (
                        <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => deleteAppointment(it.id)}>Del</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}