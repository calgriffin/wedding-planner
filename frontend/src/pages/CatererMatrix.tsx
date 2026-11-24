/**
 * Caterer matrix: one printable sheet of every guest's meal, dietary needs and
 * contact details, grouped by their seated table (unseated guests fall back to
 * their household). This is the "dietary sheet" venues and caterers ask for
 * 4-6 weeks out — Print/PDF or download the CSV and send it straight over.
 *
 * Everything shown is live guest data already captured via the RSVP portal.
 * Read-only: this page never writes anything.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api, MatrixGuest } from '../api/client';
import { PageHeader, Card, Button, StatCard, Spinner, EmptyState } from '../components/ui';

interface MatrixData {
  groups: Array<{ key: string; label: string; guests: MatrixGuest[] }>;
  guests: MatrixGuest[];
  summary: {
    total: number;
    attending: number;
    with_dietary: number;
    with_contact: number;
    seated: number;
    meals: Record<string, number>;
  };
}

const mealLabel = (o: string) =>
  o ? o.charAt(0).toUpperCase() + o.slice(1).replace(/[-_]/g, ' ') : 'TBC';

function csvCell(value: string) {
  const v = (value || '').replace(/"/g, '""');
  return /[",\n]/.test(v) ? `"${v}"` : v;
}

export default function CatererMatrixPage() {
  const { showToast } = useApp();
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [attendingOnly, setAttendingOnly] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.guest.dietaryMatrix());
    } catch (e: any) {
      showToast(e.message || 'Failed to load the caterer matrix', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    return data.groups
      .map((g) => ({ ...g, guests: attendingOnly ? g.guests.filter((x) => x.attending) : g.guests }))
      .filter((g) => g.guests.length > 0);
  }, [data, attendingOnly]);

  const visible = useMemo(() => groups.reduce((n, g) => n + g.guests.length, 0), [groups]);

  const downloadCsv = () => {
    const header = ['Table', 'Seat', 'Guest', 'Household', 'Attending', 'Meal', 'Dietary requirements', 'Email', 'Mobile'];
    const rows = groups.flatMap((g) =>
      g.guests.map((guest) => [
        g.label,
        guest.seat_number == null ? '' : String(guest.seat_number),
        guest.name,
        guest.household_name,
        guest.attending ? 'Yes' : 'No',
        mealLabel(guest.meal),
        guest.dietary,
        guest.email,
        guest.phone,
      ])
    );
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'caterer-dietary-matrix.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!data || data.guests.length === 0) {
    return (
      <>
        <PageHeader title="Caterer matrix" subtitle="Meals, dietary requirements and contact details in one printable sheet" />
        <EmptyState
          title="No guests yet"
          message="Once guests are added to your plan they'll appear here grouped by table, ready to print or export."
        />
      </>
    );
  }

  const s = data.summary;

  return (
    <>
      <PageHeader
        title="Caterer matrix"
        subtitle="Meals, dietary requirements and contact details in one printable sheet"
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!visible}>
              Download CSV
            </Button>
            <Button variant="primary" size="sm" onClick={() => window.print()} disabled={!visible}>
              Print / Save as PDF
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 print:hidden">
        <StatCard label="Attending" value={s.attending} hint={`of ${s.total} guests`} />
        <StatCard label="Dietary needs" value={s.with_dietary} hint="attending, with notes" tone={s.with_dietary ? 'warning' : 'default'} />
        <StatCard label="Contact on file" value={s.with_contact} hint="attending, email or mobile" />
        <StatCard label="Seated" value={s.seated} hint="assigned to a table" />
      </div>

      <Card
        className="mb-6"
        title="Meal breakdown"
        subtitle="Across attending guests — a quick sanity check against your final numbers."
      >
        <div className="flex flex-wrap gap-2">
          {Object.entries(s.meals)
            .sort((a, b) => b[1] - a[1])
            .map(([meal, n]) => (
              <span
                key={meal}
                className="inline-flex items-center gap-1.5 rounded-full border border-charcoal-200 bg-white px-3 py-1 text-sm text-charcoal-700"
              >
                {mealLabel(meal)} <span className="font-semibold text-sage-700">{n}</span>
              </span>
            ))}
        </div>
      </Card>

      <div className="flex items-center justify-between mb-4 print:hidden">
        <label className="flex items-center gap-2 text-sm text-charcoal-600 cursor-pointer">
          <input
            type="checkbox"
            checked={attendingOnly}
            onChange={(e) => setAttendingOnly(e.target.checked)}
            className="rounded border-charcoal-300"
          />
          Only show guests who are attending
        </label>
        <span className="text-xs text-charcoal-400">
          {visible} guest{visible === 1 ? '' : 's'} on this sheet
        </span>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Nothing to show"
          message="No guests match this filter yet. Turn off 'only attending' to see everyone on the list."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <Card key={group.key} className="break-inside-avoid">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-serif text-xl">{group.label}</h2>
                <span className="text-xs text-charcoal-400">
                  {group.guests.length} guest{group.guests.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-charcoal-200 text-left">
                      <th className="py-2 pr-3 font-semibold text-charcoal-500 w-10">Seat</th>
                      <th className="py-2 pr-3 font-semibold text-charcoal-500">Guest</th>
                      <th className="py-2 pr-3 font-semibold text-charcoal-500 w-28">Meal</th>
                      <th className="py-2 pr-3 font-semibold text-charcoal-500">Dietary requirements</th>
                      <th className="py-2 font-semibold text-charcoal-500 w-48 print:hidden">Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.guests.map((guest) => (
                      <tr key={guest.id} className="border-b border-charcoal-100 last:border-0 align-top">
                        <td className="py-2 pr-3 text-charcoal-400">
                          {guest.seat_number == null ? '—' : guest.seat_number}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="font-medium text-charcoal-900">{guest.name}</span>
                          {!guest.attending && (
                            <span className="ml-2 text-xs text-charcoal-400">not attending</span>
                          )}
                          {guest.household_name && (
                            <span className="block text-xs text-charcoal-400">{guest.household_name}</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-charcoal-700">{mealLabel(guest.meal)}</td>
                        <td className="py-2 pr-3 text-amber-800 whitespace-pre-line">
                          {guest.dietary || <span className="text-charcoal-300">—</span>}
                        </td>
                        <td className="py-2 text-charcoal-500 print:hidden">
                          {guest.email && <div className="truncate">{guest.email}</div>}
                          {guest.phone && <div className="truncate">{guest.phone}</div>}
                          {!guest.email && !guest.phone && <span className="text-charcoal-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-charcoal-400 mt-6 print:hidden">
        Free-text dietary notes appear exactly as the guest wrote them. Review them with your caterer 4–6 weeks
        before the wedding — anything ambiguous is worth a quick phone call.
      </p>
    </>
  );
}
