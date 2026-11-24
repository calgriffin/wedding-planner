/**
 * Wedding branding for the SPA. The Worker fills <meta name="wp-brand"> in
 * index.html from wrangler [vars] (worker/src/brand.js), so no couple name is
 * built into the bundle. Outside the Worker (vite dev) the placeholder is left
 * as is, and the same neutral fallbacks as the Worker apply.
 */
export interface Brand {
  /** "The Smith Wedding" (login heading) */
  name: string;
  /** "Smith Wedding" (nav heading, calendar PRODID) */
  nav: string;
  /** "smith-wedding" (storage keys, backup filename) */
  slug: string;
  /** "SMITH" (sample access code prefix) */
  code: string;
  /** "S" (the round avatar in the nav and on the login card) */
  initial: string;
}

const FALLBACK: Brand = { name: 'Wedding Planner', nav: 'Wedding Planner', slug: 'wedding', code: 'WEDDING', initial: 'W' };

const initialOf = (nav: string) => (nav.trim().charAt(0) || 'W').toUpperCase();

function readBrand(): Brand {
  try {
    const raw = typeof document !== 'undefined'
      ? document.querySelector('meta[name="wp-brand"]')?.getAttribute('content') || ''
      : '';
    if (!raw || raw.includes('%WP_BRAND_')) return FALLBACK;
    const v = JSON.parse(raw) as Partial<Brand>;
    const pick = (x: unknown, d: string) => (typeof x === 'string' && x.trim() ? x : d);
    const nav = pick(v.nav, FALLBACK.nav);
    return {
      name: pick(v.name, FALLBACK.name),
      nav,
      initial: initialOf(nav),
      slug: pick(v.slug, FALLBACK.slug),
      code: pick(v.code, FALLBACK.code),
    };
  } catch {
    return FALLBACK;
  }
}

export const brand: Brand = readBrand();
