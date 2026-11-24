/**
 * Site hostnames — every host and link the Worker builds comes from ONE
 * setting, SITE_DOMAIN (wrangler.toml [vars], e.g. "example.com"):
 *
 *   apex / www.<domain>   public guest site
 *   plan.<domain>         the couple's plan portal
 *   v1…v5.<domain>        private previews of each guest-site mode
 *   family.<domain>       family payment portal (FAMILY_HOST overrides it)
 *   .<domain>             session-cookie Domain, so the plan login also
 *                         unlocks the preview subdomains
 *
 * Page and email builders have no `env` to hand, so the fetch and scheduled
 * entry points call configureSite(env, hostname) first. An isolate serves a
 * single Worker with a single env, so this module state never mixes
 * deployments. Functions that do receive env read it directly.
 *
 * SITE_DOMAIN unset (local tests, a fork): the domain is derived from the
 * request's hostname with any known subdomain prefix stripped.
 */

const KNOWN_PREFIX = /^(?:plan|www|family|mcp|v[1-5])\./;

let configured = '';
let warnedUnset = false;

function normalizeDomain(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\.+|\.+$/g, '');
}

/** Domain derived from a request hostname: "plan.example.com" → "example.com". */
export function domainFromHostname(hostname) {
  return normalizeDomain(hostname).replace(/:\d+$/, '').replace(KNOWN_PREFIX, '');
}

/** Call once per request / cron run, before anything builds a link. */
export function configureSite(env, hostname = '') {
  const fromEnv = normalizeDomain(env && env.SITE_DOMAIN);
  if (!fromEnv && !warnedUnset) {
    // Once per isolate: a cron run has no request host to fall back on, so
    // its emails would go out with empty plan / RSVP links.
    warnedUnset = true;
    console.error(hostname
      ? `SITE_DOMAIN is not set; using "${domainFromHostname(hostname)}" from the request host. Set it in wrangler.toml [vars].`
      : 'SITE_DOMAIN is not set and a scheduled run has no request host: email links will be empty. Set it in wrangler.toml [vars].');
  }
  configured = fromEnv || (hostname ? domainFromHostname(hostname) : '');
  return configured;
}

/** The bare site domain (no scheme, no leading dot); '' when unknown. */
export function siteDomain(env) {
  return normalizeDomain(env && env.SITE_DOMAIN) || configured;
}

/** "<sub>.<domain>", or the apex when sub is empty. */
export function siteHost(sub = '', env) {
  const d = siteDomain(env);
  if (!d) return '';
  return sub ? `${sub}.${d}` : d;
}

/** "https://<sub>.<domain>" (no trailing slash), or '' when unknown. */
export function siteOrigin(sub = '', env) {
  const h = siteHost(sub, env);
  return h ? `https://${h}` : '';
}

/** True for the public guest-site hosts: the apex and www. */
export function isApexHost(hostname, env) {
  const d = siteDomain(env);
  if (!d) return false;
  const h = String(hostname || '').toLowerCase();
  return h === d || h === `www.${d}`;
}

/**
 * The `; Domain=.<domain>` cookie attribute, or '' (a host-only cookie) when
 * the domain is unknown or has no dot — browsers reject Domain=.localhost.
 */
export function cookieDomainAttr(env) {
  const d = siteDomain(env);
  return d && d.includes('.') ? `; Domain=.${d}` : '';
}
