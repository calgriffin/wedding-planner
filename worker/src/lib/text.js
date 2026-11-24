// Pure text helpers: escaping, CSV, dates, names (moved verbatim from
// index.js, #3).

export function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, headers) {
  const cols = headers === '*' ? (rows.length ? Object.keys(rows[0]) : []) : headers;
  const lines = [cols.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push(cols.map((h) => csvEscape(r[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

export function humanTerm(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
  } catch {
    return String(iso).slice(0, 10);
  }
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.round((t - Date.now()) / 86400000);
}

export function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// HTML-escape user-entered text (names come from the plan's Setup at request
// time — this repo intentionally contains no personal data).
export function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Couple names for the static guest pages, sourced from Setup (never literals
// in source). Falls back to neutral placeholders so an empty Setup still
// renders a valid page.
export function coupleNames(opts = {}) {
  const raw1 = ((opts && opts.partner1_name) || '').trim();
  const raw2 = ((opts && opts.partner2_name) || '').trim();
  return {
    n1: escHtml(raw1 || 'PARTNER ONE'),
    n2: escHtml(raw2 || 'PARTNER TWO'),
  };
}

export function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
