/**
 * Wedding branding. The couple's wedding name lives in config, never in source
 * (README rule: the repo holds no personal data). wrangler.toml [vars]:
 *
 *   WEDDING_NAME        full name, e.g. "The Smith Wedding": page and email
 *                       titles, the email tagline, the login heading
 *   WEDDING_SHORT_NAME  one word, e.g. "Smith": the app-icon label, the nav,
 *                       and the ids built from it (cache name, storage keys,
 *                       backup filename, sample access code)
 *   WEDDING_HASHTAG     optional, e.g. "#TheSmithWedding": the guest pages'
 *                       footer (left out when unset)
 *
 * Every string the app shows is derived here, so the Worker and the SPA (which
 * reads the same values from meta tags the Worker fills in, see fillBrand)
 * agree. Unset values fall back to neutral wording ("Wedding Planner") and log
 * one warning per isolate, like configureSite.
 *
 * Page and email builders have no `env` to hand, so the fetch and scheduled
 * entry points call configureBrand(env) first (the same pattern as site.js).
 */

let configured = { name: '', short: '', hashtag: '' };
let warnedUnset = false;

function clean(value, max = 80) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "Smith" → "smith"; anything outside [a-z0-9] becomes a single "-". */
export function slugify(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Call once per request / cron run, before anything renders a page or email. */
export function configureBrand(env) {
  configured = {
    name: clean(env && env.WEDDING_NAME),
    short: clean(env && env.WEDDING_SHORT_NAME, 40),
    hashtag: clean(env && env.WEDDING_HASHTAG, 60),
  };
  if ((!configured.name || !configured.short) && !warnedUnset) {
    warnedUnset = true;
    const missing = ['WEDDING_NAME', 'WEDDING_SHORT_NAME'].filter((k) => !clean(env && env[k]));
    console.warn(`${missing.join(' and ')} not set: pages and emails use neutral "Wedding Planner" branding. Set them in wrangler.toml [vars].`);
  }
  return brand();
}

/** Every branded string, derived from the configured values (or neutral fallbacks). */
export function brand() {
  const { name, short, hashtag } = configured;
  const base = slugify(short);
  const slugBase = base ? `${base}-wedding` : 'wedding';
  return {
    // "The Smith Wedding"
    name: name || 'Wedding Planner',
    // <title>: "The Smith Wedding Planner"
    plannerTitle: name ? `${name} Planner` : 'Wedding Planner',
    // <meta name="description">
    description: `${name || 'Wedding Planner'} - Complete Wedding Planning System`,
    // App-icon label / manifest short_name: "Smith"
    appShortName: short || 'Wedding',
    // Nav heading: "Smith Wedding"
    navLabel: short ? `${short} Wedding` : 'Wedding Planner',
    // "#TheSmithWedding", or '' (then left out)
    hashtag,
    // Ids: "smith-wedding" (cache "smith-wedding-v2", "smith-wedding-backup-…")
    slugBase,
    // MCP serverInfo.name: "smith-wedding-planner"
    mcpServerName: `${slugBase}-planner`,
    // Sample access code prefix: "SMITH" (→ "SMITH-DEMO")
    codePrefix: base ? base.replace(/-/g, '').toUpperCase() : 'WEDDING',
    // Running text: "the Smith wedding"
    weddingPhrase: short ? `the ${short} wedding` : 'the wedding',
    // Email footer: "From the Smith Wedding Planner"
    emailFooter: short ? `From the ${short} Wedding Planner` : 'From your Wedding Planner',
    // Backup header: "Smith wedding planner"
    backupTitle: short ? `${short} wedding planner` : 'Wedding planner',
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const escapeJson = (value) => JSON.stringify(String(value)).slice(1, -1);
// Inside a single-quoted JS string; the slug is [a-z0-9-] anyway.
const escapeJs = (value) => String(value).replace(/[^a-z0-9-]/gi, '');

/**
 * Fill the %WP_BRAND_*% placeholders the build leaves in index.html, the web
 * manifest and the service worker. kind: 'html' | 'json' | 'js' picks the
 * escaping. Text without a placeholder comes back unchanged.
 */
export function fillBrand(text, kind = 'html') {
  if (typeof text !== 'string' || !text.includes('%WP_BRAND_')) return text;
  const b = brand();
  const esc = kind === 'json' ? escapeJson : kind === 'js' ? escapeJs : escapeHtml;
  const values = {
    NAME: b.name,
    SHORT: b.appShortName,
    TITLE: b.plannerTitle,
    DESCRIPTION: b.description,
    SLUG: b.slugBase,
    NAV: b.navLabel,
    CODE: b.codePrefix,
    // For the SPA (frontend/src/utils/brand.ts reads <meta name="wp-brand">)
    JSON: JSON.stringify({ name: b.name, nav: b.navLabel, slug: b.slugBase, code: b.codePrefix }),
  };
  return text.replace(/%WP_BRAND_([A-Z]+)%/g, (m, key) => (key in values ? esc(values[key]) : m));
}
