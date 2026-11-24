/**
 * RSVP Inbox: import responses from the RSVP form export, review matches,
 * and apply responses to guest records. Imports are flagged, never silently
 * overwritten.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api/client';
import {
  PageHeader, Card, Badge, statusTone, formatLabel, Button, Modal, Field, Textarea, Select, Spinner, EmptyState, Tabs, ConfirmDialog,
} from '../components/ui';
import { formatDateTime } from '../utils/helpers';

export default function RsvpPage() {
  const { showToast } = useApp();
  const [entries, setEntries] = useState<any[] | null>(null);
  const [guests, setGuests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<any[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [matchSel, setMatchSel] = useState<Record<string, string>>({});
  const [bulkConfirm, setBulkConfirm] = useState<{ action: 'accepted' | 'rejected'; label: string; ids: string[] } | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrSheet, setQrSheet] = useState<any[]>([]);
  const [qrLoading, setQrLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [r, g] = await Promise.all([api.rsvp.list(), api.guests.list()]);
      setEntries(r || []);
      setGuests(g || []);
    } catch (e: any) {
      showToast(e.message || 'Failed to load RSVP inbox', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const openQrSheet = async () => {
    setQrLoading(true);
    try {
      const res = await api.rsvp.qrSheet();
      setQrSheet(res?.households || []);
      setQrOpen(true);
    } catch (e: any) {
      showToast(e.message || 'Could not load household codes', 'error');
    } finally {
      setQrLoading(false);
    }
  };

  const printQrSheet = () => {
    setQrOpen(false); // the modal portal must be gone before body class + print
    document.body.classList.add('print-qr-sheet');
    const cleanup = () => document.body.classList.remove('print-qr-sheet');
    window.addEventListener('afterprint', cleanup, { once: true });
    setTimeout(() => window.print(), 150);
    setTimeout(cleanup, 3500);
  };

  const guestById = useMemo(() => {
    const m: Record<string, any> = {};
    (guests || []).forEach((g) => { m[g.id] = g; });
    return m;
  }, [guests]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (entries || []).forEach((e) => {
      c[e.review_status] = (c[e.review_status] || 0) + 1;
      if (e.match_status) c[`match_${e.match_status}`] = (c[`match_${e.match_status}`] || 0) + 1;
    });
    return c;
  }, [entries]);

  const filtered = useMemo(() => {
    const list = entries || [];
    if (tab === 'pending') return list.filter((e) => e.review_status === 'pending');
    if (tab === 'flagged') return list.filter((e) => e.review_status === 'flagged' || e.match_status === 'conflict' || e.match_status === 'duplicate');
    if (tab === 'accepted') return list.filter((e) => e.review_status === 'accepted');
    return list;
  }, [entries, tab]);

  // ---------------- Import (paste from form export) ----------------
  const autoDetect = (headers: string[]) => {
    const map: Record<string, number> = {};
    headers.forEach((h, i) => {
      const hl = h.toLowerCase();
      if (!map.code && /^(invitation|invite|rsvp)\s*(code)?|invitation code/.test(hl) || (!map.code && /\bcode\b/.test(hl) && !/postcode|zip/.test(hl))) map.code = i;
      if (!map.name && /(full\s*name|guest\s*name|your\s*name|attendee|name)/.test(hl) && !/code|venue/.test(hl)) map.name = i;
      if (!map.attendance && /(attend|coming|rsvp|response|glyfwn|will you)/.test(hl)) map.attendance = i;
      if (!map.dietary && /(diet|allerg)/.test(hl)) map.dietary = i;
      if (!map.access && /(access|mobility|disabilit)/.test(hl)) map.access = i;
      if (!map.travel && /(travel|transport|taxi)/.test(hl)) map.travel = i;
      if (!map.email && /email/.test(hl)) map.email = i;
      if (!map.submitted && /(start time|submitted|timestamp|completion|date)/.test(hl)) map.submitted = i;
    });
    return map;
  };

  const parseCsv = (text: string) => {
    const lines: string[][] = [];
    let cur = '';
    let inQuotes = false;
    const row: string[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cur); cur = '';
      } else if (ch === '\n') {
        row.push(cur); cur = '';
        if (row.some((c) => c.trim() !== '')) lines.push(row);
        row.length = 0;
      } else {
        cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); if (row.some((c) => c.trim() !== '')) lines.push(row); }
    return lines;
  };

  const normalizeAttendance = (v: string): string => {
    const s = String(v || '').trim().toLowerCase();
    if (/^(yes|y|coming|will\s*attend|attend|attending|definitely|day|both|wedding)/.test(s)) return 'yes';
    if (/^(no|n|cannot|can't|unable|decline|declined|not)/.test(s)) return 'no';
    if (/^evening|night|evening\s*only|night\s*only/.test(s)) return 'evening_only';
    return String(v || '').trim();
  };

  const parseImport = () => {
    const lines = parseCsv(csvText);
    if (lines.length < 2) { showToast('Paste at least a header row and one response row.', 'error'); return; }
    const headers = lines[0].map((h) => h.trim());
    const map = autoDetect(headers);
    if (map.code === undefined || map.name === undefined) {
      showToast('Could not find invitation code and name columns. Check the header row.', 'error');
      return;
    }
    const rows = lines.slice(1).map((cells) => ({
      invitation_code: (cells[map.code] || '').trim(),
      guest_name: (cells[map.name] || '').trim(),
      attendance: normalizeAttendance(cells[map.attendance] ?? ''),
      dietary_needs: (cells[map.dietary] || '').trim(),
      accessibility_requests: (cells[map.access] || '').trim(),
      travel_requests: (cells[map.travel] || '').trim(),
      submitted_at: (cells[map.submitted] || '').trim(),
      email: (cells[map.email] || '').trim(),
    })).filter((r) => r.invitation_code || r.guest_name);
    if (rows.length === 0) { showToast('No recognizable responses in the pasted data.', 'error'); return; }
    setParsed(rows);
  };

  const runImport = async () => {
    if (!parsed) return;
    setImporting(true);
    try {
      const res = await api.rsvp.import(parsed.map(({ email, ...r }) => r));
      const unmatched = res.results.filter((x: any) => x.match_status === 'unmatched').length;
      const matched = res.results.filter((x: any) => x.match_status === 'matched').length;
      const duplicates = res.results.filter((x: any) => x.match_status === 'duplicate' || x.match_status === 'conflict').length;
      showToast(
        `Imported ${res.imported} responses — ${matched} matched, ${unmatched} unmatched, ${duplicates} flagged for review. Nothing was overwritten.`,
        duplicates > 0 || unmatched > 0 ? 'error' : 'success'
      );
      setImportOpen(false); setCsvText(''); setParsed(null);
      load();
    } catch (e: any) {
      showToast(e.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  // ---------------- Review actions ----------------
  const matchGuest = async (entryId: string, guestId: string) => {
    try {
      await api.rsvp.match(entryId, guestId);
      showToast('Response matched to guest', 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const review = async (entry: any, action: 'accepted' | 'rejected' | 'flagged') => {
    try {
      await api.rsvp.review(entry.id, action);
      showToast(action === 'accepted' ? 'Applied to guest record' : action === 'rejected' ? 'Response rejected' : 'Marked for follow-up', 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
  };

  const runBulk = async () => {
    if (!bulkConfirm) return;
    try {
      const res = await api.rsvp.bulkReview(bulkConfirm.ids, bulkConfirm.action);
      showToast(`${res.reviewed} responses ${bulkConfirm.action === 'accepted' ? 'applied' : 'rejected'}`, 'success');
      load();
    } catch (e: any) { showToast(e.message, 'error'); }
    setBulkConfirm(null);
  };

  const pendingMatched = (entries || []).filter((e) => e.review_status === 'pending' && e.matched_guest_id);
  const unmatchedPending = (entries || []).filter((e) => e.review_status === 'pending' && !e.matched_guest_id && e.match_status === 'unmatched');

  if (loading && !entries) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  return (
    <div>
      <PageHeader
        title="RSVP Inbox"
        subtitle="Paste the export from your RSVP form (e.g. Microsoft Forms). Responses are matched to guests by invitation code or name and reviewed here before anything is applied."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.open('/api/export/guests', '_blank')}>Guest list CSV</Button>
            <Button variant="outline" size="sm" onClick={openQrSheet} loading={qrLoading}>Household codes</Button>
            <Button onClick={() => setImportOpen(true)}>+ Import responses</Button>
          </>
        }
      />

      {/* Printable access-code sheet — shown only via print (see index.css: body.print-qr-sheet) */}
      <div id="print-qr-sheet" className="hidden">
        <div className="print-title">Household access codes</div>
        <div className="print-sub">Printed {new Date().toLocaleDateString()} — RSVP links and codes per household</div>
        {qrSheet.map((h: any) => (
          <div key={h.household_id} className="print-code-row">
            <span className="print-code-name">{h.household_name}</span>
            <code className="print-code">{h.access_code}</code>
            <span className="print-code-payload">{h.rsvp_link}</span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Stat label="Pending review" value={counts.pending || 0} tone={(counts.pending || 0) > 0 ? 'warning' : 'default'} />
        <Stat label="Flagged" value={counts.flagged || 0} tone={(counts.flagged || 0) > 0 ? 'danger' : 'default'} />
        <Stat label="Matched" value={(counts.match_matched || 0)} tone="success" />
        <Stat label="Unmatched" value={(counts.match_unmatched || 0)} tone={(counts.match_unmatched || 0) > 0 ? 'danger' : 'default'} />
        <Stat label="Accepted" value={counts.accepted || 0} tone="default" />
      </div>

      <Tabs
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'pending', label: 'Pending', count: counts.pending || 0 },
          { id: 'flagged', label: 'Flagged', count: (counts.flagged || 0) + (counts.conflict || 0) + (counts.duplicate || 0) },
          { id: 'accepted', label: 'Applied', count: counts.accepted || 0 },
          { id: 'all', label: 'All', count: entries?.length || 0 },
        ]}
      />

      <Card>
        <div className="px-5 py-3 border-b border-charcoal-100 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-charcoal-500">
            {filtered.length} response{filtered.length === 1 ? '' : 's'} in this view
          </p>
          <div className="flex gap-2 flex-wrap">
            {tab === 'pending' && pendingMatched.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setBulkConfirm({ action: 'accepted', label: 'Apply', ids: pendingMatched.map((e) => e.id) })}>
                Apply {pendingMatched.length} matched
              </Button>
            )}
            {tab === 'pending' && unmatchedPending.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setBulkConfirm({ action: 'rejected', label: 'Reject', ids: unmatchedPending.map((e) => e.id) })}>
                Reject {unmatchedPending.length} unmatched
              </Button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={tab === 'pending' ? 'Nothing waiting' : 'No responses here'}
            message="Import responses from your RSVP form export to see them here, with matches flagged for review."
            action={<Button size="sm" onClick={() => setImportOpen(true)}>+ Import responses</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Response</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Code</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Details</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Match</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Status</th>
                  <th className="text-right px-5 py-3 text-xs uppercase tracking-wide text-charcoal-400 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e: any) => {
                  const matched = e.matched_guest_id ? guestById[e.matched_guest_id] : null;
                  const isPending = e.review_status === 'pending';
                  return (
                    <tr key={e.id} className="border-t border-charcoal-100 hover:bg-ivory-50 align-top">
                      <td className="px-5 py-3">
                        <p className="font-medium text-charcoal-800">{e.guest_name}</p>
                        <p className="text-xs text-charcoal-400">{formatDateTime(e.submitted_at)}</p>
                        <div className="mt-1">
                          <Badge tone={e.attendance === 'no' ? 'danger' : e.attendance === 'evening_only' ? 'warning' : 'success'}>
                            {formatAttendance(e.attendance)}
                          </Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {e.invitation_code ? <Badge tone="sage" className="font-mono">{e.invitation_code}</Badge> : <span className="text-charcoal-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-charcoal-600">
                        {e.dietary_needs && <p className="text-amber-700"><span className="font-semibold">Diet:</span> {e.dietary_needs}</p>}
                        {e.accessibility_requests && <p><span className="font-semibold">Access:</span> {e.accessibility_requests}</p>}
                        {e.travel_requests && <p><span className="font-semibold">Travel:</span> {e.travel_requests}</p>}
                        {!e.dietary_needs && !e.accessibility_requests && !e.travel_requests && <span className="text-charcoal-300">no extras</span>}
                      </td>
                      <td className="px-4 py-3">
                        {matched ? (
                          <div>
                            <p className="text-charcoal-700 font-medium text-xs">{matched.first_name} {matched.last_name}</p>
                            <Badge tone={e.match_status === 'matched' ? 'success' : 'warning'}>{formatLabel(e.match_status)}</Badge>
                          </div>
                        ) : isPending ? (
                          <Select
                            value={matchSel[e.id] || ''}
                            onChange={(ev) => { if (ev.target.value) matchGuest(e.id, ev.target.value); }}
                            className="text-xs py-1"
                          >
                            <option value="">Match to…</option>
                            {guests.map((g: any) => (
                              <option key={g.id} value={g.id}>{g.first_name} {g.last_name}</option>
                            ))}
                          </Select>
                        ) : (
                          <span className="text-xs text-charcoal-400">not applied</span>
                        )}
                        {e.match_status === 'duplicate' && <p className="text-xs text-amber-700 mt-1">ambiguous match</p>}
                        {e.match_status === 'conflict' && <p className="text-xs text-red-600 mt-1">conflict</p>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          <Badge tone={statusTone(e.review_status)}>{formatLabel(e.review_status)}</Badge>
                          {e.match_status === 'unmatched' && <Badge tone="danger">unmatched</Badge>}
                          {e.notes && <p className="text-[10px] text-charcoal-400 max-w-[160px] whitespace-pre-wrap">{e.notes}</p>}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {isPending && !matched && (
                          <Button size="sm" variant="ghost" onClick={() => review(e, 'rejected')}>Reject</Button>
                        )}
                        {isPending && (
                          <Button
                            size="sm"
                            variant={matched ? 'primary' : 'ghost'}
                            disabled={!matched}
                            onClick={() => matched && review(e, 'accepted')}
                            title={matched ? 'Apply to guest record' : 'Match to a guest first'}
                          >
                            Apply
                          </Button>
                        )}
                        {isPending && (
                          <Button size="sm" variant="ghost" onClick={() => review(e, 'flagged')} className="text-amber-700 hover:bg-amber-50">Flag</Button>
                        )}
                        {!isPending && (
                          <Button size="sm" variant="ghost" onClick={() => review(e, 'pending' as any)}>Reopen</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Import modal */}
      <Modal
        open={importOpen}
        onClose={() => { setImportOpen(false); setParsed(null); setCsvText(''); }}
        title="Import RSVP responses"
        size="lg"
        footer={
          parsed ? (
            <>
              <Button variant="ghost" onClick={() => setParsed(null)}>Back</Button>
              <Button onClick={runImport} loading={importing}>Import {parsed.length} responses</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button onClick={parseImport}>Preview & check</Button>
            </>
          )
        }
      >
        {!parsed ? (
          <div className="space-y-4">
            <div className="bg-ivory-100 border border-charcoal-200 rounded-lg px-4 py-3 text-sm text-charcoal-600 space-y-1">
              <p><strong>How to:</strong></p>
              <ol className="list-decimal list-inside space-y-0.5 text-xs">
                <li>Open your RSVP form's Excel/CSV export (e.g. Microsoft Forms → Responses → Export).</li>
                <li>Copy all rows including the header row.</li>
                <li>Paste below. Columns for invitation code and guest name are required; attendance, dietary, accessibility, travel and submission time are detected automatically.</li>
              </ol>
            </div>
            <Field label="Paste the exported spreadsheet (CSV)">
              <Textarea
                rows={10}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={'Start time,Invitation code,Name,Will you be attending?,Dietary requirements\n2026-06-01 10:00,AB12-CD34,Jane Smith,Yes,Vegetarian\n2026-06-02 09:15,CD34-EF56,John Doe,Evening only,'}
                className="font-mono text-xs"
              />
            </Field>
            <p className="text-xs text-charcoal-400">
              Matches are made by invitation code first, then by full name. Ambiguous or repeated codes are flagged
              for review. <strong>Nothing is ever silently overwritten.</strong>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-charcoal-600">
              <strong>{parsed.length} responses</strong> ready to import. They will be staged with match status
              (matched / unmatched / flagged) and stay pending until you apply them.
            </p>
            <div className="overflow-x-auto max-h-72 overflow-y-auto scrollbar-thin border border-charcoal-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-ivory-100">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-charcoal-500">Code</th>
                    <th className="text-left px-3 py-2 font-semibold text-charcoal-500">Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-charcoal-500">Attendance</th>
                    <th className="text-left px-3 py-2 font-semibold text-charcoal-500">Dietary</th>
                    <th className="text-left px-3 py-2 font-semibold text-charcoal-500">Accessibility</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((r, i) => (
                    <tr key={i} className="border-t border-charcoal-100">
                      <td className="px-3 py-1.5 font-mono">{r.invitation_code || '—'}</td>
                      <td className="px-3 py-1.5">{r.guest_name}</td>
                      <td className="px-3 py-1.5">{r.attendance}</td>
                      <td className="px-3 py-1.5 text-amber-700">{r.dietary_needs || ''}</td>
                      <td className="px-3 py-1.5">{r.accessibility_requests || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!bulkConfirm}
        onClose={() => setBulkConfirm(null)}
        onConfirm={runBulk}
        title={bulkConfirm ? `${bulkConfirm.label} ${bulkConfirm.ids.length} responses?` : ''}
        message={bulkConfirm?.action === 'accepted'
          ? 'Matched responses will update guest records (attendance, dietary and accessibility). Only already-matched, pending responses are included.'
          : 'Unmatched responses will be marked rejected. They will not touch any guest record.'}
        confirmLabel={bulkConfirm?.action === 'accepted' ? 'Apply all' : 'Reject all'}
        danger={bulkConfirm?.action === 'rejected'}
      />

      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Household access codes"
        size="lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setQrOpen(false)}>Close</Button>
            <Button size="sm" onClick={printQrSheet}>Print sheet</Button>
          </>
        }
      >
        <p className="text-sm text-charcoal-500 mb-4">Each household has a short access code for the RSVP page. Share the link with the household, or print this sheet for the venue / door.</p>
        {qrSheet.length === 0 ? (
          <p className="text-sm text-charcoal-400">No households with codes yet — codes are generated when a household sheet is opened or a code is assigned.</p>
        ) : (
          <div className="overflow-y-auto max-h-96 rounded-lg border border-charcoal-100 divide-y divide-charcoal-100">
            {qrSheet.map((h: any) => (
              <div key={h.household_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-charcoal-900 truncate">{h.household_name}</p>
                  <p className="text-xs text-charcoal-400">
                    {h.guest_count} guest{h.guest_count === 1 ? '' : 's'}
                    {h.confirmed_count ? ` · ${h.confirmed_count} confirmed` : ''}
                    {h.declined_count ? ` · ${h.declined_count} declined` : ''}
                  </p>
                  <p className="text-xs text-charcoal-500 mt-0.5 break-all">{h.rsvp_link}</p>
                </div>
                <code className="shrink-0 rounded bg-ivory-200 px-2.5 py-1 text-sm font-mono text-charcoal-900">{h.access_code}</code>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'default' | 'success' | 'danger' | 'warning' }) {
  const color = tone === 'danger' ? 'text-red-600' : tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-sage-600' : 'text-charcoal-900';
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold font-serif ${color}`}>{value}</p>
    </Card>
  );
}

function formatAttendance(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v).toLowerCase();
  if (s === 'yes' || s === 'y') return 'Attending';
  if (s === 'no' || s === 'n') return 'Not attending';
  if (s === 'evening_only' || /evening/.test(s)) return 'Evening only';
  return String(v);
}