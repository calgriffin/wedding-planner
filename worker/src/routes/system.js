// System routes (moved verbatim from index.js, #3).

import { route } from '../core/router.js';
import { json, now } from '../lib/http.js';

// POST /api/health
route('GET', '/api/health', () => json({ status: 'ok', timestamp: now() }), { auth: false });
