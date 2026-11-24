/**
 * Wedding Day: run sheet, printable contacts, packing lists.
 */
import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, formatLabel, partnerLabel, Button, Modal, Field, Input, Select, Textarea, Spinner, EmptyState, Tabs, ConfirmDialog,
} from '../components/ui';
import { formatDate } from '../utils/helpers';

export default function WeddingDayPage() {
  return (
    <div>
      <PageHeader
        title="Wedding Day"
        subtitle="Chronological run sheet with owners and contingencies, printable contacts and packing lists."
      />
      <WeddingDayShell />
    </div>
  );
}

function WeddingDayShell() {
  const [tab, setTab] = useState('runsheet');
  const [runSheet, setRunSheet] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [packing, setPacking] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useApp();

  const load = async () => {
    setLoading(true);
    try {
      const [r, c, p] = await Promise.all([api.weddingDay.runSheet(), api.weddingDay.contacts(), api.weddingDay.packing()]);
      setRunSheet(r || []);
      setContacts(c || []);
      setPacking(p || []);
    } catch (e: any) { showToast(e.message || 'Failed to load wedding day', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading && runSheet.length === 0 && contacts.length === 0) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <Tabs className="flex-1" active={tab} onChange={setTab} tabs={[
          { id: 'runsheet', label: 'Run sheet', count: runSheet.length },
          { id: 'contacts', label: 'Contacts', count: contacts.length },
          { id: 'packing', label: 'Packing list', count: packing.length },
        ]} />
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => window.print()}>🖨 Print current view</Button>
          <a href="/api/export/all" download className="btn btn-outline btn-sm" style={{ padding: '6px 12px', fontSize: '14px' }}>Export CSV</a>
        </div>
      </div>

      {tab === 'runsheet' && <RunSheetTab items={runSheet} refresh={load} />}
      {tab === 'contacts' && <ContactsTab items={contacts} refresh={load} />}
      {tab === 'packing' && <PackingTab items={packing} refresh={load} />}
    </>
  );
}

function RunSheetTab({ items, refresh }: { items: any[]; refresh: () => void }) {
  const { setup, showToast } = useApp();
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);

  const openNew = () => { setIsNew(true); setForm({ time: '09:00', end_time: '', title: '', description: '', location: '', responsible_person: 'coordinator', is_critical: false, contingency_notes: '' }); setEditing({ _new: true }); };
  const openEdit = (r: any) => { setIsNew(false); setForm({ time: r.time, end_time: r.end_time || '', title: r.title, description: r.description || '', location: r.location || '', responsible_person: r.responsible_person || 'coordinator', is_critical: !!r.is_critical, contingency_notes: r.contingency_notes || '' }); setEditing(r); };

  const save = async () => {
    if (!form.title?.trim()) { showToast('Title required', 'error'); return; }
    try {
      const payload = { ...form, end_time: form.end_time || null };
      if (isNew) await api.weddingDay.createRunSheet(payload);
      else await api.weddingDay.updateRunSheet(editing.id, payload);
      showToast('Run sheet entry saved', 'success');
      setEditing(null); refresh();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => { try { await api.weddingDay.deleteRunSheet(deleting.id); showToast('Entry deleted', 'success'); refresh(); } catch (e: any) { showToast(e.message, 'error'); } };

  const ownerLabel = (o: string) => o === 'supplier' ? 'Supplier' : o === 'coordinator' ? 'Coordinator' : partnerLabel(o, setup);

  return (
    <div>
      <div className="flex justify-end mb-4">
        <span className="mr-auto text-xs text-charcoal-400">Print for a day-of schedule, or export as CSV.</span>
        <Button variant="outline" size="sm" onClick={() => window.open('/api/export/run-sheet', '_blank')}>Run sheet CSV</Button>
        <Button onClick={openNew}>+ Add entry</Button>
      </div>
      {items.length === 0 ? (
        <Card><EmptyState title="No run sheet entries yet" message="Build the day chronologically: supplier arrivals, setup, ceremony, reception, cleanup." action={<Button size="sm" onClick={openNew}>+ Add entry</Button>} /></Card>
      ) : (
        <div className="relative">
          <div className="absolute left-[88px] top-0 bottom-0 w-px bg-charcoal-200" />
          <div className="space-y-3">
            {items.map((r: any) => (
              <div key={r.id} className="relative flex gap-4">
                <div className="w-[80px] shrink-0 text-right pt-1">
                  <span className="text-sm font-mono font-medium text-charcoal-700">{r.time}</span>
                  {r.end_time && <span className="block text-xs font-mono text-charcoal-400">– {r.end_time}</span>}
                </div>
                <div className="w-4 h-4 mt-1.5 rounded-full border-2 shrink-0 relative z-10" style={{ borderColor: r.is_critical ? '#d97706' : '#527352', background: r.is_critical ? '#d97706' : '#FDFBF7' }} />
                <Card className="flex-1">
                  <div className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-medium text-charcoal-900">{r.title}</h3>
                        {r.is_critical && <Badge tone="warning">key moment</Badge>}
                        <Badge tone="neutral">{ownerLabel(r.responsible_person)}</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(r)} className="text-red-600 hover:bg-red-50">Del</Button>
                      </div>
                    </div>
                    {r.description && <p className="text-sm text-charcoal-500 mt-1">{r.description}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal-400">
                      {r.location && <span>📍 {r.location}</span>}
                      {r.contingency_notes && <span className="text-amber-700">⚠ {r.contingency_notes}</span>}
                    </div>
                  </div>
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Add run sheet entry' : 'Edit run sheet entry'} size="md" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Start time"><Input type="time" value={form.time || ''} onChange={(e) => setForm({ ...form, time: e.target.value })} /></Field>
              <Field label="End time (optional)"><Input type="time" value={form.end_time || ''} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></Field>
            </div>
            <Field label="Title *"><Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Location"><Input value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="Responsible">
              <Select value={form.responsible_person} onChange={(e) => setForm({ ...form, responsible_person: e.target.value })}>
                <option value="coordinator">Coordinator / both</option>
                <option value="partner1">{partnerLabel('partner1', setup)}</option>
                <option value="partner2">{partnerLabel('partner2', setup)}</option>
                <option value="supplier">Supplier</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-charcoal-700"><input type="checkbox" className="checkbox" checked={!!form.is_critical} onChange={(e) => setForm({ ...form, is_critical: e.target.checked })} /> Key moment (ceremony, first dance…)</label>
            <Field label="Contingency notes" hint="What if it rains / runs late / someone's missing?"><Textarea rows={2} value={form.contingency_notes || ''} onChange={(e) => setForm({ ...form, contingency_notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={doDelete} title="Delete this entry?" />
    </div>
  );
}

function ContactsTab({ items, refresh }: { items: any[]; refresh: () => void }) {
  const { showToast } = useApp();
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);

  const openNew = () => { setIsNew(true); setForm({ name: '', role: '', phone: '', email: '', notes: '', is_emergency: false }); setEditing({ _new: true }); };
  const openEdit = (c: any) => { setIsNew(false); setForm({ name: c.name, role: c.role || '', phone: c.phone || '', email: c.email || '', notes: c.notes || '', is_emergency: !!c.is_emergency }); setEditing(c); };

  const save = async () => {
    if (!form.name?.trim()) { showToast('Name required', 'error'); return; }
    try {
      if (isNew) await api.weddingDay.createContact(form);
      else await api.weddingDay.updateContact(editing.id, form);
      showToast('Contact saved', 'success');
      setEditing(null); refresh();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => { try { await api.weddingDay.deleteContact(deleting.id); showToast('Contact deleted', 'success'); refresh(); } catch (e: any) { showToast(e.message, 'error'); } };

  return (
    <div>
      <Card className="mb-4 px-5 py-3 bg-ivory-100">
        <p className="text-xs text-charcoal-500">Print this page and hand copies to your coordinator, best man/maid of honour and each venue contact.</p>
      </Card>
      <div className="flex justify-end mb-4">
        <span className="mr-auto text-xs text-charcoal-400">Print for your coordinators, or export as CSV.</span>
        <Button variant="outline" size="sm" onClick={() => window.open('/api/export/contacts', '_blank')}>Contacts CSV</Button>
        <Button onClick={openNew}>+ Add contact</Button>
      </div>
      {items.length === 0 ? (
        <Card><EmptyState title="No contacts yet" message="Add venue managers, suppliers, caterers and emergency numbers." action={<Button size="sm" onClick={openNew}>+ Add contact</Button>} /></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Name</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Role</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Phone</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Email</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Notes</th>
                  <th className="text-right px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c: any) => (
                  <tr key={c.id} className={`border-t border-charcoal-100 hover:bg-ivory-50 ${c.is_emergency ? 'bg-red-50/60' : ''}`}>
                    <td className="px-5 py-3 font-medium text-charcoal-800">
                      {c.name}
                      {c.is_emergency && <Badge tone="danger" className="ml-2">emergency</Badge>}
                    </td>
                    <td className="px-4 py-3 text-charcoal-600">{c.role || '—'}</td>
                    <td className="px-4 py-3 font-mono">{c.phone || '—'}</td>
                    <td className="px-4 py-3">{c.email || '—'}</td>
                    <td className="px-4 py-3 text-xs text-charcoal-500">{c.notes || '—'}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(c)} className="text-red-600 hover:bg-red-50">Del</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Add contact' : 'Edit contact'} size="md" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Name *"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Role"><Input value={form.role || ''} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Venue coordinator" /></Field>
              <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Email"><Input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-charcoal-700"><input type="checkbox" className="checkbox" checked={!!form.is_emergency} onChange={(e) => setForm({ ...form, is_emergency: e.target.checked })} /> Emergency contact</label>
            <Field label="Notes"><Textarea rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={doDelete} title="Delete this contact?" />
    </div>
  );
}

function PackingTab({ items, refresh }: { items: any[]; refresh: () => void }) {
  const { setup, showToast } = useApp();
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);
  const [filter, setFilter] = useState('all');

  const openNew = () => { setIsNew(true); setForm({ category: 'ceremony', item: '', quantity: 1, responsible_person: 'together', notes: '' }); setEditing({ _new: true }); };
  const openEdit = (p: any) => { setIsNew(false); setForm({ category: p.category, item: p.item, quantity: p.quantity, responsible_person: p.responsible_person, notes: p.notes || '' }); setEditing(p); };

  const save = async () => {
    if (!form.item?.trim()) { showToast('Item name required', 'error'); return; }
    try {
      if (isNew) await api.weddingDay.createPacking(form);
      else await api.weddingDay.updatePacking(editing.id, form);
      showToast('Item saved', 'success');
      setEditing(null); refresh();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const toggle = async (p: any) => {
    try {
      await api.weddingDay.updatePacking(p.id, { packed: !p.packed });
      refresh();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => { try { await api.weddingDay.deletePacking(deleting.id); showToast('Item deleted', 'success'); refresh(); } catch (e: any) { showToast(e.message, 'error'); } };

  const categories = [...new Set(items.map((p) => p.category))];
  const filtered = items.filter((p) => filter === 'all' || p.category === filter);
  const packedCount = items.filter((p) => p.packed).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <p className="text-sm text-charcoal-600"><strong className="text-charcoal-800">{packedCount}</strong> of {items.length} packed</p>
        <div className="flex items-center gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="!w-auto text-sm">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{formatLabel(c)}</option>)}
          </Select>
          <Button onClick={openNew}>+ Add item</Button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <Card><EmptyState title="No packing items" message="Add what needs to arrive on the day: ceremony, reception, personal and emergency items." action={<Button size="sm" onClick={openNew}>+ Add item</Button>} /></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((p: any) => (
            <div key={p.id} className={`card px-4 py-3 flex items-start gap-3 cursor-pointer ${p.packed ? 'opacity-60 bg-ivory-100' : ''}`} onClick={() => toggle(p)}>
              <input type="checkbox" className="checkbox mt-0.5" checked={!!p.packed} onChange={() => toggle(p)} onClick={(e) => e.stopPropagation()} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${p.packed ? 'line-through text-charcoal-400' : 'text-charcoal-900'}`}>{p.item} {p.quantity > 1 && <span className="text-charcoal-400">×{p.quantity}</span>}</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  <Badge tone="neutral">{formatLabel(p.category)}</Badge>
                  <Badge tone="sage">packed by {partnerLabel(p.responsible_person, setup)}</Badge>
                </div>
                {p.notes && <p className="text-xs text-charcoal-400 mt-1">{p.notes}</p>}
              </div>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(p)} className="text-red-600 hover:bg-red-50">Del</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Add packing item' : 'Edit packing item'} size="sm" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <Field label="Item *"><Input value={form.item || ''} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="e.g. Vows in a printed page" /></Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Category">
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {['ceremony', 'reception', 'personal', 'emergency', 'decor', 'other'].map((c) => <option key={c} value={c}>{formatLabel(c)}</option>)}
                </Select>
              </Field>
              <Field label="Quantity"><Input type="number" min={1} value={form.quantity ?? 1} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            </div>
            <Field label="Packed by">
              <Select value={form.responsible_person} onChange={(e) => setForm({ ...form, responsible_person: e.target.value })}>
                <option value="partner1">{partnerLabel('partner1', setup)}</option>
                <option value="partner2">{partnerLabel('partner2', setup)}</option>
                <option value="together">Together</option>
              </Select>
            </Field>
            <Field label="Notes"><Textarea rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={doDelete} title="Delete this item?" />
    </div>
  );
}