/**
 * Seating & Logistics: table assignments, capacities, unseated guests, logistics items.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, statusTone, formatLabel, Button, Modal, Field, Input, Select, Textarea, Spinner, EmptyState, Tabs, ConfirmDialog,
} from '../components/ui';
import { formatCurrency, cn } from '../utils/helpers';

export default function SeatingPage() {
  return (
    <div>
      <PageHeader
        title="Seating & Logistics"
        subtitle="Assign confirmed guests to tables, spot over-capacity tables and unseated guests, and track transport, accommodation and equipment."
      />
      <TabsShell />
    </div>
  );
}

function TabsShell() {
  const [tab, setTab] = useState('seating');
  const [data, setData] = useState<any | null>(null);
  const [guests, setGuests] = useState<any[]>([]);
  const [logistics, setLogistics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useApp();

  const load = async () => {
    setLoading(true);
    try {
      const [d, g, l] = await Promise.all([api.seating.all(), api.guests.list(), api.logistics.list()]);
      setData(d);
      // Everyone except the declined can be seated. Guests are commonly added
      // (and planned for) before they RSVP, so 'potential'/'invited' must stay
      // seatable — only a decline rules a guest out of the room.
      setGuests((g || []).filter((x: any) => x.status !== 'declined'));
      setLogistics(l);
    } catch (e: any) {
      showToast(e.message || 'Failed to load seating', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (loading && !data) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  return (
    <>
      <Tabs className="mb-4" active={tab} onChange={setTab} tabs={[
        { id: 'seating', label: 'Seating' },
        { id: 'room', label: 'Room plan' },
        { id: 'logistics', label: 'Logistics', count: logistics?.length },
      ]} />
      {tab === 'seating' && <SeatingTab data={data} guests={guests} refresh={load} />}
      {tab === 'room' && <RoomTab data={data} guests={guests} refresh={load} />}
      {tab === 'logistics' && <LogisticsTab items={logistics} refresh={load} />}
    </>
  );
}

function SeatingTab({ data, guests, refresh }: { data: any; guests: any[]; refresh: () => void }) {
  const { showToast } = useApp();
  const [adding, setAdding] = useState<{ tableId: string } | null>(null);
  const [tableForm, setTableForm] = useState<Record<string, any>>({});
  const [editingTable, setEditingTable] = useState<any | null>(null);
  const [isNewTable, setIsNewTable] = useState(false);
  const [deletingTable, setDeletingTable] = useState<any | null>(null);
  const [selectedGuest, setSelectedGuest] = useState('');
  const [dragGuestId, setDragGuestId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const assign = async (tableId: string) => {
    if (!selectedGuest) return;
    try {
      await api.seating.assign({ table_id: tableId, guest_id: selectedGuest });
      showToast('Guest assigned', 'success');
      setAdding(null); setSelectedGuest(''); refresh();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const unassign = async (assignmentId: string) => {
    try { await api.seating.unassign(assignmentId); refresh(); }
    catch (e: any) { showToast(e.message, 'error'); }
  };

  const saveTable = async () => {
    if (!tableForm.name?.trim()) { showToast('Table name required', 'error'); return; }
    try {
      if (isNewTable) await api.seating.createTable({ ...tableForm, capacity: Number(tableForm.capacity) || 8 });
      else await api.seating.updateTable(editingTable.id, { ...tableForm, capacity: Number(tableForm.capacity) || 8 });
      showToast('Table saved', 'success');
      setEditingTable(null); refresh();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const seatedIds = useMemo(() => new Set((data?.tables || []).flatMap((t: any) => t.assignments.map((a: any) => a.guest_id))), [data]);
  const available = guests.filter((g) => !seatedIds.has(g.id));

  const startDrag = (e: React.DragEvent, guestId: string) => {
    e.dataTransfer.setData('text/plain', guestId);
    e.dataTransfer.effectAllowed = 'move';
    setDragGuestId(guestId);
  };

  const endDrag = () => { setDragGuestId(null); setDropTarget(null); };

  const dropOnTable = async (e: React.DragEvent, tableId: string) => {
    e.preventDefault();
    const guestId = dragGuestId;
    setDropTarget(null);
    if (!guestId) return;
    try {
      await api.seating.assign({ table_id: tableId, guest_id: guestId });
      showToast('Guest seated', 'success');
      refresh();
    } catch (err: any) { showToast(err.message, 'error'); }
  };

  const dropOnTray = async (e: React.DragEvent) => {
    e.preventDefault();
    const guestId = dragGuestId;
    setDropTarget(null);
    if (!guestId) return;
    for (const t of data?.tables || []) {
      const a = t.assignments.find((x: any) => x.guest_id === guestId);
      if (a) {
        try {
          await api.seating.unassign(a.id);
          showToast('Guest returned to unseated', 'success');
          refresh();
        } catch (err: any) { showToast(err.message, 'error'); }
        return;
      }
    }
  };

  const printSeatPlan = () => {
    document.body.classList.add('print-seat-plan');
    const cleanup = () => document.body.classList.remove('print-seat-plan');
    window.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(cleanup, 3000);
    window.print();
  };

  return (
    <div>
      {/* Status summary */}
      <div className="grid md:grid-cols-4 gap-4 mb-6">
        <Card className="px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Confirmed guests</p>
          <p className="text-2xl font-serif font-semibold">{data?.totals?.accepted ?? 0}</p>
          {typeof data?.totals?.seatable === 'number' && data.totals.seatable > (data?.totals?.accepted ?? 0) && (
            <p className="text-xs text-charcoal-400 mt-0.5">{data.totals.seatable} seatable incl. awaiting RSVP</p>
          )}
          {(data?.totals?.plus_ones_pending ?? 0) > 0 && (
            <p className="text-xs text-amber-700 mt-0.5">+{data.totals.plus_ones_pending} plus-one{data.totals.plus_ones_pending === 1 ? '' : 's'} to confirm · keep seats free</p>
          )}
        </Card>
        <Card className="px-5 py-4"><p className="text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Seated</p><p className="text-2xl font-serif font-semibold">{data?.totals?.seated ?? 0}</p></Card>
        <Card className={cn('px-5 py-4', (data?.totals?.unseated ?? 0) > 0 && 'bg-amber-50 border-amber-200')}>
          <p className="text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Unseated</p>
          <p className={cn('text-2xl font-serif font-semibold', (data?.totals?.unseated ?? 0) > 0 ? 'text-amber-700' : '')}>{data?.totals?.unseated ?? 0}</p>
        </Card>
        <Card className="px-5 py-4"><p className="text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Capacity total</p><p className="text-2xl font-serif font-semibold">{data?.totals?.capacity_total ?? 0}</p></Card>
      </div>

      {(data?.totals?.unseated ?? 0) > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
          <p className="text-sm font-medium text-amber-800">Unseated guests ({data.totals.unseated}):</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {data.unseated_guests?.map((g: any) => (
              <Badge key={g.id} tone="warning">{g.name} <span className="ml-1 opacity-70">({formatLabel(g.status)})</span></Badge>
            ))}
          </div>
        </div>
      )}

      {/* Drag tray: unseated guests are draggable onto tables (desktop). Drop a seated guest here to return them. */}
      <div
        className={cn('mb-6 rounded-xl border px-5 py-3 transition-shadow', dropTarget === 'tray' ? 'border-sage-500 ring-2 ring-sage-500 bg-sage-50' : 'border-dashed border-charcoal-200 bg-white')}
        onDragOver={(e) => { e.preventDefault(); if (dragGuestId) setDropTarget('tray'); }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={dropOnTray}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-charcoal-800">
            {available.length > 0
              ? `Unseated guests (${available.length}) — drag onto a table, or use the dropdown on each table`
              : 'No unseated guests — everyone invited is seated'}
          </p>
          <Button variant="outline" size="sm" onClick={printSeatPlan} className="shrink-0">Print seat plan</Button>
        </div>
        {available.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {available.map((g: any) => (
              <span
                key={g.id}
                draggable
                onDragStart={(e) => startDrag(e, g.id)}
                onDragEnd={endDrag}
                className={cn(
                  'inline-flex cursor-grab items-center gap-1.5 rounded-full border border-charcoal-300 bg-white px-3 py-1 text-sm shadow-sm transition-opacity select-none',
                  dragGuestId === g.id && 'opacity-40'
                )}
                title="Drag onto a table (desktop) or use the table dropdown (mobile)"
              >
                {g.first_name} {g.last_name}
                <span className="text-xs text-charcoal-400">({formatLabel(g.status)})</span>
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-charcoal-400 mt-3">Desktop: drag a guest chip onto a table to seat them, drag a seated guest back here to unseat, or drag between tables to move. Mobile: use the “Assign a guest…” dropdown on each table.</p>
      </div>

      <div className="flex flex-wrap justify-end gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={printSeatPlan}>Print seat plan</Button>
        <Button variant="outline" size="sm" onClick={() => { setIsNewTable(true); setTableForm({ name: '', capacity: 8, shape: 'round', location: '', notes: '' }); setEditingTable({ _new: true }); }}>+ Table</Button>
      </div>

      {data?.tables?.length === 0 ? (
        <Card><EmptyState title="No tables yet" message="Add tables with their capacities, then drag guests onto them." action={<Button size="sm" onClick={() => { setIsNewTable(true); setTableForm({ name: 'Table 1', capacity: 8, shape: 'round', location: '', notes: '' }); setEditingTable({ _new: true }); }}>+ Table</Button>} /></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {data?.tables?.map((t: any) => (
            <Card key={t.id} className={cn(t.overcapacity && 'border-red-300 bg-red-50/40', dropTarget === t.id && 'ring-2 ring-sage-500')}>
              <div
                className="px-5 py-4"
                onDragOver={(e) => { e.preventDefault(); if (dragGuestId) setDropTarget(t.id); }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => dropOnTable(e, t.id)}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-medium text-charcoal-900">{t.name}</h3>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { setIsNewTable(false); setTableForm({ name: t.name, capacity: t.capacity, shape: t.shape, location: t.location || '', notes: t.notes || '' }); setEditingTable(t); }}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeletingTable(t)} className="text-red-600 hover:bg-red-50">Del</Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge tone={t.overcapacity ? 'danger' : 'neutral'}>
                    {t.assignments.length}/{t.capacity || 0} seated
                  </Badge>
                  {t.overcapacity && <Badge tone="danger">over capacity</Badge>}
                  {t.location && <span className="text-xs text-charcoal-400">{t.location}</span>}
                </div>

                <ul className="mt-3 space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                  {t.assignments.map((a: any) => (
                    <li key={a.id} draggable onDragStart={(e) => startDrag(e, a.guest_id)} onDragEnd={endDrag} className={cn('flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-ivory-100 text-sm cursor-grab', dragGuestId === a.guest_id && 'opacity-40')}>
                      <span className="truncate text-charcoal-700">{a.guest_name} {a.seat_number ? <span className="text-charcoal-400 text-xs">(seat {a.seat_number})</span> : null}</span>
                      <button onClick={() => unassign(a.id)} className="text-charcoal-400 hover:text-red-600 ml-2" aria-label="Remove">✕</button>
                    </li>
                  ))}
                  {t.assignments.length === 0 && <li className="text-xs text-charcoal-300 px-1">Empty table — add a guest below.</li>}
                </ul>

                <div className="mt-3 flex gap-2">
                  <Select value={adding?.tableId === t.id ? selectedGuest : ''} onChange={(e) => { setAdding({ tableId: t.id }); setSelectedGuest(e.target.value); }} className="text-sm">
                    <option value="">Assign a guest…</option>
                    {available.map((g: any) => <option key={g.id} value={g.id}>{g.first_name} {g.last_name}</option>)}
                    {t.assignments.length > 0 && <option value="">—</option>}
                  </Select>
                  {adding?.tableId === t.id && selectedGuest && (
                    <Button size="sm" onClick={() => assign(t.id)}>Add</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Printable seat plan — hidden on screen, shown only via print (see index.css: body.print-seat-plan) */}
      <div id="print-seat-plan" className="hidden">
        <div className="print-title">Seat plan</div>
        <div className="print-sub">Printed {new Date().toLocaleDateString()} · {data?.totals?.seated ?? 0} seated of {data?.totals?.accepted ?? 0} guests</div>
        <div className="print-grid">
          {(data?.tables || []).map((t: any) => (
            <div key={t.id} className="print-table">
              <div className="print-table-name">{t.name}</div>
              <div className="print-table-meta">{t.assignments.length} / {t.capacity || 0} seated{t.location ? ` · ${t.location}` : ''}{t.overcapacity ? ' · OVER CAPACITY' : ''}</div>
              <ol className="print-guests">
                {(t.assignments || []).map((a: any) => (
                  <li key={a.id}>{a.guest_name}{a.seat_number ? ` (seat ${a.seat_number})` : ''}</li>
                ))}
                {t.assignments.length === 0 && <li className="print-empty">— empty —</li>}
              </ol>
            </div>
          ))}
        </div>
        {available.length > 0 && (
          <div className="print-unseated">
            <div className="print-sub">Not seated ({available.length})</div>
            <p>{available.map((g: any) => `${g.first_name} ${g.last_name}`).join(', ')}</p>
          </div>
        )}
      </div>

      <Modal
        open={!!editingTable}
        onClose={() => setEditingTable(null)}
        title={isNewTable ? 'Add table' : 'Edit table'}
        size="sm"
        footer={<><Button variant="ghost" onClick={() => setEditingTable(null)}>Cancel</Button><Button onClick={saveTable}>Save</Button></>}
      >
        <Field label="Table name *"><Input value={tableForm.name || ''} onChange={(e) => setTableForm({ ...tableForm, name: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Capacity"><Input type="number" min={1} value={tableForm.capacity ?? 8} onChange={(e) => setTableForm({ ...tableForm, capacity: e.target.value })} /></Field>
          <Field label="Shape">
            <Select value={tableForm.shape} onChange={(e) => setTableForm({ ...tableForm, shape: e.target.value })}>
              <option value="round">Round</option>
              <option value="rectangular">Rectangular</option>
              <option value="square">Square</option>
            </Select>
          </Field>
        </div>
        <Field label="Location"><Input value={tableForm.location || ''} onChange={(e) => setTableForm({ ...tableForm, location: e.target.value })} placeholder="e.g. Main hall, left side" /></Field>
        <Field label="Notes"><Textarea rows={2} value={tableForm.notes || ''} onChange={(e) => setTableForm({ ...tableForm, notes: e.target.value })} /></Field>
      </Modal>

      <ConfirmDialog open={!!deletingTable} onClose={() => setDeletingTable(null)} onConfirm={async () => { try { await api.seating.deleteTable(deletingTable.id); showToast('Table deleted', 'success'); refresh(); } catch (e: any) { showToast(e.message, 'error'); } }} title="Delete this table?" message="Assignments for this table will be removed." />
    </div>
  );
}

function tableBox(t: any) {
  const cap = t.capacity || 8;
  if (t.shape === 'rectangular') return { w: Math.round(Math.max(150, cap * 14)), h: 100 };
  if (t.shape === 'square') return { w: Math.round(Math.max(110, cap * 10)), h: Math.round(Math.max(110, cap * 10)) };
  return { w: Math.round(Math.max(100, cap * 10)), h: Math.round(Math.max(100, cap * 10)) };
}

function RoomTab({ data, guests, refresh }: { data: any; guests: any[]; refresh: () => void }) {
  const { showToast } = useApp();
  const [w, setW] = useState(1200);
  const [h, setH] = useState(700);
  const [wInput, setWInput] = useState('1200');
  const [hInput, setHInput] = useState('700');
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [drag, setDrag] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [dragGuestId, setDragGuestId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const seatedIds = useMemo(() => new Set((data?.tables || []).flatMap((t: any) => t.assignments.map((a: any) => a.guest_id))), [data]);
  const available = guests.filter((g) => !seatedIds.has(g.id));

  useEffect(() => {
    api.seating.room().then((r) => { setW(r.width); setH(r.height); setWInput(String(r.width)); setHInput(String(r.height)); }).catch(() => {});
  }, []);

  // Mirror table positions from the server (pos_x/pos_y flow through GET).
  useEffect(() => {
    const next: Record<string, { x: number; y: number }> = {};
    (data?.tables || []).forEach((t: any) => { next[t.id] = { x: t.pos_x || 0, y: t.pos_y || 0 }; });
    setPos(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const startDrag = (e: React.DragEvent, guestId: string) => {
    e.dataTransfer.setData('text/plain', guestId);
    e.dataTransfer.effectAllowed = 'move';
    setDragGuestId(guestId);
  };
  const endDrag = () => { setDragGuestId(null); setDropTarget(null); };

  const assign = async (guestId: string, tableId: string) => {
    try {
      await api.seating.assign({ table_id: tableId, guest_id: guestId });
      showToast('Guest seated', 'success');
      refresh();
    } catch (err: any) { showToast(err.message, 'error'); }
  };

  const dropOnTable = async (e: React.DragEvent, tableId: string) => {
    e.preventDefault();
    const guestId = dragGuestId;
    setDropTarget(null);
    if (!guestId) return;
    await assign(guestId, tableId);
  };

  const dropOnTray = async (e: React.DragEvent) => {
    e.preventDefault();
    const guestId = dragGuestId;
    setDropTarget(null);
    if (!guestId) return;
    for (const t of data?.tables || []) {
      const a = t.assignments.find((x: any) => x.guest_id === guestId);
      if (a) {
        try { await api.seating.unassign(a.id); showToast('Guest returned to unseated', 'success'); refresh(); }
        catch (err: any) { showToast(err.message, 'error'); }
        return;
      }
    }
  };

  const onTablePointerDown = (e: React.PointerEvent, t: any) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setDrag({ id: t.id, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top });
    el.setPointerCapture(e.pointerId);
  };

  const onTablePointerMove = (e: React.PointerEvent, t: any) => {
    if (!drag || drag.id !== t.id) return;
    const board = (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect();
    if (!board) return;
    const b = tableBox(t);
    let x = e.clientX - board.left - drag.offsetX;
    let y = e.clientY - board.top - drag.offsetY;
    x = Math.max(0, Math.min(w - b.w, x));
    y = Math.max(0, Math.min(h - b.h, y));
    setPos((p) => ({ ...p, [t.id]: { x, y } }));
  };

  const onTablePointerUp = async (e: React.PointerEvent, t: any) => {
    if (!drag || drag.id !== t.id) return;
    const p = pos[t.id] || { x: t.pos_x || 0, y: t.pos_y || 0 };
    setDrag(null);
    try {
      await api.seating.updateTable(t.id, { pos_x: Math.round(p.x), pos_y: Math.round(p.y) });
    } catch (err: any) { showToast(err.message || 'Could not save table position', 'error'); }
  };

  const saveRoom = async () => {
    const width = Math.max(400, Math.min(4000, parseInt(wInput, 10) || 1200));
    const height = Math.max(300, Math.min(3000, parseInt(hInput, 10) || 700));
    try {
      const r = await api.seating.updateRoom({ width, height });
      setW(r.width); setH(r.height); setWInput(String(r.width)); setHInput(String(r.height));
      showToast('Room size saved', 'success');
    } catch (err: any) { showToast(err.message, 'error'); }
  };

  const printRoomPlan = () => {
    document.body.classList.add('print-room-plan');
    const cleanup = () => document.body.classList.remove('print-room-plan');
    window.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(cleanup, 3000);
    window.print();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-charcoal-800">Drag tables into place, then print the room plan for the venue.</p>
          <p className="text-xs text-charcoal-400 mt-0.5">{data?.tables?.length ?? 0} tables · {data?.totals?.seated ?? 0} seated · {data?.totals?.unseated ?? 0} unseated</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-charcoal-500">Room</label>
          <Input type="number" min={400} max={4000} value={wInput} onChange={(e) => setWInput(e.target.value)} className="w-24" aria-label="Room width" />
          <span className="text-xs text-charcoal-400">×</span>
          <Input type="number" min={300} max={3000} value={hInput} onChange={(e) => setHInput(e.target.value)} className="w-24" aria-label="Room height" />
          <Button variant="outline" size="sm" onClick={saveRoom}>Save size</Button>
          <Button variant="outline" size="sm" onClick={printRoomPlan}>Print room plan</Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="overflow-x-auto pb-2">
          <div className="relative rounded-xl border border-charcoal-100 bg-ivory-50" style={{ width: w, height: h }}>
            {data?.tables?.map((t: any) => {
              const b = tableBox(t);
              const p = pos[t.id] || { x: t.pos_x || 0, y: t.pos_y || 0 };
              return (
                <div
                  key={t.id}
                  onPointerDown={(e) => onTablePointerDown(e, t)}
                  onPointerMove={(e) => onTablePointerMove(e, t)}
                  onPointerUp={(e) => onTablePointerUp(e, t)}
                  onDragOver={(e) => { e.preventDefault(); if (dragGuestId) setDropTarget(t.id); }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => dropOnTable(e, t.id)}
                  className={cn(
                    'absolute flex flex-col items-center justify-center cursor-grab select-none border-2 transition-shadow',
                    t.shape === 'round' ? 'rounded-full' : 'rounded-xl',
                    drag?.id === t.id ? 'cursor-grabbing shadow-xl ring-2 ring-sage-500' : '',
                    dropTarget === t.id && 'ring-2 ring-sage-500',
                    t.overcapacity ? 'border-red-400 bg-red-50/90' : 'border-sage-400 bg-ivory-100/95'
                  )}
                  style={{ left: p.x, top: p.y, width: b.w, height: b.h, touchAction: 'none' }}
                  title={`${t.name} — drag to move`}
                >
                  <span className="px-2 text-center text-sm font-semibold leading-tight text-charcoal-800">{t.name}</span>
                  <span className={cn('mt-0.5 text-xs', t.overcapacity ? 'font-semibold text-red-600' : 'text-charcoal-400')}>{t.assignments.length}/{t.capacity || 0}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Unseated tray: drop a seated guest here to unseat, or drag a chip onto a table. */}
      <div
        className={cn('mt-4 rounded-xl border px-5 py-3', dropTarget === 'tray' ? 'border-sage-500 bg-sage-50 ring-2 ring-sage-500' : 'border-dashed border-charcoal-200 bg-white')}
        onDragOver={(e) => { e.preventDefault(); if (dragGuestId) setDropTarget('tray'); }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={dropOnTray}
      >
        <p className="text-sm font-medium text-charcoal-800">
          Unseated guests ({available.length}) — drag a chip onto a table, or drop a seated guest back here
        </p>
        {available.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {available.map((g: any) => (
              <span
                key={g.id}
                draggable
                onDragStart={(e) => startDrag(e, g.id)}
                onDragEnd={endDrag}
                className={cn('inline-flex cursor-grab items-center gap-1.5 rounded-full border border-charcoal-300 bg-white px-3 py-1 text-sm shadow-sm select-none', dragGuestId === g.id && 'opacity-40')}
                title="Drag onto a table (desktop) or use the Seating tab dropdown (mobile)"
              >
                {g.first_name} {g.last_name}
              </span>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-charcoal-400">Move a table: drag its shape around the room. Seat a guest: drag them from this tray onto a table. On touch devices, drag tables with your finger.</p>
      </div>

      {/* Printable room plan — hidden on screen, printed via body.print-room-plan */}
      <div id="print-room-plan" className="hidden">
        <div className="print-title">Room plan</div>
        <div className="print-sub">Printed {new Date().toLocaleDateString()} · {data?.tables?.length ?? 0} tables · {data?.totals?.seated ?? 0} seated of {data?.totals?.accepted ?? 0} guests</div>
        <div className="room-print-board" style={{ aspectRatio: `${w} / ${h}` }}>
          {(data?.tables || []).map((t: any) => {
            const b = tableBox(t);
            const p = pos[t.id] || { x: t.pos_x || 0, y: t.pos_y || 0 };
            return (
              <div
                key={t.id}
                className={cn('room-print-table', t.shape === 'round' && 'room-print-round')}
                style={{ left: `${(p.x / w) * 100}%`, top: `${(p.y / h) * 100}%`, width: `${(b.w / w) * 100}%`, height: `${(b.h / h) * 100}%` }}
              >
                <div className="room-print-table-name">{t.name}</div>
                <div className="room-print-table-meta">{t.assignments.length}/{t.capacity || 0}</div>
              </div>
            );
          })}
        </div>
        {available.length > 0 && (
          <div className="print-unseated">
            <div className="print-sub">Not seated ({available.length})</div>
            <p>{available.map((g: any) => `${g.first_name} ${g.last_name}`).join(', ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LogisticsTab({ items, refresh }: { items: any[]; refresh: () => void }) {
  const { showToast } = useApp();
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);

  const openNew = () => { setIsNew(true); setForm({ type: 'transport', name: '', description: '', cost_input: '', confirmed: false }); setEditing({ _new: true }); };
  const openEdit = (l: any) => { setIsNew(false); setForm({ type: l.type, name: l.name, description: l.description || '', cost_input: l.cost_pence != null ? formatCurrency(l.cost_pence) : '', confirmed: !!l.confirmed }); setEditing(l); };

  const save = async () => {
    if (!form.name?.trim()) { showToast('Name required', 'error'); return; }
    try {
      const { cost_input, ...rest } = form;
      const payload = { ...rest, cost_pence: cost_input ? parseAmount(String(cost_input)) : null };
      if (isNew) await api.logistics.create(payload);
      else await api.logistics.update(editing.id, payload);
      showToast('Logistics item saved', 'success');
      setEditing(null); refresh();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => { try { await api.logistics.remove(deleting.id); showToast('Item deleted', 'success'); refresh(); } catch (e: any) { showToast(e.message, 'error'); } };

  const totalCost = items.reduce((s, l) => s + (l.cost_pence || 0), 0);

  return (
    <div>
      <Card className="mb-4 px-5 py-4">
        <p className="text-sm text-charcoal-600">Transport, accommodation and equipment. Costs here are informational — keep the main figures in the <strong>Budget</strong> tab to avoid double counting.</p>
      </Card>
      <div className="flex justify-end mb-4"><Button onClick={openNew}>+ Add logistics item</Button></div>
      {items.length === 0 ? (
        <Card><EmptyState title="No logistics items" message="Track transport, accommodation blocks and equipment here." action={<Button size="sm" onClick={openNew}>+ Add item</Button>} /></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Item</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Type</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Description</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Cost</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Status</th>
                  <th className="text-right px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l: any) => (
                  <tr key={l.id} className="border-t border-charcoal-100 hover:bg-ivory-50">
                    <td className="px-5 py-3 font-medium text-charcoal-800">{l.name}</td>
                    <td className="px-4 py-3"><Badge tone="neutral">{formatLabel(l.type)}</Badge></td>
                    <td className="px-4 py-3 text-charcoal-500">{l.description || '—'}</td>
                    <td className="px-4 py-3 text-right">{l.cost_pence != null ? formatCurrency(l.cost_pence) : '—'}</td>
                    <td className="px-4 py-3"><Badge tone={l.confirmed ? 'success' : 'warning'}>{l.confirmed ? 'Confirmed' : 'Not confirmed'}</Badge></td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(l)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(l)} className="text-red-600 hover:bg-red-50">Del</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-ivory-100">
                  <td className="px-5 py-3 font-medium" colSpan={3}>Total (informational)</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(totalCost)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Add logistics item' : 'Edit logistics item'} size="md" footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Name *"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Type">
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="transport">Transport</option>
                  <option value="accommodation">Accommodation</option>
                  <option value="equipment">Equipment</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
            </div>
            <Field label="Description"><Textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Cost (£, informational)"><Input value={form.cost_input || ''} onChange={(e) => setForm({ ...form, cost_input: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm text-charcoal-700"><input type="checkbox" className="checkbox" checked={!!form.confirmed} onChange={(e) => setForm({ ...form, confirmed: e.target.checked })} /> Confirmed</label>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={doDelete} title="Delete this logistics item?" />
    </div>
  );
}

function parseAmount(input: string): number {
  const cleaned = String(input || '').replace(/[£,\s]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n * 100);
}