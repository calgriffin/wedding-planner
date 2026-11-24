/**
 * Remote MCP server (Model Context Protocol) for the wedding planner.
 *
 * Lets an AI assistant (Claude, ChatGPT, …) read and edit the plan directly.
 * Transport: Streamable HTTP, stateless — every JSON-RPC message is one POST
 * answered with one JSON body (no SSE stream, no session ids).
 *
 * Auth: per-person connection links minted on the Setup page. The secret is
 * either the last path segment (`/mcp/<token>`, which every client supports)
 * or an `Authorization: Bearer <token>` header. Only a SHA-256 of each token
 * is stored (settings key `mcp_tokens`), so a DB export never leaks one.
 *
 * Safety: every tool is dispatched through the existing /api route handlers,
 * so it gets exactly the validation the portal UI gets. Deliberately NOT
 * exposed: sending email, publishing the guest website, switching the live
 * guest mode / RSVP window, passwords, deleting guests/households/suppliers,
 * and the RSVP import/review flow (those stay human-in-the-loop in the UI).
 */

import { redactError } from './log-safe.js';
import { brand } from './brand.js';

export const MCP_TOKENS_SETTING = 'mcp_tokens';

// name comes from the brand (worker/src/brand.js): "<short>-wedding-planner".
const serverInfo = () => ({ name: brand().mcpServerName, title: 'Wedding Planner', version: '1.0.0' });
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
// Only bump last_used_at when it is this stale, so a chatty session doesn't
// rewrite the settings row on every tool call.
const LAST_USED_RESOLUTION_MS = 10 * 60 * 1000;

const INSTRUCTIONS = `You are connected to a couple's private wedding planner (their live data).
Conventions:
- Money is always in PENCE (integer). £1,250.50 = 125050. Convert when talking to the user.
- Dates are YYYY-MM-DD; times are HH:MM (24h).
- Start with get_overview for context. Use the list_*/get_* tools to find ids before updating anything.
- update_* tools are partial: send only the fields you want to change.
- Changes are live immediately in the planner both partners use. Confirm with the user before bulk or destructive changes, and never invent guest details.
- Not available here (do it in the planner UI instead): sending emails, publishing the guest website, changing the live guest-site mode / RSVP window, passwords, deleting guests/households/suppliers, reviewing imported RSVPs.`;

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description) => ({ type: 'integer', description });
const bool = (description) => ({ type: 'boolean', description });
const oneOf = (values, description) => ({ type: 'string', enum: values, description });
const date = (description) => str(`${description} (YYYY-MM-DD)`);
const pence = (description) => num(`${description}, in pence (£1 = 100)`);
const id = (what) => str(`The ${what} id (from the matching list tool)`);

const TASK_STAGES = ['initial_planning', 'venue_ceremony', 'catering', 'outfits_rings', 'stationery', 'entertainment', 'flowers_decor', 'photography_video', 'transport_accommodation', 'final_confirmations', 'post_wedding'];
const TASK_STATUS = ['not_started', 'in_progress', 'waiting', 'done', 'not_applicable'];
const OWNERS = ['partner1', 'partner2', 'together'];
const PAYMENT_TYPES = ['deposit', 'instalment', 'final', 'refund'];
const GUEST_STATUS = ['potential', 'invited', 'confirmed', 'declined', 'evening_only'];
const ATTENDANCE = ['day', 'evening', 'both', 'none'];
const SUPPLIER_CATEGORIES = ['venue_ceremony', 'venue_reception', 'catering', 'photography', 'videography', 'flowers', 'music', 'transport', 'accommodation', 'cake', 'stationery', 'attire', 'rings', 'other'];
const BOOKING_STATUS = ['researching', 'shortlisted', 'contacted', 'quoted', 'booked', 'declined'];
const DECISION_CATEGORIES = ['ceremony', 'clothing', 'decor', 'food', 'music', 'photography', 'other'];
const DECISION_STATUS = ['open', 'decided', 'deferred'];
const EVENT_TYPES = ['engagement_party', 'hen_doe', 'stag_doe', 'rehearsal_dinner', 'brunch', 'honeymoon', 'other'];
const EVENT_STATUS = ['planning', 'booked', 'completed', 'cancelled', 'not_applicable'];
const RESPONSIBLE = ['partner1', 'partner2', 'together', 'supplier', 'coordinator'];
const PACKING_CATEGORIES = ['ceremony', 'reception', 'personal', 'emergency', 'decor', 'other'];

const FIELDS = {
  task: {
    title: str('Task title'),
    description: str('Longer description'),
    stage: oneOf(TASK_STAGES, 'Planning stage the task belongs to'),
    owner: oneOf(OWNERS, 'Who owns it'),
    status: oneOf(TASK_STATUS, 'Progress'),
    agreed_deadline: date('A fixed deadline that overrides the suggested one'),
    suggested_timing_weeks_before: num('Suggested timing, in weeks before the wedding date'),
  },
  budgetCategory: {
    name: str('Category name'),
    allowance_pence: pence('Amount allocated to this category'),
    notes: str('Notes'),
  },
  budgetItem: {
    category_id: str('Budget category id (from get_budget)'),
    name: str('Item name, e.g. "Photographer"'),
    supplier_id: str('Linked supplier id (optional)'),
    estimate_pence: pence('Rough estimate'),
    agreed_price_pence: pence('Contracted price (overrides the estimate in the forecast)'),
    notes: str('Notes'),
  },
  payment: {
    budget_item_id: str('Budget item this payment is for (from get_budget)'),
    type: oneOf(PAYMENT_TYPES, 'Kind of payment'),
    amount_pence: pence('Amount'),
    due_date: date('When it is due'),
    paid_date: date('When it was paid (setting this marks it paid)'),
    reference: str('Payment reference / invoice number'),
    notes: str('Notes'),
    invoice_url: str('Link to the invoice (must be https://)'),
    invoice_label: str('Short label for the invoice link'),
    family_visible: bool('Show this payment on the read-only family portal (default true)'),
  },
  household: {
    name: str('Household name, e.g. "The Smiths"'),
    address_line1: str('Address line 1'),
    address_line2: str('Address line 2'),
    city: str('Town / city'),
    postcode: str('Postcode'),
    country: str('Country'),
    notes: str('Notes'),
  },
  guest: {
    household_id: str('Household id (from list_households)'),
    first_name: str('First name'),
    last_name: str('Last name'),
    is_primary: bool('Main contact for the household'),
    email: str('Email'),
    phone: str('Phone'),
    status: oneOf(GUEST_STATUS, 'Invitation / RSVP status'),
    attendance_type: oneOf(ATTENDANCE, 'Which parts of the day they attend'),
    dietary_needs: str('Dietary requirements'),
    accessibility_requests: str('Accessibility needs'),
    accommodation_needed: bool('Needs accommodation'),
    accommodation_booked: bool('Accommodation is booked'),
    accommodation_details: str('Accommodation details'),
    gift_received: bool('Gift received'),
    gift_description: str('What the gift was'),
    thank_you_sent: bool('Thank-you note sent'),
    thank_you_date: date('When the thank-you was sent'),
    plus_one_of: str('Guest id this person is the plus-one of'),
    plus_one_allowed: bool('Offer this guest a plus-one on the RSVP form. No name needed: they add the person themselves, and the place counts in the numbers until they answer'),
    notes: str('Notes'),
  },
  supplier: {
    name: str('Supplier / business name'),
    category: oneOf(SUPPLIER_CATEGORIES, 'Supplier type'),
    booking_status: oneOf(BOOKING_STATUS, 'Where we are with them'),
    contact_name: str('Contact person'),
    email: str('Email'),
    phone: str('Phone'),
    website: str('Website'),
    address: str('Address'),
    quote_pence: pence('Quoted price'),
    inclusions: str('What the quote includes'),
    capacity: num('Capacity (venues)'),
    availability_confirmed: bool('They have confirmed availability for the date'),
    contract_link: str('Link to the contract'),
    questions_to_ask: str('Open questions for them'),
    deadline: date('"Confirm by" decision deadline'),
    notes: str('Notes'),
  },
  decision: {
    title: str('What needs deciding'),
    description: str('Context'),
    category: oneOf(DECISION_CATEGORIES, 'Area'),
    status: oneOf(DECISION_STATUS, 'Open, decided or deferred'),
    options: { type: 'array', items: { type: 'string' }, description: 'The options being considered' },
    chosen_option: str('The option that was chosen'),
    decision_owner: oneOf(OWNERS, 'Who decides'),
    deadline: date('Decide by'),
    notes: str('Notes'),
  },
  event: {
    title: str('Event name'),
    type: oneOf(EVENT_TYPES, 'Kind of event'),
    date: date('Event date'),
    venue: str('Venue'),
    description: str('Internal description'),
    guest_count: num('Expected guests'),
    status: oneOf(EVENT_STATUS, 'Status'),
    notes: str('Internal notes'),
    guest_visible: bool('Show on the guest website schedule (only takes effect for guests once the site is published)'),
    start_time: str('Start time HH:MM'),
    end_time: str('End time HH:MM'),
    guest_description: str('Description guests see'),
  },
  appointment: {
    title: str('What the appointment is, e.g. "Dress fitting"'),
    date: date('Date'),
    time: str('Time HH:MM'),
    location: str('Where'),
    notes: str('Notes'),
  },
  runSheet: {
    time: str('Start time HH:MM'),
    end_time: str('End time HH:MM'),
    title: str('What happens'),
    description: str('Details'),
    location: str('Where'),
    responsible_person: oneOf(RESPONSIBLE, 'Who is responsible'),
    supplier_id: str('Linked supplier id'),
    is_critical: bool('Critical moment'),
    contingency_notes: str('Plan B'),
  },
  packing: {
    item: str('Item to pack'),
    category: oneOf(PACKING_CATEGORIES, 'Category'),
    quantity: num('How many'),
    responsible_person: oneOf(OWNERS, 'Who packs it'),
    packed: bool('Already packed'),
    notes: str('Notes'),
  },
  contact: {
    name: str('Name'),
    role: str('Role, e.g. "Venue coordinator"'),
    phone: str('Phone'),
    email: str('Email'),
    is_emergency: bool('Emergency contact'),
    notes: str('Notes'),
  },
  setup: {
    partner1_name: str('Partner 1 name'),
    partner2_name: str('Partner 2 name'),
    wedding_date: date('Wedding date — changing it recalculates suggested task deadlines'),
    ceremony_venue: str('Ceremony venue'),
    reception_venue: str('Reception venue'),
    budget_ceiling: pence('Total budget ceiling'),
    contingency_percent: num('Contingency percentage'),
    guest_target: num('Target number of guests'),
    priority_1: str('Top priority'),
    priority_2: str('Second priority'),
    priority_3: str('Third priority'),
    non_negotiable_1: str('Non-negotiable 1'),
    non_negotiable_2: str('Non-negotiable 2'),
    non_negotiable_3: str('Non-negotiable 3'),
  },
};

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

function schema(properties = {}, required = []) {
  return { type: 'object', properties, required, additionalProperties: false };
}

// Standard create / update / delete trio for one API collection.
function crud(noun, label, basePath, fields, { required = [], remove = false } = {}) {
  const tools = [
    {
      name: `create_${noun}`,
      title: `Add ${label}`,
      description: `Create a new ${label}.`,
      annotations: WRITE,
      inputSchema: schema(fields, required),
      method: 'POST',
      path: basePath,
    },
    {
      name: `update_${noun}`,
      title: `Edit ${label}`,
      description: `Update an existing ${label}. Only the fields you send are changed.`,
      annotations: EDIT,
      inputSchema: schema({ id: id(label), ...fields }, ['id']),
      method: 'PUT',
      path: `${basePath}/:id`,
    },
  ];
  if (remove) {
    tools.push({
      name: `delete_${noun}`,
      title: `Delete ${label}`,
      description: `Permanently delete a ${label}. Confirm with the user first.`,
      annotations: DELETE,
      inputSchema: schema({ id: id(label) }, ['id']),
      method: 'DELETE',
      path: `${basePath}/:id`,
    });
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Tool catalogue
// ---------------------------------------------------------------------------
// A tool is either { method, path, query? } — args fill `:params`, `query`
// keys go on the query string, everything else becomes the JSON body — or
// { run(args, call) } for tools that combine several reads.

const TOOLS = [
  // ---- Reads ---------------------------------------------------------------
  {
    name: 'get_overview',
    title: 'Plan overview',
    description: 'The big picture: couple, wedding date, venues, budget ceiling, priorities, plus dashboard stats (task progress, budget health, guest & RSVP counts, upcoming deadlines). Call this first.',
    annotations: READ,
    inputSchema: schema(),
    async run(args, call) {
      const [setup, stats] = await Promise.all([call('GET', '/api/setup'), call('GET', '/api/dashboard/stats')]);
      return { setup, stats, today: new Date().toISOString().slice(0, 10) };
    },
  },
  {
    name: 'get_timeline',
    title: 'Master timeline',
    description: 'Every dated thing in one sorted calendar: tasks, payments due, supplier deadlines, appointments, events, decisions and RSVP dates, with overdue flags.',
    annotations: READ,
    inputSchema: schema(),
    method: 'GET',
    path: '/api/timeline',
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: 'Planning tasks with stage, owner, status and deadlines (effective_deadline is the one that counts).',
    annotations: READ,
    inputSchema: schema({ stage: oneOf(TASK_STAGES, 'Filter by stage'), status: oneOf(TASK_STATUS, 'Filter by status') }),
    method: 'GET',
    path: '/api/tasks',
    query: ['stage', 'status'],
  },
  {
    name: 'get_budget',
    title: 'Budget',
    description: 'Budget categories (allowance, forecast, actual) and their items (estimate, agreed price, paid so far, remaining). All amounts in pence.',
    annotations: READ,
    inputSchema: schema({ category_id: str('Only items in this category') }),
    async run(args, call) {
      const [categories, items] = await Promise.all([
        call('GET', '/api/budget/categories'),
        call('GET', '/api/budget/items', { category_id: args.category_id }),
      ]);
      return { categories, items };
    },
  },
  {
    name: 'list_payments',
    title: 'List payments',
    description: 'Payments (deposits, instalments, finals, refunds) with due/paid dates and status, sorted by due date. Amounts in pence.',
    annotations: READ,
    inputSchema: schema({ budget_item_id: str('Only payments for this budget item') }),
    method: 'GET',
    path: '/api/payments',
    query: ['budget_item_id'],
  },
  {
    name: 'list_households',
    title: 'List households',
    description: 'Guest households (invitation units) with address and guest count.',
    annotations: READ,
    inputSchema: schema(),
    method: 'GET',
    path: '/api/households',
  },
  {
    name: 'list_guests',
    title: 'List guests',
    description: 'Guests with household, RSVP status, attendance, dietary/accessibility needs, accommodation, gifts and thank-yous.',
    annotations: READ,
    inputSchema: schema({ status: oneOf(GUEST_STATUS, 'Filter by status'), household_id: str('Only guests in this household') }),
    method: 'GET',
    path: '/api/guests',
    query: ['status', 'household_id'],
  },
  {
    name: 'list_suppliers',
    title: 'List suppliers',
    description: 'Suppliers / vendors with contact details, quote, booking status and confirm-by deadline.',
    annotations: READ,
    inputSchema: schema({ category: oneOf(SUPPLIER_CATEGORIES, 'Filter by type') }),
    method: 'GET',
    path: '/api/suppliers',
    query: ['category'],
  },
  {
    name: 'list_decisions',
    title: 'List decisions',
    description: 'The decision log: open / decided / deferred decisions with options, the choice made and deadlines.',
    annotations: READ,
    inputSchema: schema({ category: oneOf(DECISION_CATEGORIES, 'Filter by area') }),
    method: 'GET',
    path: '/api/decisions',
    query: ['category'],
  },
  {
    name: 'list_events',
    title: 'List events',
    description: 'Other events (engagement party, hen/stag, rehearsal dinner, brunch, honeymoon…) with dates, venues and guest-site visibility.',
    annotations: READ,
    inputSchema: schema(),
    method: 'GET',
    path: '/api/events',
  },
  {
    name: 'list_appointments',
    title: 'List appointments',
    description: 'Calendar appointments such as fittings, tastings and venue walkthroughs.',
    annotations: READ,
    inputSchema: schema(),
    method: 'GET',
    path: '/api/appointments',
  },
  {
    name: 'get_seating',
    title: 'Seating plan',
    description: 'Tables with capacity and seated guests, plus the guests not yet seated.',
    annotations: READ,
    inputSchema: schema(),
    method: 'GET',
    path: '/api/seating/tables',
  },
  {
    name: 'get_wedding_day',
    title: 'Wedding day plan',
    description: 'The run of show (run sheet), key day-of contacts and the packing list.',
    annotations: READ,
    inputSchema: schema(),
    async run(args, call) {
      const [run_sheet, contacts, packing] = await Promise.all([
        call('GET', '/api/wedding-day/run-sheet'),
        call('GET', '/api/wedding-day/contacts'),
        call('GET', '/api/wedding-day/packing'),
      ]);
      return { run_sheet, contacts, packing };
    },
  },
  {
    name: 'get_dietary_matrix',
    title: 'Dietary & meals',
    description: 'Every guest\'s meal choice and dietary requirements grouped by table, with a meal-count summary — what the caterer needs.',
    annotations: READ,
    inputSchema: schema(),
    method: 'GET',
    path: '/api/rsvp/dietary-matrix',
  },
  {
    name: 'list_song_requests',
    title: 'Song requests',
    description: 'Songs guests asked for on their RSVP.',
    annotations: READ,
    inputSchema: schema(),
    method: 'GET',
    path: '/api/rsvp/songs',
  },

  // ---- Writes --------------------------------------------------------------
  {
    name: 'update_setup',
    title: 'Edit setup',
    description: 'Change the master settings (names, wedding date, venues, budget ceiling, priorities). Only the fields you send change. These also feed the public guest pages.',
    annotations: EDIT,
    inputSchema: schema(FIELDS.setup),
    method: 'PUT',
    path: '/api/setup',
  },
  ...crud('task', 'task', '/api/tasks', FIELDS.task, { required: ['title'], remove: true }),
  ...crud('budget_category', 'budget category', '/api/budget/categories', FIELDS.budgetCategory, { required: ['name'] }),
  ...crud('budget_item', 'budget item', '/api/budget/items', FIELDS.budgetItem, { required: ['category_id', 'name'], remove: true }),
  ...crud('payment', 'payment', '/api/payments', FIELDS.payment, { required: ['budget_item_id', 'amount_pence'], remove: true }),
  {
    name: 'mark_payment_paid',
    title: 'Mark payment paid',
    description: 'Mark a payment as paid (defaults to today).',
    annotations: EDIT,
    inputSchema: schema({ id: id('payment'), paid_date: date('Date it was paid; defaults to today') }, ['id']),
    method: 'PATCH',
    path: '/api/payments/:id/paid',
  },
  ...crud('household', 'household', '/api/households', FIELDS.household, { required: ['name'] }),
  ...crud('guest', 'guest', '/api/guests', FIELDS.guest, { required: ['first_name'] }),
  ...crud('supplier', 'supplier', '/api/suppliers', FIELDS.supplier, { required: ['name'] }),
  ...crud('decision', 'decision', '/api/decisions', FIELDS.decision, { required: ['title'] }),
  ...crud('event', 'event', '/api/events', FIELDS.event, { required: ['title'] }),
  ...crud('appointment', 'appointment', '/api/appointments', FIELDS.appointment, { required: ['title', 'date'], remove: true }),
  {
    name: 'assign_seat',
    title: 'Seat a guest',
    description: 'Put a guest at a table (moves them if already seated). Pass table_id null to unseat.',
    annotations: EDIT,
    inputSchema: schema(
      {
        guest_id: id('guest'),
        table_id: { type: ['string', 'null'], description: 'Table id (from get_seating), or null to unseat' },
        seat_number: num('Seat number at the table (optional)'),
      },
      ['guest_id', 'table_id']
    ),
    method: 'POST',
    path: '/api/seating/assignments',
  },
  ...crud('run_sheet_entry', 'run-sheet entry', '/api/wedding-day/run-sheet', FIELDS.runSheet, { required: ['time', 'title'], remove: true }),
  ...crud('packing_item', 'packing-list item', '/api/wedding-day/packing', FIELDS.packing, { required: ['item'], remove: true }),
  ...crud('wedding_day_contact', 'wedding-day contact', '/api/wedding-day/contacts', FIELDS.contact, { required: ['name'] }),
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function listTools() {
  return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations: { title, ...annotations },
  }));
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newMcpToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return 'wpm_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashMcpToken(token) {
  return sha256Hex(token);
}

export function parseTokenList(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Every credential the request carries: an Authorization bearer and/or the
// token in the link. Clients (claude.ai) can attach a bearer of their own to
// a no-auth connector, so a non-matching bearer must not shadow a valid link.
function candidateTokens(request, pathname) {
  const out = [];
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (m) out.push(m[1]);
  const seg = pathname.split('/').filter(Boolean)[1];
  if (seg) {
    try {
      out.push(decodeURIComponent(seg));
    } catch {
      // Malformed escape in the path — ignore that candidate.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSON-RPC handling
// ---------------------------------------------------------------------------

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function httpJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function toolText(data, isError = false) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 1);
  return { content: [{ type: 'text', text }], isError };
}

async function callTool(tool, args, call) {
  if (tool.run) return tool.run(args, call);
  const rest = { ...args };
  const path = tool.path.replace(/:(\w+)/g, (_, key) => {
    const v = rest[key];
    delete rest[key];
    if (v === undefined || v === null || v === '') throw new ToolInputError(`Missing required argument: ${key}`);
    return encodeURIComponent(String(v));
  });
  const query = {};
  for (const key of tool.query || []) {
    if (rest[key] !== undefined) query[key] = rest[key];
    delete rest[key];
  }
  const hasBody = tool.method !== 'GET' && tool.method !== 'DELETE';
  return call(tool.method, path, query, hasBody ? rest : undefined);
}

class ToolInputError extends Error {}
class ApiCallError extends Error {}

/**
 * Runs one tool against the planner and resolves to { ok, data } or
 * { ok: false, error } — never throws. Shared by the MCP endpoint and the
 * email assistant, so both get identical validation and side effects.
 */
export async function runTool(name, args, dispatch) {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  const call = async (method, path, query, body) => {
    const { status, data } = await dispatch(method, path, query, body);
    if (status >= 400) throw new ApiCallError((data && data.error) || `Request failed (${status})`);
    return data;
  };
  try {
    return { ok: true, data: await callTool(tool, args, call) };
  } catch (e) {
    if (e instanceof ToolInputError || e instanceof ApiCallError) return { ok: false, error: e.message };
    console.error('planner tool failed', name, redactError(e));
    return { ok: false, error: 'the planner hit an internal error running that tool.' };
  }
}

async function handleMessage(msg, env, dispatch) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg && msg.id, -32600, 'Invalid Request');
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const params = msg.params || {};

  switch (msg.method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0];
      return rpcResult(msg.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: serverInfo(),
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return isNotification ? null : rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: listTools() });
    case 'tools/call': {
      const tool = TOOL_MAP.get(params.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      const r = await runTool(tool.name, args, dispatch);
      return rpcResult(msg.id, toolText(r.ok ? r.data : `Error: ${r.error}`, !r.ok));
    }
    default:
      if (isNotification) return null; // notifications/initialized, cancelled, …
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/**
 * Entry point for `/mcp` and `/mcp/<token>`.
 * `dispatch(method, path, query, body)` runs an internal API route and
 * resolves to `{ status, data }`.
 */
export async function handleMcp(request, env, pathname, { getSetting, setSetting, dispatch }) {
  const tokens = parseTokenList(await getSetting(env, MCP_TOKENS_SETTING));
  const candidates = candidateTokens(request, pathname);
  let entry = null;
  for (const candidate of candidates) {
    const hash = await hashMcpToken(candidate);
    entry = tokens.find((t) => t.hash === hash) || null;
    if (entry) break;
  }
  if (!entry) {
    // Shape only, never the token itself — enough to debug a client from `wrangler tail`.
    console.warn('mcp unauthorized', {
      method: request.method,
      bearer: /^Bearer\s+\S+$/i.test(request.headers.get('authorization') || ''),
      linkToken: pathname.split('/').filter(Boolean).length > 1,
      candidates: candidates.length,
    });
    return httpJson(rpcError(null, -32001, 'Unauthorized: this connection link is invalid or has been revoked.'), 401);
  }

  if (request.method !== 'POST') {
    // Stateless server: no SSE stream to open and no session to delete.
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  }

  const nowMs = Date.now();
  if (!entry.last_used_at || nowMs - Date.parse(entry.last_used_at) > LAST_USED_RESOLUTION_MS) {
    entry.last_used_at = new Date(nowMs).toISOString();
    try {
      await setSetting(env, MCP_TOKENS_SETTING, JSON.stringify(tokens));
    } catch {
      // Bookkeeping only — never block the request.
    }
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return httpJson(rpcError(null, -32700, 'Parse error'), 400);
  }

  if (Array.isArray(payload)) {
    const out = [];
    for (const msg of payload) {
      const r = await handleMessage(msg, env, dispatch);
      if (r) out.push(r);
    }
    return out.length ? httpJson(out) : new Response(null, { status: 202 });
  }
  const r = await handleMessage(payload, env, dispatch);
  return r ? httpJson(r) : new Response(null, { status: 202 });
}
