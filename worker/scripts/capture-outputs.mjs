#!/usr/bin/env node
/**
 * Rendered-output harness for no-behaviour-change refactors (#12, #3 split).
 *
 * Capture (needs a fresh local Worker; run-tests starts one):
 *   CAPTURE_OUT=<dir> node scripts/run-tests.mjs --only capture
 *   (or: node scripts/capture-outputs.mjs <base> <outDir> against a server
 *    started with --var SITE_DOMAIN:wedding.test --var EMAIL_DRY_RUN:1)
 * Compare two captures (exit 1 on any difference):
 *   node scripts/capture-outputs.mjs --compare <dirA> <dirB>
 *
 * Seeds the same data every time, then saves: the apex in all 5 live modes,
 * v1-v5 + preview-ended, the plan shell, manifest, sw.js, the digest, a
 * campaign preview, an RSVP reminder snapshot, the backup header, MCP
 * serverInfo, and the response of every parameter-free GET route. Values that
 * differ between any two runs (uuids, timestamps, random codes, tokens) are
 * normalised.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

if (process.argv[2] === '--compare') {
  const [a, b] = process.argv.slice(3);
  const names = [...new Set([...fs.readdirSync(a), ...fs.readdirSync(b)])].sort();
  let diff = 0;
  for (const n of names) {
    const fa = path.join(a, n), fb = path.join(b, n);
    const same = fs.existsSync(fa) && fs.existsSync(fb) && fs.readFileSync(fa).equals(fs.readFileSync(fb));
    if (!same) diff++;
    console.log(`  ${same ? 'SAME' : 'DIFF'}  ${n}`);
  }
  console.log(`\ncapture-outputs: ${names.length - diff}/${names.length} identical`);
  process.exit(diff ? 1 : 0);
}

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const OUT = process.argv[3] || process.env.CAPTURE_OUT;
if (!OUT) { console.error('capture-outputs: no output dir (argv[3] or CAPTURE_OUT)'); process.exit(2); }
const DOMAIN = 'wedding.test';
fs.mkdirSync(OUT, { recursive: true });
const u = new URL(BASE);
let cookie = '';

function raw(method, p, { host = `plan.${DOMAIN}`, body, auth = true } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Host: host };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    if (auth && cookie) headers.Cookie = cookie;
    const r = http.request({ hostname: u.hostname, port: u.port, path: p, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const sc = res.headers['set-cookie'];
        resolve({ status: res.statusCode, headers: res.headers, text, setCookie: sc });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const api = async (m, p, body) => {
  const r = await raw(m, p, { body });
  let j; try { j = JSON.parse(r.text); } catch { j = null; }
  return { ...r, json: j, data: j && j.data !== undefined && j.success !== undefined ? j.data : j };
};
// Strip values that differ between any two runs (ids, codes, timestamps).
function normalise(s) {
  return String(s)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
    // The random code shapes FIRST, so a code's token never depends on which
    // random characters it drew (a generic rule running first used to catch
    // the all-letter ones only, making two runs disagree).
    // Guest invitation codes: random XXXX-XXXX (alphabet without 0/O/1/I).
    .replace(/\b[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}\b/g, '<invite>')
    // Household access codes: random XXX-XXX.
    .replace(/\b[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}\b/g, '<code>')
    // Anything else code-like (legacy prefixes); the fixed sample "<X>-DEMO" stays.
    .replace(/\b[A-Z]{2,12}-[A-Z0-9]{4,6}\b/g, (m) => (/-DEMO$/.test(m) ? m : '<code>'))
    .replace(/wpm_[0-9a-f]{64}/g, '<token>')
    .replace(/"prefix":"wpm_[0-9a-f]+"/g, '"prefix":"<token-prefix>"')
    .replace(/dry-<uuid>/g, 'dry-id');
}
const save = (name, content) => fs.writeFileSync(path.join(OUT, name), normalise(content));

let r = await api('POST', '/api/auth/init', { password: 'CaptureTest2026!' });
r = await raw('POST', '/api/auth/login', { body: { password: 'CaptureTest2026!' }, auth: false });
cookie = (r.setCookie || []).map((c) => c.split(';')[0]).join('; ');
if (!cookie) throw new Error('login failed ' + r.status + ' ' + r.text);
await api('PUT', '/api/setup', { partner1_name: 'Alex', partner2_name: 'Sam', wedding_date: '2027-06-12', ceremony_venue: 'The Barn', reception_venue: 'The Barn' });

// Apex in every live mode
for (const mode of ['teaser', 'countdown', 'rsvp', 'weddingday', 'thankyou']) {
  await api('PUT', '/api/rsvp/window', { guest_mode: mode, teaser_live_at: '', countdown_live_at: '', rsvp_live_at: '', weddingday_live_at: '', thankyou_live_at: '' });
  const a = await raw('GET', '/', { host: DOMAIN, auth: false });
  save(`apex-${mode}.html`, `${a.status} ${a.headers['content-type']}\n${a.text}`);
}
// Previews v1..v5 (couple session) and the preview-ended page
for (const v of [1, 2, 3, 4, 5]) {
  const a = await raw('GET', '/', { host: `v${v}.${DOMAIN}` });
  save(`v${v}.html`, `${a.status} ${a.headers['content-type']}\n${a.text}`);
}
const ended = await raw('GET', '/', { host: `v1.${DOMAIN}`, auth: false });
save('v1-no-session.html', `${ended.status}\n${ended.text}`);
// Plan host shell, login route, manifest, service worker
for (const [name, p] of [['plan-shell.html', '/'], ['plan-login.html', '/login'], ['manifest.webmanifest', '/manifest.webmanifest'], ['sw.js', '/sw.js']]) {
  const a = await raw('GET', p);
  save(name, `${a.status} ${a.headers['content-type']} cache=${a.headers['cache-control'] || ''}\n${a.text}`);
}
// Emails: digest, campaign preview (sample merge), RSVP reminder snapshot
r = await api('GET', '/api/email/digest');
save('email-digest.txt', `SUBJECT ${r.data.subject}\n--- TEXT\n${r.data.text}\n--- HTML\n${r.data.html}`);
r = await api('POST', '/api/email/campaigns/preview', { subject: 'Preview me', body: 'Hi {name},\n\nRSVP with {rsvp_button}' });
save('email-campaign-preview.txt', `SUBJECT ${r.data.subject}\n--- TEXT\n${r.data.text}\n--- HTML\n${r.data.html}`);
r = await api('POST', '/api/households', { name: 'Waiting Family' });
const hid = r.data.id;
await api('POST', '/api/guests', { household_id: hid, first_name: 'Waiting', last_name: 'One', is_primary: 1, email: 'waiting@test.local' });
await api('POST', `/api/households/${hid}/qr`);
r = await api('POST', '/api/rsvp/reminders', { household_ids: [hid], note: 'Gentle nudge' });
const camps = await api('GET', '/api/email/campaigns');
const rem = (camps.data || []).find((c) => c.kind === 'rsvp_reminder' || /RSVP reminder/.test(c.subject || ''));
const remFull = rem ? await api('GET', `/api/email/campaigns/${rem.id}`) : null;
save('email-rsvp-reminder.txt', remFull ? `SUBJECT ${remFull.data.campaign.subject}\n--- BODY\n${remFull.data.campaign.body}\n--- HTML\n${remFull.data.campaign.body_html}` : 'NOT FOUND ' + JSON.stringify(camps.data).slice(0, 300));
// Backup header + filename
const b = await raw('GET', '/api/export/all');
save('backup-head.txt', `${b.status} ${b.headers['content-disposition'] || ''}\n${b.text.split('\n').slice(0, 3).join('\n')}`);
// MCP serverInfo
r = await api('POST', '/api/mcp/tokens', { name: 'Capture' });
const tok = r.data && r.data.token;
const m = await raw('POST', `/mcp/${tok}`, { body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } }, auth: false });
let si; try { si = JSON.parse(m.text).result.serverInfo; } catch { si = m.text.slice(0, 200); }
save('mcp-serverinfo.json', JSON.stringify(si));
// Every parameter-free GET route (the list endpoints), on the same data.
const routeBaseline = JSON.parse(fs.readFileSync(new URL('./route-baseline.json', import.meta.url), 'utf8'));
for (const entry of routeBaseline.routes.GET || []) {
  const [p, access] = entry.split('|');
  if (p.includes(':') || p === '/api/export/all') continue; // params / captured above
  const a = await raw('GET', p, { auth: access === 'auth' });
  save(`api${p.replace(/\//g, '_')}.txt`, `${a.status} ${a.headers['content-type'] || ''}\n${a.text}`);
}
console.log('captured', fs.readdirSync(OUT).length, 'files into', OUT);
