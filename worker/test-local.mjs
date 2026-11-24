/**
 * Local API test suite for the wedding planner worker.
 * Run against a fresh local DB with email in simulation mode:
 *   wrangler dev --local --port 8787 --var EMAIL_DRY_RUN:1 --var ASSISTANT_ALLOWED_EMAILS:couple@test.local
 * (or any base URL via argv).
 * Usage: node test-local.mjs [baseUrl]   (or just `npm test`)
 */
import { performance } from 'node:perf_hooks';

const BASE = process.argv[2] || 'http://localhost:8787';
const PORT = new URL(BASE).port || '80';

let cookie = '';
let passed = 0;
let failed = 0;
const failures = [];

async function req(method, path, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers['Cookie'] = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch((opts.base || BASE) + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const c = setCookie.split(';')[0];
    if (c.startsWith('wp_session=')) {
      cookie = c.endsWith('=') ? '' : c;
    }
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL  ${name}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ''}`); }
}

function section(t) { console.log(`\n== ${t} ==`); }

// Every <a href> and Outlook <v:roundrect href> in rendered email HTML.
function emailHrefs(html) {
  return [...String(html || '').matchAll(/<(?:a|v:roundrect)\b[^>]*?\shref="([^"]*)"/gi)].map((m) => m[1]);
}
// A href is clean when it decodes to one valid https URL: no markup, quotes
// or whitespace inside, and nothing left over from a nested link.
function cleanHref(h) {
  if (/[<>"\s]/.test(h)) return false;
  const decoded = h.replace(/&amp;/g, '&');
  if (/&(?:lt|gt|quot);/.test(h)) return false;
  try { return new URL(decoded).protocol === 'https:'; } catch { return false; }
}
// Assert every link is clean, and the RSVP links carry the guest's code.
function checkEmailLinks(label, html, { code, rsvpLinks, extra = [] }) {
  const hrefs = emailHrefs(html);
  check(`${label}: every href is a clean https URL`, hrefs.length > 0 && hrefs.every(cleanHref), hrefs.filter((h) => !cleanHref(h)));
  check(`${label}: no link nested in an attribute, no <br/> in the button`, !/href="<a/i.test(html) && !/<br\/>\s*<(?:center|\/v:roundrect|table|\/td)/i.test(html), (html.match(/href="<a[^>]{0,80}/i) || [''])[0]);
  const rsvp = hrefs.filter((h) => h.includes('?c='));
  check(`${label}: ${rsvpLinks} RSVP link(s) with ?c=${code}`, rsvp.length === rsvpLinks && rsvp.every((h) => { try { return new URL(h.replace(/&amp;/g, '&')).searchParams.get('c') === code; } catch { return false; } }), rsvp);
  for (const want of extra) check(`${label}: couple's own link kept intact (${want})`, hrefs.includes(want), hrefs);
}

const t0 = performance.now();

async function main() {
  // ---------------------------------------------------------------------
  section('1. Auth & auth gate');
  {
    let r = await req('GET', '/api/health');
    check('health 200', r.status === 200 && r.data.status === 'ok', r);

    // Regression: the guest portal is public (auth:false) — must NOT 401
    // without a plan-site cookie.
    r = await req('GET', '/api/guest/home');
    check('guest home: public without cookie (200)', r.status === 200 && r.data && !!r.data.mode, r);

    r = await req('POST', '/api/guest/access', { code: 'NO-SUCH-CODE' });
    check('guest access: public without cookie (not 401)', r.status !== 401, r);

    r = await req('POST', '/api/guest/qr-lookup', { code: 'NO-SUCH-CODE' });
    check('guest qr-lookup: public without cookie (not 401)', r.status !== 401, r);

    r = await req('POST', '/api/guest/rsvp', { code: 'NO-SUCH-CODE', responses: [] });
    check('guest rsvp: public without cookie (not 401)', r.status !== 401, r);

    r = await req('GET', '/api/auth/status');
    check('auth status not initialized', r.status === 200 && r.data.initialized === false, r);

    r = await req('GET', '/api/tasks');
    check('tasks 401 without cookie', r.status === 401, r);

    // Regression: preview hosts stay couple-only when unauthenticated — the
    // gate must serve the "Preview ended" page, never the SPA or guest pages.
    r = await req('GET', '/', undefined, { base: `http://v1.127.0.0.1.nip.io:${PORT}` });
    check('v1 no session: preview-ended page', r.status === 200 && typeof r.data === 'string' && r.data.includes('Preview ended') && !r.data.includes('Test Wedding</h1>'), r.data.slice(0, 120));

    r = await req('GET', '/', undefined, { base: `http://v4.127.0.0.1.nip.io:${PORT}` });
    check('v4 no session: preview-ended page', r.status === 200 && typeof r.data === 'string' && r.data.includes('Preview ended') && !r.data.includes('thankyou'), r.data.slice(0, 120));

    r = await req('GET', '/', undefined, { base: `http://v2.127.0.0.1.nip.io:${PORT}` });
    check('v2 no session: preview-ended page', r.status === 200 && typeof r.data === 'string' && r.data.includes('Preview ended') && !r.data.includes('Counting down'), r.data.slice(0, 120));

    r = await req('GET', '/', undefined, { base: `http://v5.127.0.0.1.nip.io:${PORT}` });
    check('v5 no session: preview-ended page', r.status === 200 && typeof r.data === 'string' && r.data.includes('Preview ended') && !r.data.includes('Thank you'), r.data.slice(0, 120));

    r = await req('POST', '/api/auth/init', { password: 'short' });
    check('init rejects short password', r.status === 400, r);

    r = await req('POST', '/api/auth/init', { password: 'PlannerTest2026!' });
    check('init success + cookie set', r.status === 200 && r.data.initialized === true && cookie !== '', { status: r.status, cookie: !!cookie });

    r = await req('POST', '/api/auth/init', { password: 'AnotherPass123' });
    check('init second time → 409', r.status === 409, r);

    // Regression: the first authenticated burst fires several requests in parallel
    // (dashboard stats, tasks, etc.). Seeding must not double-insert.
    const burst = await Promise.all(Array.from({ length: 8 }, () => req('GET', '/api/tasks')));
    check(
      'concurrent first requests → exactly 46 seed tasks (no race duplicates)',
      burst.every((b) => b.status === 200) && Array.isArray(burst[0].data) && burst[0].data.length === 46,
      { lens: burst.map((b) => (Array.isArray(b.data) ? b.data.length : b.data)) }
    );

    r = await req('POST', '/api/auth/login', { password: 'wrong-password' });
    check('wrong password → 401', r.status === 401, r);

    r = await req('GET', '/api/auth/check');
    check('auth check 200 with cookie', r.status === 200 && r.data.authenticated === true, r);

    r = await req('GET', '/api/tasks');
    check('tasks 200 after auth', r.status === 200, r);
    check('seed: 46 playbook tasks', Array.isArray(r.data) && r.data.length === 46, { n: Array.isArray(r.data) ? r.data.length : r.data });

    r = await req('GET', '/api/budget/categories');
    check('seed: 9 budget categories', Array.isArray(r.data) && r.data.length === 9, { n: Array.isArray(r.data) ? r.data.length : r.data });

    r = await req('POST', '/api/auth/logout');
    check('logout 200', r.status === 200, r);
    r = await req('GET', '/api/tasks');
    check('tasks 401 after logout', r.status === 401, r);

    r = await req('POST', '/api/auth/login', { password: 'PlannerTest2026!' });
    check('login success + cookie', r.status === 200 && cookie !== '', r);
  }

  // ---------------------------------------------------------------------
  section('2. Setup & task deadlines');
  let taskCount = 0;
  {
    let r = await req('GET', '/api/setup');
    check('setup row exists', r.status === 200 && r.data && r.data.id === 'main', r);

    const weddingDate = '2027-08-21';
    r = await req('PUT', '/api/setup', {
      partner1_name: 'Alex Morgan',
      partner2_name: 'Sam Morgan',
      wedding_date: weddingDate,
      ceremony_venue: 'St Mary\'s Church',
      reception_venue: 'The Old Barn',
      budget_ceiling: 3000000,
      contingency_percent: 10,
      guest_target: 120,
    });
    check('setup updated', r.status === 200 && r.data.wedding_date === weddingDate, r);

    r = await req('GET', '/api/tasks');
    const tasks = r.data;
    taskCount = tasks.length;
    const withSuggestion = tasks.filter((t) => t.suggested_deadline);
    check('suggested deadlines derived from wedding date', withSuggestion.length > 40, { withSuggestion: withSuggestion.length });

    // 52-week task -> wedding date minus 52 weeks (approx 364 days)
    const early = withSuggestion.find((t) => t.suggested_timing_weeks_before === 52);
    if (early) {
      check('52-week deadline lands ~one year before', (early.suggested_deadline || '').startsWith('2026-08-2'), { got: early.suggested_deadline });
    } else check('has a 52-week task', false);

    // Agreed deadline overrides suggested
    const first = tasks[0];
    r = await req('PUT', `/api/tasks/${first.id}`, { status: 'in_progress', agreed_deadline: '2027-06-01' });
    check('task update with agreed deadline', r.status === 200, r);
    if (r.status === 200) {
      check('effective_deadline = agreed deadline', r.data.effective_deadline === '2027-06-01', r.data.effective_deadline);
    }

    r = await req('POST', '/api/tasks/recalculate', { weddingDate });
    check('recalculate deadlines', r.status === 200 && r.data.count === taskCount, r);

    r = await req('POST', '/api/tasks', { stage: 'other', title: 'Test custom task', owner: 'partner1' });
    check('create custom task', r.status === 200 && !!r.data.id, r);
    if (r.status === 200) {
      const tid = r.data.id;
      r = await req('DELETE', `/api/tasks/${tid}`);
      check('delete custom task', r.status === 200 && r.data.deleted === true, r);
    }

    r = await req('POST', '/api/tasks/reorder', { taskIds: tasks.map((t) => t.id).reverse() });
    check('reorder tasks', r.status === 200, r);
  }

  // ---------------------------------------------------------------------
  section('3. Budget: forecast (agreed > estimate), payments & refund reconciliation');
  let catId = null;
  let itemId = null;
  {
    let r = await req('GET', '/api/budget/categories');
    catId = r.data[0].id;

    r = await req('POST', '/api/budget/categories', { name: 'Test category', allowance_pence: 50000 });
    check('create category', r.status === 200 && !!r.data.id, r);
    const testCat = r.data.id;
    r = await req('PUT', `/api/budget/categories/${testCat}`, { allowance_pence: 75000 });
    check('update category allowance', r.status === 200 && r.data.allowance_pence === 75000, r);

    r = await req('POST', '/api/budget/items', { category_id: catId, name: 'Venue hire', estimate_pence: 1200000 });
    check('create budget item', r.status === 200 && !!r.data.id, r);
    itemId = r.data.id;

    r = await req('POST', '/api/budget/items/recalculate');
    check('recalc 200', r.status === 200, r);
    r = await req('GET', '/api/budget/items');
    const item = r.data.find((i) => i.id === itemId);
    check('forecast = estimate when no agreed price', item && item.forecast_pence === 1200000, item && item.forecast_pence);

    // Agreed price higher than estimate -> forecast uses agreed
    r = await req('PUT', `/api/budget/items/${itemId}`, { agreed_price_pence: 1300000 });
    check('update item with agreed price', r.status === 200, r);
    r = await req('POST', '/api/budget/items/recalculate');
    r = await req('GET', '/api/budget/items');
    const item2 = r.data.find((i) => i.id === itemId);
    check('forecast = agreed price (overrides estimate)', item2 && item2.forecast_pence === 1300000, item2 && item2.forecast_pence);

    // Regression: these NOT NULL REFERENCES columns used to bind a blank ''
    // straight from the form, which raised an FK error and 500'd the save.
    // Now a blank is rejected with a readable 400, and a blank on update
    // keeps the existing value rather than nulling it out.
    r = await req('POST', '/api/budget/items', { category_id: '', name: 'No category' });
    check('budget item with blank category -> 400 not 500', r.status === 400 && /category/i.test(r.data.error || ''), r);
    r = await req('POST', '/api/payments', { budget_item_id: '', type: 'deposit', amount_pence: 1000 });
    check('payment with blank budget item -> 400 not 500', r.status === 400 && /budget item/i.test(r.data.error || ''), r);
    r = await req('PUT', `/api/budget/items/${itemId}`, { category_id: '' });
    check('blank category on update keeps existing category', r.status === 200 && r.data.category_id === catId, r.data && r.data.category_id);
    r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'instalment', amount_pence: 1 });
    const blankPayId = r.data.id;
    r = await req('PUT', `/api/payments/${blankPayId}`, { budget_item_id: '' });
    check('blank budget item on update keeps existing item', r.status === 200 && r.data.budget_item_id === itemId, r.data && r.data.budget_item_id);
    await req('DELETE', `/api/payments/${blankPayId}`);

    // Invoice links (OneDrive/SharePoint share URLs, usually very long).
    const ONEDRIVE = 'https://myorg-my.sharepoint.com/personal/me/_layouts/15/download.aspx?share=ABCdefGHIjklMNOpqrSTUvwxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMn';
    r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'deposit', amount_pence: 1000, invoice_url: ONEDRIVE, invoice_label: 'Venue invoice (Aug)' });
    check('payment accepts an invoice link + label', r.status === 200 && r.data.invoice_url === ONEDRIVE && r.data.invoice_label === 'Venue invoice (Aug)', r.data && { u: r.data.invoice_url, l: r.data.invoice_label });
    const linkedPay = r.data.id;
    r = await req('GET', `/api/payments?budget_item_id=${itemId}`);
    check('invoice link round-trips on the payments list', r.status === 200 && (r.data.find((p) => p.id === linkedPay) || {}).invoice_url === ONEDRIVE, r.status);

    // Stored-XSS guard: only http/https is ever persisted or rendered in an href.
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'not-a-url', 'file:///etc/passwd']) {
      r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'deposit', amount_pence: 1, invoice_url: bad });
      if (r.status !== 400 || /invoice link/i.test((r.data || {}).error || '') !== true) {
        check(`rejects unsafe invoice link: ${bad.slice(0, 24)}`, false, r);
      }
    }
    check('rejects javascript:/data:/vbscript:/relative/file: invoice links', true, r.data);

    // Blank clears the link; a payload that omits the field leaves it alone.
    r = await req('PUT', `/api/payments/${linkedPay}`, { invoice_url: '' });
    check('blank invoice link clears it', r.status === 200 && r.data.invoice_url === '', r.data && r.data.invoice_url);
    check('clearing the invoice link clears its label', r.status === 200 && r.data.invoice_label === '', r.data && r.data.invoice_label);
    r = await req('PUT', `/api/payments/${linkedPay}`, { invoice_url: ONEDRIVE });
    check('invoice link saved on update', r.status === 200 && r.data.invoice_url === ONEDRIVE, r.data && r.data.invoice_url);
    r = await req('PUT', `/api/payments/${linkedPay}`, { notes: 'no link in this payload' });
    check('omitting invoice_url on update leaves the link intact', r.status === 200 && r.data.invoice_url === ONEDRIVE, r.data && r.data.invoice_url);
    r = await req('PUT', `/api/payments/${linkedPay}`, { invoice_url: 'javascript:alert(1)' });
    check('unsafe invoice link rejected on update', r.status === 400, r.data);
    r = await req('GET', `/api/payments?budget_item_id=${itemId}`);
    check('rejected update did not clear the stored link', (r.data.find((p) => p.id === linkedPay) || {}).invoice_url === ONEDRIVE, null);
    r = await req('DELETE', `/api/payments/${linkedPay}`);

    // Payments: deposit paid, instalment pending then paid, refund received
    r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'deposit', amount_pence: 400000, paid_date: '2027-01-10' });
    check('create paid deposit', r.status === 200 && r.data.status === 'paid', r);
    r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'instalment', amount_pence: 500000, due_date: '2027-06-01' });
    check('create pending instalment (no paid_date)', r.status === 200 && r.data.status === 'pending' && r.data.paid_date === null, r);
    const instalId = r.data.id;
    r = await req('PATCH', `/api/payments/${instalId}/paid`, { paid_date: '2027-05-30' });
    check('mark instalment paid', r.status === 200 && r.data.status === 'paid', r);
    r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'refund', amount_pence: 200000, paid_date: '2027-07-01' });
    check('create refund (refunded status)', r.status === 200 && r.data.status === 'refunded' && r.data.type === 'refund', r);

    r = await req('GET', '/api/budget/items');
    const item3 = r.data.find((i) => i.id === itemId);
    check('actual = paid - refunds (400k+500k-200k = 700k)', item3 && item3.actual_pence === 700000, item3 && item3.actual_pence);

    r = await req('GET', '/api/payments');
    check('payments list: 3 rows with item name', r.status === 200 && r.data.length === 3 && !!r.data[0].item_name, { n: r.data.length });

    // Family portal: per-payment visibility (default on) + the couple's preview.
    r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'final', amount_pence: 123400, due_date: '2027-06-20', reference: 'SECRET-REF-1', notes: 'private note' });
    check('family_visible defaults to 1', r.status === 200 && r.data.family_visible === 1, r.data);
    const famPay = r.data.id;
    r = await req('GET', '/api/family/preview');
    check('family preview: 200 HTML showing the pending payment', r.status === 200 && typeof r.data === 'string' && r.data.includes('£1,234'), r.status);
    check('family preview: never shows reference or notes', !r.data.includes('SECRET-REF-1') && !r.data.includes('private note'));
    r = await req('PUT', `/api/payments/${famPay}`, { family_visible: false });
    check('hide from family', r.status === 200 && r.data.family_visible === 0, r.data);
    r = await req('PUT', `/api/payments/${famPay}`, { notes: 'still private' });
    check('unrelated update keeps it hidden', r.data.family_visible === 0, r.data);
    r = await req('GET', '/api/family/preview');
    check('hidden payment left out of the family view', r.status === 200 && !r.data.includes('£1,234'));
    r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'final', amount_pence: 1, family_visible: false });
    check('create hidden', r.data.family_visible === 0, r.data);
    await req('DELETE', `/api/payments/${r.data.id}`);
    await req('DELETE', `/api/payments/${famPay}`);
    const saved = cookie;
    cookie = '';
    r = await req('GET', '/api/family/preview');
    check('family preview requires the plan session', r.status === 401, r.status);
    r = await req('GET', '/api/family/members');
    check('family members list requires the plan session', r.status === 401, r.status);
    r = await req('POST', '/api/family/members', { email: 'sneak@example.com' });
    check('family members add requires the plan session', r.status === 401, r.status);
    cookie = saved;

    // Family access list: CRUD + validation. No Cloudflare token locally, so
    // every change must still save and report "sync not configured".
    r = await req('GET', '/api/family/members');
    check('family members: empty list, sync not configured', r.status === 200 && Array.isArray(r.data.members) && r.data.members.length === 0 && r.data.sync_configured === false && r.data.limit === 50, r.data);
    r = await req('POST', '/api/family/members', { email: '  Mum@Example.com ', label: 'Mum' });
    check('family members: add lower-cases + saves without a token', r.status === 200 && r.data.member.email === 'mum@example.com' && r.data.sync.state === 'not_configured' && r.data.members.length === 1, r.data);
    const famMember = r.data.member.id;
    r = await req('POST', '/api/family/members', { email: 'MUM@example.com' });
    check('family members: duplicate → 409', r.status === 409, r.status);
    r = await req('POST', '/api/family/members', { email: 'not-an-email' });
    check('family members: invalid email → 400', r.status === 400, r.status);
    r = await req('POST', '/api/family/members', {});
    check('family members: missing email → 400', r.status === 400, r.status);
    r = await req('POST', '/api/family/sync');
    check('family sync now: degrades to not_configured, no crash', r.status === 200 && r.data.sync.state === 'not_configured' && r.data.sync.ok === false, r.data.sync);
    r = await req('GET', '/api/family/members');
    check('family members: last sync result is remembered', r.status === 200 && r.data.sync && r.data.sync.state === 'not_configured' && !!r.data.sync.at, r.data.sync);
    r = await req('DELETE', '/api/family/members/nope');
    check('family members: unknown id → 404', r.status === 404, r.status);
    r = await req('DELETE', `/api/family/members/${famMember}`);
    check('family members: remove', r.status === 200 && r.data.deleted === true && r.data.members.length === 0, r.data);

    r = await req('DELETE', `/api/budget/categories/${testCat}`);
    check('delete category (cascade)', r.status === 200, r);
  }

  // ---------------------------------------------------------------------
  section('4. Households & guests (incl. import + plus-one)');
  let householdId = null;
  let janeId = null;
  let johnId = null;
  {
    let r = await req('POST', '/api/households', { name: 'Smith Family', address_line1: '1 The Green', postcode: 'SW1A 1AA' });
    check('create household', r.status === 200 && !!r.data.id, r);
    householdId = r.data.id;

    r = await req('POST', '/api/guests', { household_id: householdId, first_name: 'Jane', last_name: 'Smith', invitation_code: 'AB12-CD34', status: 'invited', email: 'jane@example.com', is_primary: 1 });
    check('create guest Jane (invited)', r.status === 200 && !!r.data.id, r);
    janeId = r.data.id;

    r = await req('POST', '/api/guests', { first_name: 'John', last_name: 'Doe', invitation_code: 'CD34-EF56', status: 'potential' });
    check('create guest John (potential)', r.status === 200 && !!r.data.id, r);
    johnId = r.data.id;

    r = await req('POST', '/api/guests/import', { guests: [
      { first_name: 'Imported', last_name: 'Guest', status: 'potential', invitation_code: 'IM00-AA01' },
      { first_name: 'Second', last_name: 'Imported', status: 'potential' },
    ] });
    check('bulk guest import', r.status === 200 && r.data.created === 2, r);

    r = await req('GET', '/api/guests');
    check('guests list includes all created', r.status === 200 && r.data.length >= 4, { n: r.data.length });

    r = await req('PUT', `/api/guests/${janeId}`, { plus_one_of: johnId });
    check('set plus-one on Jane', r.status === 200 && r.data.plus_one_of === johnId, r);

    // Regression: the guest edit modal submits household_id / plus_one_of /
    // thank_you_date as '' when the dropdown is left blank. Binding that empty
    // string straight into a REFERENCES column violated the foreign key and
    // 500'd the whole save, so a guest could be created but never edited.
    r = await req('POST', '/api/guests', { first_name: 'Blank', last_name: 'Fields', status: 'potential' });
    const blankId = r.data.id;
    r = await req('PUT', `/api/guests/${blankId}`, { household_id: '', plus_one_of: '', thank_you_date: '', status: 'confirmed' });
    check('blank FK/nullable fields do not 500 the save', r.status === 200, r);
    check('blank household_id stored as NULL', r.status === 200 && r.data.household_id === null, r.data && r.data.household_id);
    check('blank plus_one_of / thank_you_date stored as NULL', r.status === 200 && r.data.plus_one_of === null && r.data.thank_you_date === null, r.data && { po: r.data.plus_one_of, ty: r.data.thank_you_date });
    check('status change alongside blank fields still applies', r.status === 200 && r.data.status === 'confirmed', r.data && r.data.status);

    // ...and a real household id must still be honoured (not nulled).
    r = await req('PUT', `/api/guests/${blankId}`, { household_id: householdId, status: 'confirmed' });
    check('explicit household_id is preserved, not nulled', r.status === 200 && r.data.household_id === householdId, r.data && r.data.household_id);
  }

  // ---------------------------------------------------------------------
  section('5. RSVP import: matched / unmatched / duplicate-conflict / no overwrite / review');
  let janeImportId = null;
  {
    const stamp = new Date().toISOString();
    let r = await req('POST', '/api/rsvp/import', { responses: [
      { invitation_code: 'AB12-CD34', guest_name: 'Jane Smith', attendance: 'yes', dietary_needs: 'Vegetarian', submitted_at: stamp },
      { invitation_code: '', guest_name: 'John Doe', attendance: 'no', submitted_at: stamp },
      { invitation_code: 'ZZ99-XX00', guest_name: 'Unknown Person', attendance: 'yes', submitted_at: stamp },
    ] });
    check('import 3 responses', r.status === 200 && r.data.imported === 3, r);
    const byCode = r.data.results.find((x) => x.match_status === 'matched' && x.matched_guest_id === janeId);
    const byName = r.data.results.find((x) => x.matched_guest_id === johnId);
    const unmatched = r.data.results.find((x) => x.match_status === 'unmatched' && !x.matched_guest_id);
    check('code match → matched to Jane', !!byCode, r.data.results);
    check('name match → matched to John', !!byName, r.data.results);
    check('unknown → unmatched', !!unmatched, r.data.results);
    janeImportId = byCode ? byCode.id : null;

    // Regression: two different guests with NO invitation code ('' key) must
    // not be flagged as duplicates of each other (the old check compared
    // empty strings and the second import always "conflicted" with the first).
    r = await req('POST', '/api/rsvp/import', { responses: [
      { invitation_code: '', guest_name: 'Alana NoCode', attendance: 'yes', submitted_at: stamp },
      { invitation_code: '', guest_name: 'Boris NoCode', attendance: 'no', submitted_at: stamp },
    ] });
    check('empty-code imports both accepted', r.status === 200 && r.data.imported === 2, r);
    const noCodeConflicts = (r.data.results || []).filter((x) => x.match_status === 'conflict');
    check('empty-code imports never conflict', noCodeConflicts.length === 0, noCodeConflicts);

    // Duplicate code import -> nothing inserted, earlier import flagged conflict
    r = await req('POST', '/api/rsvp/import', { responses: [
      { invitation_code: 'AB12-CD34', guest_name: 'Jane Smith', attendance: 'evening_only', submitted_at: stamp },
    ] });
    check('duplicate import returns 0 imported', r.status === 200 && r.data.imported === 0, r);

    r = await req('GET', '/api/rsvp');
    const flagged = r.data.find((x) => x.match_status === 'conflict');
    check('earlier import flagged conflict (never overwritten)', !!flagged && flagged.notes.includes('never overwrites'), flagged);
    const eveningReply = r.data.find((x) => x.guest_name === 'Jane Smith' && x.attendance === 'evening_only');
    check('duplicate NOT inserted as new row', !eveningReply, r.data.filter((x) => x.guest_name === 'Jane Smith'));

    // Manual match the unmatched response to John, then accept -> John confirmed
    const unEntry = r.data.find((x) => x.guest_name === 'Unknown Person');
    r = await req('PATCH', `/api/rsvp/${unEntry.id}/match`, { guest_id: johnId });
    check('manual match unknown → John', r.status === 200 && r.data.matched === true, r);
    r = await req('PATCH', `/api/rsvp/${unEntry.id}/review`, { action: 'accepted' });
    check('accept applies to guest record', r.status === 200, r);
    r = await req('GET', '/api/guests');
    const johnNow = r.data.find((g) => g.id === johnId);
    check('John now confirmed', johnNow && johnNow.status === 'confirmed', johnNow && johnNow.status);

    // Reject John's own response (attendance 'no') - never touches the guest record
    r = await req('GET', '/api/rsvp');
    const johnEntry = r.data.find((x) => x.matched_guest_id === johnId && x.review_status === 'pending' && x.guest_name === 'John Doe');
    if (johnEntry) {
      r = await req('PATCH', `/api/rsvp/${johnEntry.id}/review`, { action: 'rejected' });
      check('reject response 200', r.status === 200, r);
      r = await req('GET', '/api/guests');
      const johnAfterReject = r.data.find((g) => g.id === johnId);
      check('reject never changes guest', johnAfterReject && johnAfterReject.status === 'confirmed', johnAfterReject && johnAfterReject.status);
    } else check('John entry findable for reject test', false);

    // Accept the flagged Jane entry -> applies vegetarian + confirmed to Jane
    r = await req('GET', '/api/rsvp');
    const janeEntry = r.data.find((x) => x.guest_name === 'Jane Smith' && x.attendance === 'yes');
    if (janeEntry) {
      r = await req('PATCH', `/api/rsvp/${janeEntry.id}/review`, { action: 'accepted' });
      check('accept flagged Jane entry', r.status === 200, r);
      r = await req('GET', '/api/guests');
      const janeNow = r.data.find((g) => g.id === janeId);
      check('Jane confirmed with dietary applied', janeNow && janeNow.status === 'confirmed' && janeNow.dietary_needs === 'Vegetarian', janeNow && janeNow.dietary_needs);
    } else check('Jane entry findable', false);

    // Bulk review
    if (janeImportId) {
      r = await req('POST', '/api/rsvp/bulk-review', { ids: [janeImportId], action: 'flagged' });
      check('bulk review flags entry', r.status === 200 && r.data.reviewed === 1, r);
    }

    r = await req('GET', '/api/rsvp/last-import');
    check('last import timestamp present', r.status === 200 && !!r.data.last_import, r);
  }

  // ---------------------------------------------------------------------
  section('6. Seating: overcapacity flagged, declined excluded, unseated list');
  {
    let r = await req('POST', '/api/seating/tables', { name: 'Table 1', capacity: 2 });
    const t1 = r.data.id;
    check('create table (cap 2)', r.status === 200, r);
    r = await req('POST', '/api/seating/tables', { name: 'Table 2', capacity: 4 });
    const t2 = r.data.id;
    check('create table (cap 4)', r.status === 200, r);

    r = await req('POST', '/api/guests', { first_name: 'Alice', last_name: 'Day', status: 'confirmed' });
    const alice = r.data.id;
    r = await req('POST', '/api/guests', { first_name: 'Bob', last_name: 'Day', status: 'confirmed' });
    const bob = r.data.id;
    r = await req('POST', '/api/guests', { first_name: 'Carol', last_name: 'No', status: 'declined' });
    const carol = r.data.id;

    r = await req('POST', '/api/seating/assignments', { table_id: t1, guest_id: alice, seat_number: 1 });
    check('assign Alice', r.status === 200, r);
    r = await req('POST', '/api/seating/assignments', { table_id: t1, guest_id: bob, seat_number: 2 });
    check('assign Bob', r.status === 200, r);

    r = await req('POST', '/api/guests', { first_name: 'Dave', last_name: 'Overflow', status: 'confirmed' });
    const dave = r.data.id;
    r = await req('POST', '/api/seating/assignments', { table_id: t1, guest_id: dave });
    check('3rd assignment accepted (flag used)', r.status === 200, r);

    // Regression: a guest who has NOT yet RSVP'd (default 'potential') must
    // still be seatable. Couples plan tables before RSVPs come in; only a
    // decline rules a guest out of the room.
    r = await req('POST', '/api/guests', { first_name: 'Eve', last_name: 'Awaiting', status: 'potential' });
    const eve = r.data.id;
    r = await req('GET', '/api/seating/tables');
    check('unseated list includes guests awaiting RSVP (potential)', (r.data.unseated_guests || []).some((g) => g.id === eve && g.name === 'Eve Awaiting'), (r.data.unseated_guests || []).map((g) => g.name));
    r = await req('POST', '/api/seating/assignments', { table_id: t2, guest_id: eve });
    check('assign a guest who has not RSVPd yet', r.status === 200, r);

    r = await req('GET', '/api/seating/tables');
    const table1 = r.data.tables.find((t) => t.id === t1);
    const table2 = r.data.tables.find((t) => t.id === t2);
    check('table1 overcapacity flagged', table1 && table1.overcapacity === true && table1.assigned === 3, table1);
    check('table2 holds only the awaiting-RSVP guest (not overcapacity)', table2 && table2.overcapacity === false && table2.assigned === 1, table2 && { a: table2.assigned, oc: table2.overcapacity });
    const unseatedNames = r.data.unseated_guests.map((g) => g.name);
    check('declined guest (Carol) NOT in unseated list', !unseatedNames.includes('Carol No'), unseatedNames);
    check('seated guest (Eve) no longer in unseated list', !unseatedNames.includes('Eve Awaiting'), unseatedNames);
    check('totals: seated 4', r.data.totals.seated === 4, r.data.totals);
    check('totals: seatable count reported alongside confirmed', r.data.totals.seatable >= r.data.totals.accepted, r.data.totals);

    // Room plan (Deploy C): new tables auto-place on the canvas, positions
    // persist through PUT and round-trip via GET; room size is settings-backed.
    check('new tables auto-positioned on room plan', table1 && table1.pos_x >= 190 && table1.pos_y >= 190 && table2 && table2.pos_x >= 190, table1 && { x: table1.pos_x, y: table1.pos_y });
    r = await req('PUT', `/api/seating/tables/${t1}`, { pos_x: 420, pos_y: 260 });
    check('PUT table saves position', r.status === 200 && r.data.pos_x === 420 && r.data.pos_y === 260, r.data);
    r = await req('GET', '/api/seating/tables');
    const t1Moved = r.data.tables.find((t) => t.id === t1);
    check('position round-trips via GET', t1Moved && t1Moved.pos_x === 420 && t1Moved.pos_y === 260 && t1Moved.name === 'Table 1', t1Moved && { n: t1Moved.name, x: t1Moved.pos_x, y: t1Moved.pos_y });

    r = await req('GET', '/api/seating/room');
    check('room defaults 1200x700', r.status === 200 && r.data.width === 1200 && r.data.height === 700, r.data);
    r = await req('PUT', '/api/seating/room', { width: 1000, height: 600 });
    check('resize room persists', r.status === 200 && r.data.width === 1000 && r.data.height === 600, r.data);
    r = await req('GET', '/api/seating/room');
    check('room size round-trips', r.status === 200 && r.data.width === 1000 && r.data.height === 600, r.data);
    r = await req('PUT', '/api/seating/room', { width: 1200, height: 700 }); // restore defaults

    // Reassign Alice to table 2 (upsert - single assignment)
    r = await req('POST', '/api/seating/assignments', { table_id: t2, guest_id: alice });
    check('reassign Alice upserts', r.status === 200 && (r.data.updated === true || r.data.created === true), r);
    r = await req('GET', '/api/seating/assignments');
    const aliceRows = r.data.filter((a) => a.guest_id === alice);
    check('Alice has exactly one assignment', aliceRows.length === 1 && aliceRows[0].table_id === t2, aliceRows);

    r = await req('DELETE', `/api/seating/assignments/table/${t1}`);
    check('clear table assignments', r.status === 200, r);
  }

  // ---------------------------------------------------------------------
  section('7. Wedding day, events, logistics CRUD');
  {
    let r = await req('POST', '/api/wedding-day/run-sheet', { time: '14:00', title: 'Ceremony', location: 'Church', is_critical: 1 });
    const rsId = r.data.id;
    check('create run sheet entry', r.status === 200 && !!rsId, r);
    r = await req('PUT', `/api/wedding-day/run-sheet/${rsId}`, { end_time: '15:00', description: 'Vows and confetti' });
    check('update run sheet entry', r.status === 200 && r.data.end_time === '15:00', r);
    r = await req('GET', '/api/wedding-day/run-sheet');
    check('run sheet list', r.status === 200 && r.data.length >= 1, r);
    r = await req('DELETE', `/api/wedding-day/run-sheet/${rsId}`);
    check('delete run sheet entry', r.status === 200, r);

    r = await req('POST', '/api/wedding-day/contacts', { name: 'Registrar', role: 'Ceremony', phone: '020 0000 0000', is_emergency: 1 });
    const contactId = r.data.id;
    check('create contact', r.status === 200 && !!contactId, r);
    r = await req('PUT', `/api/wedding-day/contacts/${contactId}`, { is_emergency: 0 });
    check('update contact', r.status === 200 && r.data.is_emergency === false, r);
    r = await req('DELETE', `/api/wedding-day/contacts/${contactId}`);
    check('delete contact', r.status === 200, r);

    r = await req('POST', '/api/wedding-day/packing', { category: 'ceremony', item: 'Vows', quantity: 2, packed: 1 });
    const packId = r.data.id;
    check('create packing item', r.status === 200 && !!packId, r);
    r = await req('PUT', `/api/wedding-day/packing/${packId}`, { packed: 0 });
    check('update packing item', r.status === 200 && r.data.packed === false, r);
    r = await req('GET', '/api/wedding-day/packing');
    check('packing list', r.status === 200 && r.data.length >= 1, r);
    r = await req('DELETE', `/api/wedding-day/packing/${packId}`);
    check('delete packing item', r.status === 200, r);

    r = await req('POST', '/api/events', { title: 'Rehearsal dinner', type: 'other_event', date: '2027-08-19', guest_count: 20 });
    const evId = r.data.id;
    check('create event', r.status === 200 && !!evId, r);
    r = await req('GET', '/api/events');
    check('events list', r.status === 200 && r.data.length >= 1, r);
    r = await req('PUT', `/api/events/${evId}`, { status: 'completed' });
    check('update event', r.status === 200 && r.data.status === 'completed', r);
    r = await req('DELETE', `/api/events/${evId}`);
    check('delete event', r.status === 200, r);

    r = await req('POST', '/api/logistics', { type: 'transport', name: 'Guest shuttle', cost_pence: 25000 });
    check('create logistics item', r.status === 200 && !!r.data.id, r);
    r = await req('GET', '/api/logistics');
    check('logistics list', r.status === 200 && r.data.length >= 1, r);
    r = await req('DELETE', `/api/logistics/${r.data[0].id}`);
    check('delete logistics item', r.status === 200, r);
  }

  // ---------------------------------------------------------------------
  section('8. Suppliers & decisions');
  {
    let r = await req('POST', '/api/suppliers', { category: 'venue', name: 'The Old Barn', quote_pence: 500000, capacity: 150, booking_status: 'shortlisted' });
    const supId = r.data.id;
    check('create supplier', r.status === 200 && !!supId, r);
    r = await req('PUT', `/api/suppliers/${supId}`, { booking_status: 'booked', availability_confirmed: 1 });
    check('update supplier to booked', r.status === 200 && r.data.booking_status === 'booked' && r.data.availability_confirmed === true, r);
    r = await req('GET', '/api/suppliers');
    check('suppliers list', r.status === 200 && r.data.length >= 1, r);
    r = await req('DELETE', `/api/suppliers/${supId}`);
    check('delete supplier', r.status === 200, r);

    r = await req('POST', '/api/decisions', { category: 'catering', title: 'Menu style', options: JSON.stringify(['Buffet', 'Plated']), status: 'open' });
    const decId = r.data.id;
    check('create decision', r.status === 200 && !!decId, r);
    r = await req('PUT', `/api/decisions/${decId}`, { chosen_option: 'Plated', status: 'decided' });
    check('decide decision', r.status === 200 && r.data.status === 'decided' && r.data.chosen_option === 'Plated', r);
    r = await req('GET', '/api/decisions');
    check('decisions list', r.status === 200 && r.data.length >= 1, r);
    r = await req('DELETE', `/api/decisions/${decId}`);
    check('delete decision', r.status === 200, r);
  }

  // ---------------------------------------------------------------------
  section('9. Dashboard & exports');
  {
    let r = await req('GET', '/api/dashboard/stats');
    check('dashboard stats 200', r.status === 200, r);
    const s = r.data;
    check('tasks.total === 46', s.tasks && s.tasks.total === 46, s.tasks);
    check('budget ceiling 3000000, contingency 10% = 300000', s.budget && s.budget.ceiling_pence === 3000000 && s.budget.contingency_pence === 300000, s.budget);
    check('budget forecast includes agreed (1300000)', s.budget && s.budget.forecast_pence >= 1300000, s.budget && s.budget.forecast_pence);
    check('budget actual includes refund net (>=700000)', s.budget && s.budget.actual_pence >= 700000, s.budget && s.budget.actual_pence);
    check('guests summary present', s.guests && s.guests.total_invited >= 2, s.guests);
    // RSVP response-rate card keys: responded = coming + declined; the rate is
    // responded / (responded + pending) — replies out of everyone asked.
    check('guests responded = coming + declined (per-guest)', s.guests && s.guests.responded === (s.guests.coming + s.guests.declined), s.guests);
    check('guests response_pct in range + matches ratio', s.guests && s.guests.response_pct >= 0 && s.guests.response_pct <= 100 && s.guests.response_pct === (s.guests.responded + s.guests.pending > 0 ? Math.round((s.guests.responded / (s.guests.responded + s.guests.pending)) * 100) : 0), s.guests);

    r = await req('GET', '/api/dashboard/upcoming-tasks?limit=5');
    check('upcoming tasks 200', r.status === 200 && Array.isArray(r.data), r);

    r = await req('GET', '/api/dashboard/overdue-payments');
    check('overdue payments 200', r.status === 200, r);

    r = await req('GET', '/api/dashboard/outstanding-decisions');
    check('outstanding decisions 200', r.status === 200, r);

    r = await req('GET', '/api/export/guests');
    check('guest CSV export', r.status === 200 && typeof r.data === 'string' && r.data.includes('first_name'), { len: typeof r.data === 'string' ? r.data.length : 0 });

    r = await req('GET', '/api/export/budget');
    check('budget CSV export', r.status === 200 && typeof r.data === 'string', r);

    r = await req('GET', '/api/export/all');
    check('full archive export', r.status === 200 && typeof r.data === 'string' && r.data.length > 100, { len: typeof r.data === 'string' ? r.data.length : 0 });

    // Backup archive: every table section present, secrets excluded, dated
    // download filename (the Setup page "Download full backup" button).
    const sectionMarkers = ['--- HOUSEHOLDS ---', '--- BUDGET_ITEMS ---', '--- PAYMENTS ---', '--- RSVP_IMPORTS ---', '--- SEATING_ASSIGNMENTS ---', '--- EMAIL_CAMPAIGNS ---', '--- SETTINGS ---'];
    check('backup archive covers all tables', typeof r.data === 'string' && sectionMarkers.every((m) => r.data.includes(m)), r.data && r.data.slice(0, 400));
    check('backup archive excludes secrets', typeof r.data === 'string' && !r.data.includes('auth_secret') && !r.data.includes('password_hash') && !r.data.includes('resend_api_key') && !r.data.includes('preview_tokens'), r.data && r.data.slice(0, 400));
    check('backup archive has a generated header', typeof r.data === 'string' && r.data.includes('Test wedding planner — full backup'), r.data && r.data.slice(0, 120));

    const rawBackup = await fetch(`${BASE}/api/export/all`, { headers: cookie ? { Cookie: cookie } : {} });
    const backupCd = rawBackup.headers.get('content-disposition') || '';
    check('backup download has dated attachment filename', backupCd.includes('attachment') && backupCd.includes('test-wedding-backup-'), backupCd);

    r = await req('GET', '/api/export/run-sheet');
    check('run-sheet CSV export', r.status === 200 && typeof r.data === 'string' && r.data.includes('time'), r);

    r = await req('GET', '/api/export/contacts');
    check('contacts CSV export', r.status === 200 && typeof r.data === 'string' && r.data.includes('name'), r);
  }

  // ---------------------------------------------------------------------
  section('10. SPA static serving');
  {
    let r = await req('GET', '/');
    check('root serves index.html', r.status === 200 && typeof r.data === 'string' && r.data.includes('<div id="root">'), { status: r.status, len: typeof r.data === 'string' ? r.data.length : 0 });
    r = await req('GET', '/login');
    check('SPA fallback for /login', r.status === 200 && typeof r.data === 'string' && r.data.includes('<div id="root">'), { status: r.status });
    r = await req('GET', '/');
    const cssAsset = (r.data || '').match(/href="(\/assets\/[^"]+\.css)"/);
    if (cssAsset) {
      r = await req('GET', cssAsset[1]);
      check('css asset served', r.status === 200 && typeof r.data === 'string' && r.data.includes(':root'), { status: r.status, asset: cssAsset[1] });
    } else {
      check('css asset served', false, { status: r.status });
    }

    // Code-split SPA: the entry module and the lazy page chunks it imports
    // are all served as JavaScript; a missing chunk is a 404, never the HTML
    // shell (a stale chunk name after a deploy must fail cleanly).
    const shell = await (await fetch(`${BASE}/`)).text();
    const entry = (shell.match(/src="(\/assets\/[^"]+\.js)"/) || [])[1];
    const entryRes = entry ? await fetch(`${BASE}${entry}`) : null;
    const entryJs = entryRes && entryRes.ok ? await entryRes.text() : '';
    check('SPA entry module served as JavaScript', !!entryRes && entryRes.status === 200 && (entryRes.headers.get('content-type') || '').startsWith('text/javascript'), { entry, status: entryRes && entryRes.status, ct: entryRes && entryRes.headers.get('content-type') });
    const chunks = [...new Set([...entryJs.matchAll(/(?:assets\/|\.\/)([A-Za-z0-9_-]+-[A-Za-z0-9_-]{8}\.js)/g)].map((m) => `/assets/${m[1]}`))].filter((p) => p !== entry);
    const chunkRes = await Promise.all(chunks.map((p) => fetch(`${BASE}${p}`).then(async (res) => ({ p, status: res.status, ct: res.headers.get('content-type') || '', html: (await res.text()).trimStart().startsWith('<') }))));
    const badChunks = chunkRes.filter((c) => c.status !== 200 || !c.ct.startsWith('text/javascript') || c.html);
    check('lazy page chunks: all served as JavaScript', chunks.length >= 20 && badChunks.length === 0, { chunks: chunks.length, bad: badChunks.slice(0, 3) });
    check('guest pages are their own chunks', ['GuestHome', 'GuestRsvp', 'GuestSite'].every((n) => chunks.some((p) => p.includes(`/${n}-`))), chunks.filter((p) => /Guest/.test(p)));
    const staleRes = await fetch(`${BASE}/assets/StalePage-deadbeef.js`);
    check('missing /assets chunk → 404, not the HTML shell', staleRes.status === 404 && !(await staleRes.text()).includes('<div id="root">'), { status: staleRes.status });

    // PWA: manifest, service worker and icons are served with the right types.
    const mfRes = await fetch(`${BASE}/manifest.webmanifest`);
    const mfBody = mfRes.ok ? await mfRes.json() : {};
    check('PWA manifest: application/manifest+json + valid fields', mfRes.status === 200 && (mfRes.headers.get('content-type') || '').includes('application/manifest+json') && !!mfBody.name && mfBody.start_url === '/' && Array.isArray(mfBody.icons) && mfBody.icons.length >= 2, { status: mfRes.status, ct: mfRes.headers.get('content-type'), name: mfBody.name });

    const swRes = await fetch(`${BASE}/sw.js`);
    const swText = swRes.ok ? await swRes.text() : '';
    check('service worker: JS + no-cache + install handler present', swRes.status === 200 && (swRes.headers.get('content-type') || '').includes('javascript') && (swRes.headers.get('cache-control') || '').includes('no-cache') && swText.includes('addEventListener') && swText.includes("'/api/'"), { status: swRes.status, ct: swRes.headers.get('content-type'), cc: swRes.headers.get('cache-control') });

    // Branding comes from WEDDING_* vars (run-tests sets a test brand), never source.
    check('brand: manifest name + short_name from config', mfBody.name === 'The Test Wedding' && mfBody.short_name === 'Test', { name: mfBody.name, short: mfBody.short_name });
    check('brand: service-worker cache name from config', swText.includes("const CACHE = 'test-wedding-v2';") && !swText.includes('%WP_BRAND_'), swText.match(/const CACHE = [^;]*;/));
    const brandShell = await fetch(`${BASE}/login`).then((res) => res.text());
    check('brand: shell title, description, app title from config', brandShell.includes('<title>The Test Wedding Planner</title>') && brandShell.includes('content="The Test Wedding - Complete Wedding Planning System"') && brandShell.includes('name="apple-mobile-web-app-title" content="Test"') && !brandShell.includes('%WP_BRAND_'), brandShell.match(/<title>[^<]*<\/title>/));
    const brandMeta = (brandShell.match(/<meta name="wp-brand" content="([^"]*)"/) || [])[1] || '';
    let brandJson = null; try { brandJson = JSON.parse(brandMeta.replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch { /* reported below */ }
    check('brand: SPA meta carries name/nav/slug/code', brandJson && brandJson.name === 'The Test Wedding' && brandJson.nav === 'Test Wedding' && brandJson.slug === 'test-wedding' && brandJson.code === 'TEST', brandMeta);

    const icRes = await fetch(`${BASE}/apple-touch-icon.png`);
    check('PWA icons: apple-touch-icon PNG served', icRes.status === 200 && (icRes.headers.get('content-type') || '').includes('image/png'), { status: icRes.status, ct: icRes.headers.get('content-type') });

    const icB = await fetch(`${BASE}/icon-512.png`).then((res) => res.arrayBuffer());
    check('PWA icons: 512px icon is a real PNG', icB.byteLength > 1000 && Buffer.from(icB).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { bytes: icB.byteLength });
  }

  // ---------------------------------------------------------------------
  section('11. Password management (temp flag + change-password)');
  {
    let r = await req('GET', '/api/auth/status');
    check('status: not temporary after normal init', r.status === 200 && r.data.temporary === false, r.data);

    r = await req('POST', '/api/auth/change-password', { current_password: 'nope', new_password: 'ChangedPass2026#' });
    check('change-password: wrong current → 401', r.status === 401, r);

    r = await req('POST', '/api/auth/change-password', { current_password: 'PlannerTest2026!', new_password: 'short' });
    check('change-password: short new → 400', r.status === 400, r);

    // Security: changing the password must revoke every other session. Keep a
    // copy of the current cookie, then confirm the change kills it while the
    // response re-issues a fresh one for this device (req() has captured it).
    const preChangeCookie = cookie;
    r = await req('POST', '/api/auth/change-password', { current_password: 'PlannerTest2026!', new_password: 'ChangedPass2026#' });
    check('change-password: success', r.status === 200 && r.data.changed === true, r);
    const oldRes = await fetch(BASE + '/api/auth/check', {
      headers: { Cookie: preChangeCookie },
      redirect: 'manual',
    });
    check('old session revoked after password change → 401', oldRes.status === 401, oldRes.status);

    r = await req('POST', '/api/auth/login', { password: 'PlannerTest2026!' });
    check('old password no longer works → 401', r.status === 401, r);

    r = await req('POST', '/api/auth/login', { password: 'ChangedPass2026#' });
    check('new password logs in', r.status === 200 && cookie !== '', r);

    r = await req('GET', '/api/auth/status');
    check('status: temporary still false after change-password', r.status === 200 && r.data.temporary === false, r.data);

    // Restore the suite's known password so re-runs stay green
    r = await req('POST', '/api/auth/change-password', { current_password: 'ChangedPass2026#', new_password: 'PlannerTest2026!' });
    check('change-password: restore original', r.status === 200 && r.data.changed === true, r);

    r = await req('POST', '/api/auth/login', { password: 'PlannerTest2026!' });
    check('login restored', r.status === 200 && cookie !== '', r);
  }

  // ---------------------------------------------------------------------
  section('12. Guest portal: window gating + household RSVP submit (public, no cookie)');
  {
    // Turn RSVP on via the admin window route (public routes then reflect it).
    // RSVPs follow the live site: open exactly while the RSVP (v3) site is
    // live. The old manual switch on its own no longer opens them.
    let r = await req('PUT', '/api/rsvp/window', { guest_mode: 'countdown', rsvp_open: true, rsvp_opens_at: '', rsvp_closes_at: '' });
    check('RSVP stays closed while v3 is not the live site', r.status === 200 && r.data.live_mode === 'countdown' && r.data.rsvp_open === false, r.data);
    r = await req('PUT', '/api/rsvp/window', { guest_mode: 'rsvp', rsvp_closes_at: '2000-01-01T00:00:00.000Z' });
    check('a past reply-by date closes RSVP even with v3 live', r.status === 200 && r.data.live_mode === 'rsvp' && r.data.rsvp_open === false, r.data);
    r = await req('PUT', '/api/rsvp/window', { guest_mode: 'rsvp', rsvp_closes_at: '' });
    check('window admin: RSVP opens when v3 goes live', r.status === 200 && r.data.rsvp_open === true, r.data);

    r = await req('GET', '/api/guest/home');
    check('guest home: rsvp_open true + mode', r.status === 200 && r.data.rsvp_open === true && !!r.data.mode, r.data);

    // Regression: a valid plan-site session may view preview hosts. The
    // preview gate permits it, so guest/home must not tell the SPA to render
    // its "Preview ended" card.
    r = await req('GET', '/api/guest/home', undefined, { base: `http://v1.127.0.0.1.nip.io:${PORT}` });
    check('v1 session preview: teaser + not ended', r.status === 200 && r.data.mode === 'teaser' && r.data.preview_ended === false, r.data);

    r = await req('GET', '/', undefined, { base: `http://v1.127.0.0.1.nip.io:${PORT}` });
    check('v1 session root: original coming-soon page', r.status === 200 && typeof r.data === 'string' && r.data.includes('Coming soon') && r.data.includes('Alex') && r.data.includes('are getting married'), r.data.slice(0, 120));

    // v2 preview: the countdown page — same layout as v1, ticking to the
    // wedding date entered in the plan.
    r = await req('GET', '/api/guest/home', undefined, { base: `http://v2.127.0.0.1.nip.io:${PORT}` });
    check('v2 session preview: countdown + not ended', r.status === 200 && r.data.mode === 'countdown' && r.data.preview_ended === false, r.data);

    r = await req('GET', '/', undefined, { base: `http://v2.127.0.0.1.nip.io:${PORT}` });
    check('v2 session root: countdown page to the wedding date', r.status === 200 && typeof r.data === 'string' && r.data.includes('Counting down') && r.data.includes('data-countdown="2027-08-21"') && r.data.includes('21 August 2027') && r.data.includes('Alex') && r.data.includes('days') && !r.data.includes('Coming soon'), r.data.slice(0, 120));

    // v4/v5 preview: Wedding Day and Thank You pages to the authenticated couple only.
    r = await req('GET', '/api/guest/home', undefined, { base: `http://v4.127.0.0.1.nip.io:${PORT}` });
    check('v4 session preview: weddingday + not ended', r.status === 200 && r.data.mode === 'weddingday' && r.data.preview_ended === false, r.data);

    r = await req('GET', '/', undefined, { base: `http://v4.127.0.0.1.nip.io:${PORT}` });
    check('v4 session root: wedding-day page', r.status === 200 && typeof r.data === 'string' && r.data.includes("Today's the day") && r.data.includes('Alex') && r.data.includes('St Mary&#39;s Church'), r.data.slice(0, 120));

    // Setup text is escaped on the public pages.
    const venueBefore = (await req('GET', '/api/setup')).data.reception_venue;
    await req('PUT', '/api/setup', { reception_venue: '<img src=x onerror=alert(1)>' });
    r = await req('GET', '/', undefined, { base: `http://v4.127.0.0.1.nip.io:${PORT}` });
    check('wedding-day page escapes the venue', typeof r.data === 'string' && !r.data.includes('<img src=x') && r.data.includes('&lt;img src=x onerror=alert(1)&gt;'), r.data.slice(0, 120));
    await req('PUT', '/api/setup', { reception_venue: venueBefore });

    r = await req('GET', '/api/guest/home', undefined, { base: `http://v5.127.0.0.1.nip.io:${PORT}` });
    check('v5 session preview: thankyou + not ended', r.status === 200 && r.data.mode === 'thankyou' && r.data.preview_ended === false, r.data);

    r = await req('GET', '/', undefined, { base: `http://v5.127.0.0.1.nip.io:${PORT}` });
    check('v5 session root: thank-you page', r.status === 200 && typeof r.data === 'string' && r.data.includes('Thank you') && r.data.includes('Alex') && !r.data.includes('Coming soon'), r.data.slice(0, 120));

    // Public access via household QR code.
    r = await req('POST', '/api/households', { name: 'Portal Family' });
    const portalHousehold = r.data.id;
    r = await req('POST', '/api/guests', { household_id: portalHousehold, first_name: 'Portal', last_name: 'One', is_primary: 1 });
    const portalGuest = r.data.id;
    r = await req('POST', `/api/households/${portalHousehold}/qr`);
    const portalCode = r.data.access_code;
    check('household QR code created', r.status === 200 && !!portalCode, r.data);

    r = await req('POST', '/api/guest/access', { code: portalCode.toLowerCase() }); // codes are case/dash-insensitive
    check('guest access: household + guests resolved', r.status === 200 && r.data.household && r.data.guests.length === 1 && r.data.rsvp_open === true, r.data);
    check('guest access: journey payload (meal options, open window, first visit)', r.status === 200 && Array.isArray(r.data.meal_options) && r.data.window_state === 'open' && r.data.already_responded === false && r.data.rsvp_submitted_at === '', r.data);

    r = await req('GET', '/api/rsvp/songs');
    check('song requests: admin list reachable (auth)', r.status === 200 && Array.isArray(r.data), r.data);

    // A malformed contact email is rejected before anything is written.
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, contact: { email: 'not-an-email' }, responses: [{ guest_id: portalGuest, attending: true }] });
    check('guest RSVP: invalid contact email rejected', r.status === 400 && /email/i.test(r.data.error || ''), r.data);

    // Ensure the household can't RSVP as someone else's guests. Contact is
    // asked once per household and stored on the primary guest.
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, contact: { email: 'Portal.One@example.com', phone: '07700 900123' }, responses: [{ guest_id: portalGuest, attending: true, dietary_choice: 'vegetarian', dietary_needs: 'severe nut allergy', song_request: 'Be Our Guest' }] });
    check('guest RSVP submit succeeds (was server-blocked)', r.status === 200 && r.data.submitted_at, r.data);

    // Household contact captured on the RSVP, persisted to the primary guest.
    r = await req('GET', '/api/guests');
    const portalContact = r.data.find((g) => g.id === portalGuest);
    check('RSVP household contact persisted to primary guest', portalContact && portalContact.email === 'Portal.One@example.com' && portalContact.phone === '07700 900123', portalContact);

    // ...and comes back through guest access so the form pre-fills.
    r = await req('POST', '/api/guest/access', { code: portalCode });
    const portalAccess = (r.data.guests || []).find((g) => g.id === portalGuest);
    check('guest access returns contact + dietary for prefill', r.status === 200 && portalAccess && portalAccess.email === 'Portal.One@example.com' && portalAccess.phone === '07700 900123' && portalAccess.dietary_needs === 'severe nut allergy', portalAccess);

    // The values land on the guest record (regression: edits must persist).
    r = await req('GET', '/api/guests');
    const portalNow = r.data.find((g) => g.id === portalGuest);
    check('RSVP values persisted to guest', portalNow && portalNow.status === 'confirmed' && portalNow.dietary_choice === 'vegetarian' && portalNow.song_request === 'Be Our Guest' && portalNow.dietary_needs === 'severe nut allergy', portalNow);

    // Only the values the form sends are accepted, and nothing is written
    // when any part of the RSVP is refused.
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: portalGuest, status: 'vip', notes: 'should not save' }] });
    check('guest RSVP: unknown status refused', r.status === 400, r.data);
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: portalGuest, attending: true, attendance_type: 'free_bar_only', notes: 'should not save' }] });
    check('guest RSVP: unknown attendance type refused', r.status === 400, r.data);
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: portalGuest, attending: true, notes: 'should not save' }, { guest_id: portalGuest, attending: false }] });
    check('guest RSVP: the same guest twice refused', r.status === 400, r.data);
    r = await req('GET', '/api/guests');
    const afterRefused = r.data.find((g) => g.id === portalGuest);
    check('guest RSVP: a refused RSVP changes nothing', afterRefused.notes === portalNow.notes && afterRefused.status === 'confirmed', afterRefused);

    // Free text is capped; answers are saved once per question and updated
    // in place; an answer to a question that no longer exists is dropped
    // rather than failing the whole RSVP.
    r = await req('POST', '/api/rsvp-questions', { question: 'Favourite cake?', field_type: 'text', options: [], required: 0, order_index: 0 });
    const cakeQ = r.data.id;
    const answerRows = async () => (await req('GET', '/api/export/all')).data.split('\n').filter((l) => l.includes(`,${portalGuest},${cakeQ},`));
    r = await req('POST', '/api/guest/rsvp', {
      code: portalCode,
      responses: [{ guest_id: portalGuest, attending: true, dietary_choice: 'vegetarian', dietary_needs: 'severe nut allergy', song_request: 'S'.repeat(5000), notes: 'N'.repeat(5000), answers: [{ question_id: cakeQ, answer: 'Lemon' }, { question_id: 'no-such-question', answer: 'x' }] }],
    });
    check('guest RSVP: long text and a stale answer still save', r.status === 200, r.data);
    r = await req('GET', '/api/guests');
    const capped = r.data.find((g) => g.id === portalGuest);
    // (Sent as `notes`, the key forms used before rsvp_message existed.)
    check('guest RSVP: free text capped (song 200, message 1000)', capped.song_request.length === 200 && capped.rsvp_message.length === 1000, { song: capped.song_request.length, message: (capped.rsvp_message || '').length });
    check('guest RSVP: the old notes key never reaches the couple’s notes', !String(capped.notes || '').startsWith('NNN'), (capped.notes || '').slice(0, 20));
    check('guest RSVP: attendance type follows the status', capped.attendance_type === 'dinner', capped.attendance_type);
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: portalGuest, attending: true, dietary_choice: 'vegetarian', dietary_needs: 'severe nut allergy', song_request: 'Be Our Guest', answers: [{ question_id: cakeQ, answer: 'Carrot' }] }] });
    const cakeRows = await answerRows();
    check('guest RSVP: a changed answer updates the one saved row', r.status === 200 && cakeRows.length === 1 && cakeRows[0].includes('Carrot'), cakeRows);
    await req('DELETE', `/api/rsvp-questions/${cakeQ}`);

    // Caterer dietary matrix: seated guests group under their table, unseated
    // under their household, and every dietary/contact field comes through.
    r = await req('POST', '/api/seating/tables', { name: 'Caterer Table', capacity: 4 });
    const catererTable = r.data.id;
    r = await req('POST', '/api/seating/assignments', { table_id: catererTable, guest_id: portalGuest, seat_number: 1 });
    check('caterer matrix: seating assigned', r.status === 200 && !!r.data.id, r.data);

    r = await req('GET', '/api/rsvp/dietary-matrix');
    const mx = r.data;
    const mxGuest = (mx.guests || []).find((g) => g.id === portalGuest);
    const mxGroup = (mx.groups || []).find((g) => g.key === 'table:Caterer Table');
    check('caterer matrix: guest row carries meal, dietary, contact + table', r.status === 200 && mxGuest && mxGuest.attending === true && mxGuest.meal === 'vegetarian' && mxGuest.dietary === 'severe nut allergy' && mxGuest.email === 'Portal.One@example.com' && mxGuest.phone === '07700 900123' && mxGuest.table_name === 'Caterer Table' && mxGuest.seat_number === 1, mxGuest);
    check('caterer matrix: seated guest grouped under their table', !!mxGroup && mxGroup.guests.some((g) => g.id === portalGuest), mxGroup && mxGroup.label);
    check('caterer matrix: unseated guests fall back to their household', (mx.groups || []).some((g) => g.key.startsWith('household:')), (mx.groups || []).map((g) => g.key).slice(0, 8));
    check('caterer matrix: summary counts dietary + contact', r.status === 200 && mx.summary && mx.summary.attending >= 1 && mx.summary.with_dietary >= 1 && mx.summary.with_contact >= 1 && mx.summary.seated >= 1 && mx.summary.meals && mx.summary.meals.vegetarian >= 1, mx.summary);

    // Declined guests must not be counted as attending.
    const declinedRow = (mx.guests || []).find((g) => g.status === 'declined');
    check('caterer matrix: declined guests marked not attending', !declinedRow || declinedRow.attending === false, declinedRow);

    // The couple's song-request list surfaces exactly what the guest submitted.
    r = await req('GET', '/api/rsvp/songs');
    const songRow = (r.data || []).find((s) => s.guest_id === portalGuest);
    check('song requests: guest request listed with household + status', r.status === 200 && songRow && songRow.song_request === 'Be Our Guest' && songRow.household_name === 'Portal Family' && songRow.status === 'confirmed' && typeof songRow.guest_name === 'string', songRow);

    // Plus-ones the guest adds themselves. The couple offer one without a
    // name; the place counts in the numbers until the guest answers.
    r = await req('GET', '/api/dashboard/stats');
    const statsBefore = r.data.guests;
    r = await req('POST', '/api/guests', { household_id: portalHousehold, first_name: 'Plus', last_name: 'Host', status: 'invited', plus_one_allowed: true });
    const plusHost = r.data.id;
    check('plus-one: offer saved on the guest', r.status === 200 && r.data.plus_one_allowed === true, r.data);
    const plusOnesOf = async (hostId) => (await req('GET', '/api/guests')).data.filter((g) => g.plus_one_of === hostId);

    r = await req('GET', '/api/dashboard/stats');
    check('plus-one: offered place counted as pending until confirmed', r.data.guests.plus_ones_pending === statsBefore.plus_ones_pending + 1 && r.data.guests.pending === statsBefore.pending + 2 && r.data.guests.total_invited === statsBefore.total_invited + 2, { before: statsBefore, after: r.data.guests });
    r = await req('GET', '/api/guests');
    check('plus-one: guest list flags the unconfirmed place', r.data.find((g) => g.id === plusHost).plus_one_pending === true && r.data.find((g) => g.id === portalGuest).plus_one_pending === false, r.data.find((g) => g.id === plusHost));
    r = await req('GET', '/api/households');
    check('plus-one: household count carries the unconfirmed place', r.data.find((h) => h.id === portalHousehold).plus_ones_pending === 1, r.data.find((h) => h.id === portalHousehold));
    r = await req('GET', '/api/seating/tables');
    check('plus-one: seating totals carry the unconfirmed place', r.status === 200 && r.data.totals.plus_ones_pending === statsBefore.plus_ones_pending + 1, r.data.totals);
    r = await req('POST', '/api/guest/access', { code: portalCode });
    check('plus-one: RSVP form is told who may add one', r.data.guests.find((g) => g.id === plusHost).plus_one_allowed === true && r.data.guests.find((g) => g.id === portalGuest).plus_one_allowed === false, r.data.guests);

    // A guest who was not offered a plus-one cannot add one.
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: portalGuest, attending: true, dietary_choice: 'vegetarian', plus_one: { bringing: true, first_name: 'Gate', last_name: 'Crasher' } }] });
    check('plus-one: ignored for a guest who was not offered one', r.status === 200 && (await plusOnesOf(portalGuest)).length === 0, r.data);

    // Bringing someone, name not known yet: a real guest row under a placeholder name.
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: plusHost, attending: true, plus_one: { bringing: true } }] });
    let plusRows = await plusOnesOf(plusHost);
    check('plus-one: unnamed plus-one saved as a confirmed guest', r.status === 200 && plusRows.length === 1 && plusRows[0].first_name === 'Guest' && plusRows[0].last_name === 'of Plus Host' && plusRows[0].status === 'confirmed' && plusRows[0].household_id === portalHousehold, plusRows);
    r = await req('GET', '/api/dashboard/stats');
    check('plus-one: no longer pending once confirmed', r.data.guests.plus_ones_pending === statsBefore.plus_ones_pending && r.data.guests.coming === statsBefore.coming + 2, r.data.guests);
    r = await req('POST', '/api/guest/access', { code: portalCode });
    check('plus-one: placeholder name flagged so the form shows it blank', r.data.guests.find((g) => g.plus_one_of === plusHost).name_pending === true, r.data.guests);

    // Naming them later updates the same row rather than adding another.
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: plusHost, attending: true, plus_one_of: portalGuest, plus_one: { bringing: true, first_name: 'Sam', last_name: 'Partner', dietary_choice: 'vegan' } }] });
    plusRows = await plusOnesOf(plusHost);
    check('plus-one: naming them updates the same guest', r.status === 200 && plusRows.length === 1 && plusRows[0].first_name === 'Sam' && plusRows[0].last_name === 'Partner' && plusRows[0].dietary_choice === 'vegan', plusRows);
    check('plus-one: the public RSVP cannot relink guests', (await plusOnesOf(portalGuest)).length === 0);

    // Changing their mind declines the plus-one without recounting the place.
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: plusHost, attending: true, plus_one: { bringing: false } }] });
    plusRows = await plusOnesOf(plusHost);
    r = await req('GET', '/api/dashboard/stats');
    check('plus-one: "not bringing anyone" declines the plus-one', plusRows.length === 1 && plusRows[0].status === 'declined' && r.data.guests.plus_ones_pending === statsBefore.plus_ones_pending, { plusRows, guests: r.data.guests });
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: plusHost, attending: true, plus_one: { bringing: true, first_name: 'Sam', last_name: 'Partner' } }] });
    plusRows = await plusOnesOf(plusHost);
    check('plus-one: can be added back while RSVPs are open', r.status === 200 && plusRows.length === 1 && plusRows[0].status === 'confirmed', plusRows);

    // Closed window: re-posting a (re)submit is rejected while access reports closed.
    r = await req('PUT', '/api/rsvp/window', { guest_mode: 'countdown' });
    check('window admin: RSVP closes when v3 stops being live', r.status === 200 && r.data.rsvp_open === false, r.data);
    r = await req('POST', '/api/guest/rsvp', { code: portalCode, responses: [{ guest_id: portalGuest, attending: false }] });
    check('guest RSVP submit blocked when window closed', r.status === 400 && /closed/i.test(r.data.error || ''), r.data);
    r = await req('POST', '/api/guest/access', { code: portalCode });
    check('guest access reports rsvp_open false', r.status === 200 && r.data.rsvp_open === false, r.data);
    check('guest access: closed window + already_responded after submit', r.status === 200 && r.data.window_state === 'closed' && r.data.already_responded === true && !!r.data.rsvp_submitted_at, r.data);
  }

  section('13. Go-live schedule: per-mode dates auto-advance the live site');
  {
    const past = (mins) => new Date(Date.now() - mins * 60 * 1000).toISOString();
    const future = (mins) => new Date(Date.now() + mins * 60 * 1000).toISOString();

    // Manual fallback only (no dates).
    let r = await req('PUT', '/api/rsvp/window', { guest_mode: 'countdown', teaser_live_at: '', countdown_live_at: '', rsvp_live_at: '' });
    check('no dates -> manual fallback countdown', r.status === 200 && r.data.live_mode === 'countdown' && r.data.guest_mode === 'countdown', r.data);

    // Past teaser date beats the manual fallback.
    r = await req('PUT', '/api/rsvp/window', { guest_mode: 'countdown', teaser_live_at: past(5) });
    check('arrived teaser date -> teaser live', r.status === 200 && r.data.live_mode === 'teaser', r.data);
    r = await req('GET', '/api/guest/home');
    check('guest home mirrors live_mode', r.status === 200 && r.data.mode === 'teaser', r.data);

    // Future countdown date not yet arrived -> teaser still live.
    r = await req('PUT', '/api/rsvp/window', { countdown_live_at: future(120) });
    check('future countdown date does NOT flip yet', r.status === 200 && r.data.live_mode === 'teaser', r.data);

    // Countdown date arrives (now in the past) -> countdown live.
    r = await req('PUT', '/api/rsvp/window', { countdown_live_at: past(2) });
    check('arrived countdown date -> countdown live', r.status === 200 && r.data.live_mode === 'countdown', r.data);

    // RSVP date later than countdown date -> RSVP wins (latest arrived).
    r = await req('PUT', '/api/rsvp/window', { rsvp_live_at: past(1) });
    check('later arrived rsvp date -> rsvp live', r.status === 200 && r.data.live_mode === 'rsvp', r.data);

    // Wedding Day (v4): an arrived weddingday_live_at wins over everything.
    r = await req('PUT', '/api/rsvp/window', { weddingday_live_at: past(1) });
    check('arrived weddingday date -> weddingday live', r.status === 200 && r.data.live_mode === 'weddingday', r.data);

    // Thank You (v5): an arrived thankyou_live_at wins over everything.
    r = await req('PUT', '/api/rsvp/window', { thankyou_live_at: past(1) });
    check('arrived thankyou date -> thankyou live', r.status === 200 && r.data.live_mode === 'thankyou', r.data);

    // Wedding-day auto rule: from midnight of the wedding date, v4 is live
    // even with no scheduled date at all.
    r = await req('GET', '/api/setup');
    const originalWedding = r.data.wedding_date;
    const today = new Date().toISOString().slice(0, 10);
    r = await req('PUT', '/api/setup', { wedding_date: today });
    r = await req('PUT', '/api/rsvp/window', { teaser_live_at: '', countdown_live_at: '', rsvp_live_at: '', weddingday_live_at: '', thankyou_live_at: '' });
    check('wedding day today -> weddingday auto-live', r.status === 200 && r.data.live_mode === 'weddingday', r.data);
    r = await req('GET', '/api/guest/home');
    check('guest home weddingday on the day', r.status === 200 && r.data.mode === 'weddingday', r.data);

    // Wedding-ended auto rule: the day after the wedding, v5 is live.
    r = await req('PUT', '/api/setup', { wedding_date: '2020-01-01' });
    r = await req('GET', '/api/rsvp/window');
    check('day after wedding -> thankyou auto-live', r.status === 200 && r.data.live_mode === 'thankyou', r.data);
    r = await req('GET', '/api/guest/home');
    check('guest home thankyou after wedding', r.status === 200 && r.data.mode === 'thankyou', r.data);

    // Restore the future wedding date -> schedule/fallback behaviour returns.
    r = await req('PUT', '/api/setup', { wedding_date: originalWedding || '2027-08-21' });
    r = await req('GET', '/api/rsvp/window');
    check('wedding date restored -> fallback again', r.status === 200 && r.data.live_mode === 'countdown', r.data);

    // Clearing all dates returns to the manual fallback.
    r = await req('PUT', '/api/rsvp/window', { teaser_live_at: '', countdown_live_at: '', rsvp_live_at: '', guest_mode: 'teaser' });
    check('cleared dates -> manual teaser again', r.status === 200 && r.data.live_mode === 'teaser' && r.data.guest_mode === 'teaser', r.data);
  }

  // ---------------------------------------------------------------------
  section('14. Guest tools admin: tags, questions, reminders');
  {
    // --- Tags ---
    let r = await req('POST', '/api/guest-tags', { name: 'Close friends', color: '#8B5E3C' });
    check('create tag', r.status === 200 && !!r.data.id && r.data.name === 'Close friends', r);
    const tagId = r.data.id;

    r = await req('GET', '/api/guest-tags');
    check('tags list', r.status === 200 && Array.isArray(r.data) && r.data.length >= 1, r);

    r = await req('PUT', `/api/guest-tags/${tagId}`, { name: 'Besties' });
    check('rename tag', r.status === 200 && r.data.name === 'Besties', r);

    r = await req('GET', '/api/guests');
    const tagGuest = (r.data || []).find((g) => g.first_name === 'Portal' && g.last_name === 'One');
    check('portal guest found for tag', r.status === 200 && !!tagGuest, r.data && r.data.slice(0, 2));
    r = await req('POST', `/api/guests/${tagGuest.id}/tags`, { tag_ids: [tagId] });
    check('assign tag to guest', r.status === 200 && r.data.updated === true, r);

    r = await req('GET', '/api/guest-tags/assignments');
    check('tag assignments list', r.status === 200 && Array.isArray(r.data) && r.data.some((a) => a.guest_id === tagGuest.id && a.tag_id === tagId), r);

    r = await req('DELETE', `/api/guest-tags/${tagId}`);
    check('delete tag', r.status === 200 && r.data.deleted === true, r);

    r = await req('GET', '/api/guest-tags/assignments');
    check('assignments cleaned after tag delete', r.status === 200 && !r.data.some((a) => a.tag_id === tagId), r);

    // --- Custom questions ---
    r = await req('POST', '/api/rsvp-questions', { question: 'How spicy is your chilli?', field_type: 'select', options: ['Mild', 'Hot', 'Volcanic'], required: 0, order_index: 0 });
    check('create question', r.status === 200 && !!r.data.id, r);
    const qId = r.data.id;

    r = await req('GET', '/api/rsvp-questions');
    check('questions list', r.status === 200 && Array.isArray(r.data) && r.data.some((q) => q.id === qId), r);

    r = await req('PUT', `/api/rsvp-questions/${qId}`, { required: 1 });
    check('update question required', r.status === 200 && r.data.required === 1, r);

    r = await req('DELETE', `/api/rsvp-questions/${qId}`);
    check('delete question', r.status === 200 && r.data.deleted === true, r);

    // --- Reminders ---
    r = await req('GET', '/api/rsvp/reminders');
    check('reminders list shape', r.status === 200 && Array.isArray(r.data.pending) && Array.isArray(r.data.log), r);

    // Portal Family RSVP'd (section 12) -> must NOT appear as pending.
    r = await req('GET', '/api/rsvp/reminders');
    const pendingPortal = (r.data.pending || []).find((p) => p.household_name === 'Portal Family');
    check('confirmed household not pending', !pendingPortal, r.data.pending);

    // Fresh household with a QR code but no RSVP -> pending.
    r = await req('POST', '/api/households', { name: 'Waiting Family' });
    const waitHouse = r.data.id;
    await req('POST', '/api/guests', { household_id: waitHouse, first_name: 'Waiting', last_name: 'One', is_primary: 1 });
    r = await req('POST', `/api/households/${waitHouse}/qr`);
    check('waiting household QR created', r.status === 200 && !!r.data.access_code, r.data);

    r = await req('GET', '/api/rsvp/reminders');
    const pendingWait = (r.data.pending || []).find((p) => p.household_id === waitHouse);
    check('unresponded household listed as pending', r.status === 200 && pendingWait && pendingWait.pending_count >= 1, r.data.pending);

    r = await req('POST', '/api/rsvp/reminders', { household_ids: [waitHouse], note: 'Gentle nudge' });
    check('send reminder', r.status === 200 && r.data.count === 1 && r.data.status === 'sent', r);

    r = await req('GET', '/api/rsvp/reminders');
    const hasLog = (r.data.log || []).some((e) => e.household_id === waitHouse && e.note === 'Gentle nudge');
    check('reminder logged', r.status === 200 && hasLog, (r.data.log || []).slice(0, 3));

    r = await req('POST', '/api/rsvp/reminders', { household_ids: [] });
    check('empty household list rejected', r.status === 400, r);
  }

  // ---------------------------------------------------------------------
  // Master Timeline: appointments CRUD + /api/timeline aggregation.
  // Every dated source (tasks, payments, suppliers, appointments, events,
  // decisions, RSVP windows) must appear as an item on the right date.
  section('15. Master timeline: appointments + aggregation');
  {
    const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

    // --- Appointments CRUD ---
    let r = await req('POST', '/api/appointments', { title: 'Dress fitting', date: inDays(10), time: '14:00', location: 'Bridal boutique' });
    const aptId = r.data.id;
    check('create appointment', r.status === 200 && !!aptId && r.data.date === inDays(10), r);
    r = await req('GET', '/api/appointments');
    check('appointments list', r.status === 200 && r.data.some((a) => a.id === aptId), r);
    r = await req('PUT', `/api/appointments/${aptId}`, { location: 'Changed address', time: '15:30' });
    check('update appointment', r.status === 200 && r.data.time === '15:30' && r.data.location === 'Changed address', r);
    r = await req('GET', '/api/timeline');
    check('timeline 200 + items array', r.status === 200 && Array.isArray(r.data.items), r.status);

    // --- Seed one of each timeline source ---
    r = await req('POST', '/api/budget/categories', { name: 'Timeline cat', allowance_pence: 0 });
    const catId = r.data.id;
    r = await req('POST', '/api/budget/items', { category_id: catId, name: 'Timeline supplier item', estimate_pence: 150000 });
    const itemId = r.data.id;
    r = await req('POST', '/api/payments', { budget_item_id: itemId, type: 'instalment', due_date: inDays(20), amount_pence: 50000 });
    check('timeline payment seeded', r.status === 200 && !!r.data.id, r);

    r = await req('POST', '/api/tasks', { title: 'Timeline task', stage: 'initial_planning', agreed_deadline: inDays(30) });
    check('timeline task seeded', r.status === 200 && !!r.data.id, r);

    r = await req('POST', '/api/suppliers', { name: 'Timeline florist', category: 'flowers', booking_status: 'quoted', deadline: inDays(40) });
    const supId = r.data.id;
    check('timeline supplier seeded', r.status === 200 && !!r.data.id, r);
    r = await req('POST', '/api/suppliers', { name: 'No deadline florist', category: 'flowers' });
    check('supplier without deadline ok (no timeline item)', r.status === 200 && !r.data.deadline, r);
    r = await req('PUT', `/api/suppliers/${supId}`, { deadline: inDays(41) });
    check('supplier deadline updatable', r.status === 200 && r.data.deadline === inDays(41), r);

    r = await req('POST', '/api/events', { title: 'Timeline hen do', type: 'hen_doe', date: inDays(50), status: 'planning' });
    check('timeline event seeded', r.status === 200 && !!r.data.id, r);

    r = await req('POST', '/api/decisions', { title: 'Timeline decision', category: 'music', deadline: inDays(60), status: 'open' });
    check('timeline decision seeded', r.status === 200 && !!r.data.id, r);

    // --- Aggregation correctness ---
    r = await req('GET', '/api/timeline');
    const its = r.data.items || [];
    const find = (type, date) => its.find((i) => i.type === type && i.date === date);
    check('timeline has appointment on its day', !!find('appointment', inDays(10)), its.filter((i) => i.type === 'appointment').slice(0, 3));
    check('timeline has payment on its due date', !!find('payment', inDays(20)), its.filter((i) => i.type === 'payment').slice(0, 3));
    check('timeline has task on its deadline', !!find('task', inDays(30)), its.filter((i) => i.type === 'task').slice(0, 3));
    check('timeline has supplier on updated deadline', !!find('supplier', inDays(41)), its.filter((i) => i.type === 'supplier').slice(0, 3));
    check('timeline has event on its date', !!find('event', inDays(50)), its.filter((i) => i.type === 'event').slice(0, 3));
    check('timeline has decision on its deadline', !!find('decision', inDays(60)), its.filter((i) => i.type === 'decision').slice(0, 3));
    check('payment carries amount_pence', its.some((i) => i.type === 'payment' && i.date === inDays(20) && i.amount_pence === 50000), its.filter((i) => i.type === 'payment').slice(0, 3));
    check('timeline sorted by date', its.every((i, idx) => idx === 0 || its[idx - 1].date <= i.date), its.slice(0, 8).map((i) => `${i.date}:${i.type}`));

    // --- Appointment delete ---
    r = await req('DELETE', `/api/appointments/${aptId}`);
    check('delete appointment', r.status === 200 && r.data.deleted === true, r);
    r = await req('GET', '/api/appointments');
    check('appointment gone after delete', r.status === 200 && !r.data.some((a) => a.id === aptId), r);
    r = await req('GET', '/api/timeline');
    check('deleted appointment leaves timeline', r.status === 200 && !(r.data.items || []).some((i) => i.id === aptId), r.status);
  }

  // ---------------------------------------------------------------------
  // Email & reminders: config, audience resolution, campaigns, the brief and
  // RSVP reminder emailing — all exercised in simulation mode (EMAIL_DRY_RUN)
  // so no real emails leave the machine (provider_id 'dry-*').
  section('16. Email & reminders: config, audience, campaigns');
  {
    // --- Config comes from the Worker's variables and is read-only ---
    let r = await req('GET', '/api/email/config');
    check('email config from env (simulation)', r.status === 200 && r.data.configured === true && r.data.dry_run === true && r.data.digest_time === '08:00' && JSON.stringify(r.data.couple_emails) === '["couple@test.local"]', r);
    check('assistant off without an API key', r.data.assistant && r.data.assistant.configured === false, r.data.assistant);
    check('no provider key in the config', !JSON.stringify(r.data).includes('api_key'), r.data);

    r = await req('PUT', '/api/email/config', { digest_time: '09:00' });
    check('email config cannot be edited over the API', r.status === 404 || r.status === 405, r.status);

    // --- Audience resolution ---
    r = await req('POST', '/api/households', { name: 'Email HQ' });
    const hqId = r.data.id;
    r = await req('POST', '/api/guests', { household_id: hqId, first_name: 'Emma', last_name: 'HQ', is_primary: 1, email: 'emma@test.local' });
    const emmaId = r.data.id;
    await req('POST', '/api/guests', { household_id: hqId, first_name: 'Bob', last_name: 'HQ', email: 'bob@test.local' });
    await req('POST', `/api/households/${hqId}/qr`);
    await req('PUT', `/api/guests/${emmaId}`, { status: 'confirmed' });

    r = await req('POST', '/api/households', { name: 'Email Pending' });
    const pendingId = r.data.id;
    await req('POST', '/api/guests', { household_id: pendingId, first_name: 'Pat', last_name: 'Pending', is_primary: 1, email: 'pat@test.local' });

    r = await req('POST', '/api/households', { name: 'Email Declined' });
    const declinedId = r.data.id;
    r = await req('POST', '/api/guests', { household_id: declinedId, first_name: 'Dan', last_name: 'Declining', is_primary: 1, email: 'dan@test.local' });
    await req('PUT', `/api/guests/${r.data.id}`, { status: 'declined' });

    r = await req('POST', '/api/households', { name: 'Email NoMail' });
    const noMailId = r.data.id;
    await req('POST', '/api/guests', { household_id: noMailId, first_name: 'Mum', last_name: 'Quiet', is_primary: 1 });

    r = await req('GET', '/api/email/audience?audience=all');
    check('audience all: resolve every household with an email', r.status === 200 && r.data.total >= 3, r.data);
    r = await req('GET', '/api/email/audience?audience=all');
    const haves = (r.data.recipients || []).map((x) => x.email);
    check('audience all: one per household incl. our seeds', r.status === 200 && haves.includes('emma@test.local') && haves.includes('pat@test.local') && haves.includes('dan@test.local') && haves.length === new Set(haves).size, haves);

    r = await req('GET', '/api/email/audience?audience=all');
    check('email-less households reported skipped', r.status === 200 && r.data.skipped_count >= 1 && r.data.skipped.some((s) => s.household_id === noMailId), r.data.skipped);

    r = await req('GET', '/api/email/audience?audience=unresponded');
    check('audience unresponded → only pending household', r.status === 200 && r.data.total === 1 && r.data.recipients[0].email === 'pat@test.local', r.data);
    r = await req('GET', '/api/email/audience?audience=confirmed');
    const conf = (r.data.recipients || []).map((x) => x.email);
    check('audience confirmed → confirmed households only', r.status === 200 && conf.includes('emma@test.local') && !conf.includes('dan@test.local') && !conf.includes('pat@test.local'), conf);
    r = await req('GET', '/api/email/audience?audience=declined');
    check('audience declined → Dan only', r.status === 200 && r.data.total === 1 && r.data.recipients[0].email === 'dan@test.local', r.data);
    r = await req('GET', `/api/email/audience?audience=household&household_id=${encodeURIComponent(hqId)}`);
    check('audience household id → HQ only, code present', r.status === 200 && r.data.total === 1 && r.data.recipients[0].email === 'emma@test.local' && !!r.data.recipients[0].code, r.data);
    r = await req('GET', '/api/email/audience?audience=household');
    check('household audience without id → 400', r.status === 400, r);

    // --- Campaign send (simulation) ---
    r = await req('POST', '/api/email/campaigns', {
      subject: 'Update from the couple',
      body: 'Hi {name}, your code is {code}. See you soon!',
      audience: 'all',
    });
    const campId = r.data.campaign_id;
    check('campaign sent (dry-run): all recipients', r.status === 200 && r.data.count >= 3 && r.data.sent === r.data.count && r.data.status === 'sent' && r.data.dry_run === true, r);

    r = await req('GET', '/api/email/campaigns');
    const found = (r.data || []).find((c) => c.id === campId);
    check('campaign listed with kind+count', r.status === 200 && found && found.kind === 'guest_campaign' && found.recipient_count >= 3 && found.audience === 'all', r.data && r.data[0]);

    r = await req('GET', `/api/email/campaigns/${campId}`);
    const logRows = (r.data && r.data.log) || [];
    const logEmails = logRows.map((l) => l.to_email);
    check('campaign detail: dry-run log rows', r.status === 200 && logRows.length >= 3 && logRows.every((l) => l.status === 'sent' && l.provider_id.startsWith('dry-')), logRows);
    check('campaign log rows cover our seeded recipients', logEmails.includes('emma@test.local') && logEmails.includes('pat@test.local') && logEmails.includes('dan@test.local'), logEmails);

    // --- HTML campaigns + draft preview + test-draft ---
    r = await req('POST', '/api/email/campaigns', {
      subject: 'Fancy update',
      body: 'Hi {name}, fancy HTML below.',
      body_html: '<p>Hi <strong>{name}</strong> &mdash; <a href="{rsvp_url}">RSVP here</a></p>{rsvp_button}',
      audience: 'all',
    });
    const fancyId = r.data.campaign_id;
    check('html campaign sent in simulation', r.status === 200 && r.data.status === 'sent', r);
    r = await req('GET', `/api/email/campaigns/${fancyId}`);
    check('body_html stored with rendered snapshot', r.status === 200 && typeof r.data.campaign.body_html === 'string' && r.data.campaign.body_html.startsWith('<!doctype html>'), r.data.campaign.body_html && 'stored');

    r = await req('POST', '/api/email/campaigns/preview', { subject: 'Preview me', body: 'Hi {name},\n\nRSVP with {rsvp_button}' });
    check('preview renders sample merge data', r.status === 200 && r.data.text.includes('Sample Guest') && r.data.text.includes('TEST-DEMO') && r.data.html.includes('View details') && r.data.html.includes('c=TEST-DEMO'), r.data.subject);

    // Plain-text mode: {rsvp_button} (button: VML + anchor = 2 links), {rsvp_url}
    // (1 link) and a URL the couple typed themselves (1 link, untouched).
    r = await req('POST', '/api/email/campaigns/preview', { subject: 'Links', body: 'Hi {name},\n\n{rsvp_button}\n\nOr open {rsvp_url}\n\nVenue map: https://maps.example.com/venue?x=1&y=2' });
    checkEmailLinks('plain preview', r.data && r.data.html, { code: 'TEST-DEMO', rsvpLinks: 3, extra: ['https://maps.example.com/venue?x=1&amp;y=2'] });
    check('plain preview: {rsvp_url} is a link, not bare text', /<a href="https:\/\/[^"]*\?c=TEST-DEMO"[^>]*>https:\/\/[^<]*\?c=TEST-DEMO<\/a>/.test((r.data && r.data.html) || ''), r.data && r.data.html && r.data.html.slice(0, 80));
    check('plain preview: text part keeps the raw RSVP URL', r.data && r.data.text.includes('RSVP online here: https://') && r.data.text.includes('?c=TEST-DEMO') && !r.data.text.includes('<a '), r.data && r.data.text);

    // A couple-typed URL that carries merge tags: they are filled INSIDE the
    // link (URL-encoded in href, escaped in the label); a trailing "." stays out.
    r = await req('POST', '/api/email/campaigns/preview', { subject: 'Tag links', body: 'Reply here: https://x.example.com/rsvp?c={code}&n={name}.\n\nOr https://x.example.com/{code}, thanks!' });
    {
      const html = (r.data && r.data.html) || '';
      checkEmailLinks('typed URL with tags', html, { code: 'TEST-DEMO', rsvpLinks: 1, extra: ['https://x.example.com/rsvp?c=TEST-DEMO&amp;n=Sample%20Guest', 'https://x.example.com/TEST-DEMO'] });
      check('typed URL with tags: label shows the filled URL, punctuation outside the link', html.includes('>https://x.example.com/rsvp?c=TEST-DEMO&amp;n=Sample Guest</a>.') && html.includes('>https://x.example.com/TEST-DEMO</a>, thanks!'), (html.match(/Reply here:[^]{0,260}/) || [''])[0]);
      check('typed URL with tags: no tag left unfilled', !/\{(?:name|code|rsvp_url)\}/.test(html), (html.match(/\{[a-z_]+\}/) || [''])[0]);
    }

    // Couple-written HTML that already has its own link, plus href="{rsvp_url}"
    // and {rsvp_button}.
    const coupleHtml = '<p>Hi {name}</p><p><a href="https://example.com/our-story?from=email&amp;ref=1">Our story</a></p><p><a href="{rsvp_url}">RSVP here</a></p>{rsvp_button}';
    r = await req('POST', '/api/email/campaigns/preview', { subject: 'Links', body: 'fallback', body_html: coupleHtml });
    checkEmailLinks('couple-written HTML preview', r.data && r.data.html, { code: 'TEST-DEMO', rsvpLinks: 3, extra: ['https://example.com/our-story?from=email&amp;ref=1'] });

    r = await req('POST', '/api/email/campaigns/test-draft', { subject: 'Links draft', body: 'Hi {name},\n\n{rsvp_button}' });
    {
      const list = await req('GET', '/api/email/campaigns');
      const draft = (list.data || []).find((c) => c.subject === 'Links draft');
      const full = draft ? await req('GET', `/api/email/campaigns/${draft.id}`) : null;
      checkEmailLinks('test-draft snapshot', full && full.data.campaign.body_html, { code: 'TEST-DEMO', rsvpLinks: 2 });
    }

    // RSVP reminder (dry run): a household with an email and a real code.
    {
      let h = await req('POST', '/api/households', { name: 'Link Check Family' });
      const linkHouse = h.data.id;
      await req('POST', '/api/guests', { household_id: linkHouse, first_name: 'Link', last_name: 'Check', is_primary: 1, email: 'linkcheck@test.local' });
      h = await req('POST', `/api/households/${linkHouse}/qr`);
      const linkCode = h.data && h.data.access_code;
      h = await req('POST', '/api/rsvp/reminders', { household_ids: [linkHouse], note: 'Link check' });
      const list = await req('GET', '/api/email/campaigns');
      const rem = (list.data || []).find((c) => c.kind === 'rsvp_reminder');
      const full = rem ? await req('GET', `/api/email/campaigns/${rem.id}`) : null;
      check('reminder: sent in simulation (dry run only)', h.status === 200 && rem && rem.dry_run === 1, rem);
      checkEmailLinks('reminder snapshot', full && full.data.campaign.body_html, { code: linkCode, rsvpLinks: 2 });
      await req('DELETE', `/api/households/${linkHouse}`);
    }

    r = await req('POST', '/api/email/campaigns/test-draft', { subject: 'Test draft', body: 'Hi {name}!' });
    check('test-draft → couple inbox (dry-run, logged)', r.status === 200 && r.data.status === 'sent' && r.data.dry_run === true && r.data.count === 1, r);

    // --- Digest ---
    await req('PUT', '/api/rsvp/window', { guest_mode: 'rsvp' }); // v3 live, so RSVPs are open and the section appears
    r = await req('GET', '/api/email/digest');
    check('digest preview mentions guests section', r.status === 200 && /GUESTS & RSVPs/i.test(r.data.text || '') && /plan site/i.test(r.data.text || ''), r.data.subject);
    check('digest preview ships styled html', r.status === 200 && typeof r.data.html === 'string' && r.data.html.includes('The Test Wedding') && r.data.html.includes('daily planner digest') && r.data.html.includes('<table'), r.data.html && r.data.html.length);

    r = await req('POST', '/api/email/digest');
    check('digest send (dry-run) → sent + logged to couple email', r.status === 200 && r.data.status === 'sent' && r.data.count === 1 && r.data.dry_run === true, r);
    r = await req('GET', '/api/email/campaigns');
    const digestCamp = (r.data || []).find((c) => c.kind === 'couple_reminder');
    check('digest campaign recorded', r.status === 200 && !!digestCamp && digestCamp.recipient_count === 1, r.data && r.data[0]);
    r = await req('GET', `/api/email/campaigns/${digestCamp.id}`);
    check('digest log row → couple@test.local', r.status === 200 && (r.data.log || []).some((l) => l.to_email === 'couple@test.local'), r);

    // --- Test email ---
    r = await req('POST', '/api/email/test');
    check('test email (dry-run) ok', r.status === 200 && r.data.all_ok === true && r.data.results[0]?.dry_run === true, r);

    // --- RSVP reminders now actually email (simulation) ---
    r = await req('POST', '/api/households', { name: 'Remind Email' });
    const remindHouse = r.data.id;
    await req('POST', '/api/guests', { household_id: remindHouse, first_name: 'Remy', last_name: 'Mind', is_primary: 1, email: 'remy@test.local' });
    r = await req('POST', `/api/households/${remindHouse}/qr`);
    check('remind household QR created', r.status === 200 && !!r.data.access_code, r);
    r = await req('POST', '/api/rsvp/reminders', { household_ids: [remindHouse], note: 'Nudge nudge' });
    check('reminder emailed in simulation', r.status === 200 && r.data.emailed && r.data.emailed.attempted === 1 && r.data.emailed.sent === 1, r);
    r = await req('GET', '/api/email/campaigns');
    const rsvpCamp = (r.data || []).find((c) => c.kind === 'rsvp_reminder');
    check('rsvp reminder campaign recorded', r.status === 200 && !!rsvpCamp && rsvpCamp.recipient_count >= 1, r.data && r.data[0]);
    r = await req('GET', `/api/email/campaigns/${rsvpCamp.id}`);
    check('rsvp reminder email logged to guest', r.status === 200 && (r.data.log || []).some((l) => l.to_email === 'remy@test.local'), r);

    // Restore: leave simulation on is fine (suite ends after security).
  }

  // ---------------------------------------------------------------------
  // Guest website (v3): draft/publish content model, public payload, events
  // guest-visibility, meal options, view counter, and privacy isolation.
  section('17. Guest website: draft/publish + public payload');
  {
    let r = null;

    // Admin routes require the couple session.
    const bare = await fetch(`${BASE}/api/guest-site`);
    check('guest-site admin: 401 without session', bare.status === 401, { status: bare.status });

    // Save a draft with all sections + custom meal options.
    const draft = {
      hero: { heading: 'We are getting married', welcome: 'A warm welcome to all of you.', photo_url: 'https://cdn.example.com/hero.jpg', photo_alt: 'Two people in a garden' },
      travel: {
        ceremony_address: 'The Old Hall\nHigh Street\nTestville',
        ceremony_map_url: 'https://maps.google.com/?q=The+Old+Hall',
        ceremony_w3w: '///filled.count.soap',
        parking: 'Free parking on site.',
      },
      expect: { dress_code: 'Garden party — smart casual.', weather: 'Bring layers; we are outside at sunset.' },
      menu: { title: 'The wedding breakfast', body: 'Starter\nMain\nDessert' },
      faqs: [
        { id: 'f1', question: 'What time should we arrive?', answer: 'From 1:30pm for a 2pm ceremony.', visible: true },
        { id: 'f2', question: 'Is there parking?', answer: 'Yes, free on site.', visible: true },
        { id: 'f3', question: 'Unanswered question', answer: '', visible: true },
      ],
      gifts: { note: 'Your presence is the present.', registry_url: 'https://registry.example.com' },
      contact: { email: 'wedding@example.com' },
      search_index: true,
    };
    r = await req('PUT', '/api/guest-site', { draft, meal_options: ['beef', 'fish', 'vegan'] });
    check('draft saved (hero + meal options)', r.status === 200 && r.data.draft.hero.welcome === 'A warm welcome to all of you.' && r.data.meal_options.join(',') === 'beef,fish,vegan', r.data && { w: r.data.draft && r.data.draft.hero && r.data.draft.hero.welcome, mo: r.data.meal_options });

    r = await req('GET', '/api/guest-site');
    check('draft round-trips on admin GET', r.status === 200 && r.data.draft.faqs.length === 3 && r.data.draft.travel.parking.includes('Free parking'), r.data && r.data.draft && r.data.draft.travel);

    // Unsafe content is sanitised at rest: scripts/URLs stripped, email validated.
    r = await req('PUT', '/api/guest-site', { draft: { ...draft, hero: { ...draft.hero, photo_url: 'javascript:alert(1)' }, contact: { email: 'not-an-email' } }, meal_options: ['beef', 'fish', 'vegan'] });
    check('sanitisation: script URL + bad email stripped', r.status === 200 && r.data.draft.hero.photo_url === '' && r.data.draft.contact.email === '', r.data && { u: r.data.draft && r.data.draft.hero && r.data.draft.hero.photo_url, e: r.data.draft && r.data.draft.contact && r.data.draft.contact.email });
    // A link typed without https:// is kept (as https), not dropped.
    r = await req('PUT', '/api/guest-site', { draft: { ...draft, gifts: { ...draft.gifts, registry_url: 'registry.example.com/list?id=1' } }, meal_options: ['beef', 'fish', 'vegan'] });
    check('sanitisation: bare link gains https://', r.status === 200 && r.data.draft.gifts.registry_url === 'https://registry.example.com/list?id=1', r.data && r.data.draft && r.data.draft.gifts);
    // ...and restore the real values for the publish test below.
    r = await req('PUT', '/api/guest-site', { draft, meal_options: ['beef', 'fish', 'vegan'] });

    // Before publishing: the public site is locked — names + date only.
    const pub0 = await (await fetch(`${BASE}/api/guest/site`)).json();
    check('public site: locked before publish (no draft leak)', pub0.locked === true && pub0.content === undefined && pub0.ceremony_venue === undefined, { locked: pub0.locked, hasContent: !!pub0.content });

    // Events: only guest_visible rows surface, with public fields.
    r = await req('POST', '/api/events', { title: 'The Ceremony', type: 'ceremony', date: '2027-06-05', venue: 'The Old Hall', guest_visible: 1, start_time: '14:00', end_time: '15:00', guest_description: 'Under the oak tree' });
    check('event created with guest fields', r.status === 200 && !!r.data.id, r);
    const visEv = r.data.id;
    r = await req('POST', '/api/events', { title: 'Internal planning call', type: 'other', date: '2027-05-20', guest_visible: 0 });
    check('private event created (guest_visible 0)', r.status === 200 && !!r.data.id, r);

    r = await req('PUT', `/api/events/${visEv}`, { start_time: '14:30', guest_description: 'Updated note' });
    check('event guest fields updatable via PUT', r.status === 200 && r.data.start_time === '14:30', r);

    // Publish the draft.
    r = await req('POST', '/api/guest-site/publish');
    check('publish returns published_at', r.status === 200 && !!r.data.published_at && r.data.published.hero.welcome === 'A warm welcome to all of you.', r);

    // A guest household + RSVP access code for the unlock tests below.
    r = await req('POST', '/api/households', { name: 'Site Village' });
    const siteHousehold = r.data.id;
    r = await req('POST', '/api/guests', { household_id: siteHousehold, first_name: 'Site', last_name: 'Goer', is_primary: 1 });
    r = await req('POST', `/api/households/${siteHousehold}/qr`);
    const siteCode = r.data.access_code;

    // Public payload: locked — couples' names + the date + the RSVP window,
    // and nothing else (details need an RSVP access code).
    const pub1 = await (await fetch(`${BASE}/api/guest/site`)).json();
    check('public payload: locked — names + date + window only', pub1.locked === true && typeof pub1.rsvp_open === 'boolean' && typeof pub1.mode === 'string' && typeof pub1.couple === 'object' && 'name_one' in pub1.couple && 'wedding_date' in pub1, { locked: pub1.locked, mode: pub1.mode });
    check('public payload: no venue / content / events / meal options', pub1.content === undefined && pub1.ceremony_venue === undefined && pub1.reception_venue === undefined && pub1.events === undefined && pub1.meal_options === undefined, { hasContent: !!pub1.content, ev: !!pub1.events, mo: !!pub1.meal_options });

    // Privacy: the locked public payload leaks no private state.
    const pubStr = JSON.stringify(pub1);
    check('public payload: no secrets or private lists', !pubStr.includes('auth_secret') && !pubStr.includes('password_hash') && !pubStr.includes('resend_api_key') && !pubStr.includes('preview_tokens') && !pubStr.includes('guest_v') && !pubStr.includes('ceremony_venue'), pubStr.slice(0, 200));

    // Guest unlock: the RSVP access code reveals the full site (published
    // content + venues + events + meal options — never household data).
    r = await req('POST', '/api/guest/site/unlock', { code: '' });
    check('unlock: empty code rejected', r.status === 400 && /enter your access code/i.test(r.data.error || ''), r.data);
    r = await req('POST', '/api/guest/site/unlock', { code: 'NO-SUCH-CODE-123' });
    check('unlock: unknown code rejected', r.status === 400 && /wasn't found|wasn.t found/i.test(r.data.error || ''), r.data);
    r = await req('POST', '/api/guest/site/unlock', { code: siteCode });
    check('unlock: valid code returns full site', r.status === 200 && r.data.unlocked === true && r.data.site && r.data.site.content && r.data.site.content.hero && r.data.site.content.hero.welcome === 'A warm welcome to all of you.' && Array.isArray(r.data.site.meal_options) && r.data.site.meal_options.join(',') === 'beef,fish,vegan', r.data && { unlocked: r.data.unlocked, welcome: r.data.site && r.data.site.content && r.data.site.content.hero && r.data.site.content.hero.welcome });
    check('unlock: visible event present, private event excluded', Array.isArray(r.data.site.events) && r.data.site.events.some((e) => e.id === visEv && e.start_time === '14:30' && e.description === 'Updated note') && !r.data.site.events.some((e) => e.title === 'Internal planning call'), r.data.site && r.data.site.events && r.data.site.events.map((e) => e.title));
    check('unlock: FAQs filtered to answered+visible', Array.isArray(r.data.site.content.faqs) && r.data.site.content.faqs.length === 2, r.data.site && r.data.site.content && r.data.site.content.faqs && r.data.site.content.faqs.length);
    check('unlock: venue fields return', typeof r.data.site.ceremony_venue === 'string' && 'reception_venue' in r.data.site, r.data.site && { c: r.data.site.ceremony_venue });
    check('unlock: no household/guest data (that is access-route only)', r.data.site.household === undefined && r.data.site.guests === undefined && r.data.site.questions === undefined, 'no household leak');

    // Draft edits after publish stay private — the public site stays locked.
    r = await req('PUT', '/api/guest-site', { draft: { ...draft, hero: { ...draft.hero, welcome: 'EDITED BUT UNPUBLISHED' } }, meal_options: ['beef', 'fish', 'vegan'] });
    const pub2 = await (await fetch(`${BASE}/api/guest/site`)).json();
    check('post-publish draft edit NOT public', pub2.locked === true && pub2.content === undefined, { locked: pub2.locked, hasContent: !!pub2.content });

    // Draft preview requires the couple session: with cookie → draft; bare → locked public.
    const withPreview = await req('GET', '/api/guest/site?draft=1');
    check('draft=1 WITH session returns the draft', withPreview.data.content.hero.welcome === 'EDITED BUT UNPUBLISHED', withPreview.data && withPreview.data.content && withPreview.data.content.hero && withPreview.data.content.hero.welcome);
    const barePreview = await (await fetch(`${BASE}/api/guest/site?draft=1`)).json();
    check('draft=1 WITHOUT session stays locked public', barePreview.locked === true && barePreview.content === undefined, { locked: barePreview.locked, hasContent: !!barePreview.content });

    // View counter: anonymous & approximate — verified through the admin
    // readout (the public payload deliberately exposes no counters).
    const c0 = (await req('GET', '/api/guest-site')).data.views;
    await fetch(`${BASE}/api/guest/site`);
    const c1 = (await req('GET', '/api/guest-site')).data.views;
    check('public view counter increments', Number(c1) > Number(c0), { c0, c1 });

    // Admin exposes the counters for the portal.
    r = await req('GET', '/api/guest-site');
    check('admin GET exposes counters + events list', r.status === 200 && typeof r.data.views === 'number' && Array.isArray(r.data.events) && r.data.events.some((e) => e.id === visEv && e.guest_visible === true), r.data && { views: r.data.views, n: r.data.events && r.data.events.length });

    // RSVP journey payload: a household's access carries the configured meal
    // options plus window state (never any private data).
    r = await req('POST', '/api/guest/access', { code: siteCode });
    check('access payload: configured meal options + window state', r.status === 200 && Array.isArray(r.data.meal_options) && r.data.meal_options.join(',') === 'beef,fish,vegan' && typeof r.data.window_state === 'string' && r.data.already_responded === false, r.data && { mo: r.data.meal_options, ws: r.data.window_state });

    // Same-location ceremony+reception flag: round-trips through draft and
    // publish and shows up in the UNLOCKED payload — never the locked public one.
    r = await req('PUT', '/api/guest-site', { draft: { ...draft, same_venue: true } });
    check('draft: same_venue saved', r.status === 200 && r.data.draft.same_venue === true, r.data && r.data.draft && r.data.draft.same_venue);
    r = await req('POST', '/api/guest-site/publish');
    const sv = await req('POST', '/api/guest/site/unlock', { code: siteCode });
    check('publish: same_venue flows to unlocked payload', r.status === 200 && sv.status === 200 && sv.data.site && sv.data.site.content && sv.data.site.content.same_venue === true, sv.data && sv.data.site && sv.data.site.content && sv.data.site.content.same_venue);
    // Default is separate venues — restore it so later state stays clean.
    r = await req('PUT', '/api/guest-site', { draft: { ...draft, same_venue: false } });
    r = await req('POST', '/api/guest-site/publish');
    const sv2 = await req('POST', '/api/guest/site/unlock', { code: siteCode });
    check('default: same_venue false (separate venues)', sv2.status === 200 && sv2.data.site.content.same_venue === false, sv2.data && sv2.data.site && sv2.data.site.content && sv2.data.site.content.same_venue);

    // Cleanup: leave no newsletter residue; the private event row stays (harmless).
  }

  // ---------------------------------------------------------------------
  // Media & sharing: R2 hero photo upload, /media serving, OG tags and
  // cross-mode pass-through (media + site data work on every host/mode).
  section('18. Media & sharing: R2 hero upload, /media serving, OG tags, cross-mode pass-through');
  {
    // Raw-body helper (upload sends bytes, not JSON).
    const raw = (method, path, body, ct, base) =>
      fetch((base || BASE) + path, {
        method,
        headers: { Cookie: cookie, ...(ct ? { 'Content-Type': ct } : {}) },
        body,
      });

    // Upload requires the couple session.
    let rr = await fetch(`${BASE}/api/guest-site/photo`, { method: 'POST', body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) });
    check('photo upload: 401 without session', rr.status === 401, rr.status);

    // Non-image content-type rejected.
    rr = await raw('POST', '/api/guest-site/photo', 'hello', 'text/plain');
    const ntErr = rr.status === 400 ? (await rr.json()).error : '';
    check('photo upload: rejects non-image type', rr.status === 400 && ntErr.includes('Unsupported'), ntErr);

    // Declared image but wrong contents rejected (magic-byte sniff).
    rr = await raw('POST', '/api/guest-site/photo', 'not-a-real-image', 'image/png');
    const snfErr = rr.status === 400 ? (await rr.json()).error : '';
    check('photo upload: rejects content mismatch', rr.status === 400 && snfErr.includes('do not match'), snfErr);

    // Oversized rejected (5MB cap).
    rr = await raw('POST', '/api/guest-site/photo', new Uint8Array(5 * 1024 * 1024 + 1), 'image/png');
    check('photo upload: rejects >5MB', rr.status === 413, rr.status);

    // Valid PNG upload.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    rr = await raw('POST', '/api/guest-site/photo', png, 'image/png');
    const photo = rr.status === 200 ? await rr.json() : {};
    check('photo upload: returns /media path', rr.status === 200 && typeof photo.path === 'string' && photo.path.startsWith('/media/guest-site/photo-') && photo.path.endsWith('.png'), { status: rr.status, path: photo.path });

    if (photo.path) {
      // Serve on the main host with the right type + long-lived cache.
      const okResp = await fetch(`${BASE}${photo.path}`);
      check('media: serves photo with image/png + immutable cache', okResp.status === 200 && (okResp.headers.get('content-type') || '').includes('image/png') && (okResp.headers.get('cache-control') || '').includes('immutable'), { ct: okResp.headers.get('content-type'), cc: okResp.headers.get('cache-control') });

      // Cross-mode pass-through: the same media bytes work on the preview
      // hosts with a session (v1 teaser + v3 guest site) — every host, every mode.
      for (const host of ['v1', 'v3']) {
        const pv = await fetch(`http://${host}.127.0.0.1.nip.io:${PORT}${photo.path}`, { headers: { Cookie: cookie } });
        check(`media: pass-through on ${host} preview host (session)`, pv.status === 200 && (pv.headers.get('content-type') || '').includes('image/png'), { status: pv.status, ct: pv.headers.get('content-type') });
      }
      // …and the host gate still applies without a session.
      const pvNo = await fetch(`http://v1.127.0.0.1.nip.io:${PORT}${photo.path}`);
      const pvNoBody = await pvNo.text();
      check('media: preview host still gated without session', (pvNo.headers.get('content-type') || '').includes('text/html') && pvNoBody.includes('Preview ended'), { status: pvNo.status, ct: pvNo.headers.get('content-type') });

      // Site data passes through to preview hosts with a session (the SPA asks
      // for the draft there, exactly like it does on the live preview hosts).
      const sitePv = await req('GET', '/api/guest/site?draft=1', undefined, { base: `http://v3.127.0.0.1.nip.io:${PORT}` });
      check('site data pass-through on preview host', sitePv.status === 200 && !!sitePv.data.content, { status: sitePv.status });
    }

    // Missing / hostile media keys.
    const miss1 = await fetch(`${BASE}/media/guest-site/does-not-exist.png`);
    check('media: unknown key -> 404', miss1.status === 404, miss1.status);
    const trav = await fetch(`${BASE}/media/..%2F..%2Fsrc%2Findex.js`);
    check('media: traversal rejected -> 404', trav.status === 404, trav.status);

    // Publish a draft that references the media photo, then verify it flows
    // through to the guest-unlocked payload only. The SPA shell is public, so
    // its OG tags must carry the couple's names and nothing from the site.
    rr = await req('POST', '/api/households', { name: 'Media Village' });
    const mediaHousehold = rr.data.id;
    rr = await req('POST', '/api/guests', { household_id: mediaHousehold, first_name: 'Media', last_name: 'Goer', is_primary: 1 });
    rr = await req('POST', `/api/households/${mediaHousehold}/qr`);
    const mediaCode = rr.data.access_code;
    rr = await req('PUT', '/api/guest-site', {
      draft: { hero: { heading: 'Let’s celebrate', welcome: 'A shared welcome for OG testing.', photo_url: photo.path, photo_alt: 'Us at the venue' } },
    });
    check('draft: saved with /media photo', rr.status === 200 && rr.data.draft.hero.photo_url === photo.path, rr.data && rr.data.draft && rr.data.draft.hero && rr.data.draft.hero.photo_url);
    rr = await req('POST', '/api/guest-site/publish');
    check('publish: photo flows through', rr.status === 200 && rr.data.published.hero.photo_url === photo.path, rr.data && rr.data.published && rr.data.published.hero && rr.data.published.hero.photo_url);
    const pub = await req('POST', '/api/guest/site/unlock', { code: mediaCode });
    check('unlock: keeps /media photo in the site payload', pub.status === 200 && pub.data.site && pub.data.site.content && pub.data.site.content.hero && pub.data.site.content.hero.photo_url === photo.path, pub.data && pub.data.site && pub.data.site.content && pub.data.site.content.hero && pub.data.site.content.hero.photo_url);

    const shell = await (await fetch(`${BASE}/`)).text();
    check('SPA shell: OG title injected', shell.includes('<meta property="og:title"'), shell.includes('og:title') ? shell.slice(-400) : 'no og tags');
    check('SPA shell: no published heading or welcome text', !shell.includes('Let’s celebrate') && !shell.includes('A shared welcome for OG testing.'), 'gated content in the public shell');
    check('SPA shell: no hero photo in OG tags', !shell.includes('og:image') && !shell.includes('twitter:image') && !shell.includes('/media/'), (shell.match(/<meta property="og:image"[^>]*>/) || ['none'])[0]);
    check('SPA shell: twitter card + title', shell.includes('<meta name="twitter:card" content="summary">') && shell.includes('<meta name="twitter:title"'), shell.includes('twitter:card') ? 'twitter present' : 'missing twitter');
    const shellNoPublish = await (await fetch(`${BASE}/login`)).text();
    check('SPA fallback (client route) still serves with og meta', shellNoPublish.includes('<div id="root">') && shellNoPublish.includes('og:title'), shellNoPublish.length);
  }

  // ---------------------------------------------------------------------
  section('18b. AI assistant (MCP) endpoint: tokens, protocol, tools, revoke');
  {
    const rpc = async (path, message, headers = {}) => {
      const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify(message),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: res.status, data };
    };
    const toolJson = (r) => { try { return JSON.parse(r.data.result.content[0].text); } catch { return null; } };

    let r = await req('POST', '/api/mcp/tokens', { name: '' });
    check('mcp token: blank name rejected', r.status === 400, r);

    const savedCookie = cookie;
    cookie = '';
    r = await req('POST', '/api/mcp/tokens', { name: 'Sneaky' });
    check('mcp token: create requires a session', r.status === 401, r);
    cookie = savedCookie;

    r = await req('POST', '/api/mcp/tokens', { name: 'Test – Claude' });
    const created = r.data;
    check('mcp token: created with one-time url', r.status === 200 && /^wpm_[0-9a-f]{64}$/.test(created.token) && created.url.endsWith('/mcp/' + created.token), r);
    const mcpPath = '/mcp/' + created.token;

    r = await req('GET', '/api/mcp/tokens');
    check('mcp token: list shows it without secret/hash', r.status === 200 && r.data.length === 1 && r.data[0].name === 'Test – Claude' && !('hash' in r.data[0]) && !('token' in r.data[0]), r);

    r = await rpc('/mcp/wpm_' + '0'.repeat(64), { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    check('mcp: bad token → 401', r.status === 401, r);
    // Same bad token in other path shapes the router accepts. Each must answer
    // 401 and, like the one above, write no log line (run-tests counts them).
    for (const shape of ['/mcp//wpm_' + '0'.repeat(64), '/mcp/wpm_' + '0'.repeat(64) + '/', '/mcp/%77pm_' + '0'.repeat(64)]) {
      r = await rpc(shape, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      check(`mcp: bad token as ${shape.slice(0, 12)}… → 401`, r.status === 401, r);
    }
    // ...and the valid token in those shapes still authenticates (proves they
    // really are routed to MCP, so the quiet gate must cover them).
    for (const shape of ['/mcp//' + created.token, '/mcp/' + created.token + '/', '/mcp/%77' + created.token.slice(1)]) {
      r = await rpc(shape, { jsonrpc: '2.0', id: 1, method: 'ping' });
      check(`mcp: valid token as ${shape.slice(0, 12)}… → 200`, r.status === 200, r);
    }
    r = await rpc('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    check('mcp: no token → 401', r.status === 401, r);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    check('mcp: initialize echoes supported version + tools capability', r.status === 200 && r.data.result.protocolVersion === '2025-06-18' && !!r.data.result.capabilities.tools && r.data.result.instructions.includes('PENCE'), r);

    r = await rpc(mcpPath, { jsonrpc: '2.0', method: 'notifications/initialized' });
    check('mcp: notification → 202 no body', r.status === 202, r);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = (r.data && r.data.result && r.data.result.tools) || [];
    const names = tools.map((t) => t.name);
    check('mcp: tools/list has reads + writes', names.includes('get_overview') && names.includes('create_task') && names.includes('mark_payment_paid') && tools.length > 40, names.length);
    check('mcp: no email/publish/password tools exposed', !names.some((n) => /email|publish|password|delete_guest|delete_household|delete_supplier/.test(n)), names);
    check('mcp: every tool has an object inputSchema', tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_overview', arguments: {} } });
    const ov = toolJson(r);
    check('mcp: get_overview returns setup + stats', r.status === 200 && ov && ov.setup && ov.setup.partner1_name !== undefined && ov.stats, r.data);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_task', arguments: { title: 'MCP test task', stage: 'catering', owner: 'partner2', agreed_deadline: '2027-01-15' } } });
    const task = toolJson(r);
    check('mcp: create_task writes through the API', r.data.result && !r.data.result.isError && task && task.title === 'MCP test task' && task.effective_deadline === '2027-01-15', r.data);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'update_task', arguments: { id: task.id, status: 'done' } } });
    const upd = toolJson(r);
    check('mcp: update_task is partial (title kept, completed_at stamped)', upd && upd.status === 'done' && upd.title === 'MCP test task' && !!upd.completed_at, r.data);

    r = await req('GET', '/api/tasks/' + task.id);
    check('mcp: change visible to the portal API', r.status === 200 && r.data.status === 'done', r);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_tasks', arguments: { status: 'done', stage: 'catering' } } });
    const done = toolJson(r);
    check('mcp: list_tasks filters by query args', Array.isArray(done) && done.some((t) => t.id === task.id) && done.every((t) => t.status === 'done' && t.stage === 'catering'), r.data);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'update_task', arguments: { id: 'no-such-task', status: 'done' } } });
    check('mcp: API error → tool result isError (not a protocol error)', r.status === 200 && r.data.result && r.data.result.isError === true && r.data.result.content[0].text.includes('Task not found'), r.data);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'create_payment', arguments: { budget_item_id: '', amount_pence: 100 } } });
    check('mcp: API validation surfaces to the AI', r.data.result && r.data.result.isError === true && r.data.result.content[0].text.includes('budget item'), r.data);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'send_email', arguments: {} } });
    check('mcp: unknown tool → JSON-RPC error', r.data.error && r.data.error.code === -32602, r.data);

    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_budget', arguments: {} } });
    const budget = toolJson(r);
    check('mcp: get_budget combines categories + items', budget && Array.isArray(budget.categories) && Array.isArray(budget.items), r.data);

    r = await rpc(mcpPath, [{ jsonrpc: '2.0', id: 11, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/cancelled' }]);
    check('mcp: batch → array of responses (notifications dropped)', Array.isArray(r.data) && r.data.length === 1 && r.data[0].id === 11, r.data);

    r = await rpc('/mcp', { jsonrpc: '2.0', id: 12, method: 'ping' }, { Authorization: 'Bearer ' + created.token });
    check('mcp: Authorization: Bearer works on /mcp', r.status === 200 && r.data.result, r);

    // Regression: claude.ai "This isn't working right now" — OAuth discovery
    // probes got the SPA's index.html (200) and were read as broken OAuth.
    for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource' + mcpPath, '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
      const wk = await fetch(BASE + p);
      check(`mcp: ${p.slice(0, 50)} → 404 JSON (no SPA fallback)`, wk.status === 404 && (wk.headers.get('content-type') || '').includes('application/json'));
    }

    let res = await fetch(BASE + mcpPath, { method: 'GET' });
    check('mcp: GET → 405 (stateless, no SSE)', res.status === 405);

    res = await fetch(BASE + mcpPath, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    check('mcp: malformed JSON → parse error', res.status === 400 && (await res.json()).error.code === -32700);

    r = await req('GET', '/api/mcp/tokens');
    check('mcp token: last_used_at recorded', r.data[0].last_used_at, r.data);

    r = await req('GET', '/api/export/all');
    check('mcp token: hashes excluded from full export', r.status === 200 && !JSON.stringify(r.data).includes('mcp_tokens'), typeof r.data);

    r = await req('DELETE', '/api/mcp/tokens/' + created.id);
    check('mcp token: revoke', r.status === 200, r);
    r = await rpc(mcpPath, { jsonrpc: '2.0', id: 13, method: 'ping' });
    check('mcp: revoked link → 401 immediately', r.status === 401, r);
    r = await req('DELETE', '/api/mcp/tokens/' + created.id);
    check('mcp token: revoke unknown → 404', r.status === 404, r);

    await req('DELETE', '/api/tasks/' + task.id);
  }

  // ---------------------------------------------------------------------
  // Security: guest access-code guess limit. 5 wrong codes from one visitor
  // inside 15 minutes time that visitor out of every code endpoint. The
  // wrong codes used earlier in this suite count towards the 5, so this only
  // asserts that the timeout arrives within 5 more. Run near the end: it
  // leaves this machine timed out for 15 minutes (fresh local DB to re-run).
  section('18c. Security: guest access-code guess limit');
  {
    // The couple's notes on a guest are private: never sent to the guest, and
    // never changed by the guest's RSVP. The guest's own message has its own
    // field. (Here, before the guess limit below times this machine out.)
    {
      let n = await req('POST', '/api/households', { name: 'Private Notes' });
      const nh = n.data.id;
      n = await req('POST', '/api/guests', { household_id: nh, first_name: 'Nell', last_name: 'Notes', is_primary: 1, notes: 'Couple only: seat away from the bar' });
      const ng = n.data.id;
      n = await req('POST', `/api/households/${nh}/qr`);
      const nCode = n.data.access_code;
      n = await req('POST', '/api/guest/access', { code: nCode });
      const shownGuest = (n.data.guests || []).find((x) => x.id === ng) || {};
      check('private notes: not in the guest access payload', n.status === 200 && !('notes' in shownGuest) && !JSON.stringify(n.data).includes('seat away from the bar'), Object.keys(shownGuest));
      n = await req('POST', '/api/guest/rsvp', { code: nCode, responses: [{ guest_id: ng, attending: true, rsvp_message: 'Can we bring the dog?' }] });
      check('private notes: RSVP with a message saves', n.status === 200, n);
      n = await req('GET', '/api/guests');
      const saved = n.data.find((g) => g.id === ng) || {};
      check('private notes: the couple’s note is unchanged', saved.notes === 'Couple only: seat away from the bar', saved.notes);
      check('private notes: the guest’s message is saved separately', saved.rsvp_message === 'Can we bring the dog?', saved.rsvp_message);
      n = await req('POST', '/api/guest/access', { code: nCode });
      check('private notes: the guest sees their own message back', ((n.data.guests || []).find((x) => x.id === ng) || {}).rsvp_message === 'Can we bring the dog?', n.data.guests);
    }

    // Guests can correct their own name and add their own email / mobile on
    // the RSVP. (Here, before the guess limit below times this machine out.)
    {
      let d = await req('POST', '/api/households', { name: 'Details Edit' });
      const dh = d.data.id;
      d = await req('POST', '/api/guests', { household_id: dh, first_name: 'Jon', last_name: 'Smyth', is_primary: 1 });
      const g1 = d.data.id;
      d = await req('POST', '/api/guests', { household_id: dh, first_name: 'Sam', last_name: 'Smyth', email: 'keep@example.com' });
      const g2 = d.data.id;
      d = await req('POST', `/api/households/${dh}/qr`);
      const dCode = d.data.access_code;
      d = await req('POST', '/api/guest/rsvp', { code: dCode, responses: [{ guest_id: g1, attending: true, email: 'not-an-email' }] });
      check('guest details: a bad email is refused before anything is saved', d.status === 400 && /email/i.test(d.data.error || ''), d);
      d = await req('POST', '/api/guest/rsvp', {
        code: dCode,
        responses: [
          { guest_id: g1, attending: true, first_name: ' John ', last_name: 'Smith' },
          { guest_id: g2, attending: true, first_name: '', last_name: 'Smith', email: '', phone: '07000 000000' },
        ],
      });
      check('guest details: RSVP with edited details saves', d.status === 200, d);
      d = await req('POST', '/api/guest/access', { code: dCode });
      const byId = Object.fromEntries((d.data.guests || []).map((x) => [x.id, x]));
      check('guest details: name corrected and trimmed', byId[g1] && byId[g1].first_name === 'John' && byId[g1].last_name === 'Smith', byId[g1]);
      check('guest details: a blank never replaces a saved value', byId[g2] && byId[g2].first_name === 'Sam' && byId[g2].email === 'keep@example.com', byId[g2]);
      check('guest details: own mobile and surname saved', byId[g2] && byId[g2].phone === '07000 000000' && byId[g2].last_name === 'Smith', byId[g2]);

      // The household can correct its name and postal address the same way.
      d = await req('PUT', `/api/households/${dh}`, { city: 'Exampleton' });
      d = await req('POST', '/api/guest/rsvp', {
        code: dCode,
        household: { name: ' The Smiths ', address_line1: '1 Church St', city: '', postcode: 'AB1 2CD' },
        responses: [{ guest_id: g1, attending: true }],
      });
      check('household details: RSVP with edited household saves', d.status === 200, d);
      d = await req('POST', '/api/guest/access', { code: dCode });
      const hd = d.data.household || {};
      check('household details: name corrected and trimmed', hd.name === 'The Smiths', hd);
      check('household details: address saved and returned', hd.address_line1 === '1 Church St' && hd.postcode === 'AB1 2CD', hd);
      check('household details: a blank never replaces a saved value', hd.city === 'Exampleton', hd);
    }

    // A household with no code yet gets one when the code sheet loads, and
    // the code the sheet shows must be saved (it once wasn't).
    let s = await req('POST', '/api/households', { name: 'Sheet Code' });
    const sheetHh = s.data.id;
    await req('POST', '/api/guests', { household_id: sheetHh, first_name: 'Sheet', last_name: 'Code', is_primary: 1 });
    s = await req('GET', '/api/rsvp/qr-sheet');
    const shown = ((s.data.households || []).find((x) => x.household_id === sheetHh) || {}).access_code;
    s = await req('POST', '/api/guest/site/unlock', { code: shown });
    check('code sheet: a newly shown code unlocks the site', !!shown && s.status === 200 && s.data.unlocked === true, { shown, s });
    s = await req('GET', '/api/rsvp/qr-sheet');
    check('code sheet: the code is stable on reload', ((s.data.households || []).find((x) => x.household_id === sheetHh) || {}).access_code === shown, shown);
    check('code format: six characters as XXX-XXX', /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(shown), shown);
    s = await req('POST', '/api/guest/site/unlock', { code: shown.toLowerCase().replace('-', ' ') });
    check('code format: typed in lower case with a space still works', s.status === 200 && s.data.unlocked === true, s);
    // Regenerating gives a different code and kills the old one.
    s = await req('POST', `/api/households/${sheetHh}/qr`);
    const after = s.data.access_code;
    check('regenerate: a different code in the same format', after !== shown && /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(after), { shown, after });
    s = await req('GET', `/api/households/${sheetHh}/qr`);
    check('regenerate: the new code is the saved one', s.data.access_code === after, { after, got: s.data.access_code });
    // (Not checked by trying the old code: a wrong code here would use up
    // the guess limit this section tests next.)
    s = await req('GET', '/api/rsvp/qr-sheet');
    check('regenerate: the sheet shows only the new code', ((s.data.households || []).find((x) => x.household_id === sheetHh) || {}).access_code === after, after);

    let r = await req('POST', '/api/households', { name: 'Guess Limit' });
    const hh = r.data.id;
    await req('POST', '/api/guests', { household_id: hh, first_name: 'Good', last_name: 'Code', is_primary: 1 });
    r = await req('POST', `/api/households/${hh}/qr`);
    const goodCode = r.data.access_code;
    r = await req('POST', '/api/guest/site/unlock', { code: goodCode });
    check('guess limit: valid code works before the timeout', r.status === 200 && r.data.unlocked === true, r);
    let tries = 0;
    do {
      tries++;
      r = await req('POST', '/api/guest/site/unlock', { code: `WRONG-${tries}` });
    } while (r.status !== 429 && tries < 5);
    check('guess limit: repeated wrong codes → 429 with a wait time', r.status === 429 && /wait \d+ minutes?/i.test(r.data.error || ''), { tries, r });
    r = await req('POST', '/api/guest/site/unlock', { code: goodCode });
    check('guess limit: valid code refused during the timeout', r.status === 429, r);
    r = await req('POST', '/api/guest/access', { code: goodCode });
    check('guess limit: RSVP access refused during the timeout', r.status === 429, r);
    r = await req('POST', '/api/guest/rsvp', { code: goodCode, responses: [] });
    check('guess limit: RSVP submit refused during the timeout', r.status === 429, r);
    r = await req('POST', '/api/guest/qr-lookup', { code: goodCode });
    check('guess limit: code lookup refused during the timeout', r.status === 429, r);
    r = await req('GET', '/api/guest/site');
    check('guess limit: locked public site still loads', r.status === 200 && r.data.locked === true, r);
  }

  // ---------------------------------------------------------------------
  // Security: brute-force backoff. 5 consecutive failures arm a lock; the
  // next attempt (even with the correct password) is rejected with 429.
  // Run LAST because it leaves the lock armed for 5 minutes — re-running the
  // suite needs a fresh local DB (the usual protocol: wipe .wrangler/state).
  section('19. Security: login brute-force backoff');
  {
    let r = null;
    for (let i = 1; i <= 5; i++) {
      r = await req('POST', '/api/auth/login', { password: 'wrong-password' });
    }
    check('5 consecutive failures → 401 (lock arms on the 5th)', r.status === 401, r);
    r = await req('POST', '/api/auth/login', { password: 'PlannerTest2026!' });
    check('login locked out after 5 failures → 429', r.status === 429, r);
  }

  // ---------------------------------------------------------------------
  // Runtime route probe (#3 split): with NO session, every registered route
  // (collected statically from worker/src) answers with the same status as
  // the committed baseline, so each route module is imported and registered,
  // and the auth flags are unchanged. Last, so side effects of the public
  // POSTs (code-guess counts) cannot touch the checks above.
  // Re-record after an intended change: ROUTE_PROBE_RECORD=1 npm test -- --only local
  section('20. Runtime route probe (all routes, no session)');
  {
    const { collect } = await import('./scripts/route-table.mjs');
    const fs = await import('node:fs');
    const baselineFile = new URL('./scripts/route-probe-baseline.json', import.meta.url);
    const routes = collect().routes;
    const got = {};
    for (const rt of routes) {
      const path = rt.pattern.replace(/:(\w+)/g, 'probe-$1');
      const hasBody = rt.method !== 'GET' && rt.method !== 'DELETE';
      const res = await fetch(`${BASE}${path}`, {
        method: rt.method,
        headers: hasBody ? { 'Content-Type': 'application/json' } : {},
        body: hasBody ? '{}' : undefined,
        redirect: 'manual',
      });
      await res.arrayBuffer();
      got[`${rt.method} ${rt.pattern}`] = res.status;
    }
    // Two public routes answer from state this suite built up earlier (the
    // password is already set: init 409; section 19 armed the lockout: login
    // 429). Their exact status is order-dependent, so they are recorded and
    // compared as a status class ("4xx"): still refusing, never 2xx/5xx.
    const STATE_DEPENDENT = new Set(['POST /api/auth/init', 'POST /api/auth/login']);
    for (const k of STATE_DEPENDENT) if (k in got) got[k] = `${String(got[k])[0]}xx`;
    if (process.env.ROUTE_PROBE_RECORD === '1') {
      fs.writeFileSync(baselineFile, JSON.stringify(Object.fromEntries(Object.entries(got).sort()), null, 2) + '\n');
      check(`route probe baseline recorded (${routes.length} routes)`, true);
    } else {
      const want = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
      const diffs = keys.filter((k) => want[k] !== got[k]).map((k) => `${k}: baseline ${want[k] ?? 'absent'}, now ${got[k] ?? 'absent'}`);
      check(`route probe: ${Object.keys(got).length} routes registered (baseline ${Object.keys(want).length})`, Object.keys(got).length === Object.keys(want).length, diffs.slice(0, 5));
      check('route probe: every route answers with its baseline status (no session)', diffs.length === 0, diffs.slice(0, 10));
      const authed = routes.filter((rt) => rt.auth);
      check(`route probe: all ${authed.length} authenticated routes refuse without a session (401)`, authed.every((rt) => got[`${rt.method} ${rt.pattern}`] === 401), authed.filter((rt) => got[`${rt.method} ${rt.pattern}`] !== 401).map((rt) => `${rt.method} ${rt.pattern}: ${got[`${rt.method} ${rt.pattern}`]}`).slice(0, 5));
    }
    const unknown = await fetch(`${BASE}/api/__route_probe_unknown__`, { redirect: 'manual' });
    await unknown.arrayBuffer();
    check('route probe: unknown /api path → 404', unknown.status === 404, unknown.status);
  }
}

main().then(() => {
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`PASSED: ${passed}   FAILED: ${failed}   (${secs}s)`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  process.exit(failed ? 1 : 0);
}).catch((err) => {
  console.error(err);
  process.exit(2);
});
