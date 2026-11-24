/**
 * Family portal unit suite — no Worker or network needed.
 * Signs real RS256 tokens with a throwaway key, serves them through a mocked
 * Access certs endpoint, and drives handleFamily() against a fake D1.
 * Usage: node test-family.mjs
 */
import { verifyAccess, _resetAccessCache } from './src/access.js';
import { handleFamily, isFamilyHost, renderFamilyPage, loadFamilyPlan } from './src/family.js';
import {
  FAMILY_MEMBER_LIMIT, normaliseEmail, maskEmail, coupleEmails, isFamilyAllowed, buildInclude,
  addFamilyMember, removeFamilyMember, listFamilyMembers, syncFamilyPolicy, getSyncStatus,
} from './src/family-access.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ''}`); }
}

const TEAM = 'testteam.cloudflareaccess.com';
const ISS = `https://${TEAM}`;
const AUD = 'aud-tag-123';
const env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const enc = (obj) => b64u(Buffer.from(JSON.stringify(obj)));

async function keypair(kid) {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kid, privateKey: kp.privateKey, jwk: { kid, kty: 'RSA', alg: 'RS256', use: 'sig', n: pub.n, e: pub.e } };
}

async function sign(key, claims, header = {}) {
  const h = enc({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const p = enc(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

const nowS = Math.floor(Date.now() / 1000);
const good = (extra = {}) => ({ aud: [AUD], iss: ISS, email: 'Mum@Example.com', exp: nowS + 3600, iat: nowS, nbf: nowS, ...extra });

const k1 = await keypair('k1');
const k2 = await keypair('k2');
const rogue = await keypair('k1'); // same kid, different key
let served = [k1.jwk];
let certCalls = 0;
const fetchImpl = async (u) => {
  certCalls++;
  if (u !== `${ISS}/cdn-cgi/access/certs`) return new Response('nope', { status: 404 });
  return new Response(JSON.stringify({ keys: served }), { headers: { 'content-type': 'application/json' } });
};
const reqWith = (token, how = 'header') =>
  new Request('https://family.example.test/', {
    headers: token ? (how === 'header' ? { 'Cf-Access-Jwt-Assertion': token } : { Cookie: `x=1; CF_Authorization=${token}` }) : {},
  });

console.log('\n== Access JWT verification ==');
{
  let r = await verifyAccess(reqWith(await sign(k1, good())), {}, { fetchImpl });
  check('unconfigured → not_configured (fails closed)', !r.ok && r.reason === 'not_configured', r);

  r = await verifyAccess(reqWith(null), env, { fetchImpl });
  check('no token → missing', !r.ok && r.reason === 'missing', r);

  r = await verifyAccess(reqWith(await sign(k1, good())), env, { fetchImpl });
  check('valid header token → ok, email lower-cased', r.ok && r.email === 'mum@example.com', r);

  r = await verifyAccess(reqWith(await sign(k1, good()), 'cookie'), env, { fetchImpl });
  check('valid CF_Authorization cookie → ok', r.ok, r);

  r = await verifyAccess(reqWith(await sign(k1, good({ aud: AUD }))), env, { fetchImpl });
  check('aud as string → ok', r.ok, r);

  r = await verifyAccess(reqWith(await sign(k1, good({ aud: ['other-app'] }))), env, { fetchImpl });
  check('wrong aud → invalid', !r.ok && r.reason === 'invalid', r);

  r = await verifyAccess(reqWith(await sign(k1, good({ iss: 'https://evil.cloudflareaccess.com' }))), env, { fetchImpl });
  check('wrong issuer → invalid', !r.ok && r.reason === 'invalid', r);

  r = await verifyAccess(reqWith(await sign(k1, good({ exp: nowS - 600 }))), env, { fetchImpl });
  check('expired → invalid', !r.ok && r.reason === 'invalid', r);

  r = await verifyAccess(reqWith(await sign(k1, good({ nbf: nowS + 600 }))), env, { fetchImpl });
  check('not yet valid → invalid', !r.ok && r.reason === 'invalid', r);

  r = await verifyAccess(reqWith(await sign(rogue, good())), env, { fetchImpl });
  check('signed by an unknown key (same kid) → invalid', !r.ok && r.reason === 'invalid', r);

  const t = await sign(k1, good());
  const [h, , s] = t.split('.');
  r = await verifyAccess(reqWith(`${h}.${enc(good({ email: 'stranger@example.com' }))}.${s}`), env, { fetchImpl });
  check('tampered payload → invalid', !r.ok && r.reason === 'invalid', r);

  r = await verifyAccess(reqWith(`${enc({ alg: 'none', kid: 'k1' })}.${enc(good())}.`), env, { fetchImpl });
  check('alg none → invalid', !r.ok && r.reason === 'invalid', r);

  r = await verifyAccess(reqWith('garbage'), env, { fetchImpl });
  check('malformed → invalid', !r.ok && r.reason === 'invalid', r);

  // Key rotation: k2 not yet in the cache → one forced refresh picks it up.
  served = [k1.jwk, k2.jwk];
  const before = certCalls;
  r = await verifyAccess(reqWith(await sign(k2, good())), env, { fetchImpl });
  check('rotated key picked up via refresh', r.ok && certCalls === before + 1, { r, calls: certCalls - before });

  const before2 = certCalls;
  await verifyAccess(reqWith(await sign(k1, good())), env, { fetchImpl });
  check('certs cached between requests', certCalls === before2, certCalls - before2);

  r = await verifyAccess(reqWith(await sign(k1, good({ email: '' }))), env, { fetchImpl });
  check('token without an email → invalid', !r.ok && r.reason === 'invalid', r);

  _resetAccessCache();
  r = await verifyAccess(reqWith(await sign(k1, good())), env, { fetchImpl: async () => new Response('down', { status: 502 }) });
  check('certs endpoint down → certs_unavailable', !r.ok && r.reason === 'certs_unavailable', r);
  _resetAccessCache();
}

console.log('\n== Family host + page ==');
{
  check('family host matches default', isFamilyHost('Family.Example.Test', { SITE_DOMAIN: 'example.test' }));
  check('apex is not the family host', !isFamilyHost('example.test', { SITE_DOMAIN: 'example.test' }));
  check('FAMILY_HOST override', isFamilyHost('pay.example.test', { FAMILY_HOST: 'pay.example.test' }) && !isFamilyHost('family.example.test', { SITE_DOMAIN: 'example.test', FAMILY_HOST: 'pay.example.test' }));
  check('no domain configured → never the family host', !isFamilyHost('family.', {}) && !isFamilyHost('family.example.test', {}));

  const today = '2026-10-12';
  const rows = [
    { id: 'a', type: 'deposit', due_date: '2026-10-01', amount_pence: 50000, paid_date: null, status: 'pending', item_name: 'Photographer', category_name: 'Photo', supplier_name: 'Snap Ltd' },
    { id: 'b', type: 'instalment', due_date: '2026-10-20', amount_pence: 125050, paid_date: null, status: 'pending', item_name: '<b>Venue</b>', category_name: 'Venue', supplier_name: null },
    { id: 'c', type: 'final', due_date: '2027-03-01', amount_pence: 300000, paid_date: null, status: 'pending', item_name: 'Catering', category_name: 'Food', supplier_name: null },
    { id: 'd', type: 'deposit', due_date: '2026-06-01', amount_pence: 20000, paid_date: '2026-06-02', status: 'paid', item_name: 'Florist', category_name: 'Flowers', supplier_name: null },
    { id: 'e', type: 'refund', due_date: null, amount_pence: 5000, paid_date: '2026-07-01', status: 'refunded', item_name: 'Cake', category_name: 'Food', supplier_name: null },
  ];
  let lastSql = '';
  // Minimal D1 stand-in: payments rows, the settings table and family_members.
  const settings = { couple_email: 'One@Example.com', couple_email_2: 'two@example.com' };
  let members = [{ id: 'm1', email: 'mum@example.com', label: 'Mum', created_at: '2026-10-01T00:00:00Z' }];
  let membersTableBroken = false;
  const DB = {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        all: async () => {
          if (/FROM family_members/.test(sql)) {
            if (membersTableBroken) throw new Error('no such table: family_members');
            return { results: [...members] };
          }
          lastSql = sql;
          return { results: rows };
        },
        first: async () => {
          if (/FROM settings/.test(sql)) return args[0] in settings ? { value: settings[args[0]] } : null;
          if (membersTableBroken) throw new Error('no such table: family_members');
          if (/COUNT\(\*\)/.test(sql)) return { n: members.length };
          if (/WHERE email = \?/.test(sql)) return members.find((m) => m.email === args[0]) || null;
          if (/WHERE id = \?/.test(sql)) return members.find((m) => m.id === args[0]) || null;
          return null;
        },
        run: async () => {
          if (/INTO settings/.test(sql)) settings[args[0]] = args[1];
          else if (/INSERT INTO family_members/.test(sql)) members.push({ id: args[0], email: args[1], label: args[2], created_at: args[3] });
          else if (/DELETE FROM family_members/.test(sql)) members = members.filter((m) => m.id !== args[0]);
          return { success: true };
        },
      };
      return stmt;
    },
  };
  const fakeEnv = (extra = {}) => ({ ...env, ...extra, DB });

  const plan = await loadFamilyPlan(fakeEnv(), today);
  check('SQL filters on family_visible', /family_visible/.test(lastSql));
  check('SQL never selects reference/notes/invoice', !/reference|notes|invoice/.test(lastSql));
  check('upcoming = pending non-refunds, due order', plan.upcoming.map((p) => p.id).join() === 'a,b,c', plan.upcoming.map((p) => p.id));
  check('overdue flagged', plan.upcoming[0].overdue === true && plan.upcoming[1].overdue === false);
  check('totals', plan.totals.outstanding === 475050 && plan.totals.next30 === 175050 && plan.totals.overdue === 50000 && plan.totals.paid === 20000, plan.totals);
  check('recently paid excludes refunds', plan.recentlyPaid.map((p) => p.id).join() === 'd');

  const html = renderFamilyPage({ plan, setup: { partner1_name: 'Alex', partner2_name: 'Sam<script>', wedding_date: '2027-06-01' }, viewer: 'mum@example.com' });
  check('escapes names', html.includes('Sam&lt;script&gt;') && !html.includes('Sam<script>'));
  check('escapes item names', html.includes('&lt;b&gt;Venue&lt;/b&gt;'));
  check('next payment hero shows overdue', html.includes('11 days overdue'));
  check('pounds formatting', html.includes('£1,250.50') && html.includes('£500'));
  check('countdown', html.includes('232 days to go'));
  check('sign-out link', html.includes('/cdn-cgi/access/logout'));
  check('no scripts on the page', !/<script/i.test(html.replace('Sam&lt;script&gt;', '')));

  const getSetup = async () => ({ partner1_name: 'Alex', partner2_name: 'Sam', wedding_date: '2027-06-01' });
  const url = (p) => new URL(`https://family.example.test${p}`);
  const req = async (p, token, method = 'GET', e = fakeEnv()) =>
    handleFamily(new Request(url(p), { method, headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }), e, url(p), { getSetup }, { fetchImpl });

  let r = await req('/', await sign(k1, good()), 'GET', { ...fakeEnv(), CF_ACCESS_AUD: '' });
  check('not configured → 503, no data', r.status === 503 && !(await r.text()).includes('Photographer'));

  r = await req('/', null);
  let body = await r.text();
  check('no Access token → 403, no data', r.status === 403 && !body.includes('Photographer'), r.status);

  r = await req('/', await sign(k1, good()));
  body = await r.text();
  check('valid Access token → 200 with plan', r.status === 200 && body.includes('Photographer') && body.includes('mum@example.com'), r.status);
  check('no-store + CSP + noindex headers', r.headers.get('cache-control') === 'private, no-store' && /default-src 'none'/.test(r.headers.get('content-security-policy') || '') && /noindex/.test(r.headers.get('x-robots-tag') || ''));

  r = await req('/api/payments', await sign(k1, good()));
  check('family host never serves /api', r.status === 404);
  r = await req('/mcp', await sign(k1, good()));
  check('family host never serves /mcp', r.status === 404);
  r = await req('/', await sign(k1, good()), 'POST');
  check('POST rejected', r.status === 405);

  // Second lock: the signed-in email must be the couple or on the list.
  r = await req('/', await sign(k1, good({ email: 'stranger@example.com' })));
  body = await r.text();
  check('valid Access token, not on the list → 403 "Not on the list", no data', r.status === 403 && body.includes('Not on the list') && !body.includes('Photographer'), r.status);
  r = await req('/', await sign(k1, good({ email: 'ONE@example.com' })));
  check('the couple are always let in', r.status === 200);
  members = [];
  r = await req('/', await sign(k1, good()));
  check('removed from the list → 403 at once, even with a valid Access session', r.status === 403);
  members = [{ id: 'm1', email: 'mum@example.com', label: 'Mum', created_at: '2026-10-01T00:00:00Z' }];
  membersTableBroken = true;
  r = await req('/', await sign(k1, good()));
  check('family_members unreadable → fails closed for family', r.status === 403);
  r = await req('/', await sign(k1, good({ email: 'two@example.com' })));
  check('family_members unreadable → couple still in', r.status === 200);
  membersTableBroken = false;

  console.log('\n== Family access list + Access policy sync ==');
  check('normaliseEmail trims + lower-cases', normaliseEmail('  Dad@Example.COM ') === 'dad@example.com');
  check('normaliseEmail rejects junk', [null, '', 'nope', 'a@b', 'a b@example.com', 'a@example.com,b@example.com', '<a@example.com>'].every((v) => normaliseEmail(v) === null));
  check('maskEmail hides the address', maskEmail('grandma@example.com') === 'g***@e***.com' && maskEmail('junk') === '***');
  check('couple emails come from settings + ACCESS_ALLOWED_EMAILS', (await coupleEmails(fakeEnv({ ACCESS_ALLOWED_EMAILS: 'Three@example.com, one@example.com' }))).join() === 'one@example.com,two@example.com,three@example.com');
  check('isFamilyAllowed: member / couple / stranger / blank', (await isFamilyAllowed(fakeEnv(), 'MUM@example.com')) && (await isFamilyAllowed(fakeEnv(), 'one@example.com')) && !(await isFamilyAllowed(fakeEnv(), 'x@example.com')) && !(await isFamilyAllowed(fakeEnv(), '')));
  check('buildInclude: one email rule each, de-duplicated, couple first', JSON.stringify(buildInclude(['one@example.com'], ['Mum@example.com', 'one@example.com', 'bad'])) === JSON.stringify([{ email: { email: 'one@example.com' } }, { email: { email: 'mum@example.com' } }]));

  let n = 0;
  const meta = () => ({ id: `new-${++n}`, now: '2026-10-12T10:00:00Z' });
  let a = await addFamilyMember(fakeEnv(), { email: ' Dad@Example.com ', label: '  Dad  ' }, meta());
  check('add: stored lower-case with a trimmed label', a.member && a.member.email === 'dad@example.com' && a.member.label === 'Dad', a);
  a = await addFamilyMember(fakeEnv(), { email: 'DAD@example.com' }, meta());
  check('add: duplicate rejected (409)', a.status === 409, a);
  a = await addFamilyMember(fakeEnv(), { email: 'not-an-email' }, meta());
  check('add: invalid email rejected (400)', a.status === 400, a);
  a = await addFamilyMember(fakeEnv(), { email: 'two@example.com' }, meta());
  check('add: a couple address is refused (always included)', a.status === 409, a);
  const keep = members;
  members = Array.from({ length: FAMILY_MEMBER_LIMIT }, (_, i) => ({ id: `f${i}`, email: `f${i}@example.com`, label: null, created_at: 'x' }));
  a = await addFamilyMember(fakeEnv(), { email: 'onemore@example.com' }, meta());
  check(`add: capped at ${FAMILY_MEMBER_LIMIT}`, a.status === 400 && members.length === FAMILY_MEMBER_LIMIT, a);
  members = keep;
  check('remove: unknown id → false', (await removeFamilyMember(fakeEnv(), 'nope')) === false);
  check('list: mum + dad', (await listFamilyMembers(fakeEnv())).map((m) => m.email).join() === 'mum@example.com,dad@example.com');

  // Sync against a mocked Cloudflare API.
  const syncEnv = (extra = {}) => fakeEnv({ CF_API_TOKEN: 'test-token', CF_ACCOUNT_ID: 'acct123', CF_ACCESS_FAMILY_POLICY_ID: 'pol456', ...extra });
  const policy = { id: 'pol456', name: 'Family', decision: 'allow', include: [{ email: { email: 'old@example.com' } }], exclude: [], require: [], session_duration: '24h' };
  let calls = [];
  const cf = (over = {}) => async (u, init) => {
    calls.push({ u, init });
    if (init.method === 'GET') return new Response(JSON.stringify(over.get || { success: true, result: policy }), { status: over.getStatus || 200 });
    return new Response(JSON.stringify(over.put || { success: true, result: policy }), { status: over.putStatus || 200 });
  };

  let st = await syncFamilyPolicy(fakeEnv(), { fetchImpl: cf() });
  check('sync: no token → not_configured, nothing sent', st.state === 'not_configured' && calls.length === 0, st);
  st = await syncFamilyPolicy(syncEnv({ CF_ACCESS_FAMILY_POLICY_ID: '' }), { fetchImpl: cf() });
  check('sync: partial config → not_configured', st.state === 'not_configured' && calls.length === 0, st);

  st = await syncFamilyPolicy(syncEnv(), { fetchImpl: cf() });
  const put = calls.find((c) => c.init.method === 'PUT');
  const sent = put && JSON.parse(put.init.body);
  check('sync: GET then PUT on the reusable policy endpoint', calls.length === 2 && calls[0].init.method === 'GET' && calls.every((c) => c.u === 'https://api.cloudflare.com/client/v4/accounts/acct123/access/policies/pol456'), calls.map((c) => c.u));
  check('sync: bearer token sent', put && put.init.headers.Authorization === 'Bearer test-token');
  check('sync: include = couple + family, one {email:{email}} rule each', sent && JSON.stringify(sent.include) === JSON.stringify(['one@example.com', 'two@example.com', 'mum@example.com', 'dad@example.com'].map((email) => ({ email: { email } }))), sent && sent.include);
  check('sync: keeps name, Allow decision and session duration', sent && sent.name === 'Family' && sent.decision === 'allow' && sent.session_duration === '24h');
  check('sync: never sends Everyone or a domain rule', sent && sent.include.every((r) => Object.keys(r).join() === 'email') && !/everyone|email_domain/.test(put.init.body));
  check('sync: reports synced with a count', st.state === 'synced' && st.ok && st.count === 4, st);
  check('sync: status stored without any address', JSON.stringify(await getSyncStatus(fakeEnv())) === JSON.stringify(st) && !/@/.test(JSON.stringify(st)));

  calls = [];
  st = await syncFamilyPolicy(syncEnv(), { fetchImpl: cf({ putStatus: 403, put: { success: false, errors: [{ code: 10000, message: 'Authentication error for dad@example.com' }] } }) });
  check('sync failure: state failed, list kept', st.state === 'failed' && !st.ok && members.length === 2, st);
  check('sync failure: message carries the status, never an address', /403/.test(st.message) && !/dad@example\.com/.test(st.message), st.message);
  st = await syncFamilyPolicy(syncEnv(), { fetchImpl: async () => { throw new Error('network down'); } });
  check('sync failure: network error → failed, no throw', st.state === 'failed', st);

  calls = [];
  st = await syncFamilyPolicy(syncEnv(), { fetchImpl: cf({ get: { success: true, result: { ...policy, decision: 'bypass' } } }) });
  check('sync: refuses a non-Allow policy (no PUT)', st.state === 'failed' && !calls.some((c) => c.init.method === 'PUT'), st);

  // Never-empty rule: with no known couple address nothing is sent at all.
  const savedSettings = { ...settings };
  delete settings.couple_email; delete settings.couple_email_2;
  calls = [];
  st = await syncFamilyPolicy(syncEnv(), { fetchImpl: cf() });
  check('never-empty: couple unknown → refused, no request', st.state === 'failed' && calls.length === 0, st);
  members = [];
  st = await syncFamilyPolicy(syncEnv(), { fetchImpl: cf() });
  check('never-empty: empty list is never sent', st.state === 'failed' && calls.length === 0, st);
  Object.assign(settings, savedSettings);
  calls = [];
  st = await syncFamilyPolicy(syncEnv(), { fetchImpl: cf() });
  const sent2 = JSON.parse(calls.find((c) => c.init.method === 'PUT').init.body);
  check('no family left → policy falls back to just the couple', st.state === 'synced' && sent2.include.length === 2, sent2.include);
}

console.log('\n== MCP isolation ==');
{
  const { readFileSync } = await import('node:fs');
  const mcpSrc = readFileSync(new URL('./src/mcp.js', import.meta.url), 'utf8');
  check('MCP tools never touch the family access list', !/family\/members|family\/sync|family_members/.test(mcpSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
