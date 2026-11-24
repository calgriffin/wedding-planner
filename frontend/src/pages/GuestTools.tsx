import React, { useState, useEffect } from 'react';
import { Card, Button, Field, Spinner, ConfirmDialog } from '../components/ui';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { siteHost } from '../utils/site';

const QUESTION_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'radio', label: 'Radio choice' },
  { value: 'checkbox', label: 'Checkbox' },
];

const DEMO_SITES = [
  {
    host: siteHost('v1'),
    mode: 'Teaser',
    description: 'The \u201cComing soon\u201d page: couple names, an animated wreath, nothing else.',
  },
  {
    host: siteHost('v2'),
    mode: 'Countdown',
    description: 'Countdown to the wedding day. Some couple details shown.',
  },
  {
    host: siteHost('v3'),
    mode: 'RSVP',
    description: 'The full guest portal: access code + RSVP with your custom questions.',
  },
];

const LIVE_MODES = [
  { value: 'teaser' as const, label: 'Teaser (v1)', description: 'A \u201cComing soon\u201d page with your names and an animated wreath. No date, venue, or RSVP shown.' },
  { value: 'countdown' as const, label: 'Countdown (v2)', description: 'Shows the countdown to the wedding day, while keeping RSVP private.' },
  { value: 'rsvp' as const, label: 'RSVP (v3)', description: 'Shows the guest access-code and RSVP journey.' },
  { value: 'weddingday' as const, label: 'Wedding Day (v4)', description: '\u201cToday\u2019s the day\u201d page with your date and venues. Takes over automatically on the wedding day.' },
  { value: 'thankyou' as const, label: 'Thank You (v5)', description: 'A post-wedding \u201cThank you\u201d page. Takes over automatically the day after the wedding.' },
];

type LiveMode = 'teaser' | 'countdown' | 'rsvp' | 'weddingday' | 'thankyou';
type LiveAtKey = 'teaser_live_at' | 'countdown_live_at' | 'rsvp_live_at' | 'weddingday_live_at' | 'thankyou_live_at';

const MODE_KEYS: { mode: LiveMode; key: LiveAtKey }[] = [
  { mode: 'teaser', key: 'teaser_live_at' },
  { mode: 'countdown', key: 'countdown_live_at' },
  { mode: 'rsvp', key: 'rsvp_live_at' },
  { mode: 'weddingday', key: 'weddingday_live_at' },
  { mode: 'thankyou', key: 'thankyou_live_at' },
];

const EMPTY_DATES: Record<LiveAtKey, string> = { teaser_live_at: '', countdown_live_at: '', rsvp_live_at: '', weddingday_live_at: '', thankyou_live_at: '' };

// ISO timestamp <-> <input type="datetime-local"> value (local time).
function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export default function GuestToolsPage() {
  const { showToast } = useApp();
  // --- Guest tags ---
  const [tags, setTags] = useState<any[]>([]);
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#527352');
  const [deletingTag, setDeletingTag] = useState<any | null>(null);
  const [savingTag, setSavingTag] = useState(false);
  // --- RSVP window ---
  const [rsvpOpen, setRsvpOpen] = useState(false);
  const [rsvpOpensAt, setRsvpOpensAt] = useState('');
  const [rsvpClosesAt, setRsvpClosesAt] = useState('');
  const [savingWindow, setSavingWindow] = useState(false);
  // --- Reminders ---
  const [reminders, setReminders] = useState<{ log: any[]; pending: any[] } | null>(null);
  const [sendingReminders, setSendingReminders] = useState(false);
  // --- Custom questions ---
  const [questions, setQuestions] = useState<any[]>([]);
  const [qForm, setQForm] = useState({ question: '', field_type: 'text', optionsText: '', required: false });
  const [deletingQuestion, setDeletingQuestion] = useState<any | null>(null);
  const [savingQuestion, setSavingQuestion] = useState(false);
  const [liveMode, setLiveMode] = useState<LiveMode | null>(null);
  const [fallbackMode, setFallbackMode] = useState<LiveMode>('countdown');
  const [draftDates, setDraftDates] = useState<Record<LiveAtKey, string>>(EMPTY_DATES);
  const [savingLiveMode, setSavingLiveMode] = useState(false);
  const [savingDates, setSavingDates] = useState(false);

  useEffect(() => {
    api.rsvp.window()
      .then((data) => {
        setLiveMode(data.live_mode || data.guest_mode || 'countdown');
        setFallbackMode(data.guest_mode || 'countdown');
        setDraftDates({
          teaser_live_at: toLocalInput(data.teaser_live_at),
          countdown_live_at: toLocalInput(data.countdown_live_at),
          rsvp_live_at: toLocalInput(data.rsvp_live_at),
          weddingday_live_at: toLocalInput(data.weddingday_live_at),
          thankyou_live_at: toLocalInput(data.thankyou_live_at),
        });
      setRsvpOpen(!!data.rsvp_open);
        setRsvpOpensAt(toLocalInput(data.rsvp_opens_at || ''));
        setRsvpClosesAt(toLocalInput(data.rsvp_closes_at || ''));
      })
      .catch(() => showToast('Could not load the live guest-site setting.', 'error'));
  }, [showToast]);

  useEffect(() => {
    api.guestTags.list().then(setTags).catch(() => showToast('Could not load guest tags.', 'error'));
    api.guestTags.assignments()
      .then((rows: any[]) => {
        const counts: Record<string, number> = {};
        (rows || []).forEach((r) => { counts[r.tag_id] = (counts[r.tag_id] || 0) + 1; });
        setTagCounts(counts);
      })
      .catch(() => {});
    api.rsvp.reminders.list().then(setReminders).catch(() => {});
    api.rsvp.questions.list().then((rows: any[]) => setQuestions(rows || [])).catch(() => showToast('Could not load custom questions.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTag = async () => {
    const name = newTagName.trim();
    if (!name || savingTag) return;
    setSavingTag(true);
    try {
      const created = await api.guestTags.create({ name, color: newTagColor });
      setTags((prev) => [...prev, created].sort((a, b) => String(a.name).localeCompare(String(b.name))));
      setNewTagName('');
      showToast(`Tag "${name}" added.`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not add the tag.', 'error');
    } finally {
      setSavingTag(false);
    }
  };

  const deleteTag = async () => {
    if (!deletingTag) return;
    try {
      await api.guestTags.remove(deletingTag.id);
      setTags((prev) => prev.filter((t) => t.id !== deletingTag.id));
      showToast(`Tag "${deletingTag.name}" removed.`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not remove the tag.', 'error');
    } finally {
      setDeletingTag(null);
    }
  };

  const saveRsvpWindow = async () => {
    if (savingWindow) return;
    setSavingWindow(true);
    try {
      const res = await api.rsvp.updateWindow({
        rsvp_opens_at: fromLocalInput(rsvpOpensAt),
        rsvp_closes_at: fromLocalInput(rsvpClosesAt),
      });
      setRsvpOpen(!!res.rsvp_open);
      setRsvpOpensAt(toLocalInput(res.rsvp_opens_at || ''));
      setRsvpClosesAt(toLocalInput(res.rsvp_closes_at || ''));
      showToast('RSVP dates saved.', 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not save the RSVP window.', 'error');
    } finally {
      setSavingWindow(false);
    }
  };

  const sendReminders = async () => {
    if (sendingReminders || !reminders || !reminders.pending.length) return;
    setSendingReminders(true);
    try {
      const res = await api.rsvp.reminders.send(reminders.pending.map((p: any) => p.household_id));
      const fresh = await api.rsvp.reminders.list();
      setReminders(fresh);
      const emailedNote = res.emailed ? ` Emailed ${res.emailed.sent}/${res.emailed.attempted}.` : '';
      showToast(`Reminder logged for ${res.count} household${res.count === 1 ? '' : 's'}.${emailedNote}`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not send reminders.', 'error');
    } finally {
      setSendingReminders(false);
    }
  };

  const needsOptions = qForm.field_type === 'select' || qForm.field_type === 'radio' || qForm.field_type === 'checkbox';

  const addQuestion = async () => {
    const text = qForm.question.trim();
    if (!text || savingQuestion) return;
    setSavingQuestion(true);
    try {
      await api.rsvp.questions.create({
        question: text,
        field_type: qForm.field_type,
        options: needsOptions ? qForm.optionsText.split(/\s*,\s*|\n+/).map((s) => s.trim()).filter(Boolean) : [],
        required: qForm.required,
        order_index: questions.length,
      });
      const fresh = await api.rsvp.questions.list();
      setQuestions(fresh);
      setQForm({ question: '', field_type: 'text', optionsText: '', required: false });
      showToast('Question added — it now appears in the guest RSVP form.', 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not add the question.', 'error');
    } finally {
      setSavingQuestion(false);
    }
  };

  const deleteQuestion = async () => {
    if (!deletingQuestion) return;
    try {
      await api.rsvp.questions.remove(deletingQuestion.id);
      setQuestions((prev) => prev.filter((q) => q.id !== deletingQuestion.id));
      showToast('Question removed.', 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not remove the question.', 'error');
    } finally {
      setDeletingQuestion(null);
    }
  };

  const applyWindow = (data: {
    guest_mode: LiveMode;
    live_mode: LiveMode;
    teaser_live_at: string;
    countdown_live_at: string;
    rsvp_live_at: string;
    weddingday_live_at: string;
    thankyou_live_at: string;
  }) => {
    setLiveMode(data.live_mode || data.guest_mode || 'countdown');
    setFallbackMode(data.guest_mode || 'countdown');
    setDraftDates({
      teaser_live_at: toLocalInput(data.teaser_live_at),
      countdown_live_at: toLocalInput(data.countdown_live_at),
      rsvp_live_at: toLocalInput(data.rsvp_live_at),
      weddingday_live_at: toLocalInput(data.weddingday_live_at),
      thankyou_live_at: toLocalInput(data.thankyou_live_at),
    });
  };

  const selectLiveMode = async (mode: LiveMode) => {
    if (savingLiveMode) return;
    setSavingLiveMode(true);
    try {
      const res = await api.rsvp.updateWindow({ guest_mode: mode });
      applyWindow(res);
      const liveLabel = LIVE_MODES.find((m) => m.value === res.live_mode)?.label;
      if (res.live_mode === mode) {
        showToast(`${liveLabel} is live at ${siteHost()}.`, 'success');
      } else {
        showToast(`Set as fallback — ${liveLabel} is live until its scheduled go-live.`, 'success');
      }
    } catch (e: any) {
      showToast(e.message || 'Could not change the live guest site.', 'error');
    } finally {
      setSavingLiveMode(false);
    }
  };

  const saveGoLiveDates = async () => {
    if (savingDates) return;
    setSavingDates(true);
    try {
      const res = await api.rsvp.updateWindow({
        teaser_live_at: fromLocalInput(draftDates.teaser_live_at),
        countdown_live_at: fromLocalInput(draftDates.countdown_live_at),
        rsvp_live_at: fromLocalInput(draftDates.rsvp_live_at),
        weddingday_live_at: fromLocalInput(draftDates.weddingday_live_at),
        thankyou_live_at: fromLocalInput(draftDates.thankyou_live_at),
      });
      applyWindow(res);
      showToast('Go-live schedule saved. The live site updates automatically on those dates.', 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not save the go-live schedule.', 'error');
    } finally {
      setSavingDates(false);
    }
  };

  return (
    <main className="min-h-screen bg-ivory-50 text-charcoal-900 font-sans p-6">
      <h1 className="font-serif text-3xl mb-6">Guest Tools</h1>
      <div className="grid gap-6 md:grid-cols-2 max-w-5xl mx-auto">
        <Card className="p-6 shadow-md md:col-span-2" title="Live guest site" subtitle={`Choose the version to show at ${siteHost()} now, and optionally schedule when each one goes live automatically.`}>
          {liveMode === null ? (
            <div className="flex items-center gap-2 text-sm text-charcoal-500"><Spinner size="sm" /> Loading live-site setting…</div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                {LIVE_MODES.map((mode) => {
                  const selected = liveMode === mode.value;
                  const isFallback = !selected && fallbackMode === mode.value;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => selectLiveMode(mode.value)}
                      disabled={savingLiveMode}
                      aria-pressed={selected}
                      className={`text-left rounded-xl border-2 px-4 py-4 transition-colors disabled:opacity-60 ${selected ? 'border-sage-500 bg-sage-50' : 'border-charcoal-200 bg-white hover:border-sage-300'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-charcoal-900">{mode.label}</span>
                        <span className={`flex h-5 w-5 items-center justify-center rounded border ${selected ? 'border-sage-600 bg-sage-600 text-white' : 'border-charcoal-300 bg-white'}`} aria-hidden="true">{selected ? '✓' : ''}</span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-charcoal-500">{mode.description}</p>
                      {selected && <p className="mt-3 text-xs font-medium text-sage-700">Live now</p>}
                      {isFallback && <p className="mt-3 text-xs font-medium text-charcoal-500">Fallback until a go-live date arrives</p>}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 border-t border-charcoal-100 pt-5">
                <h3 className="font-medium text-charcoal-900 mb-1">Go-live schedule</h3>
                <p className="text-xs text-charcoal-500 mb-4">
                  Set a date and time for each version. The main site advances Teaser → Countdown → RSVP → Wedding Day → Thank You automatically as each date passes.
                  The calendar also drives the last two stages on its own: Wedding Day (v4) takes over from midnight of the wedding date, and Thank You (v5) the day after. The tick above controls what shows until then.
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  {MODE_KEYS.map(({ mode, key }) => (
                    <Field
                      key={key}
                      label={LIVE_MODES.find((m) => m.value === mode)?.label || mode}
                      hint={liveMode === mode ? 'Live now' : 'Scheduled go-live'}
                    >
                      <input
                        type="datetime-local"
                        value={draftDates[key]}
                        onChange={(e) => setDraftDates((d) => ({ ...d, [key]: e.target.value }))}
                        className="w-full px-3 py-2 border rounded-lg bg-white"
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Button onClick={saveGoLiveDates} loading={savingDates} disabled={savingDates}>Save schedule</Button>
                  {liveMode && (
                    <p className="text-sm text-charcoal-600">
                      Live now: <span className="font-medium text-sage-700">{LIVE_MODES.find((m) => m.value === liveMode)?.label}</span>
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </Card>
        <Card className="p-6 shadow-md" title="Preview the demo sites" subtitle="Each subdomain is a live copy of the guest site in that mode. Only you can see them — they open in a new tab using your logged-in browser.">
          <div className="space-y-3">
            {DEMO_SITES.map((site) => (
              <a
                key={site.host}
                href={`https://${site.host}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-charcoal-200 bg-white px-4 py-3 hover:border-sage-400 hover:bg-sage-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-medium text-charcoal-900">{site.mode}</p>
                    <p className="text-xs text-charcoal-500 mt-0.5">{site.description}</p>
                  </div>
                  <span className="text-xs font-mono text-sage-600 whitespace-nowrap">{site.host}</span>
                </div>
              </a>
            ))}
          </div>
          <p className="text-xs text-charcoal-400 mt-4">
            Guests will see whichever mode you've chosen on the live site — use these demos to choose the right look first.
          </p>
        </Card>
        <Card className="p-6 shadow-md">
          <h2 className="font-serif text-xl mb-1">Guest Tags</h2>
          <p className="text-xs text-charcoal-500 mb-4">Group guests (family, close friends, VIP…). The number is how many guests currently carry each tag.</p>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <input
              type="text"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTag(); }}
              placeholder="New tag name…"
              className="flex-1 px-3 py-2 border rounded-lg bg-white text-sm"
            />
            <div className="flex gap-2">
              <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} className="h-10 w-12 rounded-lg border cursor-pointer" title="Tag colour" aria-label="Tag colour" />
              <Button onClick={addTag} loading={savingTag} disabled={!newTagName.trim() || savingTag} className="shrink-0">Add tag</Button>
            </div>
          </div>
          {tags.length === 0 ? (
            <p className="text-sm text-charcoal-400">No tags yet — add your first one above.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-2 pl-2 pr-1 py-1 text-xs rounded-full bg-sage-100 text-sage-800">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color || '#527352' }} aria-hidden="true" />
                  {t.name}
                  {tagCounts[t.id] ? <span className="text-sage-500">({tagCounts[t.id]})</span> : null}
                  <button
                    type="button"
                    onClick={() => setDeletingTag(t)}
                    className="ml-1 flex h-4 w-4 items-center justify-center rounded-full text-charcoal-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                    title={`Delete "${t.name}"`}
                  >×</button>
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-charcoal-400 mt-4">Tags are managed here and assigned per-guest on the Guests page (edit a guest or filter by tag).</p>
        </Card>
        <Card className="p-6 shadow-md">
          <h2 className="font-serif text-xl mb-1">RSVP Window</h2>
          <p className="text-xs text-charcoal-500 mb-4">Guests can RSVP whenever the RSVP site (v3) is the live site, and not otherwise. Choose the live site under Live guest site. The dates below are optional and only narrow that, for example a reply-by deadline.</p>
          <p className={`mb-4 text-sm font-medium ${rsvpOpen ? 'text-sage-700' : 'text-charcoal-600'}`}>
            {rsvpOpen
              ? 'RSVPs are open: the RSVP site is live.'
              : liveMode === 'rsvp'
                ? 'RSVPs are closed: the RSVP site is live, but today is outside the dates below.'
                : 'RSVPs are closed: the RSVP site is not the live site.'}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Opens" hint="When guests can start RSVPing">
              <input type="datetime-local" value={rsvpOpensAt} onChange={(e) => setRsvpOpensAt(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white" />
            </Field>
            <Field label="Closes" hint="When RSVPing ends">
              <input type="datetime-local" value={rsvpClosesAt} onChange={(e) => setRsvpClosesAt(e.target.value)} className="w-full px-3 py-2 border rounded-lg bg-white" />
            </Field>
          </div>
          <div className="mt-4">
            <Button onClick={saveRsvpWindow} loading={savingWindow} disabled={savingWindow}>Save dates</Button>
          </div>
        </Card>
        <Card className="p-6 shadow-md">
          <h2 className="font-serif text-xl mb-1">Reminders</h2>
          <p className="text-xs text-charcoal-500 mb-4">Nudge households that haven't responded yet. Every reminder is logged so you can see who's been chased.</p>
          {reminders === null ? (
            <div className="flex items-center gap-2 text-sm text-charcoal-500"><Spinner size="sm" /> Loading…</div>
          ) : (
            <>
              {reminders.pending.length > 0 ? (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-charcoal-100 divide-y divide-charcoal-100 mb-4">
                  {reminders.pending.map((p: any) => (
                    <div key={p.household_id} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-charcoal-800">{p.household_name}</span>
                      <span className="text-xs text-charcoal-400">{p.pending_count} guest{p.pending_count === 1 ? '' : 's'} to reply</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-sage-700 mb-4">Nothing pending — every household that has an access code has responded.</p>
              )}
              <Button onClick={sendReminders} loading={sendingReminders} disabled={sendingReminders || reminders.pending.length === 0} size="sm">
                {reminders.pending.length > 0 ? `Remind all unresponded (${reminders.pending.length})` : 'Remind all unresponded'}
              </Button>
              {reminders.log.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-charcoal-400 mb-1">Recent reminders</h3>
                  <ul className="space-y-1 text-xs text-charcoal-600">
                    {reminders.log.slice(0, 3).map((e: any, i: number) => (
                      <li key={i} className="truncate">
                        {new Date(e.at).toLocaleString()} — {e.household_name}{e.note ? ` (${e.note})` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Card>
        <Card className="p-6 shadow-md">
          <h2 className="font-serif text-xl mb-1">Custom Questions</h2>
          <p className="text-xs text-charcoal-500 mb-4">Meal, dietary, song request, accessibility… Answers are stored per guest and these appear in the RSVP form.</p>

          {questions.length > 0 && (
            <div className="mb-4 space-y-2">
              {questions.map((q: any) => (
                <div key={q.id} className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-charcoal-800 truncate">{q.question}</p>
                    <p className="text-xs text-charcoal-400 mt-0.5">
                      {QUESTION_TYPES.find((t) => t.value === q.field_type)?.label || q.field_type}
                      {(q.required === 1 || q.required === true) ? ' · Required' : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => setDeletingQuestion(q)} className="shrink-0 text-sm text-charcoal-400 hover:text-red-600 transition-colors" title="Delete question">Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-dashed border-charcoal-200 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={qForm.question}
                onChange={(e) => setQForm((f) => ({ ...f, question: e.target.value }))}
                placeholder="New question…"
                className="flex-1 px-3 py-2 border rounded-lg bg-white text-sm"
              />
              <select
                value={qForm.field_type}
                onChange={(e) => setQForm((f) => ({ ...f, field_type: e.target.value }))}
                className="px-3 py-2 border rounded-lg bg-white text-sm sm:w-44"
              >
                {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {needsOptions && (
              <textarea
                value={qForm.optionsText}
                onChange={(e) => setQForm((f) => ({ ...f, optionsText: e.target.value }))}
                placeholder="Options — one per line (or comma separated)"
                rows={2}
                className="w-full px-3 py-2 border rounded-lg bg-white text-sm"
              />
            )}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-charcoal-800 cursor-pointer select-none">
                <input type="checkbox" checked={qForm.required} onChange={(e) => setQForm((f) => ({ ...f, required: e.target.checked }))} className="h-4 w-4 accent-sage-600" />
                Required
              </label>
              <div className="sm:ml-auto flex items-center gap-3">
                <span className="text-xs text-charcoal-400">Goes live in the RSVP form immediately</span>
                <Button size="sm" onClick={addQuestion} loading={savingQuestion} disabled={!qForm.question.trim() || savingQuestion} className="shrink-0">Add question</Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={!!deletingTag}
        onClose={() => setDeletingTag(null)}
        onConfirm={deleteTag}
        title={`Delete tag "${deletingTag?.name || ''}"?`}
        message="The tag is removed from every guest it's assigned to. The guests themselves are kept."
        confirmLabel="Delete tag"
      />
      <ConfirmDialog
        open={!!deletingQuestion}
        onClose={() => setDeletingQuestion(null)}
        onConfirm={deleteQuestion}
        title="Delete this question?"
        message="The question and any answers already saved against it will be removed. This cannot be undone."
        confirmLabel="Delete question"
      />
    </main>
  );
}
