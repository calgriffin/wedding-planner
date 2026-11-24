/**
 * Guest Website: editor for the public v3 guest site. Draft -> preview -> publish.
 * Only published content is ever served to guests.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { api, uploadHeroPhoto } from '../api/client';
import {
  PageHeader, Card, Badge, Button, Field, Input, Textarea, Spinner,
} from '../components/ui';
import { cn, formatDate } from '../utils/helpers';
import { siteHost } from '../utils/site';

const EMPTY_DRAFT: any = {
  hero: { heading: '', welcome: '', photo_url: '', photo_alt: '' },
  same_venue: false,
  travel: {
    ceremony_address: '', reception_address: '', ceremony_map_url: '', reception_map_url: '',
    ceremony_w3w: '', reception_w3w: '', arrival: '', parking: '', transport: '', accommodation: '', accessibility: '',
  },
  expect: { dress_code: '', weather: '', food_drink: '', children: '', plus_ones: '' },
  menu: { title: '', body: '' },
  faqs: [],
  gifts: { note: '', registry_url: '' },
  contact: { email: '' },
  search_index: false,
};

const STARTER_FAQS = [
  { question: 'What time should we arrive?', answer: '' },
  { question: 'Is there parking at the venue?', answer: '' },
  { question: 'What should I wear?', answer: '' },
  { question: 'Can I bring my children?', answer: '' },
  { question: 'I have dietary needs — what should I do?', answer: 'Tell us in your RSVP form and we’ll make sure the caterers know.' },
  { question: 'Can I change my RSVP later?', answer: '' },
  { question: 'Do you have a gift list?', answer: '' },
];

export default function GuestWebsitePage() {
  const { showToast } = useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [draft, setDraft] = useState<any>(EMPTY_DRAFT);
  const [mealOptions, setMealOptions] = useState<string[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [publishedAt, setPublishedAt] = useState('');
  const [views, setViews] = useState(0);
  const [rsvpStarted, setRsvpStarted] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [savingEventId, setSavingEventId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [photoErr, setPhotoErr] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const d = await api.guestSite.get();
      setDraft(d.draft || EMPTY_DRAFT);
      setMealOptions(d.meal_options || []);
      setEvents(d.events || []);
      setPublishedAt(d.published_at || '');
      setViews(d.views || 0);
      setRsvpStarted(d.rsvp_started || 0);
      setDirty(false);
    } catch (e: any) {
      showToast(e.message || 'Failed to load guest website content', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // ---- Draft field helpers ----
  const setSection = (section: string, key: string, value: any) => {
    setDraft((d: any) => ({ ...d, [section]: { ...d[section], [key]: value } }));
    setDirty(true);
  };
  const setTop = (key: string, value: any) => { setDraft((d: any) => ({ ...d, [key]: value })); setDirty(true); };

  // ---- Hero photo upload (R2) ----
  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setPhotoErr('');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setPhotoErr('Please choose a JPEG, PNG, WEBP or GIF image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setPhotoErr('That image is over 5MB — try a smaller one.');
      return;
    }
    setUploading(true);
    try {
      const r = await uploadHeroPhoto(file);
      const path = r && r.path ? r.path : '';
      if (path) {
        setSection('hero', 'photo_url', path);
        showToast('Cover photo uploaded — save the draft, then publish.', 'success');
      }
    } catch (err: any) {
      setPhotoErr(err.message || 'Upload failed — please try again.');
    } finally {
      setUploading(false);
    }
  };
  const clearPhoto = () => { setSection('hero', 'photo_url', ''); setSection('hero', 'photo_alt', ''); };

  const faqs: any[] = draft.faqs || [];
  const setFaq = (id: string, key: string, value: any) => {
    setTop('faqs', faqs.map((f) => (f.id === id ? { ...f, [key]: value } : f)));
  };
  const addFaq = (question = '', answer = '') => {
    setTop('faqs', [...faqs, { id: `faq-${Date.now()}-${faqs.length}`, question, answer, visible: true }]);
  };
  const removeFaq = (id: string) => setTop('faqs', faqs.filter((f) => f.id !== id));
  const moveFaq = (id: string, dir: -1 | 1) => {
    const idx = faqs.findIndex((f) => f.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= faqs.length) return;
    const next = [...faqs];
    [next[idx], next[j]] = [next[j], next[idx]];
    setTop('faqs', next);
  };
  const addStarterFaqs = () => {
    const existing = new Set(faqs.map((f) => f.question.toLowerCase().trim()));
    const toAdd = STARTER_FAQS.filter((s) => !existing.has(s.question.toLowerCase()))
      .map((s, i) => ({ id: `faq-${Date.now()}-${i}`, question: s.question, answer: s.answer, visible: true }));
    if (!toAdd.length) { showToast('Starter questions are all present already', 'info'); return; }
    setTop('faqs', [...faqs, ...toAdd]);
    showToast(`Added ${toAdd.length} starter question${toAdd.length === 1 ? '' : 's'} — edit the answers`, 'success');
  };

  // ---- Save / publish ----
  const saveDraft = async () => {
    setSaving(true);
    try {
      const r = await api.guestSite.save({ draft, meal_options: mealOptions });
      setDraft(r.draft);
      setMealOptions(r.meal_options);
      setDirty(false);
      showToast('Draft saved. Preview it on the private v3 site before publishing.', 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not save draft', 'error');
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (dirty) { showToast('Save the draft first, then publish.', 'info'); return; }
    setPublishing(true);
    try {
      await api.guestSite.publish();
      await load();
      showToast('Published — the live guest site now shows this content.', 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not publish', 'error');
    } finally {
      setPublishing(false);
    }
  };

  // ---- Schedule rows (events) are saved per-row, they live in the Events page ----
  const saveEventRow = async (ev: any) => {
    setSavingEventId(ev.id);
    try {
      await api.events.update(ev.id, {
        guest_visible: !!ev.guest_visible,
        start_time: ev.start_time || '',
        end_time: ev.end_time || '',
        guest_description: ev.guest_description || '',
      });
      showToast(`"${ev.title}" updated for the guest site`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not save event', 'error');
    } finally {
      setSavingEventId(null);
    }
  };
  const setEvent = (id: string, key: string, value: any) =>
    setEvents((list) => list.map((e) => (e.id === id ? { ...e, [key]: value } : e)));

  // ---- Completion checklist ----
  const visibleFaqs = faqs.filter((f) => f.visible && f.question.trim() && f.answer.trim());
  const visibleEvents = events.filter((e) => e.guest_visible && e.status !== 'cancelled' && e.status !== 'not_applicable');
  const checklist = useMemo(() => [
    { label: 'Welcome message written', ok: !!(draft.hero?.welcome || '').trim() },
    { label: 'Cover photo added (optional)', ok: !!(draft.hero?.photo_url || '').trim(), optional: true },
    { label: 'At least one event visible with a time', ok: visibleEvents.some((e) => (e.start_time || '').trim()) },
    { label: 'Ceremony address + map link', ok: !!(draft.travel?.ceremony_address || '').trim() && !!(draft.travel?.ceremony_map_url || '').trim() },
    { label: 'Dress code written', ok: !!(draft.expect?.dress_code || '').trim() },
    { label: 'At least two answered FAQs', ok: visibleFaqs.length >= 2 },
    { label: 'Guest contact email (optional)', ok: !!(draft.contact?.email || '').trim(), optional: true },
  ], [draft, visibleFaqs.length, visibleEvents]);
  const doneCount = checklist.filter((c) => c.ok).length;

  if (loading) return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;

  const hero = draft.hero || {};
  const travel = draft.travel || {};
  const expect = draft.expect || {};
  const menu = draft.menu || {};
  const gifts = draft.gifts || {};
  const contact = draft.contact || {};

  return (
    <div>
      <PageHeader
        title="Guest Website"
        subtitle="Write the guest-facing site here. Nothing reaches guests until you publish."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={saveDraft} loading={saving}>{dirty ? 'Save draft' : 'Draft saved'}</Button>
            <Button size="sm" onClick={publish} loading={publishing} disabled={dirty}>Publish to live site</Button>
          </>
        }
      />

      {/* Status + checklist */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <Card className="px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-charcoal-400 font-semibold mb-2">Readiness</p>
          <div className="flex flex-wrap gap-2">
            {checklist.map((c) => (
              <Badge key={c.label} tone={c.ok ? 'success' : c.optional ? 'neutral' : 'warning'}>
                {c.ok ? '✓ ' : ''}{c.label}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-charcoal-400 mt-3">{doneCount} of {checklist.length} complete{dirty ? ' · unsaved changes' : ''}</p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-charcoal-400 font-semibold mb-2">Status</p>
          <p className="text-sm text-charcoal-600">
            {publishedAt ? `Last published ${formatDate(publishedAt.slice(0, 10))}` : 'Nothing published yet — the live site shows a minimal page until you publish.'}
          </p>
          <p className="text-xs text-charcoal-400 mt-2">Approx. site views: {views} · RSVPs started: {rsvpStarted}</p>
          <p className="text-xs text-charcoal-400 mt-1">
            Preview the draft at <span className="font-medium text-charcoal-500">{siteHost('v3')}</span> (private to you while signed in).
          </p>
        </Card>
      </div>

      {/* Welcome & appearance */}
      <Card title="Welcome & appearance" subtitle="The top of the guest site." className="mb-6">
        <div className="px-5 py-4 space-y-4">
          <Field label="Heading (optional)" hint="Defaults to your names from Setup if blank.">
            <Input value={hero.heading || ''} onChange={(e) => setSection('hero', 'heading', e.target.value)} placeholder="e.g. We’re getting married" />
          </Field>
          <Field label="Welcome message" hint="A sentence or two under the hero — warm and short works best.">
            <Textarea rows={3} value={hero.welcome || ''} onChange={(e) => setSection('hero', 'welcome', e.target.value)} placeholder="e.g. We can’t wait to celebrate with you. Everything you need for the day is here — timings, travel, and your RSVP." />
          </Field>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Cover photo" hint="Upload or paste below — JPEG, PNG, WEBP or GIF, up to 5MB. Leave blank for an elegant text-only hero.">
              <div className="space-y-2">
                {hero.photo_url ? (
                  <div className="flex items-center gap-3">
                    <img src={hero.photo_url} alt={hero.photo_alt || 'Cover preview'} className="h-16 w-24 rounded object-cover border border-charcoal-200" />
                    <span className="text-xs text-charcoal-400">{hero.photo_url.startsWith('/media/') ? 'Stored on our media service' : 'External image'}</span>
                  </div>
                ) : (
                  <p className="text-xs text-charcoal-400">No photo yet — the hero is typographic.</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-charcoal-100 px-4 py-2 text-sm font-medium text-charcoal-900 transition-colors hover:bg-charcoal-200 focus:outline-none focus:ring-2 focus:ring-charcoal-400 disabled:opacity-50">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={onPickPhoto}
                      disabled={uploading}
                    />
                    {uploading ? 'Uploading…' : hero.photo_url ? 'Replace photo' : 'Upload photo'}
                  </label>
                  {hero.photo_url && (
                    <button type="button" onClick={clearPhoto} className="text-xs text-red-600 hover:underline">Remove</button>
                  )}
                </div>
                {photoErr && <p className="text-xs text-red-600">{photoErr}</p>}
              </div>
            </Field>
            <Field label="Photo description (alt text)" hint="Shown to screen readers and if the image can’t load.">
              <Input value={hero.photo_alt || ''} onChange={(e) => setSection('hero', 'photo_alt', e.target.value)} placeholder="e.g. The two of us in the garden" />
            </Field>
          </div>
          <Field label="…or paste an image link" hint="External https:// links work too — the site only keeps https:// or /media/ URLs.">
            <Input value={hero.photo_url || ''} onChange={(e) => setSection('hero', 'photo_url', e.target.value)} placeholder="https://…" />
          </Field>
        </div>
      </Card>

      {/* Schedule */}
      <Card title="Schedule of the day" subtitle="Choose which events appear on the guest site, with the times guests should know." className="mb-6">
        <div className="px-5 py-4">
          {events.length === 0 ? (
            <p className="text-sm text-charcoal-500">No events yet — add them on the <strong>Other Events</strong> page first, then mark them visible here.</p>
          ) : (
            <ul className="divide-y divide-charcoal-100">
              {events.map((ev) => (
                <li key={ev.id} className="py-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 text-sm font-medium text-charcoal-800 cursor-pointer min-w-48">
                      <input type="checkbox" checked={!!ev.guest_visible} onChange={(e) => setEvent(ev.id, 'guest_visible', e.target.checked)} className="rounded border-charcoal-300 text-sage-600 focus:ring-sage-500" />
                      {ev.title}
                      <span className="text-xs text-charcoal-400 font-normal">{ev.date ? formatDate(ev.date) : 'no date'}{ev.venue ? ` · ${ev.venue}` : ''}</span>
                    </label>
                    {(ev.status === 'cancelled' || ev.status === 'not_applicable') && <Badge tone="neutral">{ev.status}</Badge>}
                  </div>
                  {ev.guest_visible && (
                    <div className="mt-2 ml-7 grid md:grid-cols-4 gap-3">
                      <Field label="Starts">
                        <Input type="time" value={ev.start_time || ''} onChange={(e) => setEvent(ev.id, 'start_time', e.target.value)} />
                      </Field>
                      <Field label="Ends (optional)">
                        <Input type="time" value={ev.end_time || ''} onChange={(e) => setEvent(ev.id, 'end_time', e.target.value)} />
                      </Field>
                      <div className="md:col-span-2">
                        <Field label="Guest-facing note (optional)">
                          <Input value={ev.guest_description || ''} onChange={(e) => setEvent(ev.id, 'guest_description', e.target.value)} placeholder="e.g. Drinks on the lawn after the ceremony" />
                        </Field>
                      </div>
                      <div className="md:col-span-4">
                        <Button variant="outline" size="sm" onClick={() => saveEventRow(ev)} loading={savingEventId === ev.id}>Save “{ev.title}”</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-charcoal-400 mt-3">Internal notes, budgets and guest counts never appear on the guest site.</p>
        </div>
      </Card>

      {/* Venue & travel */}
      <Card title="Getting there & staying" subtitle="Addresses, maps and travel details. Leave anything blank and it simply won’t show." className="mb-6">
        <div className="px-5 py-4 space-y-4">
          <label className="flex items-center gap-2 text-sm text-charcoal-800 cursor-pointer">
            <input
              type="checkbox"
              checked={!!draft.same_venue}
              onChange={(e) => setTop('same_venue', e.target.checked)}
              className="rounded border-charcoal-300 text-sage-600 focus:ring-sage-500"
            />
            <span>Ceremony and reception are at the same location{!draft.same_venue ? '' : ' — guests will see one venue'}</span>
          </label>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label={draft.same_venue ? 'Venue address' : 'Ceremony address'} hint={draft.same_venue ? 'Used for the single venue shown to guests.' : undefined}>
              <Textarea rows={2} value={travel.ceremony_address || ''} onChange={(e) => setSection('travel', 'ceremony_address', e.target.value)} placeholder="Venue name, street, town, postcode" />
            </Field>
            {!draft.same_venue && (
              <Field label="Reception address (if different)">
                <Textarea rows={2} value={travel.reception_address || ''} onChange={(e) => setSection('travel', 'reception_address', e.target.value)} placeholder="Venue name, street, town, postcode" />
              </Field>
            )}
            <Field label={draft.same_venue ? 'Map link' : 'Ceremony map link'} hint="A Google Maps link guests can tap.">
              <Input value={travel.ceremony_map_url || ''} onChange={(e) => setSection('travel', 'ceremony_map_url', e.target.value)} placeholder="https://maps.google.com/…" />
            </Field>
            {!draft.same_venue && (
              <Field label="Reception map link">
                <Input value={travel.reception_map_url || ''} onChange={(e) => setSection('travel', 'reception_map_url', e.target.value)} placeholder="https://maps.google.com/…" />
              </Field>
            )}
            <Field label={draft.same_venue ? 'What3Words (optional)' : 'Ceremony What3Words (optional)'} hint="e.g. ///filled.count.soap">
              <Input value={travel.ceremony_w3w || ''} onChange={(e) => setSection('travel', 'ceremony_w3w', e.target.value)} placeholder="///word.word.word" />
            </Field>
            {!draft.same_venue && (
              <Field label="Reception What3Words (optional)">
                <Input value={travel.reception_w3w || ''} onChange={(e) => setSection('travel', 'reception_w3w', e.target.value)} placeholder="///word.word.word" />
              </Field>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Arrival guidance" hint="e.g. Please arrive from 1:30pm for a 2pm ceremony.">
              <Textarea rows={2} value={travel.arrival || ''} onChange={(e) => setSection('travel', 'arrival', e.target.value)} />
            </Field>
            <Field label="Parking">
              <Textarea rows={2} value={travel.parking || ''} onChange={(e) => setSection('travel', 'parking', e.target.value)} />
            </Field>
            <Field label="Public transport / taxis">
              <Textarea rows={2} value={travel.transport || ''} onChange={(e) => setSection('travel', 'transport', e.target.value)} />
            </Field>
            <Field label="Accommodation suggestions" hint="Nearby hotels or a booking note.">
              <Textarea rows={2} value={travel.accommodation || ''} onChange={(e) => setSection('travel', 'accommodation', e.target.value)} />
            </Field>
            <Field label="Accessibility at the venue" hint="Step-free access, hearing loop, quiet space…">
              <Textarea rows={2} value={travel.accessibility || ''} onChange={(e) => setSection('travel', 'accessibility', e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      {/* What to expect */}
      <Card title="What to expect" subtitle="The practical questions guests always ask." className="mb-6">
        <div className="px-5 py-4 grid md:grid-cols-2 gap-4">
          <Field label="Dress code" hint="e.g. Garden party — think smart but comfortable; stiletto-friendly paths.">
            <Textarea rows={2} value={expect.dress_code || ''} onChange={(e) => setSection('expect', 'dress_code', e.target.value)} />
          </Field>
          <Field label="Outdoors / weather notes">
            <Textarea rows={2} value={expect.weather || ''} onChange={(e) => setSection('expect', 'weather', e.target.value)} />
          </Field>
          <Field label="Food & drink">
            <Textarea rows={2} value={expect.food_drink || ''} onChange={(e) => setSection('expect', 'food_drink', e.target.value)} placeholder="e.g. Wedding breakfast followed by evening food; dietary needs catered for — tell us in your RSVP." />
          </Field>
          <Field label="Children">
            <Textarea rows={2} value={expect.children || ''} onChange={(e) => setSection('expect', 'children', e.target.value)} />
          </Field>
          <Field label="Plus-ones">
            <Textarea rows={2} value={expect.plus_ones || ''} onChange={(e) => setSection('expect', 'plus_ones', e.target.value)} placeholder="e.g. If your invitation includes a plus-one, you can add them on your RSVP form." />
          </Field>
        </div>
      </Card>

      {/* Menu */}
      <Card title="On the menu (optional)" subtitle="Shown only when filled in." className="mb-6">
        <div className="px-5 py-4 space-y-4">
          <Field label="Menu title">
            <Input value={menu.title || ''} onChange={(e) => setSection('menu', 'title', e.target.value)} placeholder="e.g. The wedding breakfast" />
          </Field>
          <Field label="Menu" hint="One line per course reads beautifully.">
            <Textarea rows={6} value={menu.body || ''} onChange={(e) => setSection('menu', 'body', e.target.value)} placeholder={'Starter\n…\nMain\n…\nDessert\n…'} />
          </Field>
        </div>
      </Card>

      {/* FAQs */}
      <Card title="FAQs" subtitle="Answered questions appear on the site; blank answers stay hidden. Drag order with the arrows." className="mb-6">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <p className="text-xs text-charcoal-400">{visibleFaqs.length} answered & visible</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={addStarterFaqs}>Add starter questions</Button>
              <Button variant="outline" size="sm" onClick={() => addFaq()}>+ Add question</Button>
            </div>
          </div>
          {faqs.length === 0 ? (
            <p className="text-sm text-charcoal-500">No questions yet — use “Add starter questions” for the classics.</p>
          ) : (
            <ul className="space-y-3">
              {faqs.map((f, idx) => (
                <li key={f.id} className={cn('rounded-xl border p-4', f.visible ? 'border-charcoal-200 bg-white' : 'border-charcoal-100 bg-charcoal-50 opacity-70')}>
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-1 pt-1">
                      <button type="button" onClick={() => moveFaq(f.id, -1)} disabled={idx === 0} className="text-charcoal-400 hover:text-charcoal-700 disabled:opacity-30 text-xs" aria-label="Move up">▲</button>
                      <button type="button" onClick={() => moveFaq(f.id, 1)} disabled={idx === faqs.length - 1} className="text-charcoal-400 hover:text-charcoal-700 disabled:opacity-30 text-xs" aria-label="Move down">▼</button>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Input value={f.question} onChange={(e) => setFaq(f.id, 'question', e.target.value)} placeholder="Question" />
                      <Textarea rows={2} value={f.answer} onChange={(e) => setFaq(f.id, 'answer', e.target.value)} placeholder="Answer (leave blank to keep it hidden)" />
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs text-charcoal-500 cursor-pointer">
                          <input type="checkbox" checked={!!f.visible} onChange={(e) => setFaq(f.id, 'visible', e.target.checked)} className="rounded border-charcoal-300 text-sage-600 focus:ring-sage-500" />
                          Show on site
                        </label>
                        <button type="button" onClick={() => removeFaq(f.id)} className="text-xs text-red-600 hover:underline">Remove</button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Gifts & contact */}
      <Card title="Gifts & contact" subtitle="Both optional — guests see them only if you fill them in." className="mb-6">
        <div className="px-5 py-4 space-y-4">
          <Field label="Gift note" hint="e.g. Your presence is the present — but if you’d like to, here’s our list.">
            <Textarea rows={2} value={gifts.note || ''} onChange={(e) => setSection('gifts', 'note', e.target.value)} />
          </Field>
          <Field label="Registry link (optional)">
            <Input value={gifts.registry_url || ''} onChange={(e) => setSection('gifts', 'registry_url', e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Guest contact email (optional)" hint="Shown as “Questions before the day?” — consider a dedicated wedding address.">
            <Input type="email" value={contact.email || ''} onChange={(e) => setSection('contact', 'email', e.target.value)} placeholder="you@example.com" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-charcoal-600 cursor-pointer">
            <input type="checkbox" checked={!!draft.search_index} onChange={(e) => setTop('search_index', e.target.checked)} className="rounded border-charcoal-300 text-sage-600 focus:ring-sage-500" />
            Allow search engines to index the guest site (off = hidden from Google)
          </label>
        </div>
      </Card>

      {/* RSVP meal options */}
      <Card title="RSVP meal options" subtitle="The choices guests see in the RSVP form. Saved choices guests already made are never lost." className="mb-6">
        <div className="px-5 py-4">
          <div className="space-y-2">
            {mealOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={opt} onChange={(e) => setMealOptions((m) => m.map((x, j) => (j === i ? e.target.value : x)))} />
                <button type="button" onClick={() => setMealOptions((m) => m.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline shrink-0">Remove</button>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setMealOptions((m) => [...m, ''])}>+ Add option</Button>
          <p className="text-xs text-charcoal-400 mt-2">If you remove every option, the defaults come back (dinner, salad, vegetarian, vegan).</p>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={saveDraft} loading={saving}>Save draft</Button>
        <Button onClick={publish} loading={publishing} disabled={dirty}>Publish to live site</Button>
      </div>
    </div>
  );
}
