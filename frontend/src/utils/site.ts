/**
 * Site hostnames, derived from where the app is running — never hardcoded.
 * The plan portal is served from plan.<domain> (and the guest-site SPA from
 * the apex or a v1…v5 preview), so stripping that one known prefix from
 * window.location gives the site domain the Worker was configured with
 * (SITE_DOMAIN in worker/wrangler.toml).
 */

const KNOWN_PREFIX = /^(?:plan|www|family|mcp|v[1-5])\./;

/** Bare site domain, e.g. "example.com". */
export function siteDomain(hostname: string = typeof window !== 'undefined' ? window.location.hostname : ''): string {
  return String(hostname || '').toLowerCase().replace(KNOWN_PREFIX, '');
}

/** "<sub>.<domain>", or the apex when sub is empty. */
export function siteHost(sub = ''): string {
  const d = siteDomain();
  return sub ? `${sub}.${d}` : d;
}

/** "https://<sub>.<domain>" without a trailing slash. */
export function siteOrigin(sub = ''): string {
  return `https://${siteHost(sub)}`;
}
