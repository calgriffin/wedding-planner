/**
 * Guests: individuals & households, invitations, RSVPs, dietary, gifts, thank-yous.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, statusTone, formatLabel, Button, Modal, Field, Input, Select, Textarea, Spinner, EmptyState, SearchInput, ConfirmDialog, Tabs,
} from '../components/ui';
import { formatDate, generateInvitationCode } from '../utils/helpers';
import { householdNameFromGuests } from '../utils/householdName';

const STATUSES = ['potential', 'invited', 'confirmed', 'declined', 'evening_only'];
const ATTENDANCE = ['none', 'day', 'evening', 'both'];

export default function GuestsPage() {
  const { showToast } = useApp();
  const [guests, setGuests] = useState<any[] | null>(null);
  const [households, setHouseholds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tab, setTab] = useState('guests'); // guests | households
  const [editing, setEditing] = useState<any | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [deleting, setDeleting] = useState<any | null>(null);
  const [deletingKind, setDeletingKind] = useState<'guest' | 'household'>('guest');
  const [tags, setTags] = useState<any[]>([]);
  const [tagById, setTagById] = useState<Record<string, any>>({});
  const [guestTagIds, setGuestTagIds] = useState<Record<string, string[]>>({});
  const [tagFilter, setTagFilter] = useState('all');
  const [formTagIds, setFormTagIds] = useState<string[]>([]);
  const [householdCode, setHouseholdCode] = useState<Record<string, { access_code: string; rsvp_link: string }>>({});
  const [songs, setSongs] = useState<any[]>([]);
  const [songsOnlyAttending, setSongsOnlyAttending] = useState(false);
  // "Name from guests" for every household: the proposed renames, each ticked
  // by default, applied only when the couple confirms.
  const [renames, setRenames] = useState<{ id: string; from: string; to: string; apply: boolean }[] | null>(null);
  const [renaming, setRenaming] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [g, h, tg, ta, qr, sg] = await Promise.all([api.guests.list(), api.households.list(), api.guestTags.list(), api.guestTags.assignments(), api.rsvp.qrSheet(), api.rsvp.songs()]);
      setGuests(g);
      setHouseholds(h);
      setSongs(sg || []);
      setTags(tg || []);
      const byId: Record<string, any> = {};
      (tg || []).forEach((t: any) => { byId[t.id] = t; });
      setTagById(byId);
      const perGuest: Record<string, string[]> = {};
      (ta || []).forEach((a: any) => { (perGuest[a.guest_id] = perGuest[a.guest_id] || []).push(a.tag_id); });
      setGuestTagIds(perGuest);
      const codeMap: Record<string, { access_code: string; rsvp_link: string }> = {};
      (qr?.households || []).forEach((hh: any) => { if (hh?.access_code) codeMap[hh.household_id] = { access_code: hh.access_code, rsvp_link: hh.rsvp_link || '' }; });
      setHouseholdCode(codeMap);
    } catch (e: any) {
      showToast(e.message || 'Failed to load guests', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (guests || []).forEach((g) => { c[g.status] = (c[g.status] || 0) + 1; });
    return c;
  }, [guests]);

  // Plus-ones offered but not answered yet: no record of their own, but they
  // count towards the numbers until the guest RSVPs.
  const plusOnesPending = useMemo(() => (guests || []).filter((g) => g.plus_one_pending).length, [guests]);

  const tagUsedCounts = useMemo(() => {
    const c: Record<string, number> = {};
    Object.values(guestTagIds).forEach((ids) => { ids.forEach((id) => { c[id] = (c[id] || 0) + 1; }); });
    return c;
  }, [guestTagIds]);

  const songRows = useMemo(() => {
    let list = songs || [];
    if (songsOnlyAttending) list = list.filter((s) => s.status === 'confirmed' || s.status === 'evening_only');
    return list;
  }, [songs, songsOnlyAttending]);

  const copySongs = async () => {
    const text = songRows.map((s) => `${s.song_request} — ${s.guest_name}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast('Song requests copied for the DJ', 'success');
    } catch {
      showToast('Could not copy — select the list and copy manually', 'error');
    }
  };

  const filtered = useMemo(() => {
    let list = guests || [];
    if (statusFilter !== 'all') list = list.filter((g) => g.status === statusFilter);
    if (tagFilter !== 'all') list = list.filter((g) => (guestTagIds[g.id] || []).includes(tagFilter));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) => `${g.first_name} ${g.last_name} ${g.email || ''} ${g.notes || ''}`.toLowerCase().includes(q));
    }
    return list;
  }, [guests, statusFilter, tagFilter, guestTagIds, search]);

  const openNew = () => {
    setIsNew(true);
    setForm({
      household_id: '', is_primary: true, first_name: '', last_name: '', email: '', phone: '',
      invitation_code: generateInvitationCode(), status: 'potential', attendance_type: 'none', dietary_needs: '',
      accessibility_requests: '', accommodation_needed: false, accommodation_booked: false, plus_one_allowed: false, notes: '',
    });
    setFormTagIds([]);
    setEditing({ _new: true });
  };

  const openEdit = (g: any) => {
    setIsNew(false);
    setForm({
      household_id: g.household_id || '', is_primary: !!g.is_primary, first_name: g.first_name, last_name: g.last_name,
      email: g.email || '', phone: g.phone || '', invitation_code: g.invitation_code || '', status: g.status,
      attendance_type: g.attendance_type || 'none', dietary_needs: g.dietary_needs || '', accessibility_requests: g.accessibility_requests || '',
      accommodation_needed: !!g.accommodation_needed, accommodation_booked: !!g.accommodation_booked,
      accommodation_details: g.accommodation_details || '', gift_received: !!g.gift_received, gift_description: g.gift_description || '',
      thank_you_sent: !!g.thank_you_sent, thank_you_date: g.thank_you_date || '', plus_one_of: g.plus_one_of || '', plus_one_allowed: !!g.plus_one_allowed, notes: g.notes || '',
    });
    setFormTagIds(guestTagIds[g.id] || []);
    setEditing(g);
  };

  const save = async () => {
    if (!form.first_name?.trim() || !form.last_name?.trim()) { showToast('Guest needs a first and last name', 'error'); return; }
    try {
      if (isNew) {
        const created = await api.guests.create({ ...form, invitation_code: form.invitation_code || generateInvitationCode() });
        await api.guestTags.assign(created.id, formTagIds);
      } else {
        await api.guests.update(editing.id, form);
        await api.guestTags.assign(editing.id, formTagIds);
      }
      showToast('Guest saved', 'success');
      setEditing(null); load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const quickStatus = async (id: string, status: string) => {
    try {
      await api.guests.update(id, { status });
      showToast(`Marked ${formatLabel(status)}`, 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const doDelete = async () => {
    try {
      if (deletingKind === 'guest') await api.guests.remove(deleting.id);
      else await api.households.remove(deleting.id);
      showToast('Deleted', 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const openNewHousehold = () => {
    setIsNew(true);
    setForm({ name: '', address_line1: '', address_line2: '', city: '', postcode: '', country: '', notes: '' });
    setEditing({ _household: true, _new_household: true });
  };

  const openHousehold = (h: any) => {
    setIsNew(false);
    setForm({ name: h.name, address_line1: h.address_line1 || '', address_line2: h.address_line2 || '', city: h.city || '', postcode: h.postcode || '', country: h.country || '', notes: h.notes || '' });
    setEditing({ ...h, _household: true });
  };

  const suggestedName = (householdId: string) =>
    householdNameFromGuests((guests || []).filter((g: any) => g.household_id === householdId));

  const openRenames = () => {
    const proposed = households
      .map((h: any) => ({ id: h.id, from: h.name, to: suggestedName(h.id), apply: true }))
      .filter((r) => r.to && r.to !== r.from);
    if (!proposed.length) { showToast('Every household already matches its guests’ names', 'success'); return; }
    setRenames(proposed);
  };

  const applyRenames = async () => {
    const chosen = (renames || []).filter((r) => r.apply);
    setRenaming(true);
    try {
      for (const r of chosen) await api.households.update(r.id, { name: r.to });
      showToast(`Renamed ${chosen.length} household${chosen.length === 1 ? '' : 's'}`, 'success');
      setRenames(null); load();
    } catch (e: any) { showToast(e.message, 'error'); load(); }
    finally { setRenaming(false); }
  };

  const saveHousehold = async () => {
    if (!form.name?.trim()) { showToast('Household name required', 'error'); return; }
    try {
      if (editing._new_household) await api.households.create(form);
      else await api.households.update(editing.id, form);
      showToast('Household saved', 'success');
      setEditing(null); load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  if (loading && !guests) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader
        title="Guests"
        subtitle="One row per guest, linked by household. Name a plus-one as their own guest, or offer one without a name and let the guest add them when they RSVP."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setTab('households')}>Households</Button>
            <Button onClick={openNew}>+ Add guest</Button>
          </>
        }
      />

      <Tabs
        tabs={[
          { id: 'guests', label: 'Guests', count: guests?.length },
          { id: 'households', label: 'Households', count: households.length },
          { id: 'requests', label: 'Song requests', count: songs.length },
        ]}
        active={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === 'guests' && (
        <>
          <div className="flex flex-col md:flex-row gap-3 mb-4 items-start md:items-center">
            <div className="flex flex-wrap gap-2">
              {['all', ...STATUSES].map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-sage-100 text-sage-700' : 'text-charcoal-500 hover:bg-charcoal-100'}`}>
                  {s === 'all' ? `All (${guests?.length ?? 0})` : `${formatLabel(s)} (${counts[s] || 0})`}
                </button>
              ))}
            </div>
            <SearchInput value={search} onChange={setSearch} className="md:ml-auto md:w-64" placeholder="Search guests…" />
          </div>

          {plusOnesPending > 0 && (
            <p className="mb-4 text-sm text-charcoal-500">
              <span className="font-medium text-charcoal-800">{(guests?.length ?? 0) + plusOnesPending} places</span> in your numbers: {guests?.length ?? 0} guests + {plusOnesPending} plus-one{plusOnesPending === 1 ? '' : 's'} still to be confirmed on the RSVP.
            </p>
          )}

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              <button onClick={() => setTagFilter('all')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tagFilter === 'all' ? 'bg-sage-100 text-sage-700' : 'text-charcoal-500 hover:bg-charcoal-100'}`}>All tags</button>
              {tags.map((t: any) => (
                <button key={t.id} onClick={() => setTagFilter(tagFilter === t.id ? 'all' : t.id)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tagFilter === t.id ? 'bg-sage-100 text-sage-700' : 'text-charcoal-500 hover:bg-charcoal-100'}`}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color || '#527352' }} aria-hidden="true" />
                  {t.name}
                  <span className="text-xs opacity-60">({tagUsedCounts[t.id] || 0})</span>
                </button>
              ))}
            </div>
          )}

          <Card>
            {filtered.length === 0 ? (
              <EmptyState title="No guests match" message="Add guests to build your list, or change your filters." action={<Button size="sm" onClick={openNew}>+ Add guest</Button>} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-left px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Guest</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Household</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">RSVP code</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Status</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Attendance</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Tags</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Dietary / accessibility</th>
                      <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Gift & thank-you</th>
                      <th className="text-right px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((g: any) => (
                      <tr key={g.id} className="border-t border-charcoal-100 hover:bg-ivory-50">
                        <td className="px-5 py-3">
                          <span className="font-medium text-charcoal-800">{g.first_name} {g.last_name}</span>
                          {g.plus_one_of && <p className="text-xs text-charcoal-400">plus-one</p>}
                          {g.plus_one_pending && <p className="text-xs text-amber-700">+1 offered · counted until they reply</p>}
                          {!!g.plus_one_allowed && !g.plus_one_pending && (
                            <p className="text-xs text-charcoal-400">{g.plus_one_name && g.plus_one_response !== 'declined' ? `+1: ${g.plus_one_name}` : g.plus_one_response === 'declined' ? 'not bringing a +1' : '+1 offered'}</p>
                          )}
                          {g.email && <p className="text-xs text-charcoal-400">{g.email}</p>}
                        </td>
                        <td className="px-4 py-3 text-charcoal-600">{g.household_name || '—'}</td>
                        <td className="px-4 py-3">
                          {householdCode[g.household_id || '']?.access_code ? (
                            <span title={householdCode[g.household_id || ''].rsvp_link || 'RSVP access code for this household'}>
                              <Badge tone="sage" className="font-mono">{householdCode[g.household_id || ''].access_code}</Badge>
                            </span>
                          ) : (
                            <span className="text-charcoal-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Select value={g.status} onChange={(e) => quickStatus(g.id, e.target.value)} className="!w-auto text-xs py-1">
                            {STATUSES.map((s) => <option key={s} value={s}>{formatLabel(s)}</option>)}
                          </Select>
                          <Badge tone={statusTone(g.status)} className="ml-1 hidden xl:inline-flex">{formatLabel(g.status)}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {g.attendance_type && g.attendance_type !== 'none'
                            ? <Badge tone={g.attendance_type === 'evening' ? 'warning' : 'info'}>{formatLabel(g.attendance_type)}</Badge>
                            : <span className="text-charcoal-300">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {(guestTagIds[g.id] || []).length === 0 ? (
                            <span className="text-charcoal-300">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {(guestTagIds[g.id] || []).map((tid) => {
                                const t = tagById[tid];
                                return t ? (
                                  <span key={tid} className="inline-flex items-center gap-1 rounded-full bg-charcoal-50 px-2 py-0.5 text-xs text-charcoal-600" title={t.name}>
                                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.color || '#527352' }} aria-hidden="true" />
                                    {t.name}
                                  </span>
                                ) : null;
                              })}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-charcoal-600">
                          {g.dietary_needs ? <span className="text-amber-700">{g.dietary_needs}</span> : <span className="text-charcoal-300">—</span>}
                          {g.accessibility_requests && <p className="text-charcoal-500">{g.accessibility_requests}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {g.gift_received
                            ? <Badge tone="success" className="mr-1">gift{g.gift_description ? ': ' + g.gift_description : ''}</Badge>
                            : null}
                          {g.thank_you_sent
                            ? <Badge tone="info">thank-you {g.thank_you_date ? formatDate(g.thank_you_date) : ''}</Badge>
                            : g.gift_received ? <Badge tone="warning">note due</Badge> : null}
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(g)}>Edit</Button>
                          <Button variant="ghost" size="sm" onClick={() => { setDeleting(g); setDeletingKind('guest'); }} className="text-red-600 hover:bg-red-50">Del</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'households' && (
        <Card>
          <div className="px-5 py-3 border-b border-charcoal-100 flex justify-end gap-2">
            {households.length > 0 && <Button variant="ghost" size="sm" onClick={openRenames}>Name from guests…</Button>}
            <Button variant="outline" size="sm" onClick={openNewHousehold}>+ Household</Button>
          </div>
          {households.length === 0 ? (
            <EmptyState title="No households yet" message="Group guests by household to manage invitations and addresses together." action={<Button size="sm" onClick={openNewHousehold}>+ Add household</Button>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Household</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">RSVP code</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Address</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Guests</th>
                    <th className="text-right px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {households.map((h: any) => (
                    <tr key={h.id} className="border-t border-charcoal-100 hover:bg-ivory-50">
                      <td className="px-5 py-3 font-medium text-charcoal-800">{h.name}</td>
                      <td className="px-4 py-3">
                        {householdCode[h.id]?.access_code ? (
                          <Badge tone="sage" className="font-mono">{householdCode[h.id]?.access_code}</Badge>
                        ) : <span className="text-charcoal-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-charcoal-500">
                        {[h.address_line1, h.address_line2, h.city, h.postcode, h.country].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral">{h.guest_count}</Badge>
                        {h.plus_ones_pending > 0 && <span className="ml-2 text-xs text-amber-700">+{h.plus_ones_pending} plus-one{h.plus_ones_pending === 1 ? '' : 's'} to confirm</span>}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => openHousehold(h)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setDeleting(h); setDeletingKind('household'); }} className="text-red-600 hover:bg-red-50">Del</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'requests' && (
        <Card>
          <div className="px-5 py-3 border-b border-charcoal-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm text-charcoal-600 cursor-pointer">
                <input type="checkbox" checked={songsOnlyAttending} onChange={(e) => setSongsOnlyAttending(e.target.checked)} className="rounded border-charcoal-300 text-sage-600 focus:ring-sage-500" />
                Only attending guests
              </label>
              <span className="text-xs text-charcoal-400">{songRows.length} request{songRows.length === 1 ? '' : 's'} · collected on the RSVP form</span>
            </div>
            <Button variant="outline" size="sm" onClick={copySongs} disabled={!songRows.length}>Copy all for the DJ</Button>
          </div>
          {songRows.length === 0 ? (
            <EmptyState title="No song requests yet" message="Each guest can add one song on the RSVP page. Requests appear here as they come in." />
          ) : (
            <ul className="divide-y divide-charcoal-100">
              {songRows.map((s) => (
                <li key={s.guest_id} className="px-5 py-3 flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-charcoal-900">&ldquo;{s.song_request}&rdquo;</p>
                    <p className="text-xs text-charcoal-400 mt-0.5">{s.guest_name}{s.household_name ? ` · ${s.household_name}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge tone={statusTone(s.status)}>{formatLabel(s.status)}</Badge>
                    {s.attendance_type && s.attendance_type !== 'none' && <span className="text-xs text-charcoal-400">{formatLabel(s.attendance_type)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Guest modal */}
      <Modal
        open={!!editing && !editing._household}
        onClose={() => setEditing(null)}
        title={isNew ? 'Add guest' : 'Edit guest'}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}
      >
        {editing && !editing._household && (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Household">
              <Select value={form.household_id || ''} onChange={(e) => setForm({ ...form, household_id: e.target.value })}>
                <option value="">— None —</option>
                {households.map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </Select>
            </Field>
            <Field label="Invitation code" hint="Also accepted on the RSVP page; used to match form imports">
              <Input value={form.invitation_code || ''} onChange={(e) => setForm({ ...form, invitation_code: e.target.value })} className="font-mono" />
            </Field>
            {householdCode[form.household_id || '']?.access_code && (
              <div className="md:col-span-2 -mt-1 text-xs text-charcoal-500">
                RSVP access code for this household: <code className="font-mono text-charcoal-800">{householdCode[form.household_id || '']?.access_code}</code>
                {householdCode[form.household_id || '']?.rsvp_link
                  ? <> · <span className="break-all">{householdCode[form.household_id || '']?.rsvp_link}</span></>
                  : null}
              </div>
            )}
            <Field label="First name *"><Input value={form.first_name || ''} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
            <Field label="Last name *"><Input value={form.last_name || ''} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{formatLabel(s)}</option>)}
              </Select>
            </Field>
            <Field label="Attendance">
              <Select value={form.attendance_type} onChange={(e) => setForm({ ...form, attendance_type: e.target.value })}>
                {ATTENDANCE.map((a) => <option key={a} value={a}>{formatLabel(a)}</option>)}
              </Select>
            </Field>
            <Field label="Dietary needs"><Input value={form.dietary_needs || ''} onChange={(e) => setForm({ ...form, dietary_needs: e.target.value })} placeholder="e.g. vegetarian, nut allergy" /></Field>
            <Field label="Accessibility / travel requests"><Input value={form.accessibility_requests || ''} onChange={(e) => setForm({ ...form, accessibility_requests: e.target.value })} /></Field>
            {!form.plus_one_of && (
              <div className="md:col-span-2">
                <label className="flex items-center gap-2 text-sm text-charcoal-700"><input type="checkbox" className="checkbox" checked={!!form.plus_one_allowed} onChange={(e) => setForm({ ...form, plus_one_allowed: e.target.checked })} /> Offer a plus-one on their RSVP</label>
                <p className="mt-1 text-xs text-charcoal-400">
                  No name needed: they add their plus-one themselves when they RSVP. The place counts in your numbers until they reply.
                  {!isNew && editing?.plus_one_name && editing?.plus_one_response !== 'declined' ? ` Bringing ${editing.plus_one_name}.` : ''}
                  {!isNew && editing?.plus_one_allowed && editing?.plus_one_response === 'declined' ? ' They said they are not bringing anyone.' : ''}
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-charcoal-700"><input type="checkbox" className="checkbox" checked={!!form.accommodation_needed} onChange={(e) => setForm({ ...form, accommodation_needed: e.target.checked })} /> Needs accommodation</label>
            <label className="flex items-center gap-2 text-sm text-charcoal-700"><input type="checkbox" className="checkbox" checked={!!form.accommodation_booked} onChange={(e) => setForm({ ...form, accommodation_booked: e.target.checked })} /> Accommodation booked</label>
            <div className="md:col-span-2">
              <Field label="Accommodation details"><Input value={form.accommodation_details || ''} onChange={(e) => setForm({ ...form, accommodation_details: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-charcoal-700"><input type="checkbox" className="checkbox" checked={!!form.gift_received} onChange={(e) => setForm({ ...form, gift_received: e.target.checked })} /> Gift received</label>
            <Field label="Gift description"><Input value={form.gift_description || ''} onChange={(e) => setForm({ ...form, gift_description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm text-charcoal-700"><input type="checkbox" className="checkbox" checked={!!form.thank_you_sent} onChange={(e) => setForm({ ...form, thank_you_sent: e.target.checked })} /> Thank-you sent</label>
            <Field label="Thank-you date"><Input type="date" value={form.thank_you_date || ''} onChange={(e) => setForm({ ...form, thank_you_date: e.target.value })} /></Field>
            <div className="md:col-span-2">
              <Field label="Tags" hint="Group guests — e.g. family, friends, evening guests. Add and colour tags on the Guest Tools page.">
                {tags.length === 0 ? (
                  <p className="text-sm text-charcoal-400">No tags yet — create some on the Guest Tools page, then tag guests here.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((t: any) => {
                      const on = formTagIds.includes(t.id);
                      return (
                        <button key={t.id} type="button" onClick={() => setFormTagIds(on ? formTagIds.filter((id) => id !== t.id) : [...formTagIds, t.id])} aria-pressed={on} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${on ? 'border-sage-500 bg-sage-50 text-sage-700' : 'border-charcoal-200 text-charcoal-500 hover:border-sage-300'}`}>
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color || '#527352' }} aria-hidden="true" />
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Notes" hint="Private to you — never shown to the guest."><Textarea rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              {editing?.rsvp_message && (
                <div className="rounded-lg border border-sage-200 bg-sage-50 px-3 py-2 text-sm text-charcoal-700">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-sage-700">Message from the guest (RSVP)</p>
                  <p className="whitespace-pre-line">{editing.rsvp_message}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Household modal */}
      <Modal
        open={!!editing && !!editing._household}
        onClose={() => setEditing(null)}
        title={editing?._new_household ? 'Add household' : 'Edit household'}
        size="md"
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveHousehold}>Save</Button></>}
      >
        <Field label="Household name *"><Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        {editing?._household && !editing?._new_household && (() => {
          const suggestion = suggestedName(editing.id);
          return suggestion && suggestion !== (form.name || '').trim() ? (
            <p className="-mt-2 mb-4 text-xs text-charcoal-500">
              From guests&rsquo; names: <span className="text-charcoal-800">{suggestion}</span>{' '}
              <button type="button" className="text-sage-700 underline underline-offset-2 hover:text-sage-800" onClick={() => setForm({ ...form, name: suggestion })}>Use this</button>
            </p>
          ) : null;
        })()}
        <Field label="Address line 1"><Input value={form.address_line1 || ''} onChange={(e) => setForm({ ...form, address_line1: e.target.value })} /></Field>
        <Field label="Address line 2"><Input value={form.address_line2 || ''} onChange={(e) => setForm({ ...form, address_line2: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="City"><Input value={form.city || ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="Postcode"><Input value={form.postcode || ''} onChange={(e) => setForm({ ...form, postcode: e.target.value })} /></Field>
          <Field label="Country"><Input value={form.country || ''} onChange={(e) => setForm({ ...form, country: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Textarea rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </Modal>

      {/* Name every household from its guests */}
      <Modal
        open={!!renames}
        onClose={() => setRenames(null)}
        title="Name households from guests"
        size="md"
        footer={<>
          <Button variant="ghost" onClick={() => setRenames(null)}>Cancel</Button>
          <Button loading={renaming} disabled={!(renames || []).some((r) => r.apply)} onClick={applyRenames}>
            Rename {(renames || []).filter((r) => r.apply).length}
          </Button>
        </>}
      >
        <p className="text-sm text-charcoal-600 mb-3">
          Untick any household whose current name you&rsquo;d rather keep. Plus-ones aren&rsquo;t included in the name.
        </p>
        <ul className="divide-y divide-charcoal-100">
          {(renames || []).map((r) => (
            <li key={r.id}>
              <label className="flex items-start gap-3 py-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={r.apply}
                  onChange={(e) => setRenames((prev) => (prev || []).map((x) => (x.id === r.id ? { ...x, apply: e.target.checked } : x)))}
                />
                <span>
                  <span className="text-charcoal-400 line-through">{r.from}</span>
                  <span className="block text-charcoal-800">{r.to}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={doDelete}
        title={deletingKind === 'guest' ? 'Delete this guest?' : 'Delete this household?'}
        message={deletingKind === 'household' ? 'Guests in this household will keep their records but lose the link.' : 'This guest will be removed from the list, seating and counts.'}
      />
    </div>
  );
}

