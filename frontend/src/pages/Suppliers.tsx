/**
 * Suppliers & Venues: compare options, quotes, inclusions, availability, booking status.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, statusTone, formatLabel, Button, Modal, Field, Input, Select, Textarea, Spinner, EmptyState, SearchInput, ConfirmDialog, Tabs,
} from '../components/ui';
import { formatCurrency, formatDate } from '../utils/helpers';

const CATEGORIES: Record<string, string> = {
  venue_ceremony: 'Ceremony venue',
  venue_reception: 'Reception venue',
  catering: 'Catering',
  photography: 'Photography',
  videography: 'Videography',
  flowers: 'Flowers',
  music: 'Music & entertainment',
  transport: 'Transport',
  accommodation: 'Accommodation',
  cake: 'Cake',
  stationery: 'Stationery',
  attire: 'Attire',
  rings: 'Rings',
  other: 'Other',
};

const BOOKING_STATUS = ['researching', 'shortlisted', 'contacted', 'quoted', 'booked', 'declined'];

export default function SuppliersPage() {
  const { showToast } = useApp();
  const [suppliers, setSuppliers] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setSuppliers(await api.suppliers.list());
    } catch (e: any) {
      showToast(e.message || 'Failed to load suppliers', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => {
    let list = suppliers || [];
    if (filter !== 'all') list = list.filter((s) => s.category === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => `${s.name} ${s.contact_name || ''} ${s.notes || ''} ${s.inclusions || ''}`.toLowerCase().includes(q));
    }
    return list;
  }, [suppliers, filter, search]);

  const openNew = () => {
    setIsNew(true);
    setForm({ category: 'other', name: '', contact_name: '', email: '', phone: '', website: '', address: '', quote_input: '', inclusions: '', capacity: '', availability_confirmed: false, booking_status: 'researching', contract_link: '', questions_to_ask: '', notes: '', deadline: '' });
    setEditing({ _new: true });
  };

  const openEdit = (s: any) => {
    setIsNew(false);
    setForm({
      category: s.category, name: s.name, contact_name: s.contact_name || '', email: s.email || '', phone: s.phone || '',
      website: s.website || '', address: s.address || '', quote_input: s.quote_pence != null ? formatCurrency(s.quote_pence) : '',
      inclusions: s.inclusions || '', capacity: s.capacity ?? '', availability_confirmed: !!s.availability_confirmed,
      booking_status: s.booking_status || 'researching', contract_link: s.contract_link || '', questions_to_ask: s.questions_to_ask || '', notes: s.notes || '',
      deadline: s.deadline || '',
    });
    setEditing(s);
  };

  const save = async () => {
    if (!form.name?.trim()) { showToast('Supplier name required', 'error'); return; }
    try {
      const { quote_input, ...rest } = form;
      const payload = {
        ...rest,
        quote_pence: quote_input ? parseAmount(String(quote_input)) : null,
        capacity: rest.capacity === '' || rest.capacity == null ? null : Number(rest.capacity),
      };
      if (isNew) await api.suppliers.create(payload);
      else await api.suppliers.update(editing.id, payload);
      showToast('Supplier saved', 'success');
      setEditing(null); load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const quickStatus = async (id: string, status: string) => {
    try {
      await api.suppliers.update(id, { booking_status: status });
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => {
    try { await api.suppliers.remove(deleting.id); showToast('Supplier deleted', 'success'); load(); }
    catch (e: any) { showToast(e.message, 'error'); }
  };

  if (loading && !suppliers) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader
        title="Suppliers & Venues"
        subtitle="Shortlist, compare quotes and track bookings. Link contracts from your OneDrive folders."
        actions={<Button onClick={openNew}>+ Add supplier</Button>}
      />

      <Tabs
        tabs={[{ id: 'all', label: 'All', count: suppliers?.length }, ...Object.entries(CATEGORIES).map(([id, label]) => ({ id, label: label.split(' & ')[0] }))]}
        active={filter}
        onChange={setFilter}
        className="mb-4"
      />

      <div className="flex justify-end mb-4"><SearchInput value={search} onChange={setSearch} placeholder="Search suppliers…" className="w-64" /></div>

      {filtered.length === 0 ? (
        <Card><EmptyState title="No suppliers in this view" message="Add venues and suppliers to start comparing options." action={<Button size="sm" onClick={openNew}>+ Add supplier</Button>} /></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((s: any) => (
            <Card key={s.id} className="flex flex-col">
              <div className="px-5 py-4 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Badge tone="neutral">{CATEGORIES[s.category] || s.category}</Badge>
                    <h3 className="mt-1.5 text-base font-medium text-charcoal-900">{s.name}</h3>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setDeleting(s); }} className="text-red-600 hover:bg-red-50">Del</Button>
                </div>
                {s.contact_name && <p className="text-sm text-charcoal-600 mt-1">Contact: {s.contact_name} {s.phone && `· ${s.phone}`}</p>}
                {s.website && <a href={normalizeUrl(s.website)} target="_blank" rel="noreferrer" className="text-sm text-sage-600 hover:underline block mt-0.5">{s.website.replace(/^https?:\/\//, '')}</a>}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Select value={s.booking_status} onChange={(e) => quickStatus(s.id, e.target.value)} className="!w-auto text-xs py-1">
                    {BOOKING_STATUS.map((b) => <option key={b} value={b}>{formatLabel(b)}</option>)}
                  </Select>
                  <Badge tone={statusTone(s.booking_status)}>{formatLabel(s.booking_status)}</Badge>
                </div>
                {s.quote_pence != null && (
                  <p className="mt-2 text-sm">Quote: <strong className="text-charcoal-900">{formatCurrency(s.quote_pence)}</strong></p>
                )}
                {s.deadline && (
                  <p className="mt-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-2.5 py-1.5 inline-block">
                    Confirm by {formatDate(s.deadline)}
                  </p>
                )}
                {s.capacity != null && <p className="text-xs text-charcoal-400 mt-0.5">Capacity: {s.capacity}</p>}
                {s.inclusions && <p className="text-xs text-charcoal-500 mt-2 bg-ivory-100 rounded-md px-2.5 py-1.5">{s.inclusions}</p>}
                {s.questions_to_ask && (
                  <p className="mt-2 text-xs text-sage-700 bg-sage-50 rounded-md px-2.5 py-1.5">
                    <span className="font-semibold">Ask before booking: </span>{s.questions_to_ask}
                  </p>
                )}
                {s.contract_link && <p className="mt-2 text-xs"><a href={normalizeUrl(s.contract_link)} target="_blank" rel="noreferrer" className="text-sage-600 underline">View contract</a></p>}
                {!s.availability_confirmed && s.booking_status === 'quoted' && <p className="mt-2 text-xs text-amber-700">Availability not yet confirmed</p>}
              </div>
              <div className="px-5 py-3 border-t border-charcoal-100 flex justify-between items-center">
                <span className="text-xs text-charcoal-400">{s.notes}</span>
                <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>Edit</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={isNew ? 'Add supplier / venue' : 'Edit supplier'}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}
      >
        {editing && (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Name *"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Contact name"><Input value={form.contact_name || ''} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Website"><Input value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
            <Field label="Address"><Input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Quote (£)"><Input value={form.quote_input || ''} onChange={(e) => setForm({ ...form, quote_input: e.target.value })} /></Field>
              <Field label="Capacity"><Input type="number" value={form.capacity ?? ''} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></Field>
            </div>
            <Field label="Decision deadline (confirm by)" hint="Shown on the Master Timeline">
              <Input type="date" value={form.deadline || ''} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </Field>
            <Field label="Booking status">
              <Select value={form.booking_status} onChange={(e) => setForm({ ...form, booking_status: e.target.value })}>
                {BOOKING_STATUS.map((b) => <option key={b} value={b}>{formatLabel(b)}</option>)}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-charcoal-700 h-fit mt-6"><input type="checkbox" className="checkbox" checked={!!form.availability_confirmed} onChange={(e) => setForm({ ...form, availability_confirmed: e.target.checked })} /> Availability confirmed</label>
            <div className="md:col-span-2">
              <Field label="Inclusions"><Textarea rows={2} value={form.inclusions || ''} onChange={(e) => setForm({ ...form, inclusions: e.target.value })} placeholder="What the quote includes…" /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Questions to ask before booking"><Textarea rows={2} value={form.questions_to_ask || ''} onChange={(e) => setForm({ ...form, questions_to_ask: e.target.value })} placeholder="Cancellation policy? Corkage? Setup time?…" /></Field>
            </div>
            <Field label="Contract link (OneDrive)"><Input value={form.contract_link || ''} onChange={(e) => setForm({ ...form, contract_link: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Notes"><Input value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={doDelete} title="Delete this supplier?" message="Budget items linked to this supplier are kept but the link is removed." />
    </div>
  );
}

function parseAmount(input: string): number {
  const cleaned = String(input || '').replace(/[£,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function normalizeUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}