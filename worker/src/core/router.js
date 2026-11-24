// Router: the route registry, matching and in-process dispatch (moved
// verbatim from index.js, #3). Route modules register by importing route().

import { seedIfEmpty } from './seed.js';

export const routes = {
  GET: [],
  POST: [],
  PUT: [],
  PATCH: [],
  DELETE: [],
};

export function route(method, pattern, handler, { auth = true } = {}) {
  const parts = pattern.split('/').filter(Boolean);
  routes[method].push({ parts, handler, auth });
}

export function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const list = routes[method] || [];
  for (const r of list) {
    if (r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const rp = r.parts[i];
      if (rp.startsWith(':')) {
        params[rp.slice(1)] = decodeURIComponent(parts[i]);
      } else if (rp !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params, auth: r.auth };
  }
  return null;
}

// Runs an authenticated API route in-process (used by the MCP server) and
// returns { status, data } — the same handler, validation and side effects
// the portal UI gets, without a network hop or a session cookie.
export async function dispatchInternal(env, method, path, query, body) {
  const url = new URL('https://internal' + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const match = matchRoute(method, url.pathname);
  if (!match) return { status: 404, data: { error: 'Not found' } };
  try {
    await seedIfEmpty(env);
  } catch {
    // Non-fatal, as in the fetch handler.
  }
  const req = new Request(url.toString(), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await match.handler(env, req, match.params, url);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
