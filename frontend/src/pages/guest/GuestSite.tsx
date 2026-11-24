/**
 * GuestSite: the public v3 guest website. Renders ONLY published content from
 * GET /api/guest/site — every section hides itself when the couple hasn't
 * filled it in. Mobile-first, keyboard accessible, reduced-motion friendly.
 * The look (ornaments, monogram, reveals) lives in GuestChrome.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Accessibility, Baby, BedDouble, CalendarHeart, Car, ChevronDown, Clock, CloudSun, Gift, Mail, MapPin, Menu, Plus,
  Shirt, TrainFront, UserPlus, UtensilsCrossed, Wine, X, type LucideIcon,
} from 'lucide-react';
import { api } from '../../api/client';
import { cn, formatDate, calendarLinks } from '../../utils/helpers';
import {
  GUEST_SITE_UNLOCK_KEY, Monogram, Reveal, Sprig, coupleNames, friendlyTime, longDate, recallCode, rememberCode, weddingTitle,
} from './GuestChrome';

type Tone = 'ivory' | 'white';

function Section({
  id,
  eyebrow,
  title,
  tone,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn('scroll-mt-16 border-t border-ivory-200 px-5 py-20 sm:px-6 md:py-28', tone === 'white' ? 'bg-white' : 'bg-ivory-50')}
    >
      <div className="mx-auto max-w-5xl">
        <Reveal className="mb-12 text-center md:mb-16">
          <p className="gs-eyebrow mb-4">{eyebrow}</p>
          <h2 className="text-4xl font-light text-charcoal-900 md:text-6xl">{title}</h2>
          <Sprig className="mx-auto mt-6 text-sage-400" />
        </Reveal>
        {children}
      </div>
    </section>
  );
}

function InfoTile({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sage-200 bg-sage-50 text-sage-600">
        <Icon className="h-5 w-5" strokeWidth={1.4} aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-2xl text-charcoal-900">{title}</h3>
        <div className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-charcoal-600">{children}</div>
      </div>
    </div>
  );
}

function CalendarButtons({ data }: { data: any }) {
  const venue = [
    data.ceremony_venue && data.ceremony_venue !== 'TBC' ? data.ceremony_venue : '',
    data.content?.travel?.ceremony_address || '',
  ]
    .filter(Boolean)
    .join(', ');
  const cal = calendarLinks({
    title: weddingTitle(data),
    date: data.wedding_date || '',
    location: venue,
    description: data.content?.hero?.welcome || `We can't wait to celebrate with you.`,
  });
  if (!cal.google && !cal.ics) return null;
  return (
    <div className="mt-12 flex flex-col items-center gap-4">
      <p className="gs-eyebrow">Save the date</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {cal.google && (
          <a href={cal.google} target="_blank" rel="noreferrer" className="gs-btn-outline">
            Google Calendar
          </a>
        )}
        {cal.ics && (
          <a href={cal.ics} download={cal.downloadName} className="gs-btn-outline">
            Apple / Outlook
          </a>
        )}
      </div>
    </div>
  );
}

/** Days, hours, minutes and seconds until the wedding day begins. */
function Countdown({ date }: { date: string }) {
  const target = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (isNaN(target)) return null;
  const left = target - now;
  if (left <= -86400000) return null;
  if (left <= 0) {
    return <p className="font-display text-4xl font-light italic text-sage-700 md:text-5xl">Today’s the day</p>;
  }
  const units = [
    { label: 'Days', value: Math.floor(left / 86400000) },
    { label: 'Hours', value: Math.floor(left / 3600000) % 24 },
    { label: 'Minutes', value: Math.floor(left / 60000) % 60 },
    { label: 'Seconds', value: Math.floor(left / 1000) % 60 },
  ];
  return (
    <div className="flex items-start justify-center" role="timer" aria-label={`${units[0].value} days to go`}>
      {units.map((u, i) => (
        <div key={u.label} className={cn('w-20 px-2 text-center sm:w-28', i > 0 && 'border-l border-ivory-300')}>
          <p className="font-display text-4xl font-light tabular-nums text-charcoal-900 sm:text-6xl">{u.value}</p>
          <p className="mt-2 text-[10px] uppercase tracking-[0.25em] text-charcoal-500 sm:text-[11px]">{u.label}</p>
        </div>
      ))}
    </div>
  );
}

/** The couple's names, stacked on phones with a soft italic ampersand. */
function HeroNames({ data, heading }: { data: any; heading: string }) {
  if (heading) return <>{heading}</>;
  const one = data?.couple?.name_one;
  const two = data?.couple?.name_two;
  if (!one || !two) return <>Our wedding</>;
  return (
    <>
      <span className="block md:inline">{one}</span>{' '}
      <span className="my-1 block text-[0.55em] font-light italic opacity-80 md:mx-[0.15em] md:my-0 md:inline">&amp;</span>{' '}
      <span className="block md:inline">{two}</span>
    </>
  );
}

function VenueCard({ label, name, address, mapUrl, w3w }: { label: string; name?: string; address?: string; mapUrl?: string; w3w?: string }) {
  return (
    <div className="gs-card flex flex-col items-center p-8 text-center md:p-10">
      <MapPin className="h-6 w-6 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
      <p className="gs-eyebrow mt-4">{label}</p>
      {name && <h3 className="mt-3 text-3xl text-charcoal-900">{name}</h3>}
      {address && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-charcoal-600">{address}</p>}
      {w3w && (
        <p className="mt-4 text-sm text-charcoal-500">
          what3words <span className="font-medium text-charcoal-800">{w3w}</span>
        </p>
      )}
      {mapUrl && (
        <a href={mapUrl} target="_blank" rel="noreferrer" className="gs-btn-outline mt-6">
          Get directions
        </a>
      )}
    </div>
  );
}

/**
 * LockScreen: the public guest site shows only the couple's names and the
 * date. Guests unlock the details (venue, travel, schedule, FAQs…) with the
 * RSVP access code printed on their invitation.
 */
function LockScreen({ data, code, onUnlocked }: { data: any; code: string; onUnlocked: (full: any) => void }) {
  const [input, setInput] = useState(code || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoTried = useRef(false);

  const submit = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.guest.unlock({ code: value });
      if (r && r.unlocked && r.site) {
        try { sessionStorage.setItem(GUEST_SITE_UNLOCK_KEY, JSON.stringify(r.site)); } catch { /* private mode */ }
        rememberCode(value);
        onUnlocked(r.site);
      } else {
        setError('That code didn’t work — please double-check your invitation.');
      }
    } catch (e: any) {
      setError((e && e.message) || 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Invitation links may carry ?c=CODE — try it once on mount, then fall back
  // to the form if it's rejected.
  useEffect(() => {
    if (code && !autoTried.current) {
      autoTried.current = true;
      submit(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="gs gs-paper flex min-h-screen items-center justify-center px-5 py-16 sm:px-6">
      <div className="gs-rise w-full max-w-xl text-center">
        <Monogram data={data} className="text-sage-500" />
        <p className="gs-eyebrow mt-8">The wedding of</p>
        <h1 className="mt-5 text-6xl font-light leading-[1.05] text-charcoal-900 md:text-7xl">
          <HeroNames data={data} heading="" />
        </h1>
        {data?.wedding_date && (
          <p className="mt-7 text-xs uppercase tracking-[0.3em] text-charcoal-600 md:text-sm">{longDate(data.wedding_date)}</p>
        )}
        <Sprig className="mx-auto mt-8 text-sage-400" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && input.trim()) submit(input.trim());
          }}
          className="gs-card mx-auto mt-10 max-w-md px-6 py-8 sm:px-8"
        >
          <p className="text-[15px] leading-relaxed text-charcoal-600">
            Enter the access code from your invitation to see the details.
          </p>
          <label htmlFor="site-access-code" className="sr-only">Access code</label>
          <input
            id="site-access-code"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="e.g. 7K2-QM4"
            className="gs-input mt-5 text-center tracking-[0.15em]"
          />
          {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !input.trim()} className="gs-btn-primary mt-5 w-full">
            {busy ? 'Checking…' : 'View details'}
          </button>
        </form>
        <p className="mt-6 text-xs text-charcoal-500">Codes are printed on your invitation.</p>
      </div>
    </main>
  );
}

function scrollToId(id: string) {
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth';
  if (id === 'top') {
    window.scrollTo({ top: 0, behavior });
    return;
  }
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior, block: 'start' });
}

function SiteNav({
  data,
  links,
  overPhoto,
  rsvpHref,
}: {
  data: any;
  links: { id: string; label: string }[];
  overPhoto: boolean;
  rsvpHref: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setOpen(false);
    scrollToId(id);
  };

  const light = overPhoto && !scrolled;
  const a = (data?.couple?.name_one || '').trim().charAt(0).toUpperCase();
  const b = (data?.couple?.name_two || '').trim().charAt(0).toUpperCase();

  return (
    <>
      <nav
        aria-label="Sections"
        className={cn(
          'fixed inset-x-0 top-0 z-40 transition-all duration-500',
          scrolled ? 'border-b border-ivory-200 bg-ivory-50/90 shadow-sm backdrop-blur-md' : 'border-b border-transparent',
          light ? 'text-ivory-50' : 'text-charcoal-800'
        )}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
          <a href="#top" onClick={go('top')} className="font-display text-2xl font-light tracking-wide" aria-label="Back to the top">
            {a && b ? (
              <>
                {a}
                <span className="mx-1 text-lg italic opacity-70">&amp;</span>
                {b}
              </>
            ) : (
              'Our wedding'
            )}
          </a>
          <div className="hidden items-center gap-7 lg:flex">
            {links.map((l) => (
              <a
                key={l.id}
                href={`#${l.id}`}
                onClick={go(l.id)}
                className="text-[11px] uppercase tracking-[0.22em] opacity-80 transition-opacity hover:opacity-100"
              >
                {l.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {data.rsvp_open && (
              <Link
                to={rsvpHref}
                className={cn(
                  'inline-flex items-center rounded-full px-5 py-2 text-[11px] font-medium uppercase tracking-[0.22em] transition-colors',
                  light ? 'bg-ivory-50 text-charcoal-900 hover:bg-white' : 'bg-sage-600 text-ivory-50 hover:bg-sage-700'
                )}
              >
                RSVP
              </Link>
            )}
            {links.length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open menu"
                aria-expanded={open}
                className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full lg:hidden"
              >
                <Menu className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </nav>

      {open && (
        <div className="gs gs-paper fixed inset-0 z-50 flex flex-col lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex h-16 items-center justify-end px-5 sm:px-6">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              autoFocus
              className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-charcoal-800"
            >
              <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto pb-16">
            {data.rsvp_open && (
              <Link to={rsvpHref} className="gs-btn-primary">
                RSVP now
              </Link>
            )}
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} onClick={go(l.id)} className="font-display text-4xl font-light text-charcoal-900">
                {l.label}
              </a>
            ))}
            <Sprig className="mt-4 text-sage-400" />
          </div>
        </div>
      )}
    </>
  );
}

// Venue names/addresses compared loosely: case, punctuation and spacing don't count.
const placeKey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const samePlace = (a?: string, b?: string) => !!placeKey(a) && placeKey(a) === placeKey(b);
const differentPlace = (a?: string, b?: string) => !!placeKey(a) && !!placeKey(b) && placeKey(a) !== placeKey(b);

function GuestSite({ data, code }: { data: any; code: string }) {
  const content = data?.content || {};
  const hero = content.hero || {};
  const travel = content.travel || {};
  const expect = content.expect || {};
  const menu = content.menu || {};
  const gifts = content.gifts || {};
  const contact = content.contact || {};
  const faqs: any[] = (content.faqs || []).filter((f: any) => f.visible && f.question?.trim() && f.answer?.trim());
  const events: any[] = data?.events || [];
  // One venue when the couple ticked "same location", or when the ceremony and
  // reception names (or addresses) match and nothing else tells them apart.
  const sameVenue =
    !!content.same_venue ||
    ((samePlace(data.ceremony_venue, data.reception_venue) || samePlace(travel.ceremony_address, travel.reception_address)) &&
      !differentPlace(data.ceremony_venue, data.reception_venue) &&
      !differentPlace(travel.ceremony_address, travel.reception_address));
  // The first card/address: the ceremony's, or the shared venue's from whichever side was filled in.
  const firstVenue = {
    name: data.ceremony_venue || (sameVenue ? data.reception_venue : ''),
    address: travel.ceremony_address || (sameVenue ? travel.reception_address : ''),
    mapUrl: travel.ceremony_map_url || (sameVenue ? travel.reception_map_url : ''),
    w3w: travel.ceremony_w3w || (sameVenue ? travel.reception_w3w : ''),
  };
  const secondVenue = {
    name: data.reception_venue,
    address: sameVenue ? '' : travel.reception_address,
    mapUrl: sameVenue ? '' : travel.reception_map_url,
    w3w: sameVenue ? '' : travel.reception_w3w,
  };
  // A map link or what3words on its own still earns the venue its card.
  const showFirstVenue = !!(firstVenue.address || firstVenue.mapUrl || firstVenue.w3w);
  const showSecondVenue = !!(secondVenue.address || secondVenue.mapUrl || secondVenue.w3w);

  const [openFaq, setOpenFaq] = useState<string | null>(null);

  const names = coupleNames(data);
  const rsvpHref = code ? `/guest/access?c=${encodeURIComponent(code)}` : '/guest/access';

  const nowIso = new Date().toISOString();
  const opensInFuture = data?.rsvp_opens_at && data.rsvp_opens_at > nowIso;
  const closesInPast = data?.rsvp_closes_at && data.rsvp_closes_at < nowIso;

  const hasDetails = !!(data.ceremony_venue || data.reception_venue || data.wedding_date);
  const hasTravel = !!(showFirstVenue || showSecondVenue || travel.arrival || travel.parking || travel.transport || travel.accommodation || travel.accessibility);
  const hasExpect = !!(expect.dress_code || expect.weather || expect.food_drink || expect.children || expect.plus_ones);
  const hasGifts = !!(gifts.note || gifts.registry_url);
  const hasPhoto = !!hero.photo_url;

  const links = [
    hasDetails && { id: 'details', label: 'Details' },
    events.length > 0 && { id: 'schedule', label: 'Schedule' },
    hasTravel && { id: 'travel', label: 'Travel' },
    hasExpect && { id: 'expect', label: 'Good to know' },
    !!menu.body && { id: 'menu', label: 'Menu' },
    faqs.length > 0 && { id: 'faqs', label: 'Q & A' },
    hasGifts && { id: 'gifts', label: 'Gifts' },
  ].filter(Boolean) as { id: string; label: string }[];

  // Sections alternate white / ivory in whatever order the couple has filled in.
  let band = 0;
  const nextTone = (): Tone => (band++ % 2 === 0 ? 'white' : 'ivory');

  // Events on more than one day get a date heading per day.
  const eventDays: { date: string; items: any[] }[] = [];
  events.forEach((ev) => {
    const last = eventDays[eventDays.length - 1];
    if (last && last.date === (ev.date || '')) last.items.push(ev);
    else eventDays.push({ date: ev.date || '', items: [ev] });
  });

  const place = data.ceremony_venue && data.ceremony_venue !== 'TBC' ? data.ceremony_venue : '';

  const heroText = (
    <div className="gs-rise mx-auto max-w-4xl px-5 text-center sm:px-6">
      <p className={cn('text-[11px] font-medium uppercase tracking-[0.36em]', hasPhoto ? 'text-ivory-50/90' : 'text-sage-600')}>
        We’re getting married
      </p>
      <h1 className={cn('mt-6 text-6xl font-light leading-[1.02] sm:text-7xl md:text-8xl', hasPhoto ? 'text-ivory-50 drop-shadow-md' : 'text-charcoal-900')}>
        <HeroNames data={data} heading={hero.heading || ''} />
      </h1>
      <Sprig className={cn('mx-auto mt-8', hasPhoto ? 'text-ivory-50/80' : 'text-sage-400')} />
      {data.wedding_date && (
        <p className={cn('mt-7 text-xs uppercase tracking-[0.3em] sm:text-sm', hasPhoto ? 'text-ivory-50' : 'text-charcoal-700')}>
          {longDate(data.wedding_date)}
        </p>
      )}
      {place && (
        <p className={cn('mt-3 font-display text-2xl font-light italic', hasPhoto ? 'text-ivory-50/90' : 'text-charcoal-500')}>{place}</p>
      )}
      {data.rsvp_open && (
        <Link to={rsvpHref} className={cn('mt-10', hasPhoto ? 'gs-btn-light' : 'gs-btn-primary')}>
          RSVP now
        </Link>
      )}
    </div>
  );

  return (
    <main id="top" className="gs min-h-screen">
      <SiteNav data={data} links={links} overPhoto={hasPhoto} rsvpHref={rsvpHref} />

      {/* Hero */}
      {hasPhoto ? (
        <header className="relative isolate flex min-h-[100svh] items-center justify-center overflow-hidden bg-charcoal-950 py-28">
          <img src={hero.photo_url} alt={hero.photo_alt || ''} className="gs-hero-photo absolute inset-0 -z-10 h-full w-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-charcoal-950/60 via-charcoal-950/35 to-charcoal-950/70" aria-hidden="true" />
          {heroText}
          <a
            href="#welcome"
            onClick={(e) => { e.preventDefault(); scrollToId('welcome'); }}
            aria-label="Scroll to the details"
            className="gs-bob absolute bottom-6 left-1/2 -ml-5 flex h-10 w-10 items-center justify-center text-ivory-50/80"
          >
            <ChevronDown className="h-6 w-6" strokeWidth={1.2} aria-hidden="true" />
          </a>
        </header>
      ) : (
        <header className="gs-paper relative flex min-h-[92svh] flex-col items-center justify-center overflow-hidden pb-20 pt-28">
          <Monogram data={data} size="lg" className="gs-rise mb-10 text-sage-500" />
          {heroText}
        </header>
      )}

      {/* Welcome + countdown + RSVP */}
      <section id="welcome" className="scroll-mt-16 bg-ivory-50 px-5 py-20 text-center sm:px-6 md:py-28">
        <Reveal className="mx-auto max-w-3xl">
          {hero.welcome && (
            <p className="whitespace-pre-line font-display text-2xl font-light italic leading-relaxed text-charcoal-700 md:text-[2rem] md:leading-relaxed">
              {hero.welcome}
            </p>
          )}
          {data.wedding_date && (
            <div className={cn(hero.welcome && 'mt-14')}>
              <Countdown date={data.wedding_date} />
            </div>
          )}
          <div className="mt-12">
            {data.rsvp_open ? (
              <div id="rsvp" className="gs-card mx-auto max-w-xl scroll-mt-24 px-6 py-10 sm:px-10">
                <p className="gs-eyebrow">Kindly reply</p>
                <h2 className="mt-3 text-4xl font-light text-charcoal-900">RSVP</h2>
                <p className="mt-4 text-[15px] leading-relaxed text-charcoal-600">
                  Let us know whether you can make it. One reply covers everyone on your invitation and takes a couple of minutes.
                </p>
                <Link to={rsvpHref} className="gs-btn-primary mt-7">
                  RSVP now
                </Link>
                {data.rsvp_closes_at && (
                  <p className="mt-4 text-sm text-charcoal-500">Please reply by {longDate(data.rsvp_closes_at.slice(0, 10))}</p>
                )}
              </div>
            ) : opensInFuture ? (
              <p className="text-[15px] text-charcoal-600">RSVPs open {formatDate(data.rsvp_opens_at.slice(0, 10))} — your invitation will have the details.</p>
            ) : closesInPast ? (
              <p className="text-[15px] text-charcoal-600">RSVPs have now closed{contact.email ? <> — anything urgent, <a className="text-sage-700 underline underline-offset-4" href={`mailto:${contact.email}`}>contact us</a>.</> : '.'}</p>
            ) : (
              <p className="text-[15px] text-charcoal-600">RSVP details coming soon — save the date.</p>
            )}
          </div>
        </Reveal>
      </section>

      {/* At a glance */}
      {hasDetails && (
        <Section id="details" eyebrow="The details" title="At a glance" tone={nextTone()}>
          <Reveal>
            <div className={cn('mx-auto grid gap-5', sameVenue || !data.reception_venue || !firstVenue.name ? 'max-w-3xl sm:grid-cols-2' : 'md:grid-cols-3')}>
              <div className="gs-card flex flex-col items-center px-6 py-10 text-center">
                <CalendarHeart className="h-6 w-6 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
                <p className="gs-eyebrow mt-4">Date</p>
                <p className="mt-3 font-display text-3xl text-charcoal-900">{data.wedding_date ? longDate(data.wedding_date) : 'To be announced'}</p>
              </div>
              {firstVenue.name && (
                <div className="gs-card flex flex-col items-center px-6 py-10 text-center">
                  <MapPin className="h-6 w-6 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
                  <p className="gs-eyebrow mt-4">{sameVenue ? 'Venue' : 'Ceremony'}</p>
                  <p className="mt-3 font-display text-3xl text-charcoal-900">{firstVenue.name}</p>
                </div>
              )}
              {!sameVenue && data.reception_venue && (
                <div className="gs-card flex flex-col items-center px-6 py-10 text-center">
                  <Wine className="h-6 w-6 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
                  <p className="gs-eyebrow mt-4">Reception</p>
                  <p className="mt-3 font-display text-3xl text-charcoal-900">{data.reception_venue}</p>
                </div>
              )}
            </div>
            {data.wedding_date && <CalendarButtons data={data} />}
          </Reveal>
        </Section>
      )}

      {/* Schedule */}
      {events.length > 0 && (
        <Section id="schedule" eyebrow="The day" title="Schedule" tone={nextTone()}>
          <div className="mx-auto max-w-2xl">
            {eventDays.map((day, d) => (
              <div key={day.date || d} className={cn(d > 0 && 'mt-14')}>
                {eventDays.length > 1 && day.date && (
                  <Reveal>
                    <p className="mb-8 text-center font-display text-2xl italic text-sage-700">{longDate(day.date)}</p>
                  </Reveal>
                )}
                <ol className="relative">
                  <span className="absolute bottom-3 left-[5px] top-3 w-px bg-sage-200 sm:left-[9.5rem]" aria-hidden="true" />
                  {day.items.map((ev) => (
                    <li key={ev.id} className="relative pb-10 pl-9 last:pb-0 sm:pl-[12rem]">
                      <span className="absolute left-0 top-2 h-[11px] w-[11px] rounded-full border border-sage-500 bg-ivory-50 sm:left-[calc(9.5rem-5px)]" aria-hidden="true" />
                      <Reveal>
                        {(ev.start_time || ev.end_time) && (
                          <p className="mb-1 font-display text-2xl text-sage-700 sm:absolute sm:left-0 sm:top-0 sm:mb-0 sm:w-[8rem] sm:text-right">
                            {friendlyTime(ev.start_time)}
                            {ev.end_time && (
                              <span className="ml-2 font-jost text-xs uppercase tracking-[0.15em] text-charcoal-400 sm:ml-0 sm:mt-1 sm:block">
                                until {friendlyTime(ev.end_time)}
                              </span>
                            )}
                          </p>
                        )}
                        <h3 className="text-3xl leading-tight text-charcoal-900">{ev.title}</h3>
                        {ev.venue && <p className="mt-1.5 text-xs uppercase tracking-[0.2em] text-charcoal-500">{ev.venue}</p>}
                        {ev.description && <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-charcoal-600">{ev.description}</p>}
                      </Reveal>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Getting there */}
      {hasTravel && (
        <Section id="travel" eyebrow="Travel" title="Getting there & staying" tone={nextTone()}>
          {(showFirstVenue || showSecondVenue) && (
            <Reveal>
              <div className={cn('mx-auto grid gap-5', showFirstVenue && showSecondVenue ? 'md:grid-cols-2' : 'max-w-xl')}>
                {showFirstVenue && (
                  <VenueCard
                    label={sameVenue ? 'Venue' : 'Ceremony'}
                    name={firstVenue.name}
                    address={firstVenue.address}
                    mapUrl={firstVenue.mapUrl}
                    w3w={firstVenue.w3w}
                  />
                )}
                {showSecondVenue && (
                  <VenueCard
                    label="Reception"
                    name={secondVenue.name}
                    address={secondVenue.address}
                    mapUrl={secondVenue.mapUrl}
                    w3w={secondVenue.w3w}
                  />
                )}
              </div>
            </Reveal>
          )}
          {(travel.arrival || travel.parking || travel.transport || travel.accommodation || travel.accessibility) && (
            <Reveal className="mx-auto mt-14 grid max-w-4xl gap-x-12 gap-y-10 md:grid-cols-2">
              {travel.arrival && <InfoTile icon={Clock} title="Arrival">{travel.arrival}</InfoTile>}
              {travel.parking && <InfoTile icon={Car} title="Parking">{travel.parking}</InfoTile>}
              {travel.transport && <InfoTile icon={TrainFront} title="Public transport & taxis">{travel.transport}</InfoTile>}
              {travel.accommodation && <InfoTile icon={BedDouble} title="Where to stay">{travel.accommodation}</InfoTile>}
              {travel.accessibility && <InfoTile icon={Accessibility} title="Accessibility">{travel.accessibility}</InfoTile>}
            </Reveal>
          )}
        </Section>
      )}

      {/* What to expect */}
      {hasExpect && (
        <Section id="expect" eyebrow="Practicalities" title="What to expect" tone={nextTone()}>
          <Reveal className="mx-auto grid max-w-4xl gap-x-12 gap-y-10 md:grid-cols-2">
            {expect.dress_code && <InfoTile icon={Shirt} title="Dress code">{expect.dress_code}</InfoTile>}
            {expect.weather && <InfoTile icon={CloudSun} title="Outdoors & weather">{expect.weather}</InfoTile>}
            {expect.food_drink && <InfoTile icon={UtensilsCrossed} title="Food & drink">{expect.food_drink}</InfoTile>}
            {expect.children && <InfoTile icon={Baby} title="Children">{expect.children}</InfoTile>}
            {expect.plus_ones && <InfoTile icon={UserPlus} title="Plus-ones">{expect.plus_ones}</InfoTile>}
          </Reveal>
        </Section>
      )}

      {/* Menu */}
      {menu.body && (
        <Section id="menu" eyebrow="Food & drink" title={menu.title || 'On the menu'} tone={nextTone()}>
          <Reveal>
            <div className="gs-card mx-auto max-w-xl p-3">
              <div className="rounded-xl border border-sage-200 px-6 py-12 text-center sm:px-12">
                <UtensilsCrossed className="mx-auto h-6 w-6 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
                <div className="mt-8 whitespace-pre-line font-display text-2xl font-light leading-loose text-charcoal-800">{menu.body}</div>
                <Sprig className="mx-auto mt-8 text-sage-400" />
              </div>
            </div>
          </Reveal>
        </Section>
      )}

      {/* FAQs */}
      {faqs.length > 0 && (
        <Section id="faqs" eyebrow="Questions" title="Q & A" tone={nextTone()}>
          <Reveal className="mx-auto max-w-2xl border-b border-ivory-300">
            {faqs.map((f) => {
              const open = openFaq === f.id;
              return (
                <div key={f.id} className="border-t border-ivory-300">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : f.id)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-6 py-6 text-left"
                  >
                    <span className="font-display text-2xl leading-snug text-charcoal-900">{f.question}</span>
                    <Plus className={cn('h-5 w-5 shrink-0 text-sage-600 transition-transform duration-300', open && 'rotate-45')} strokeWidth={1.3} aria-hidden="true" />
                  </button>
                  <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                    <div className="overflow-hidden">
                      {open && <p className="whitespace-pre-line pb-7 pr-10 text-[15px] leading-relaxed text-charcoal-600">{f.answer}</p>}
                    </div>
                  </div>
                </div>
              );
            })}
          </Reveal>
        </Section>
      )}

      {/* Gifts */}
      {hasGifts && (
        <Section id="gifts" eyebrow="Gifts" title="If you'd like to" tone={nextTone()}>
          <Reveal className="mx-auto max-w-2xl text-center">
            <Gift className="mx-auto h-6 w-6 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
            {gifts.note && <p className="mt-6 whitespace-pre-line text-base leading-relaxed text-charcoal-600">{gifts.note}</p>}
            {gifts.registry_url && (
              <a href={gifts.registry_url} target="_blank" rel="noreferrer" className="gs-btn-outline mt-8">
                View our gift list
              </a>
            )}
          </Reveal>
        </Section>
      )}

      {/* Contact */}
      {contact.email && (
        <Section id="contact" eyebrow="Questions" title="Before the day" tone={nextTone()}>
          <Reveal className="mx-auto max-w-2xl text-center">
            <Mail className="mx-auto h-6 w-6 text-sage-500" strokeWidth={1.3} aria-hidden="true" />
            <p className="mt-6 text-base leading-relaxed text-charcoal-600">
              Anything we haven’t covered? Email us at{' '}
              <a href={`mailto:${contact.email}`} className="break-words text-sage-700 underline underline-offset-4">{contact.email}</a>.
            </p>
          </Reveal>
        </Section>
      )}

      {/* Footer + final RSVP */}
      <footer className="bg-sage-800 px-5 py-20 text-center text-ivory-50 sm:px-6 md:py-24">
        <Reveal>
          <Monogram data={data} className="text-ivory-200" />
          <p className="mt-8 font-display text-4xl font-light md:text-5xl">{names}</p>
          {data.wedding_date && <p className="mt-4 text-xs uppercase tracking-[0.3em] text-ivory-200">{longDate(data.wedding_date)}</p>}
          {data.rsvp_open && (
            <div>
              <Link to={rsvpHref} className="gs-btn-light mt-10">
                RSVP now
              </Link>
            </div>
          )}
          <p className="mt-10 font-display text-xl font-light italic text-ivory-200">We can’t wait to celebrate with you.</p>
        </Reveal>
      </footer>
    </main>
  );
}

export default function GuestSitePage() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [search] = useSearchParams();
  // The code from the invitation link, or the one already used in this tab.
  const [code] = useState(() => search.get('c') || search.get('code') || recallCode());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The v3 preview host shows the couple's DRAFT when signed in; the
        // public site only ever receives published content.
        const isPreviewHost = typeof window !== 'undefined' && /^v[1-5]\./.test(window.location.hostname);
        // A guest who already unlocked keeps the full site for this tab
        // (session storage: cleared when the tab closes, so shared computers
        // don't linger — no household data is ever cached, site content only).
        if (!isPreviewHost) {
          try {
            const cached = sessionStorage.getItem(GUEST_SITE_UNLOCK_KEY);
            if (cached) {
              const parsed = JSON.parse(cached);
              if (parsed && parsed.content) {
                if (!cancelled) setData(parsed);
                // The saved copy shows instantly; then pick up anything the
                // couple has published since, using the code from this tab.
                const saved = recallCode();
                if (saved) {
                  api.guest.unlock({ code: saved }).then((r) => {
                    if (!r || !r.unlocked || !r.site) return;
                    try { sessionStorage.setItem(GUEST_SITE_UNLOCK_KEY, JSON.stringify(r.site)); } catch { /* private mode */ }
                    if (!cancelled) setData(r.site);
                  }).catch(() => { /* offline or rate-limited — keep the saved copy */ });
                }
                return;
              }
            }
          } catch { /* corrupt cache — refetch below */ }
        }
        const d = await api.guest.site(isPreviewHost);
        if (!cancelled) setData(d);
      } catch (e: any) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!data) return;
    const names = data.couple?.name_one && data.couple?.name_two ? `${data.couple.name_one} & ${data.couple.name_two}` : 'Wedding';
    document.title = `${names} — Wedding`;
    let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!data.content?.search_index) {
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'robots');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', 'noindex, nofollow');
    } else if (meta) {
      meta.remove();
    }
    if (window.location.hash === '#details') {
      requestAnimationFrame(() => scrollToId('details'));
    }
  }, [data]);

  if (loading) {
    return (
      <div className="gs gs-paper flex min-h-screen flex-col items-center justify-center" role="status">
        <Sprig className="animate-pulse text-sage-400" />
        <p className="mt-4 text-[11px] uppercase tracking-[0.3em] text-charcoal-500">Loading…</p>
      </div>
    );
  }
  if (err) {
    return (
      <div className="gs gs-paper flex min-h-screen items-center justify-center px-6 text-center">
        <div>
          <Sprig className="mx-auto text-sage-400" />
          <h2 className="mb-2 mt-6 text-4xl font-light text-charcoal-900">Something went wrong</h2>
          <p className="text-[15px] text-charcoal-600">{err}</p>
        </div>
      </div>
    );
  }
  if (data?.locked === true) {
    return <LockScreen data={data} code={code} onUnlocked={(full) => setData(full)} />;
  }
  return <GuestSite data={data} code={code} />;
}
