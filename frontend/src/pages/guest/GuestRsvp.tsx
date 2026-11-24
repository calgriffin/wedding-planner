import React, { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { CalendarClock, Check, Hourglass, KeyRound } from 'lucide-react';
import { cn, formatDate, calendarLinks } from '../../utils/helpers';
import { GUEST_SITE_UNLOCK_KEY, GuestShell, Card, Button, Field, Input, Select, Textarea, weddingTitle } from './GuestChrome';

interface Guest {
  id: string;
  first_name: string;
  last_name: string;
  is_primary: number;
  status: string;
  attendance_type: string;
  email: string;
  phone: string;
  dietary_needs: string;
  dietary_choice: string;
  song_request: string;
  accessibility_requests: string;
  plus_one_of: string | null;
  plus_one_allowed?: boolean;
  plus_one_response?: string;
  name_pending?: boolean;
  rsvp_message?: string;
}

// A guest's answer to "are you bringing a plus-one?" (only asked when the
// couple offered them one). `bringing` stays undefined until they choose.
interface PlusOne {
  bringing?: boolean;
  first_name: string;
  last_name: string;
  dietary_needs: string;
  dietary_choice: string;
}

interface GuestDetails {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

// The household's name and postal address, which the household can correct.
interface HouseholdDetails {
  name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postcode: string;
  country: string;
}

const ADDRESS_FIELDS = ['address_line1', 'address_line2', 'city', 'postcode', 'country'] as const;

interface Question {
  id: string;
  question: string;
  question_type: string; // text | textarea | select | radio | checkbox
  options: string[];
  is_required: boolean;
}

interface Answers {
  [questionId: string]: string;
}

type Step = 'form' | 'review' | 'done';

const DEFAULT_MEALS = ['dinner', 'salad', 'vegetarian', 'vegan'];

const mealLabel = (o: string) => o.charAt(0).toUpperCase() + o.slice(1).replace(/[-_]/g, ' ');

export default function GuestRsvp() {
  const location = useLocation();
  const access = (location.state as any)?.access;
  const code = (location.state as any)?.code || '';
  const household: Guest[] = (access && access.guests) || [];
  // A plus-one added by a guest is answered on that guest's card, so it
  // doesn't get a card of its own.
  const plusOneRecord = (host: Guest) => household.find((g) => g.plus_one_of === host.id);
  const guests: Guest[] = household.filter(
    (g) => !household.some((h) => h.plus_one_allowed && h.id === g.plus_one_of)
  );
  const questions: Question[] = (access && access.questions) || [];
  const rsvpOpen = access ? access.rsvp_open : false;
  const windowState: 'open' | 'not_yet_open' | 'closed' =
    (access && access.window_state) || (rsvpOpen ? 'open' : 'closed');
  const mealOptions: string[] =
    access && Array.isArray(access.meal_options) && access.meal_options.length
      ? access.meal_options
      : DEFAULT_MEALS;

  // Site data for the calendar + contact links, ready by the time the household
  // reaches the success step. The venue and contact details sit behind the
  // access code, so this needs the UNLOCKED payload: the copy GuestAccess saved
  // for this tab, else a fresh unlock with the code. The public payload (names
  // + date only) is the last resort.
  const [site, setSite] = useState<any>(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(GUEST_SITE_UNLOCK_KEY) || 'null');
      return cached && cached.content ? cached : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (site) return;
    let cancelled = false;
    (async () => {
      try {
        if (code) {
          const u = await api.guest.unlock({ code: String(code).trim() });
          if (u && u.unlocked && u.site) {
            try { sessionStorage.setItem(GUEST_SITE_UNLOCK_KEY, JSON.stringify(u.site)); } catch { /* private mode */ }
            if (!cancelled) setSite(u.site);
            return;
          }
        }
      } catch { /* fall through to the public payload */ }
      try {
        const d = await api.guest.site();
        if (!cancelled) setSite(d);
      } catch { /* the calendar card just stays hidden */ }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [step, setStep] = useState<Step>('form');
  const [attending, setAttending] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    // Guests who haven't replied yet start with neither answer chosen, so
    // nobody declines (or accepts) by accident.
    guests.forEach((g) => {
      if (g.status === 'confirmed' || g.status === 'potential') m[g.id] = true;
      else if (g.status === 'declined') m[g.id] = false;
    });
    return m;
  });
  const [form, setForm] = useState<Record<string, Record<string, string>>>(() => {
    const m: Record<string, Record<string, string>> = {};
    guests.forEach((g) => {
      m[g.id] = {
        dietary_needs: g.dietary_needs || '',
        dietary_choice: g.dietary_choice || '',
        song_request: g.song_request || '',
        accessibility_requests: g.accessibility_requests || '',
        rsvp_message: g.rsvp_message || '',
      };
    });
    return m;
  });
  const [plusOne, setPlusOne] = useState<Record<string, PlusOne>>(() => {
    const m: Record<string, PlusOne> = {};
    guests.forEach((g) => {
      if (!g.plus_one_allowed) return;
      const p = plusOneRecord(g);
      m[g.id] = {
        bringing: p && p.status !== 'declined' ? true : p || g.plus_one_response === 'declined' ? false : undefined,
        first_name: p && !p.name_pending ? p.first_name : '',
        last_name: p && !p.name_pending ? p.last_name : '',
        dietary_needs: (p && p.dietary_needs) || '',
        dietary_choice: (p && p.dietary_choice) || '',
      };
    });
    return m;
  });
  // Each guest's own name and contact details, which they can correct. The
  // primary guest's email and mobile are the household ones asked at the top.
  const [details, setDetails] = useState<Record<string, GuestDetails>>(() => {
    const m: Record<string, GuestDetails> = {};
    guests.forEach((g) => {
      m[g.id] = { first_name: g.first_name || '', last_name: g.last_name || '', email: g.email || '', phone: g.phone || '' };
    });
    return m;
  });
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});
  const [answers, setAnswers] = useState<Record<string, Answers>>(() => {
    const m: Record<string, Answers> = {};
    guests.forEach((g) => {
      m[g.id] = {};
    });
    return m;
  });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [submittedAt, setSubmittedAt] = useState('');

  // Each step, and any message about the form, starts at the top of the page.
  useEffect(() => {
    if (step !== 'form' || err) window.scrollTo({ top: 0 });
  }, [step, err]);

  // Household contact is asked ONCE (not per guest) and stored on the primary
  // guest. Pre-filled from whichever guest is already primary.
  const primary = guests.find((g) => g.is_primary) || guests[0];
  const [contact, setContact] = useState({ email: primary?.email || '', phone: primary?.phone || '' });
  const [householdDetails, setHouseholdDetails] = useState<HouseholdDetails>(() => {
    const h = (access && access.household) || {};
    return {
      name: h.name || '',
      address_line1: h.address_line1 || '',
      address_line2: h.address_line2 || '',
      city: h.city || '',
      postcode: h.postcode || '',
      country: h.country || '',
    };
  });
  const [householdOpen, setHouseholdOpen] = useState(false);

  if (!access) {
    return (
      <GuestShell width="max-w-md">
        <Card className="px-6 py-10 text-center">
          <KeyRound className="mx-auto mb-5 h-7 w-7 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
          <h2 className="mb-3 text-4xl font-light">Start from your invite</h2>
          <p className="mb-7 text-[15px] leading-relaxed text-charcoal-600">
            This page opens from the access-code screen — enter your code to continue.
          </p>
          <Link to="/guest/access">
            <Button variant="primary">Enter access code</Button>
          </Link>
        </Card>
      </GuestShell>
    );
  }

  // ---- Window states -------------------------------------------------------
  if (windowState === 'not_yet_open') {
    return (
      <GuestShell width="max-w-md">
        <Card className="px-6 py-10 text-center">
          <CalendarClock className="mx-auto mb-5 h-7 w-7 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
          <h2 className="mb-3 text-4xl font-light">RSVPs open soon</h2>
          <p className="text-sm text-charcoal-600">
            {access.rsvp_opens_at
              ? `You'll be able to respond from ${formatDate(access.rsvp_opens_at)}.`
              : 'You\'ll be able to respond very soon — check back shortly.'}{' '}
            See you at the wedding.
          </p>
        </Card>
      </GuestShell>
    );
  }
  if (windowState === 'closed') {
    return (
      <GuestShell width="max-w-md">
        <Card className="px-6 py-10 text-center">
          <Hourglass className="mx-auto mb-5 h-7 w-7 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
          <h2 className="mb-3 text-4xl font-light">RSVP window closed</h2>
          <p className="text-sm text-charcoal-600">Please check back soon — see you at the wedding.</p>
        </Card>
      </GuestShell>
    );
  }

  // ---- Helpers -------------------------------------------------------------
  const setDetail = (guestId: string, patch: Partial<GuestDetails>) =>
    setDetails((prev) => ({ ...prev, [guestId]: { ...prev[guestId], ...patch } }));

  const firstName = (g: Guest) => (details[g.id]?.first_name || '').trim() || g.first_name;
  const fullName = (g: Guest) => `${firstName(g)} ${(details[g.id]?.last_name ?? g.last_name ?? '').trim()}`.trim();
  const ownsHouseholdContact = (g: Guest) => !!primary && g.id === primary.id;

  const setHouseholdDetail = (patch: Partial<HouseholdDetails>) =>
    setHouseholdDetails((prev) => ({ ...prev, ...patch }));
  const householdName = householdDetails.name.trim() || access.household?.name || '';
  // "For the Smiths household", whether or not they typed "The" themselves.
  const forHousehold = householdName ? `For the ${householdName.replace(/^the\s+/i, '')} household.` : '';
  const householdAddress = ADDRESS_FIELDS.map((f) => householdDetails[f].trim()).filter(Boolean).join(', ');

  const setField = (guestId: string, field: string, value: string) =>
    setForm((prev) => ({ ...prev, [guestId]: { ...(prev[guestId] || {}), [field]: value } }));

  const setPlusOneField = (guestId: string, patch: Partial<PlusOne>) =>
    setPlusOne((prev) => ({ ...prev, [guestId]: { ...prev[guestId], ...patch } }));

  const plusOneName = (guestId: string) =>
    `${plusOne[guestId]?.first_name || ''} ${plusOne[guestId]?.last_name || ''}`.trim() || 'name to follow';

  const setAnswer = (guestId: string, questionId: string, value: string) => {
    setAnswers((prev) => {
      const cur = { ...(prev[guestId] || {}) };
      if (value === '') {
        delete cur[questionId];
      } else {
        cur[questionId] = value;
      }
      return { ...prev, [guestId]: cur };
    });
  };

  const toggleCheckboxOption = (guestId: string, q: Question, option: string) => {
    setAnswers((prev) => {
      const cur = { ...(prev[guestId] || {}) };
      const selected = cur[q.id] ? cur[q.id].split(', ').filter(Boolean) : [];
      const next = selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option];
      if (next.length) cur[q.id] = next.join(', ');
      else delete cur[q.id];
      return { ...prev, [guestId]: cur };
    });
  };

  const buildResponses = () =>
    guests.map((g) => {
      const f = form[g.id] || {};
      const a = answers[g.id] || {};
      return {
        guest_id: g.id,
        first_name: (details[g.id]?.first_name || '').trim(),
        last_name: (details[g.id]?.last_name || '').trim(),
        ...(ownsHouseholdContact(g)
          ? {}
          : { email: (details[g.id]?.email || '').trim(), phone: (details[g.id]?.phone || '').trim() }),
        attending: attending[g.id] ?? false,
        attendance_type: attending[g.id] ? 'dinner' : 'not_attending',
        dietary_needs: f.dietary_needs || '',
        dietary_choice: f.dietary_choice || '',
        song_request: f.song_request || '',
        accessibility_requests: f.accessibility_requests || '',
        rsvp_message: f.rsvp_message || '',
        ...(g.plus_one_allowed
          ? {
              plus_one: {
                bringing: !!attending[g.id] && !!plusOne[g.id]?.bringing,
                first_name: (plusOne[g.id]?.first_name || '').trim(),
                last_name: (plusOne[g.id]?.last_name || '').trim(),
                dietary_needs: plusOne[g.id]?.dietary_needs || '',
                dietary_choice: plusOne[g.id]?.dietary_choice || '',
              },
            }
          : {}),
        answers: questions
          .map((q) => ({ question_id: q.id, answer: (a[q.id] || '').trim() }))
          .filter((x) => x.answer !== ''),
      };
    });

  // Required custom questions must be answered for attending guests before
  // the household can move to review.
  const missingRequired = () => {
    const missing: string[] = [];
    guests.forEach((g) => {
      if (!attending[g.id]) return;
      questions.forEach((q) => {
        if (q.is_required && !((answers[g.id] || {})[q.id] || '').trim()) {
          missing.push(`${firstName(g)}'s "${q.question}"`);
        }
      });
    });
    return missing;
  };

  const goReview = () => {
    setErr('');
    const email = contact.email.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setErr('That email address doesn\u2019t look right — please check it (or leave it blank).');
      return;
    }
    const nameless = guests.find((g) => !(details[g.id]?.first_name || '').trim());
    if (nameless) {
      setDetailsOpen((prev) => ({ ...prev, [nameless.id]: true }));
      setErr(`Please add a first name for ${nameless.first_name || 'each guest'}.`);
      return;
    }
    const badEmail = guests.find((g) => {
      const e = ownsHouseholdContact(g) ? '' : (details[g.id]?.email || '').trim();
      return e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
    });
    if (badEmail) {
      setDetailsOpen((prev) => ({ ...prev, [badEmail.id]: true }));
      setErr(`${firstName(badEmail)}\u2019s email address doesn\u2019t look right — please check it (or leave it blank).`);
      return;
    }
    const unanswered = guests.filter((g) => attending[g.id] === undefined);
    if (unanswered.length) {
      setErr(`Please let us know whether ${unanswered.map((g) => firstName(g)).join(' and ')} can make it.`);
      return;
    }
    const plusOneUnanswered = guests.filter(
      (g) => g.plus_one_allowed && attending[g.id] && plusOne[g.id]?.bringing === undefined
    );
    if (plusOneUnanswered.length) {
      setErr(`Please let us know whether ${plusOneUnanswered.map((g) => firstName(g)).join(' and ')} will be bringing a plus-one.`);
      return;
    }
    const missing = missingRequired();
    if (missing.length) {
      setErr(`Please answer a few required questions first: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
      return;
    }
    setStep('review');
  };

  const submit = async () => {
    setLoading(true);
    setErr('');
    try {
      const r: any = await api.guest.rsvp({
        code,
        contact: { email: contact.email.trim(), phone: contact.phone.trim() },
        household: {
          name: householdDetails.name.trim(),
          ...Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, householdDetails[f].trim()])),
        },
        responses: buildResponses(),
      });
      setSubmittedAt((r && r.submitted_at) || new Date().toISOString());
      setStep('done');
    } catch (e: any) {
      setErr(e.message || 'Sorry — we couldn’t save your RSVP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const mealValue = (g: Guest) => {
    const saved = (form[g.id] || {}).dietary_choice || '';
    if (!saved) return '';
    return mealOptions.find((o) => o.toLowerCase() === saved.toLowerCase()) || saved;
  };

  // ---- Success (step 3) ----------------------------------------------------
  if (step === 'done') {
    const title = weddingTitle(site);
    const venue = [
      site?.ceremony_venue && site.ceremony_venue !== 'TBC' ? site.ceremony_venue : '',
      site?.content?.travel?.ceremony_address || '',
    ]
      .filter(Boolean)
      .join(', ');
    const cal = calendarLinks({
      title,
      date: site?.wedding_date || '',
      location: venue,
      description: site?.content?.hero?.welcome || `We can't wait to celebrate with you.`,
    });
    return (
      <GuestShell>
          <Card className="mb-6 px-6 py-10 text-center">
            <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-sage-600 text-ivory-50">
              <Check className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
            </span>
            <p className="gs-eyebrow">RSVP saved</p>
            <h1 className="mb-3 mt-3 text-5xl font-light">Thank you</h1>
            <p className="text-[15px] text-charcoal-600">
              {forHousehold} See you at the wedding!
            </p>
            {submittedAt && (
              <p className="text-xs text-charcoal-400 mt-3">Sent {formatDate(submittedAt)}.</p>
            )}
          </Card>

          <Card className="p-6 mb-4">
            <h2 className="mb-4 text-3xl">Your response</h2>
            <ul className="space-y-3">
              {guests.map((g) => {
                const f = form[g.id] || {};
                const isAttending = attending[g.id];
                return (
                  <li key={g.id} className="border-b border-charcoal-100 pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-charcoal-900">
                      {fullName(g)}
                      <span className={`ml-2 text-xs font-sans ${isAttending ? 'text-sage-600' : 'text-charcoal-400'}`}>
                        {isAttending ? 'Joyfully accepts' : 'Regretfully declines'}
                      </span>
                    </p>
                    {isAttending && (
                      <p className="text-xs text-charcoal-500 mt-1">
                        {f.dietary_choice ? `Meal: ${mealLabel(f.dietary_choice)}` : 'Meal: TBD'}
                        {f.dietary_needs ? ` · Dietary: ${f.dietary_needs}` : ''}
                        {f.song_request ? ` · Song: ${f.song_request}` : ''}
                      </p>
                    )}
                    {isAttending && g.plus_one_allowed && (
                      <p className="text-xs text-charcoal-500 mt-1">
                        {plusOne[g.id]?.bringing ? `Plus-one: ${plusOneName(g.id)}` : 'No plus-one'}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link to="/guest/rsvp" className="flex-1" onClick={() => setStep('form')}>
                <Button variant="secondary" className="w-full">Change your response</Button>
              </Link>
              <Link to="/" className="flex-1">
                <Button variant="primary" className="w-full">Back to the site</Button>
              </Link>
            </div>
          </Card>

          {site?.wedding_date && (
            <Card className="p-6 mb-4 text-center">
              <h2 className="mb-1 text-3xl">Save the date</h2>
              <p className="text-xs text-charcoal-500 mb-4">
                {formatDate(site.wedding_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                {venue ? ` · ${venue}` : ''}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                {cal.google && (
                  <a href={cal.google} target="_blank" rel="noreferrer" className="flex-1">
                    <Button variant="secondary" className="w-full">Google Calendar</Button>
                  </a>
                )}
                {cal.ics && (
                  <a href={cal.ics} download={cal.downloadName} className="flex-1">
                    <Button variant="primary" className="w-full">Apple / Outlook</Button>
                  </a>
                )}
              </div>
            </Card>
          )}

          {site?.content?.contact?.email && (
            <p className="text-center text-xs text-charcoal-500">
              Questions?{' '}
              <a className="text-sage-600 hover:text-sage-700 underline" href={`mailto:${site.content.contact.email}`}>
                {site.content.contact.email}
              </a>
            </p>
          )}
      </GuestShell>
    );
  }

  // ---- Review (step 2) -----------------------------------------------------
  if (step === 'review') {
    return (
      <GuestShell>
          <Stepper step={step} />
          <h1 className="mb-2 text-5xl font-light">Review &amp; send</h1>
          <p className="mb-8 text-[15px] text-charcoal-600">
            Almost there — please check everyone’s details before sending.
          </p>
          {err && <p className="mb-4 text-sm text-red-700" role="alert">{err}</p>}
          {(householdName || householdAddress || contact.email.trim() || contact.phone.trim()) && (
            <Card className="p-5 mb-4">
              <h2 className="mb-2 text-2xl">Your household</h2>
              <ul className="text-sm text-charcoal-600 space-y-1.5">
                {householdName && <li><span className="text-charcoal-400">Household:</span> {householdName}</li>}
                {householdAddress && <li><span className="text-charcoal-400">Address:</span> {householdAddress}</li>}
                {contact.email.trim() && <li><span className="text-charcoal-400">Email:</span> {contact.email.trim()}</li>}
                {contact.phone.trim() && <li><span className="text-charcoal-400">Mobile:</span> {contact.phone.trim()}</li>}
              </ul>
            </Card>
          )}
          {guests.map((g) => {
            const f = form[g.id] || {};
            const a = answers[g.id] || {};
            const isAttending = attending[g.id];
            return (
              <Card key={g.id} className="p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-2xl">
                    {fullName(g)}
                  </h2>
                  <button type="button" className="text-xs uppercase tracking-[0.2em] text-sage-700 underline-offset-4 hover:underline" onClick={() => setStep('form')}>
                    Edit
                  </button>
                </div>
                <p className={`text-sm mb-2 ${isAttending ? 'text-sage-700' : 'text-charcoal-400'}`}>
                  {isAttending ? 'Joyfully accepts' : 'Regretfully declines'}
                </p>
                {!ownsHouseholdContact(g) && ((details[g.id]?.email || '').trim() || (details[g.id]?.phone || '').trim()) && (
                  <ul className="mb-1.5 text-sm text-charcoal-600 space-y-1.5">
                    {(details[g.id]?.email || '').trim() && <li><span className="text-charcoal-400">Email:</span> {details[g.id].email.trim()}</li>}
                    {(details[g.id]?.phone || '').trim() && <li><span className="text-charcoal-400">Mobile:</span> {details[g.id].phone.trim()}</li>}
                  </ul>
                )}
                {isAttending && (
                  <ul className="text-sm text-charcoal-600 space-y-1.5">
                    <li><span className="text-charcoal-400">Meal:</span> {f.dietary_choice ? mealLabel(f.dietary_choice) : 'TBD'}</li>
                    {f.dietary_needs && <li><span className="text-charcoal-400">Dietary:</span> {f.dietary_needs}</li>}
                    {f.song_request && <li><span className="text-charcoal-400">Song:</span> {f.song_request}</li>}
                    {f.accessibility_requests && <li><span className="text-charcoal-400">Accessibility:</span> {f.accessibility_requests}</li>}
                    {f.rsvp_message && <li><span className="text-charcoal-400">Message:</span> {f.rsvp_message}</li>}
                    {g.plus_one_allowed && (
                      <li>
                        <span className="text-charcoal-400">Plus-one:</span>{' '}
                        {plusOne[g.id]?.bringing
                          ? [
                              plusOneName(g.id),
                              plusOne[g.id]?.dietary_choice ? `Meal: ${mealLabel(plusOne[g.id].dietary_choice)}` : '',
                              plusOne[g.id]?.dietary_needs ? `Dietary: ${plusOne[g.id].dietary_needs}` : '',
                            ].filter(Boolean).join(' · ')
                          : 'Not bringing anyone'}
                      </li>
                    )}
                    {questions.map((q) => {
                      const val = a[q.id];
                      return val ? (
                        <li key={q.id}><span className="text-charcoal-400">{q.question}:</span> {val}</li>
                      ) : null;
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
          <div className="mt-6 flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setStep('form')}>
              Back
            </Button>
            <Button variant="primary" className="flex-1" loading={loading} onClick={submit}>
              {loading ? 'Sending…' : 'Send RSVP'}
            </Button>
          </div>
      </GuestShell>
    );
  }

  // ---- Form (step 1) -------------------------------------------------------
  return (
    <GuestShell>
        <Stepper step={step} />
        <h1 className="mb-2 text-5xl font-light">Your RSVP</h1>
        <p className="mb-8 text-[15px] text-charcoal-600">
          {forHousehold || 'Tell us how you’ll be attending.'}
        </p>
        {access.already_responded && (
          <div className="rounded-xl bg-sage-50 border border-sage-200 px-4 py-3 mb-4 text-sm text-sage-800">
            You’ve already sent your RSVP{access.rsvp_submitted_at ? ` (${formatDate(access.rsvp_submitted_at)})` : ''} — happy to make changes below.
          </div>
        )}
        {err && <p className="mb-4 text-sm text-red-700" role="alert">{err}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            goReview();
          }}
        >
          {/* Household contact — asked once for the whole party, saved against
              the primary guest. Powers the caterer matrix and any reminders. */}
          <Card className="p-5 mb-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="mb-1 text-2xl">Your household</h2>
              <button
                type="button"
                aria-expanded={householdOpen}
                className="shrink-0 text-xs uppercase tracking-[0.2em] text-sage-700 underline-offset-4 hover:underline"
                onClick={() => setHouseholdOpen((o) => !o)}
              >
                {householdOpen ? 'Done' : 'Edit name & address'}
              </button>
            </div>
            {!householdOpen && (
              <p className="text-sm text-charcoal-600 mb-3">
                {householdName || 'Your household'}
                <span className="block text-xs text-charcoal-500 mt-0.5">
                  {householdAddress || 'No postal address yet — add one so we can post you anything we need to.'}
                </span>
              </p>
            )}
            {householdOpen && (
              <div className="mt-3 mb-4 rounded-xl border border-ivory-300 bg-ivory-50 px-4 pt-4">
                <Field label="Household name" hint="How you’d like your household to appear — e.g. “Smith” or “Smith & Jones”.">
                  <Input
                    autoComplete="off"
                    maxLength={120}
                    value={householdDetails.name}
                    onChange={(e) => setHouseholdDetail({ name: e.target.value })}
                  />
                </Field>
                <Field label="Address line 1">
                  <Input
                    autoComplete="address-line1"
                    maxLength={120}
                    value={householdDetails.address_line1}
                    onChange={(e) => setHouseholdDetail({ address_line1: e.target.value })}
                  />
                </Field>
                <Field label="Address line 2" hint="Optional">
                  <Input
                    autoComplete="address-line2"
                    maxLength={120}
                    value={householdDetails.address_line2}
                    onChange={(e) => setHouseholdDetail({ address_line2: e.target.value })}
                  />
                </Field>
                <div className="grid gap-x-3 sm:grid-cols-2">
                  <Field label="Town / city">
                    <Input
                      autoComplete="address-level2"
                      maxLength={80}
                      value={householdDetails.city}
                      onChange={(e) => setHouseholdDetail({ city: e.target.value })}
                    />
                  </Field>
                  <Field label="Postcode">
                    <Input
                      autoComplete="postal-code"
                      maxLength={20}
                      value={householdDetails.postcode}
                      onChange={(e) => setHouseholdDetail({ postcode: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Country">
                  <Input
                    autoComplete="country-name"
                    maxLength={80}
                    value={householdDetails.country}
                    onChange={(e) => setHouseholdDetail({ country: e.target.value })}
                  />
                </Field>
              </div>
            )}
            <p className="text-xs text-charcoal-500 mb-3">
              One email and mobile number for your household — we’ll only use these for wedding updates.
            </p>
            <Field label="Email" hint="Optional — for reminders and any last-minute updates.">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Mobile" hint="Optional — handy for day-of messages.">
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={contact.phone}
                onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                placeholder="07…"
              />
            </Field>
          </Card>

          {guests.map((g) => (
            <Card key={g.id} className="p-5 mb-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-3xl">{fullName(g)}</h2>
                <button
                  type="button"
                  aria-expanded={!!detailsOpen[g.id]}
                  className="shrink-0 text-xs uppercase tracking-[0.2em] text-sage-700 underline-offset-4 hover:underline"
                  onClick={() => setDetailsOpen((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
                >
                  {detailsOpen[g.id] ? 'Done' : 'Edit details'}
                </button>
              </div>
              {detailsOpen[g.id] && (
                <div className="mt-4 rounded-xl border border-ivory-300 bg-ivory-50 px-4 pt-4">
                  <div className="grid gap-x-3 sm:grid-cols-2">
                    <Field label="First name">
                      <Input
                        autoComplete="off"
                        maxLength={80}
                        value={details[g.id]?.first_name || ''}
                        onChange={(e) => setDetail(g.id, { first_name: e.target.value })}
                      />
                    </Field>
                    <Field label="Last name">
                      <Input
                        autoComplete="off"
                        maxLength={80}
                        value={details[g.id]?.last_name || ''}
                        onChange={(e) => setDetail(g.id, { last_name: e.target.value })}
                      />
                    </Field>
                  </div>
                  {ownsHouseholdContact(g) ? (
                    <p className="pb-4 text-xs text-charcoal-500">Your email and mobile are the contact details at the top of this page.</p>
                  ) : (
                    <div className="grid gap-x-3 sm:grid-cols-2">
                      <Field label="Email" hint="Optional — their own, for updates.">
                        <Input
                          type="email"
                          inputMode="email"
                          autoComplete="off"
                          value={details[g.id]?.email || ''}
                          onChange={(e) => setDetail(g.id, { email: e.target.value })}
                          placeholder="name@example.com"
                        />
                      </Field>
                      <Field label="Mobile" hint="Optional.">
                        <Input
                          type="tel"
                          inputMode="tel"
                          autoComplete="off"
                          value={details[g.id]?.phone || ''}
                          onChange={(e) => setDetail(g.id, { phone: e.target.value })}
                          placeholder="07…"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}
              <div className="mb-5 mt-4 grid grid-cols-2 gap-2" role="group" aria-label={`Will ${firstName(g)} be attending?`}>
                {[
                  { value: true, label: 'Joyfully accepts' },
                  { value: false, label: 'Regretfully declines' },
                ].map((o) => {
                  const active = attending[g.id] === o.value;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setAttending((prev) => ({ ...prev, [g.id]: o.value }))}
                      className={cn(
                        'rounded-xl border px-3 py-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-500',
                        active ? 'border-sage-600 bg-sage-600 text-ivory-50' : 'border-charcoal-200 bg-white text-charcoal-600 hover:border-sage-400'
                      )}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>

              {attending[g.id] && (
                <>
                  <Field label="Dietary needs" hint="Any allergies or dietary requirements.">
                    <Input
                      value={form[g.id]?.dietary_needs || ''}
                      maxLength={500}
                      onChange={(e) => setField(g.id, 'dietary_needs', e.target.value)}
                      placeholder="e.g. vegetarian, allergies"
                    />
                  </Field>
                  <Field label="Meal preference" hint={g.dietary_choice ? 'Your saved choice shown below.' : 'Choose your meal.'}>
                    <Select value={mealValue(g)} onChange={(e) => setField(g.id, 'dietary_choice', e.target.value)}>
                      <option value="">TBD</option>
                      {mealOptions.map((o) => (
                        <option key={o} value={o}>{mealLabel(o)}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Song request" hint="Song & artist — one that gets you on the dance floor.">
                    <Input
                      value={form[g.id]?.song_request || ''}
                      maxLength={200}
                      onChange={(e) => setField(g.id, 'song_request', e.target.value)}
                      placeholder="A song you love..."
                    />
                  </Field>
                  <Field label="Accessibility requests" hint="Seating, mobility, or hearing needs.">
                    <Textarea
                      value={form[g.id]?.accessibility_requests || ''}
                      maxLength={500}
                      onChange={(e) => setField(g.id, 'accessibility_requests', e.target.value)}
                      placeholder="Any requests we should know about"
                    />
                  </Field>
                  <Field label="Message for the couple" hint="Optional — anything else you’d like us to know.">
                    <Textarea
                      value={form[g.id]?.rsvp_message || ''}
                      maxLength={1000}
                      onChange={(e) => setField(g.id, 'rsvp_message', e.target.value)}
                      placeholder="Anything else?"
                    />
                  </Field>
                  {g.plus_one_allowed && (
                    <div className="mt-4 border-t border-charcoal-100 pt-4">
                      <p className="mb-2 text-sm font-medium text-charcoal-800">Will {g.first_name} be bringing a plus-one?</p>
                      <div className="mb-4 grid grid-cols-2 gap-2" role="group" aria-label={`Will ${g.first_name} be bringing a plus-one?`}>
                        {[
                          { value: true, label: 'Yes, a plus-one' },
                          { value: false, label: 'No plus-one' },
                        ].map((o) => {
                          const active = plusOne[g.id]?.bringing === o.value;
                          return (
                            <button
                              key={o.label}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setPlusOneField(g.id, { bringing: o.value })}
                              className={cn(
                                'rounded-xl border px-3 py-3 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-500',
                                active ? 'border-sage-600 bg-sage-600 text-ivory-50' : 'border-charcoal-200 bg-white text-charcoal-600 hover:border-sage-400'
                              )}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                      {plusOne[g.id]?.bringing && (
                        <>
                          <Field label="Plus-one's first name" hint="Not sure who yet? Leave the name blank and add it later.">
                            <Input
                              value={plusOne[g.id]?.first_name || ''}
                              maxLength={80}
                              onChange={(e) => setPlusOneField(g.id, { first_name: e.target.value })}
                              autoComplete="off"
                            />
                          </Field>
                          <Field label="Plus-one's last name">
                            <Input
                              value={plusOne[g.id]?.last_name || ''}
                              maxLength={80}
                              onChange={(e) => setPlusOneField(g.id, { last_name: e.target.value })}
                              autoComplete="off"
                            />
                          </Field>
                          <Field label="Plus-one's dietary needs" hint="Any allergies or dietary requirements.">
                            <Input
                              value={plusOne[g.id]?.dietary_needs || ''}
                              maxLength={500}
                              onChange={(e) => setPlusOneField(g.id, { dietary_needs: e.target.value })}
                              placeholder="e.g. vegetarian, allergies"
                            />
                          </Field>
                          <Field label="Plus-one's meal preference">
                            <Select
                              value={mealOptions.find((o) => o.toLowerCase() === (plusOne[g.id]?.dietary_choice || '').toLowerCase()) || plusOne[g.id]?.dietary_choice || ''}
                              onChange={(e) => setPlusOneField(g.id, { dietary_choice: e.target.value })}
                            >
                              <option value="">TBD</option>
                              {mealOptions.map((o) => (
                                <option key={o} value={o}>{mealLabel(o)}</option>
                              ))}
                            </Select>
                          </Field>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {questions.map((q) => (
                <div key={q.id} className="mt-4 pt-4 border-t border-charcoal-100">
                  <p className="text-sm font-medium text-charcoal-800 mb-2">
                    {q.question}
                    {q.is_required && <span className="text-sage-600 ml-1">*</span>}
                  </p>
                  {q.question_type === 'textarea' ? (
                    <Textarea
                      value={answers[g.id]?.[q.id] || ''}
                      maxLength={1000}
                      onChange={(e) => setAnswer(g.id, q.id, e.target.value)}
                      rows={2}
                      placeholder="Your answer…"
                    />
                  ) : q.question_type === 'select' ? (
                    <Select value={answers[g.id]?.[q.id] || ''} onChange={(e) => setAnswer(g.id, q.id, e.target.value)}>
                      <option value="">Please choose…</option>
                      {(q.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : q.question_type === 'radio' || q.question_type === 'checkbox' ? (
                    <div className="space-y-2">
                      {(q.options || []).map((o) => {
                        const selected = (answers[g.id]?.[q.id] || '').split(', ').filter(Boolean);
                        const checked = selected.includes(o);
                        return (
                          <label key={o} className="flex items-center gap-2 text-sm text-charcoal-700 cursor-pointer">
                            <input
                              type={q.question_type === 'checkbox' ? 'checkbox' : 'radio'}
                              checked={checked}
                              onChange={
                                q.question_type === 'checkbox'
                                  ? () => toggleCheckboxOption(g.id, q, o)
                                  : () => setAnswer(g.id, q.id, o)
                              }
                              className="accent-sage-500"
                            />
                            {o}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <Input
                      value={answers[g.id]?.[q.id] || ''}
                      maxLength={1000}
                      onChange={(e) => setAnswer(g.id, q.id, e.target.value)}
                      placeholder="Your answer…"
                    />
                  )}
                </div>
              ))}
            </Card>
          ))}
          {questions.length > 0 && guests.length === 0 && (
            <Card className="p-5 mb-4">
              <p className="text-sm text-charcoal-600">No guests in this household yet.</p>
            </Card>
          )}
          <Button type="submit" className="mt-2 w-full">Review RSVP</Button>
        </form>
    </GuestShell>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'form', label: 'Your RSVP' },
    { key: 'review', label: 'Review' },
    { key: 'done', label: 'Sent' },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="flex items-center gap-2 mb-6" aria-label="RSVP steps">
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          <span
            className={`flex items-center gap-1.5 text-xs font-medium ${
              i === idx ? 'text-sage-700' : i < idx ? 'text-charcoal-400' : 'text-charcoal-300'
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] ${
                i === idx
                  ? 'bg-sage-600 text-white'
                  : i < idx
                    ? 'bg-sage-100 text-sage-700'
                    : 'bg-charcoal-100 text-charcoal-400'
              }`}
            >
              {i < idx ? '✓' : i + 1}
            </span>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="flex-1 h-px bg-charcoal-200" />}
        </React.Fragment>
      ))}
    </div>
  );
}