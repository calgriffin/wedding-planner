/**
 * GuestChrome: the shared look of the public v3 guest website — botanical
 * ornaments, the couple's monogram, scroll reveals and the page shell used by
 * the access-code and RSVP screens. Presentation only: no data fetching.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../utils/helpers';
import { brand } from '../../utils/brand';

// Where a guest's unlocked site lives for this tab. Content-only (no guest
// or household data); cleared when the tab closes, so shared computers stay safe.
// Built from the brand slug so the live keys stay exactly as before.
export const GUEST_SITE_UNLOCK_KEY = `${brand.slug}-guest-site-unlocked`;
const GUEST_CODE_KEY = `${brand.slug}-guest-code`;

/** Keeps the guest's access code for this tab so they only type it once. */
export function rememberCode(code: string) {
  try { sessionStorage.setItem(GUEST_CODE_KEY, code); } catch { /* private mode */ }
}

export function recallCode(): string {
  try { return sessionStorage.getItem(GUEST_CODE_KEY) || ''; } catch { return ''; }
}

export function coupleNames(data: any): string {
  return data?.couple?.name_one && data?.couple?.name_two
    ? `${data.couple.name_one} & ${data.couple.name_two}`
    : 'Our wedding';
}

/** Calendar-entry title: "Alex & Sam's wedding". */
export function weddingTitle(data: any): string {
  return data?.couple?.name_one && data?.couple?.name_two
    ? `${data.couple.name_one} & ${data.couple.name_two}'s wedding`
    : 'Our wedding';
}

/** "2027-06-12" -> "Saturday 12 June 2027" (parsed as a local calendar day). */
export function longDate(value: string | null | undefined): string {
  if (!value) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (isNaN(day.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(day)
    .replace(',', '');
}

/** "14:30" -> "2:30 pm". Anything unexpected is shown as written. */
export function friendlyTime(value: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value || '');
  if (!m) return value || '';
  const h = Number(m[1]);
  if (h > 23) return value || '';
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

const SPRIG_LEAF = 'M0 0C-3-6-10-8-14-6C-11-1-5 1 0 0Z';

function SprigHalf() {
  return (
    <>
      <path d="M70 12H14" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
      {[62, 50, 38, 26].map((x, i) => (
        <path key={x} d={SPRIG_LEAF} transform={`translate(${x} 12)${i % 2 ? ' scale(1 -1)' : ''}`} />
      ))}
      <path d="M0 0C-5-3-10-3-14 0C-10 3-5 3 0 0Z" transform="translate(16 12)" />
    </>
  );
}

/** A small leafy divider. Inherits its colour from the text colour. */
export function Sprig({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 24" className={cn('h-5 w-32', className)} fill="currentColor" aria-hidden="true">
      <SprigHalf />
      <g transform="translate(160 0) scale(-1 1)">
        <SprigHalf />
      </g>
      <path d="M80 8.5L83.5 12L80 15.5L76.5 12Z" />
    </svg>
  );
}

const WREATH_LEAF = 'M0 0C3.2-5 3.2-11 0-15.5C-3.2-11-3.2-5 0 0Z';
const rad = (deg: number) => (deg * Math.PI) / 180;
const WREATH_LEAVES = Array.from({ length: 8 }, (_, k) => {
  const t = 14 + k * 19.5;
  return {
    x: 60 + 50 * Math.sin(rad(t)),
    y: 60 + 50 * Math.cos(rad(t)),
    rotate: 90 - t + (k % 2 ? -32 : 30),
  };
});
const WREATH_STEM = `M${60 + 50 * Math.sin(rad(6))} ${60 + 50 * Math.cos(rad(6))}A50 50 0 0 0 ${60 + 50 * Math.sin(rad(158))} ${60 + 50 * Math.cos(rad(158))}`;

function WreathHalf() {
  return (
    <>
      <path d={WREATH_STEM} fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
      {WREATH_LEAVES.map((l, i) => (
        <path key={i} d={WREATH_LEAF} transform={`translate(${l.x.toFixed(2)} ${l.y.toFixed(2)}) rotate(${l.rotate.toFixed(1)})`} />
      ))}
    </>
  );
}

/** The couple's initials inside a laurel wreath. */
export function Monogram({ data, className, size = 'md' }: { data: any; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const a = (data?.couple?.name_one || '').trim().charAt(0).toUpperCase();
  const b = (data?.couple?.name_two || '').trim().charAt(0).toUpperCase();
  const box = size === 'lg' ? 'h-36 w-36 md:h-44 md:w-44' : size === 'sm' ? 'h-20 w-20' : 'h-28 w-28';
  const text = size === 'lg' ? 'text-4xl md:text-5xl' : size === 'sm' ? 'text-xl' : 'text-3xl';
  return (
    <div className={cn('relative inline-flex items-center justify-center', box, className)} aria-hidden="true">
      <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full" fill="currentColor">
        <WreathHalf />
        <g transform="translate(120 0) scale(-1 1)">
          <WreathHalf />
        </g>
      </svg>
      {a && b && (
        <span className={cn('font-display font-light leading-none tracking-wide', text)}>
          {a}
          <span className="mx-[0.12em] text-[0.6em] italic opacity-70">&amp;</span>
          {b}
        </span>
      )}
    </div>
  );
}

/** Fades its children up into place the first time they scroll into view. */
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn('gs-reveal', shown && 'is-in', className)} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/** Page shell for the access-code and RSVP screens. */
export function GuestShell({ children, width = 'max-w-xl' }: { children: React.ReactNode; width?: string }) {
  return (
    <main className="gs gs-paper min-h-screen pb-20">
      <div className={cn('mx-auto px-5 sm:px-6', width)}>
        <div className="flex items-center justify-between pt-6">
          <Link to="/" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-charcoal-500 transition-colors hover:text-sage-700">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to the site
          </Link>
        </div>
        <div className="flex justify-center pb-8 pt-8 text-sage-500">
          <Sprig />
        </div>
        {children}
      </div>
    </main>
  );
}

// ---- Form primitives for the RSVP journey (same props as components/ui) ----

export function Card({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('gs-card', className)}>{children}</div>;
}

interface GuestButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}
export function Button({ variant = 'primary', loading, className, children, disabled, ...rest }: GuestButtonProps) {
  return (
    <button
      className={cn(variant === 'primary' ? 'gs-btn-primary' : 'gs-btn-outline', 'px-5 text-center', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label?: string; hint?: string; children?: React.ReactNode }) {
  return (
    <label className="mb-5 block">
      {label && <span className="gs-label">{label}</span>}
      {children}
      {hint && <span className="gs-hint block">{hint}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => <input ref={ref} className={cn('gs-input', className)} {...rest} />
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...rest }, ref) => (
    <select ref={ref} className={cn('gs-input', className)} {...rest}>
      {children}
    </select>
  )
);
Select.displayName = 'Select';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => <textarea ref={ref} className={cn('gs-input resize-y', className)} {...rest} />
);
Textarea.displayName = 'Textarea';
