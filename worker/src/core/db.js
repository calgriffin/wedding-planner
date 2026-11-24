// Settings table access (moved verbatim from index.js, #3).

import { now } from '../lib/http.js';

export async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
  )
    .bind(key, value, now())
    .run();
}
