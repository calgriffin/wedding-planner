/**
 * In-app assistant chat. The same assistant as the email one (same Claude
 * model, same API key, same planner tools as the MCP server), answering in
 * the plan portal. Every chat is shared: both partners see every
 * conversation, each message labelled with who wrote it.
 *
 * The assistant can also ask the couple things:
 * - mid-conversation (the ask_couple tool: a question card with tap-to-answer
 *   options, both partners notified);
 * - by itself: a one-off launch review the first time the cron runs with
 *   this code, then a daily check-in, each posting questions only when there
 *   is something worth asking;
 * - from the email assistant (ask_in_app), so an email question can be
 *   answered in the app.
 *
 * Safety model, as for email, enforced here in code:
 * - Marking a payment paid, deleting anything and changing master settings
 *   are queued and only run when one of the couple presses Confirm. The model
 *   cannot confirm its own proposals.
 * - The model has no tool that sends email or messages; notifications go only
 *   to the couple (src/notify.js).
 * - Attachments go to the model with the message they came with and are
 *   never stored; only their names are kept.
 * - ASSISTANT_DRY_RUN applies here too: it replies but saves nothing.
 */
import { listTools, runTool } from './mcp.js';
import { assistantConfig, converse, needsConfirmation, describeCall, describeActions, readTool } from './assistant.js';
import { notifyCouple } from './notify.js';
import { redactError } from './log-safe.js';
import { recordUsage } from './ai-usage.js';

const MAX_TEXT = 8000;
const MAX_HISTORY = 40;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const THINKING_STALE_MS = 10 * 60 * 1000;
const MAX_QUESTIONS_PER_TURN = 3;
const MAX_CHECKIN_QUESTIONS = 5;
const MAX_LAUNCH_QUESTIONS = 8;
const LAUNCH_SETTING = 'chat_launch_checkin';
const CHECKIN_DATE_SETTING = 'chat_checkin_last_date';
const NAMES_SETTING = 'chat_names';
const CHECKIN_LOCK_SETTING = 'chat_checkin_lock';
const CHECKIN_LOCK_MS = 3 * 60 * 1000;
// The daily check-in waits while this many days' worth of its questions are unanswered.
const CHECKIN_BACKLOG_DAYS = 7;

export class ChatError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const nowIso = () => new Date().toISOString();
const lower = (s) => String(s || '').trim().toLowerCase();
const parse = (v, fallback) => {
  try {
    const x = JSON.parse(v);
    return x === null || x === undefined ? fallback : x;
  } catch {
    return fallback;
  }
};
const ukToday = () =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());

function ukClock() {
  const uk = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { date: `${uk.year}-${uk.month}-${uk.day}`, hhmm: `${uk.hour}:${uk.minute}` };
}

async function getSettingValue(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function putSetting(env, key, value) {
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)').bind(key, value, nowIso()).run();
}

/** AI is available in chat as soon as there is an API key (no mailbox needed). */
export function chatConfig(env) {
  const cfg = assistantConfig(env);
  return {
    ...cfg,
    aiReady: !!cfg.apiKey,
    dailyLimit: Number(env.CHAT_DAILY_LIMIT) || 200,
    checkinEnabled: env.CHAT_CHECKIN !== 'off',
    checkinTime: /^\d{2}:\d{2}$/.test(env.CHAT_CHECKIN_TIME || '') ? env.CHAT_CHECKIN_TIME : /^\d{2}:\d{2}$/.test(env.DAILY_BRIEF_TIME || '') ? env.DAILY_BRIEF_TIME : '08:00',
  };
}

// ---------------------------------------------------------------------------
// Who's who
// ---------------------------------------------------------------------------

/**
 * Display names. A partner can set their own; otherwise the first name from
 * Setup that their address starts with, otherwise the address's first word.
 */
export async function people(env) {
  const cfg = assistantConfig(env);
  const custom = parse(await getSettingValue(env, NAMES_SETTING), {});
  let firsts = [];
  try {
    const setup = await env.DB.prepare('SELECT partner1_name, partner2_name FROM setup LIMIT 1').first();
    firsts = [setup && setup.partner1_name, setup && setup.partner2_name].map((n) => String(n || '').trim().split(/\s+/)[0]).filter(Boolean);
  } catch {
    // No setup yet: fall back to the address.
  }
  const nameOf = (email) => {
    const e = lower(email);
    if (!e) return 'One of you';
    if (custom[e]) return custom[e];
    const local = e.split('@')[0];
    const hit = firsts.find((f) => local.startsWith(f.toLowerCase()));
    if (hit) return hit;
    const word = local.split(/[._+\-\d]/).filter(Boolean)[0] || local;
    return word.charAt(0).toUpperCase() + word.slice(1);
  };
  return { couple: cfg.allowed, nameOf };
}

export async function setDisplayName(env, email, name) {
  const e = lower(email);
  if (!e) throw new ChatError('Names can only be set when you sign in with your own email address.');
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const all = parse(await getSettingValue(env, NAMES_SETTING), {});
  if (clean) all[e] = clean;
  else delete all[e];
  await putSetting(env, NAMES_SETTING, JSON.stringify(all));
  return clean;
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

function shapeMessage(r, nameOf) {
  return {
    id: r.id,
    role: r.role,
    author_email: r.author_email,
    author_name: r.role === 'user' ? nameOf(r.author_email) : r.role === 'assistant' ? 'Assistant' : '',
    text: r.text,
    status: r.status,
    reason: r.reason,
    actions: parse(r.actions, []),
    attachments: parse(r.attachments, []),
    questions: parse(r.questions, []).map((q) => ({ ...q, answered_by_name: q.answered_at ? nameOf(q.answered_by) : '' })),
    reply_to: r.reply_to ? parse(r.reply_to, null) : null,
    dry_run: !!r.dry_run,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function shapePending(p, nameOf) {
  return {
    code: p.code,
    message_id: p.message_id,
    summary: p.summary,
    status: p.status,
    result: p.result,
    resolved_by_name: p.resolved_at ? nameOf(p.resolved_by) : '',
    created_at: p.created_at,
    resolved_at: p.resolved_at,
  };
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export async function createConversation(env, { title = '', kind = 'chat', sourceRef = '', createdBy = '' } = {}) {
  const id = crypto.randomUUID();
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'New chat';
  const at = nowIso();
  await env.DB.prepare('INSERT INTO chat_conversations (id, title, kind, source_ref, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, t, kind, sourceRef, lower(createdBy), at, at)
    .run();
  return { id, title: t, kind, source_ref: sourceRef, created_by: lower(createdBy), archived: 0, created_at: at, updated_at: at };
}

async function loadConversation(env, id) {
  const c = await env.DB.prepare('SELECT * FROM chat_conversations WHERE id = ?').bind(id).first();
  if (!c) throw new ChatError('Chat not found', 404);
  return c;
}

export async function updateConversation(env, id, { title, archived }) {
  await loadConversation(env, id);
  if (title !== undefined) {
    const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) throw new ChatError('A chat needs a title.');
    await env.DB.prepare('UPDATE chat_conversations SET title = ? WHERE id = ?').bind(t, id).run();
  }
  if (archived !== undefined) {
    await env.DB.prepare('UPDATE chat_conversations SET archived = ? WHERE id = ?').bind(archived ? 1 : 0, id).run();
  }
  return loadConversation(env, id);
}

// Messages the reader didn't write themselves count towards "unread".
const NOT_MINE = "NOT (m.role = 'user' AND m.author_email = ?1)";

export async function listConversations(env, email, { archived = false } = {}) {
  const me = lower(email);
  const { nameOf } = await people(env);
  const res = await env.DB.prepare(
    `SELECT c.*,
       (SELECT m.text FROM chat_messages m WHERE m.conversation_id = c.id AND m.role != 'event' AND m.status = 'done' ORDER BY m.created_at DESC LIMIT 1) AS last_text,
       (SELECT m.role FROM chat_messages m WHERE m.conversation_id = c.id AND m.role != 'event' AND m.status = 'done' ORDER BY m.created_at DESC LIMIT 1) AS last_role,
       (SELECT m.author_email FROM chat_messages m WHERE m.conversation_id = c.id AND m.role != 'event' AND m.status = 'done' ORDER BY m.created_at DESC LIMIT 1) AS last_author,
       (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.conversation_id = c.id AND ${NOT_MINE}) AS last_other_at,
       (SELECT COUNT(*) FROM chat_messages m, json_each(m.questions) q WHERE m.conversation_id = c.id AND json_extract(q.value, '$.answered_at') IS NULL) AS open_questions,
       (SELECT COUNT(*) FROM chat_pending p WHERE p.conversation_id = c.id AND p.status = 'pending') AS pending_count,
       (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.status = 'thinking') AS thinking,
       (SELECT r.read_at FROM chat_reads r WHERE r.conversation_id = c.id AND r.email = ?1) AS read_at
     FROM chat_conversations c WHERE c.archived = ?2 ORDER BY c.updated_at DESC LIMIT 200`
  )
    .bind(me, archived ? 1 : 0)
    .all();
  return (res.results || []).map((c) => ({
    id: c.id,
    title: c.title,
    kind: c.kind,
    created_by_name: c.created_by ? nameOf(c.created_by) : c.kind === 'chat' ? '' : 'Assistant',
    archived: !!c.archived,
    created_at: c.created_at,
    updated_at: c.updated_at,
    last_text: String(c.last_text || '').slice(0, 160),
    last_author_name: c.last_role === 'assistant' ? 'Assistant' : c.last_role === 'user' ? nameOf(c.last_author) : '',
    unread: !!c.last_other_at && (!c.read_at || c.last_other_at > c.read_at),
    open_questions: c.open_questions || 0,
    pending_count: c.pending_count || 0,
    thinking: !!c.thinking,
  }));
}

export async function unreadSummary(env, email) {
  const me = lower(email);
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM chat_conversations c WHERE c.archived = 0 AND EXISTS (
          SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND ${NOT_MINE}
            AND m.created_at > COALESCE((SELECT r.read_at FROM chat_reads r WHERE r.conversation_id = c.id AND r.email = ?1), ''))) AS unread,
       (SELECT COUNT(*) FROM chat_messages m, json_each(m.questions) q
          JOIN chat_conversations c ON c.id = m.conversation_id
          WHERE c.archived = 0 AND json_extract(q.value, '$.answered_at') IS NULL) AS open_questions,
       (SELECT COUNT(*) FROM chat_pending p JOIN chat_conversations c ON c.id = p.conversation_id WHERE c.archived = 0 AND p.status = 'pending') AS pending`
  )
    .bind(me)
    .first();
  return { unread: row.unread || 0, open_questions: row.open_questions || 0, pending: row.pending || 0 };
}

async function expireStale(env, conversationId) {
  const cutoff = new Date(Date.now() - THINKING_STALE_MS).toISOString();
  await env.DB.prepare("UPDATE chat_messages SET status = 'failed', reason = 'it stopped before it finished', updated_at = ? WHERE conversation_id = ? AND status = 'thinking' AND created_at < ?")
    .bind(nowIso(), conversationId, cutoff)
    .run();
}

export async function getConversation(env, id, email, { markRead = true } = {}) {
  const c = await loadConversation(env, id);
  await expireStale(env, id);
  const { nameOf } = await people(env);
  const msgs = await env.DB.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 500').bind(id).all();
  const pending = await env.DB.prepare('SELECT * FROM chat_pending WHERE conversation_id = ? ORDER BY created_at ASC').bind(id).all();
  if (markRead) {
    await env.DB.prepare('INSERT OR REPLACE INTO chat_reads (email, conversation_id, read_at) VALUES (?, ?, ?)').bind(lower(email), id, nowIso()).run();
  }
  return {
    conversation: { id: c.id, title: c.title, kind: c.kind, archived: !!c.archived, created_by_name: c.created_by ? nameOf(c.created_by) : '', created_at: c.created_at, updated_at: c.updated_at },
    messages: (msgs.results || []).map((m) => shapeMessage(m, nameOf)),
    pending: (pending.results || []).map((p) => shapePending(p, nameOf)),
  };
}

async function insertMessage(env, m) {
  const id = m.id || crypto.randomUUID();
  const at = m.created_at || nowIso();
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, conversation_id, role, author_email, text, status, reason, actions, attachments, questions, reply_to, input_tokens, output_tokens, dry_run, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      m.conversation_id,
      m.role,
      lower(m.author_email),
      m.text || '',
      m.status || 'done',
      m.reason || '',
      JSON.stringify(m.actions || []),
      JSON.stringify(m.attachments || []),
      JSON.stringify(m.questions || []),
      m.reply_to ? JSON.stringify(m.reply_to) : '',
      m.input_tokens || 0,
      m.output_tokens || 0,
      m.dry_run ? 1 : 0,
      at,
      at
    )
    .run();
  await env.DB.prepare('UPDATE chat_conversations SET updated_at = ?, archived = 0 WHERE id = ?').bind(at, m.conversation_id).run();
  return id;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

const ASK_TOOL = {
  name: 'ask_couple',
  description:
    'Ask the couple a question in the planner app. It appears as a card both of them are notified about, with your options as tap-to-answer buttons. Use it when you need information only they have. After asking, finish your turn with a short message; their answer arrives later as a new message.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'One clear question, under 300 characters' },
      options: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Optional short answer choices (they can always type their own answer)' },
      about: { type: 'string', description: 'Optional: what it is about, a few words, e.g. "Florist balance"' },
    },
    required: ['question'],
    additionalProperties: false,
  },
};

function cleanQuestion(args) {
  const question = String((args && args.question) || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!question) return null;
  const options = (Array.isArray(args.options) ? args.options : [])
    .map((o) => String(o || '').replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 6);
  const about = String(args.about || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { id: crypto.randomUUID().slice(0, 8), question, options, about, answer: null, answered_by: '', answered_at: null };
}

function questionsDigest(questions) {
  return questions.map((q) => `- ${q.question}${q.options.length ? ` (${q.options.join(' / ')})` : ''}`).join('\n');
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

const CHAT_SYSTEM = `You are the assistant inside a couple's private wedding planner app. Both of them can see and post in every chat, so you may hear from either of them in the same conversation; each message says who wrote it. You keep their plan up to date using the planner tools and answer their questions about it.

How to work
- Start with get_overview when you need context, and use the list/get tools to find ids before you change anything.
- Money is always in PENCE in the tools (£1,250.50 = 125050). Write pounds to them.
- Dates are YYYY-MM-DD and times HH:MM (24h) in the tools.
- update_* tools are partial: send only the fields that change.
- Record what they actually tell you or what an attachment establishes. Never invent guest, supplier or payment details. Before creating something, check whether it already exists and update it instead.
- Attachments (quotes, invoices, photos) are only included with the message they came with, so file what matters from them straight away.

Asking them things
- If you need information only they can give before you can do something properly, call ask_couple: one clear question per call, with short options when the answer is one of a few choices. Both of them get a notification. Then finish your turn with a brief message rather than waiting; their answer arrives as a new message.
- Don't ask what the planner already tells you, and ask no more than you need (at most ${MAX_QUESTIONS_PER_TURN} at a time). For a simple clarification you can also just ask in your reply.

Changes that need a yes first
- Marking a payment paid, deleting anything and changing the master settings are queued, not done. When you call those tools the change appears under your message with Confirm and Cancel buttons. Say plainly what you propose. You cannot confirm it yourself.

Your reply
- Chat style: short, friendly, British English. Light formatting is fine: **bold** and simple "- " lists. No tables or headings.
- A list of the exact changes you made is shown under your message automatically, so don't repeat every field.
- You cannot send emails or messages to anyone. If a supplier needs a reply, offer wording they can send themselves.`;

const CHECKIN_SYSTEM = `You do a regular check-in for a couple's private wedding planner. Look through the plan with the read-only planner tools (start with get_overview) and decide whether there is anything only the couple can tell you that would make the plan more complete or catch a problem early. Good examples:
- a payment or balance with no due date, or a due date coming up with no amount;
- a supplier with no booking status, or one awaiting a decision whose deadline is close;
- a task close to its deadline with nobody owning it, or one overdue that may already be done;
- a decision that is overdue or still open close to the date it matters;
- a budget category with nothing quoted yet when that supplier is usually booked by now.

Rules
- Ask with ask_couple: one question per call, short and specific (names, amounts, dates), with options when the answer is one of a few choices.
- Only ask what matters now and what the planner can't already tell you. Never repeat a question that is listed as already asked, unless the plan shows the situation has changed. Never ask again anything marked SKIPPED, or a rewording of it.
- If nothing is worth asking, ask nothing and reply "Nothing to ask today."
- Money is in PENCE in the tools; write pounds. You cannot change the plan in this check-in; their answers come back in the app chat, where you can act on them.
- Your final message is shown above the questions as a short intro: one or two warm sentences in British English, no lists, no markdown.`;

const LAUNCH_NOTE = `This is the first check-in since the in-app assistant chat was switched on. Do a fuller review of the whole plan than usual and ask up to ${MAX_LAUNCH_QUESTIONS} of the most useful questions, most important first. In your intro, say briefly that you can now ask them things in the app and that they can answer here.`;

async function historyFor(env, conversationId, excludeId, nameOf) {
  const res = await env.DB.prepare(
    "SELECT * FROM chat_messages WHERE conversation_id = ? AND id != ? AND status != 'thinking' ORDER BY created_at DESC, rowid DESC LIMIT ?"
  )
    .bind(conversationId, excludeId, MAX_HISTORY)
    .all();
  const rows = (res.results || []).reverse();
  const pending = (await env.DB.prepare('SELECT message_id, summary, status, result FROM chat_pending WHERE conversation_id = ?').bind(conversationId).all()).results || [];

  const turns = [];
  const push = (role, text) => {
    const t = String(text || '').trim() || '(no text)';
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n\n${t}`;
    else turns.push({ role, text: t });
  };
  for (const r of rows) {
    if (r.role === 'user') {
      const reply = r.reply_to ? parse(r.reply_to, null) : null;
      const files = parse(r.attachments, []);
      push(
        'user',
        `${nameOf(r.author_email)}${reply ? ` (answering your question "${reply.question}")` : ''}: ${r.text}${files.length ? `\n[Attached: ${files.map((f) => f.name).join(', ')}]` : ''}`
      );
    } else if (r.role === 'assistant') {
      const parts = [r.text];
      if (r.status === 'failed') parts.push(`(This reply did not finish: ${r.reason || 'an error'}.)`);
      const actions = parse(r.actions, []);
      if (actions.length) parts.push(`(Changes you made:\n${describeActions(actions)})`);
      for (const q of parse(r.questions, [])) {
        const state = q.skipped ? `${nameOf(q.answered_by)} skipped it as not needed` : q.answered_at ? `${nameOf(q.answered_by)} answered: ${q.answer}` : 'not answered yet';
        parts.push(`(You asked: "${q.question}"${q.options && q.options.length ? ` [${q.options.join(' / ')}]` : ''} — ${state})`);
      }
      for (const p of pending.filter((x) => x.message_id === r.id)) {
        parts.push(`(Proposed change waiting for their Confirm button: ${p.summary} — ${p.status}${p.result ? `: ${p.result}` : ''})`);
      }
      push('assistant', parts.filter(Boolean).join('\n\n'));
    } else {
      push('user', `[Planner note] ${r.text}`);
    }
  }
  if (!turns.length || turns[0].role !== 'user') turns.unshift({ role: 'user', text: '[Planner note] This chat was started by the assistant.' });
  if (turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', text: '[Planner note] Please continue.' });
  return turns;
}

function attachmentBlocks(files) {
  return files.map((f) => {
    const source = { type: 'base64', media_type: f.type, data: f.data };
    return f.type === 'application/pdf' ? { type: 'document', source, title: f.name } : { type: 'image', source };
  });
}

function validateAttachments(list) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length > MAX_ATTACHMENTS) throw new ChatError(`Attach at most ${MAX_ATTACHMENTS} files at a time.`);
  return list.map((a) => {
    const name = String((a && a.name) || 'file').slice(0, 120);
    const type = lower(a && a.type);
    const data = String((a && a.data) || '').replace(/^data:[^,]*,/, '');
    if (type !== 'application/pdf' && !IMAGE_TYPES.includes(type)) throw new ChatError(`${name}: only PDFs and photos (PNG, JPEG, GIF, WEBP) can be attached.`);
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new ChatError(`${name}: the file could not be read.`);
    if (Math.floor((data.length * 3) / 4) > MAX_ATTACHMENT_BYTES) throw new ChatError(`${name} is larger than 4 MB.`);
    return { name, type, data };
  });
}

/**
 * One assistant turn in a conversation: reads the shared history, may use
 * planner tools, ask questions and propose changes, then writes its reply
 * into the "thinking" placeholder. Never throws.
 */
async function runTurn(env, deps, cfg, { conv, placeholderId, files, actorEmail, deviceId, afterPing = Promise.resolve() }) {
  const { couple, nameOf } = await people(env);
  const catalogue = listTools();
  const byName = new Map(catalogue.map((t) => [t.name, t]));
  const tools = [...catalogue.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })), ASK_TOOL];
  const actions = [];
  const questions = [];
  const usage = { input: 0, output: 0 };

  const execute = async (name, args) => {
    if (name === 'ask_couple') {
      if (questions.length >= MAX_QUESTIONS_PER_TURN) return { text: `Error: ask at most ${MAX_QUESTIONS_PER_TURN} questions at a time.`, isError: true };
      const q = cleanQuestion(args);
      if (!q) return { text: 'Error: the question is empty.', isError: true };
      questions.push(q);
      return { text: 'Posted as a question card; both of them are notified. Finish your turn with a short message now.' };
    }
    const tool = byName.get(name);
    if (!tool) return { text: `Error: unknown tool ${name}`, isError: true };
    if (tool.annotations.readOnlyHint) return readTool(deps)(name, args);
    const summary = describeCall(tool, args);
    if (needsConfirmation(tool, args)) {
      const code = crypto.randomUUID().slice(0, 8).toUpperCase();
      await env.DB.prepare('INSERT INTO chat_pending (code, conversation_id, message_id, tool, args, summary) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(code, conv.id, placeholderId, name, JSON.stringify(args), summary)
        .run();
      return { text: 'Not done yet: shown to them with Confirm and Cancel buttons. Tell them what you propose; you cannot confirm it yourself.' };
    }
    if (cfg.dryRun) {
      actions.push({ tool: name, summary, simulated: true });
      return { text: 'Simulation mode: this change was NOT saved. Carry on as if it had been, and mention that this was a simulation.' };
    }
    const r = await runTool(name, args, deps.dispatch);
    if (!r.ok) return { text: `Error: ${r.error}`, isError: true };
    actions.push({ tool: name, summary });
    return { text: JSON.stringify(r.data) };
  };

  let outcome;
  try {
    const turns = await historyFor(env, conv.id, placeholderId, nameOf);
    const waiting = (await env.DB.prepare("SELECT code, summary FROM chat_pending WHERE conversation_id = ? AND status = 'pending'").bind(conv.id).all()).results || [];
    const speaker = actorEmail ? nameOf(actorEmail) : 'one of the couple';
    const note = [
      `[Planner note] Today is ${ukToday()} (${nowIso().slice(0, 10)}). The couple: ${couple.map(nameOf).join(' and ') || 'two partners'}. The latest message is from ${speaker}. Chat: "${conv.title}".`,
      cfg.dryRun ? 'SIMULATION MODE: planner changes are not saved.' : '',
      waiting.length ? `Proposed changes still waiting for their Confirm button:\n${waiting.map((p) => `- ${p.summary}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const messages = turns.map((t, i) =>
      i === turns.length - 1
        ? { role: 'user', content: [...attachmentBlocks(files), { type: 'text', text: `${note}\n\n${t.text}` }] }
        : { role: t.role, content: t.text }
    );
    outcome = await converse(cfg, { system: CHAT_SYSTEM, tools, messages, execute, usage });
  } catch (e) {
    console.error('chat turn failed', redactError(e));
    outcome = { text: '', problem: 'something went wrong on the planner side' };
  }

  const parts = [];
  if (outcome.text) parts.push(outcome.text);
  if (outcome.problem) parts.push(`I hit a problem before finishing: ${outcome.problem}.`);
  const failed = !!outcome.problem && !outcome.text && !actions.length && !questions.length;
  await env.DB.prepare(
    'UPDATE chat_messages SET text = ?, status = ?, reason = ?, actions = ?, questions = ?, input_tokens = ?, output_tokens = ?, dry_run = ?, updated_at = ? WHERE id = ?'
  )
    .bind(parts.join('\n\n'), failed ? 'failed' : 'done', outcome.problem || '', JSON.stringify(actions), JSON.stringify(questions), usage.input, usage.output, cfg.dryRun ? 1 : 0, nowIso(), placeholderId)
    .run();
  await recordUsage(env, { source: 'chat', ref: placeholderId, model: cfg.model, usage, actorEmail });
  await env.DB.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').bind(nowIso(), conv.id).run();

  // The message's own notification goes first, so the email throttle sees it.
  await afterPing;
  if (questions.length) {
    await notifyCouple(env, {
      kind: 'question',
      title: questions.length === 1 ? 'Your planner has a question' : `Your planner has ${questions.length} questions`,
      body: questionsDigest(questions),
      conversationId: conv.id,
      deviceId, // "always both": only the device that sent it is skipped
    });
  } else if (!failed) {
    await notifyCouple(env, {
      kind: 'activity',
      title: `Assistant · ${conv.title}`,
      body: parts.join('\n\n').slice(0, 400),
      conversationId: conv.id,
      actorEmail,
      deviceId,
    });
  }
  return { failed };
}

/**
 * Posts a partner's message and starts the assistant's reply. Resolves to
 * { work } — a promise for the reply (the route keeps the request alive for
 * it) — or { work: null } when AI isn't set up (the message is still saved,
 * so partners can talk to each other).
 */
export async function postMessage(env, deps, { conversationId, email, deviceId = '', text, attachments, answerTo }) {
  const cfg = chatConfig(env);
  const conv = await loadConversation(env, conversationId);
  const body = String(text || '').trim().slice(0, MAX_TEXT);
  const files = validateAttachments(attachments);
  if (!body && !files.length) throw new ChatError('Write a message first.');

  await expireStale(env, conv.id);
  const busy = await env.DB.prepare("SELECT 1 FROM chat_messages WHERE conversation_id = ? AND status = 'thinking' LIMIT 1").bind(conv.id).first();
  if (busy) throw new ChatError('The assistant is still replying in this chat. Try again in a moment.', 409);
  if (cfg.aiReady) {
    const today = nowIso().slice(0, 10);
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE role = 'assistant' AND created_at >= ?").bind(today).first();
    if (count && count.n >= cfg.dailyLimit) throw new ChatError(`The assistant has reached today's limit of ${cfg.dailyLimit} replies. It resets at midnight (UTC).`, 429);
  }

  let replyTo = null;
  if (answerTo && answerTo.message_id && answerTo.question_id) {
    const m = await env.DB.prepare('SELECT id, questions FROM chat_messages WHERE id = ? AND conversation_id = ?').bind(answerTo.message_id, conv.id).first();
    if (!m) throw new ChatError('That question is no longer here.', 404);
    const qs = parse(m.questions, []);
    const q = qs.find((x) => x.id === answerTo.question_id);
    if (!q) throw new ChatError('That question is no longer here.', 404);
    if (q.answered_at) throw new ChatError(q.skipped ? 'That question was skipped.' : 'That question has already been answered.', 409);
    q.answer = body.slice(0, 1000);
    q.answered_by = lower(email);
    q.answered_at = nowIso();
    await env.DB.prepare('UPDATE chat_messages SET questions = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(qs), nowIso(), m.id).run();
    replyTo = { message_id: m.id, question_id: q.id, question: q.question };
  }

  await insertMessage(env, {
    conversation_id: conv.id,
    role: 'user',
    author_email: email,
    text: body,
    attachments: files.map((f) => ({ name: f.name, type: f.type, size: Math.floor((f.data.length * 3) / 4) })),
    reply_to: replyTo,
  });
  // A brand-new chat takes its title from its first message.
  if (conv.kind === 'chat' && conv.title === 'New chat' && body) {
    const t = body.replace(/\s+/g, ' ').slice(0, 60);
    await env.DB.prepare('UPDATE chat_conversations SET title = ? WHERE id = ?').bind(t.length < body.length ? `${t}…` : t, conv.id).run();
    conv.title = t;
  }

  const { nameOf } = await people(env);
  const ping = notifyCouple(env, {
    kind: 'activity',
    title: `${nameOf(email)} · ${conv.title}`,
    body: replyTo ? `Answered "${replyTo.question}": ${body}` : body || `Sent ${files.length} attachment(s)`,
    conversationId: conv.id,
    actorEmail: email,
    deviceId,
  });

  if (!cfg.aiReady) {
    await ping;
    return { work: null };
  }
  const placeholderId = await insertMessage(env, { conversation_id: conv.id, role: 'assistant', text: '', status: 'thinking', dry_run: cfg.dryRun });
  const work = runTurn(env, deps, cfg, { conv, placeholderId, files, actorEmail: email, deviceId, afterPing: ping });
  return { work };
}

// ---------------------------------------------------------------------------
// Confirm / cancel a proposed change
// ---------------------------------------------------------------------------

export async function resolvePending(env, deps, { code, decision, email, deviceId = '' }) {
  const cfg = chatConfig(env);
  const p = await env.DB.prepare('SELECT * FROM chat_pending WHERE code = ?').bind(String(code || '').toUpperCase()).first();
  if (!p) throw new ChatError('That proposed change was not found.', 404);
  if (p.status !== 'pending') throw new ChatError(`That change was already ${p.status}.`, 409);
  // Claim it first, so two presses (or both partners at once) run it once.
  const claim = await env.DB.prepare("UPDATE chat_pending SET status = 'running' WHERE code = ? AND status = 'pending'").bind(p.code).run();
  if (!claim.meta || claim.meta.changes !== 1) throw new ChatError('That change is already being handled.', 409);

  const { nameOf } = await people(env);
  const who = nameOf(email);
  let status = 'cancelled';
  let result = '';
  let note = `${who} cancelled: ${p.summary}`;
  let actions = [];
  if (decision === 'confirm') {
    if (cfg.dryRun) {
      status = 'confirmed';
      actions = [{ tool: p.tool, summary: p.summary, simulated: true }];
      note = `${who} confirmed: ${p.summary} (simulation: not saved)`;
    } else {
      const r = await runTool(p.tool, parse(p.args, {}), deps.dispatch);
      if (r.ok) {
        status = 'confirmed';
        actions = [{ tool: p.tool, summary: p.summary }];
        note = `${who} confirmed: ${p.summary}`;
      } else {
        status = 'failed';
        result = String(r.error || 'it failed').slice(0, 300);
        note = `${who} confirmed "${p.summary}", but it could not be done: ${result}`;
      }
    }
  }
  await env.DB.prepare('UPDATE chat_pending SET status = ?, result = ?, resolved_by = ?, resolved_at = ? WHERE code = ?').bind(status, result, lower(email), nowIso(), p.code).run();
  await insertMessage(env, { conversation_id: p.conversation_id, role: 'event', author_email: email, text: note, actions });
  const conv = await loadConversation(env, p.conversation_id);
  await notifyCouple(env, { kind: 'activity', title: `${who} · ${conv.title}`, body: note, conversationId: conv.id, actorEmail: email, deviceId });
  return { status, result };
}

// ---------------------------------------------------------------------------
// Questions the assistant raises by itself
// ---------------------------------------------------------------------------

async function recentlyAsked(env) {
  const since = new Date(Date.now() - 45 * 86400000).toISOString();
  const res = await env.DB.prepare("SELECT questions, created_at FROM chat_messages WHERE questions != '[]' AND created_at >= ? ORDER BY created_at DESC LIMIT 60").bind(since).all();
  const out = [];
  for (const r of res.results || []) {
    for (const q of parse(r.questions, [])) {
      const state = q.skipped ? 'SKIPPED: they said this does not need asking; never ask it again' : q.answered_at ? `answered: ${q.answer}` : 'not answered yet';
      out.push(`- (${r.created_at.slice(0, 10)}) ${q.question} — ${state}`);
    }
  }
  return out.slice(0, 60);
}

/**
 * Reviews the plan and posts any questions worth asking as a new chat.
 * `launch` is the one-off fuller review. Resolves to { status, count, problem }.
 */
export async function runCheckin(env, deps, { launch = false, actorEmail = '' } = {}) {
  const cfg = chatConfig(env);
  if (!cfg.aiReady) return { status: 'not configured', count: 0 };
  // One check-in at a time (two presses, both partners, or the cron).
  const lock = parse(await getSettingValue(env, CHECKIN_LOCK_SETTING), null);
  if (lock && Date.now() - Date.parse(lock.at) < CHECKIN_LOCK_MS) return { status: 'already running', count: 0 };
  await putSetting(env, CHECKIN_LOCK_SETTING, JSON.stringify({ at: nowIso() }));
  try {
    return await checkinNow(env, deps, cfg, { launch, actorEmail });
  } finally {
    await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(CHECKIN_LOCK_SETTING).run();
  }
}

/**
 * Open (unanswered, not skipped) questions in check-in chats that aren't
 * archived, newest chat first: [{ conversationId, count }]. `sinceDays`
 * limits it to recent ones.
 */
export async function openCheckinQuestions(env, { sinceDays = 0 } = {}) {
  const since = sinceDays ? new Date(Date.now() - sinceDays * 86400000).toISOString() : '';
  const res = await env.DB.prepare(
    `SELECT m.conversation_id AS conversationId, COUNT(*) AS count, MAX(m.created_at) AS latest
     FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id, json_each(m.questions) q
     WHERE c.kind = 'checkin' AND c.archived = 0 AND json_extract(q.value, '$.answered_at') IS NULL AND m.created_at >= ?
     GROUP BY m.conversation_id ORDER BY latest DESC`
  )
    .bind(since)
    .all();
  return (res.results || []).map((r) => ({ conversationId: r.conversationId, count: r.count }));
}

/**
 * "Any questions for us?": if check-in questions are still waiting, point
 * to them instead of asking more; otherwise run a check-in now.
 */
export async function requestCheckin(env, deps, { actorEmail = '' } = {}) {
  const open = await openCheckinQuestions(env);
  if (open.length) {
    return { status: 'open questions', count: open.reduce((n, o) => n + o.count, 0), conversationId: open[0].conversationId };
  }
  return runCheckin(env, deps, { launch: false, actorEmail });
}

/** Skips a question nobody needs to answer; the check-ins won't ask it again. */
export async function skipQuestion(env, { messageId, questionId, email }) {
  const m = await env.DB.prepare('SELECT id, conversation_id, questions FROM chat_messages WHERE id = ?').bind(messageId).first();
  const qs = m ? parse(m.questions, []) : [];
  const q = qs.find((x) => x.id === questionId);
  if (!q) throw new ChatError('That question is no longer here.', 404);
  if (q.answered_at) throw new ChatError(q.skipped ? 'That question was already skipped.' : 'That question has already been answered.', 409);
  q.skipped = true;
  q.answer = null;
  q.answered_by = lower(email);
  q.answered_at = nowIso();
  await env.DB.prepare('UPDATE chat_messages SET questions = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(qs), nowIso(), m.id).run();
  const { nameOf } = await people(env);
  await insertMessage(env, { conversation_id: m.conversation_id, role: 'event', author_email: email, text: `${nameOf(email)} skipped: ${q.question}` });
  return { skipped: true };
}

async function checkinNow(env, deps, cfg, { launch, actorEmail }) {
  const limit = launch ? MAX_LAUNCH_QUESTIONS : MAX_CHECKIN_QUESTIONS;
  const tools = [...listTools().filter((t) => t.annotations.readOnlyHint).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })), ASK_TOOL];
  const questions = [];
  const read = readTool(deps);
  const execute = async (name, args) => {
    if (name === 'ask_couple') {
      if (questions.length >= limit) return { text: `Error: that's the limit of ${limit} questions for this check-in. Finish now.`, isError: true };
      const q = cleanQuestion(args);
      if (!q) return { text: 'Error: the question is empty.', isError: true };
      questions.push(q);
      return { text: 'Noted.' };
    }
    const tool = listTools().find((t) => t.name === name);
    if (!tool || !tool.annotations.readOnlyHint) return { text: 'Error: only the read-only planner tools are available in a check-in.', isError: true };
    return read(name, args);
  };
  const asked = await recentlyAsked(env);
  const text = [
    `Today is ${ukToday()} (${nowIso().slice(0, 10)}).`,
    launch ? LAUNCH_NOTE : `Ask at most ${limit} questions.`,
    asked.length ? `\nAlready asked recently (don't repeat these):\n${asked.join('\n')}` : '\nNothing has been asked yet.',
  ].join('\n');
  const usage = { input: 0, output: 0 };
  const reply = await converse(cfg, { system: CHECKIN_SYSTEM, tools, content: [{ type: 'text', text }], execute, usage });
  if (!questions.length) {
    await recordUsage(env, { source: 'checkin', model: cfg.model, usage, actorEmail });
    return { status: reply.problem ? 'failed' : 'nothing to ask', count: 0, problem: reply.problem || '' };
  }

  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }).format(new Date());
  const conv = await createConversation(env, {
    title: launch ? 'Getting started: a few questions' : `Questions from your planner · ${date}`,
    kind: 'checkin',
    sourceRef: launch ? 'launch' : ukClock().date,
  });
  const intro = (reply.text && reply.text !== 'Nothing to ask today.' ? reply.text : '') || 'A few things I need from you to keep the plan on track:';
  const messageId = await insertMessage(env, { conversation_id: conv.id, role: 'assistant', text: intro, questions, input_tokens: usage.input, output_tokens: usage.output });
  await recordUsage(env, { source: 'checkin', ref: messageId, model: cfg.model, usage, actorEmail });
  await notifyCouple(env, {
    kind: 'question',
    title: questions.length === 1 ? 'Your planner has a question' : `Your planner has ${questions.length} questions`,
    body: questionsDigest(questions),
    conversationId: conv.id,
  });
  return { status: 'asked', count: questions.length, conversationId: conv.id, problem: reply.problem || '' };
}

/**
 * Cron entry point: the one-off launch review on the first run, then a daily
 * check-in at CHAT_CHECKIN_TIME (default: the brief's time). Never throws.
 */
export async function scheduledCheckins(env, deps) {
  try {
    const cfg = chatConfig(env);
    if (!cfg.aiReady) return 'not configured';
    if (!cfg.checkinEnabled) return 'off';
    const { date, hhmm } = ukClock();
    const launch = parse(await getSettingValue(env, LAUNCH_SETTING), null);
    const staleRun = launch && launch.status === 'running' && Date.now() - Date.parse(launch.at) > 30 * 60 * 1000;
    if (!launch || (launch.status === 'failed' && launch.attempts < 3) || staleRun) {
      const attempts = ((launch && launch.attempts) || 0) + 1;
      // Claimed before running, so an overlapping cron run doesn't repeat it.
      await putSetting(env, LAUNCH_SETTING, JSON.stringify({ status: 'running', attempts, at: nowIso() }));
      const r = await runCheckin(env, deps, { launch: true });
      if (r.status === 'already running') {
        // Another check-in held the lock: try again next run, attempt not used.
        await putSetting(env, LAUNCH_SETTING, JSON.stringify({ status: 'failed', attempts: attempts - 1, at: nowIso() }));
        return 'launch: waiting for another check-in';
      }
      await putSetting(env, LAUNCH_SETTING, JSON.stringify({ status: r.status === 'failed' ? 'failed' : 'done', attempts, at: nowIso(), result: r.status, count: r.count }));
      // The launch review stands in for today's check-in.
      await putSetting(env, CHECKIN_DATE_SETTING, date);
      return `launch: ${r.status}${r.count ? `, ${r.count} question(s)` : ''}`;
    }
    if (hhmm < cfg.checkinTime) return 'not due yet';
    if ((await getSettingValue(env, CHECKIN_DATE_SETTING)) === date) return 'already done today';
    await putSetting(env, CHECKIN_DATE_SETTING, date);
    // Don't pile new questions on top of ones still waiting from this week.
    const backlog = await openCheckinQuestions(env, { sinceDays: CHECKIN_BACKLOG_DAYS });
    if (backlog.length) return `daily: skipped, ${backlog.reduce((n, o) => n + o.count, 0)} question(s) still open`;
    const r = await runCheckin(env, deps, { launch: false });
    return `daily: ${r.status}${r.count ? `, ${r.count} question(s)` : ''}`;
  } catch (e) {
    console.error('chat check-in failed', redactError(e));
    return 'failed';
  }
}

/** The email assistant's ask_in_app tool: the question joins that email's chat. */
export async function askFromEmail(env, { threadId, subject, from, excerpt, question, options }) {
  const q = cleanQuestion({ question, options });
  if (!q) return null;
  const { nameOf } = await people(env);
  let conv = threadId ? await env.DB.prepare("SELECT * FROM chat_conversations WHERE kind = 'email' AND source_ref = ? LIMIT 1").bind(threadId).first() : null;
  if (!conv) {
    conv = await createConversation(env, { title: `Email: ${String(subject || '').replace(/^((re|fwd?):\s*)+/i, '') || '(no subject)'}`, kind: 'email', sourceRef: threadId || '' });
    await insertMessage(env, {
      conversation_id: conv.id,
      role: 'event',
      text: `From the email "${subject || '(no subject)'}" that ${nameOf(from)} sent to the planner mailbox:\n\n${String(excerpt || '').slice(0, 1500)}`,
    });
  }
  await insertMessage(env, { conversation_id: conv.id, role: 'assistant', text: 'A question about your email:', questions: [q] });
  // Push only: the email reply already carries the question to their inbox.
  await notifyCouple(env, { kind: 'question', title: 'Your planner has a question', body: questionsDigest([q]), conversationId: conv.id, emailFallback: false });
  return conv.id;
}
