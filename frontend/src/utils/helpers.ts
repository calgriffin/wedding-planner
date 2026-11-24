/**
 * Utility functions for the wedding planner
 */

import { siteDomain } from './site';
import { brand } from './brand';

// Currency formatting (GBP, stored in pence)
export function formatCurrency(pence: number | null | undefined): string {
  if (pence === null || pence === undefined || isNaN(pence)) return '—';
  const pounds = pence / 100;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(pounds);
}

export function formatCurrencyWithPence(pence: number | null | undefined): string {
  if (pence === null || pence === undefined || isNaN(pence)) return '—';
  const pounds = pence / 100;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pounds);
}

export function parseCurrency(input: string): number {
  // Parse "£1,234" or "£1,234.56" to pence
  const cleaned = input.replace(/[£,\s]/g, '');
  const pounds = parseFloat(cleaned);
  if (isNaN(pounds)) return 0;
  return Math.round(pounds * 100);
}

// Date formatting (UK format)
export function formatDate(dateString: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...options,
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatDateShort(dateString: string | null | undefined): string {
  return formatDate(dateString, { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatTime(timeString: string | null | undefined): string {
  if (!timeString) return '—';
  // Expects HH:MM format
  return timeString.substring(0, 5);
}

// Date calculations
export function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + weeks * 7);
  return result;
}

export function weeksUntil(targetDate: string | null | undefined): number | null {
  if (!targetDate) return null;
  const target = new Date(targetDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7));
}

export function isOverdue(dateString: string | null | undefined): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

export function isDueThisWeek(dateString: string | null | undefined): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today);
  nextWeek.setDate(today.getDate() + 7);
  return date >= today && date < nextWeek;
}

export function daysUntilHuman(dateString: string | null | undefined): string {
  if (!dateString) return 'No deadline';
  const target = new Date(dateString);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays < 0) return `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`;
  return `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

// Generate unique IDs
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function generateInvitationCode(): string {
  // Crypto RNG: the server also accepts these as guest-site access codes.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing chars
  const picked = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => chars[b % chars.length]).join('');
  return `${picked.slice(0, 4)}-${picked.slice(4)}`;
}

// Status helpers
export function getStatusBadgeClass(status: string): string {
  const classes: Record<string, string> = {
    // Task statuses
    not_started: 'badge-neutral',
    in_progress: 'badge-info',
    waiting: 'badge-warning',
    done: 'badge-success',
    not_applicable: 'badge-neutral',

    // Guest statuses
    potential: 'badge-neutral',
    invited: 'badge-info',
    confirmed: 'badge-success',
    declined: 'badge-danger',
    evening_only: 'badge-warning',

    // Payment statuses
    pending: 'badge-warning',
    paid: 'badge-success',
    overdue: 'badge-danger',
    refunded: 'badge-info',

    // Supplier booking statuses
    researching: 'badge-neutral',
    shortlisted: 'badge-info',
    contacted: 'badge-info',
    quoted: 'badge-warning',
    booked: 'badge-success',

    // Decision statuses
    open: 'badge-warning',
    decided: 'badge-success',
    deferred: 'badge-neutral',

    // Event statuses
    planning: 'badge-info',
    completed: 'badge-success',
    cancelled: 'badge-danger',

    // RSVP match statuses
    matched: 'badge-success',
    unmatched: 'badge-danger',
    duplicate: 'badge-warning',
    conflict: 'badge-danger',
    pending_review: 'badge-warning',

    // RSVP review statuses
    accepted: 'badge-success',
    rejected: 'badge-danger',
    flagged: 'badge-warning',
  };
  return classes[status] || 'badge-neutral';
}

export function formatStatusLabel(status: string): string {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Number formatting
export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num)) return '—';
  return new Intl.NumberFormat('en-GB').format(num);
}

export function formatPercent(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

// Color utilities for charts/progress
export function getProgressColor(percent: number): string {
  if (percent >= 100) return 'text-green-600';
  if (percent >= 80) return 'text-amber-600';
  if (percent >= 50) return 'text-blue-600';
  return 'text-red-600';
}

export function getProgressBgColor(percent: number): string {
  if (percent >= 100) return 'bg-green-500';
  if (percent >= 80) return 'bg-amber-500';
  if (percent >= 50) return 'bg-blue-500';
  return 'bg-red-500';
}

// Debounce
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Class name utility (using clsx pattern)
export function cn(...classes: (string | boolean | undefined | null | Record<string, boolean>)[]): string {
  return classes
    .flatMap(c => {
      if (!c) return [];
      if (typeof c === 'string') return c.split(' ');
      if (typeof c === 'object') return Object.entries(c).filter(([, v]) => v).map(([k]) => k);
      return [];
    })
    .join(' ');
}

// ---- Add-to-calendar helpers (guest RSVP journey) --------------------------
// Builds Google Calendar + downloadable .ics payloads for the wedding day.
export interface CalendarLinkInput {
  title: string;
  date: string; // YYYY-MM-DD (all-day event)
  location?: string;
  description?: string;
}
export function calendarLinks({ title, date, location = '', description = '' }: CalendarLinkInput): {
  google: string;
  ics: string; // data: URI with the .ics content
  downloadName: string;
} {
  const when = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replace(/-/g, '') : '';
  const google =
    when && title
      ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}` +
        `&dates=${when}/${endDate(when)}` +
        (location ? `&location=${encodeURIComponent(location)}` : '') +
        (description ? `&details=${encodeURIComponent(description)}` : '')
      : '';
  const ics =
    when && title
      ? `data:text/calendar;charset=utf-8,` +
        encodeURIComponent(
          ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${brand.nav}//EN`, 'BEGIN:VEVENT',
            `UID:wedding-${when}@${siteDomain()}`, `DTSTART;VALUE=DATE:${when}`, `DTEND;VALUE=DATE:${endDate(when)}`,
            `SUMMARY:${icsText(title)}`, location ? `LOCATION:${icsText(location)}` : '',
            description ? `DESCRIPTION:${icsText(description)}` : '',
            'END:VEVENT', 'END:VCALENDAR']
            .filter(Boolean)
            .join('\r\n')
        )
      : '';
  return { google, ics, downloadName: when ? `wedding-${when}.ics` : 'wedding.ics' };
}
// iCalendar TEXT escaping: a venue address is full of commas, and a welcome
// message can span lines.
function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
}
function endDate(d: string): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(4, 6));
  const day = Number(d.slice(6, 8));
  const end = new Date(Date.UTC(y, m - 1, day + 1));
  return end.toISOString().slice(0, 10).replace(/-/g, '');
}

// Storage keys
export const STORAGE_KEYS = {
  SETUP: 'wedding_setup',
  TASKS: 'wedding_tasks',
  BUDGET_CATEGORIES: 'wedding_budget_categories',
  BUDGET_ITEMS: 'wedding_budget_items',
  PAYMENTS: 'wedding_payments',
  GUESTS: 'wedding_guests',
  HOUSEHOLDS: 'wedding_households',
  SUPPLIERS: 'wedding_suppliers',
  DECISIONS: 'wedding_decisions',
  TABLES: 'wedding_tables',
  SEATING: 'wedding_seating',
  LOGISTICS: 'wedding_logistics',
  RUN_SHEET: 'wedding_run_sheet',
  CONTACTS: 'wedding_contacts',
  PACKING: 'wedding_packing',
  EVENTS: 'wedding_events',
  RSVP_IMPORTS: 'wedding_rsvp_imports',
} as const;

// Local storage helpers (for offline-first)
export function getFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) return JSON.parse(stored);
  } catch {
    // Ignore parse errors
  }
  return defaultValue;
}

export function setToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors
  }
}

// Export to CSV
export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string
): void {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const rows = data.map(item =>
    headers.map(header => {
      const value = item[header];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value).replace(/"/g, '""');
    }).map(v => `"${v}"`).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${formatDateShort(new Date().toISOString())}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Print utility
export function printElement(elementId: string, title: string): void {
  const element = document.getElementById(elementId);
  if (!element) return;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        body { font-family: Georgia, serif; margin: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #333; padding: 8px; text-align: left; font-size: 12px; }
        th { background: #f0f0f0; }
        h1 { text-align: center; color: #333; }
        .print-header { text-align: center; margin-bottom: 30px; }
        @page { margin: 15mm; }
      </style>
    </head>
    <body>
      <div class="print-header">
        <h1>${title}</h1>
        <p>Generated: ${formatDate(new Date().toISOString())}</p>
      </div>
      ${element.innerHTML}
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
}