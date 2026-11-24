/**
 * In-app assistant chat suite. Runs the real Worker against a fake Claude API
 * (scripted by a marker in the latest message), a fake Web Push service
 * (decrypts every push with the subscription's own keys, as a browser would)
 * and a fake SMTP server (the email fallback). `npm test -- --only chat`
 * starts the Worker with the vars this needs (scripts/run-tests.mjs).
 *
 * Usage: node test-chat.mjs [baseUrl]
 */
import net from 'node:net';
import http from 'node:http';

const BASE = process.argv[2] || 'http://localhost:8787';
const MODEL = 'claude-sonnet-5-5'; // ASSISTANT_MODEL in scripts/run-tests.mjs
const COUPLE = ['one@couple.test', 'two@couple.test'];
const MAILBOX = 'ai@planner.test';

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${extra !== undefined ? ` :: ${JSON.stringify(extra).slice(0, 600)}` : ''}`); }
}
const section = (t) => console.log(`\n== ${t} ==`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Fake Claude API
// ---------------------------------------------------------------------------

const apiCalls = [];
const USAGE = { input_tokens: 100, cache_creation_input_tokens: 10, cache_read_input_tokens: 50, output_tokens: 20 };
// claude-sonnet-5-5 list prices, US$ per million tokens (src/ai-usage.js).
const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 };
const toolUse = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2)}`, name, input }] });
const say = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const isToolResults = (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result');
const textOf = (m) => (typeof m.content === 'string' ? m.content : (m.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

function script(body) {
  const msgs = body.messages;
  let idx = msgs.length - 1;
  while (idx > 0 && (msgs[idx].role !== 'user' || isToolResults(msgs[idx]))) idx--;
  const turns = (msgs.length - 1 - idx) / 2;
  const full = textOf(msgs[idx]);
  // In a chat the first paragraph is the Worker's context note (which names
  // the chat's title): pick the scenario from the message itself.
  const last = body.system.includes('regular check-in') ? full : full.split('\n\n').slice(1).join('\n\n');
  const lastResult = msgs.length > idx + 1 ? msgs[msgs.length - 1].content[0].content : '';

  if (body.system.includes('regular check-in')) {
    if (last.includes('first check-in')) {
      if (turns === 0) return toolUse('get_overview', {});
      if (turns === 1) return toolUse('ask_couple', { question: 'LAUNCH-Q1: when is the florist balance due?', options: ['This month', 'Next month'] });
      if (turns === 2) return toolUse('ask_couple', { question: 'LAUNCH-Q2: who is booking the band?' });
      if (turns === 3) return toolUse('create_task', { title: 'Sneaky check-in write' });
      return say('LAUNCH-INTRO: I can now ask you things here.');
    }
    if (turns === 0) return toolUse('ask_couple', { question: 'DAILY-Q: has the venue confirmed numbers?', options: ['Yes', 'Not yet'], about: 'Venue' });
    return say('A quick one from me today.');
  }
  if (last.includes('CHAT-TASK')) {
    if (turns === 0) return toolUse('create_task', { title: 'Chat task' });
    return say('Added **Chat task** for you.\n- one\n- two');
  }
  if (last.includes('CHAT-DELETE')) {
    if (turns === 0) return toolUse('create_task', { title: 'Delete me' });
    if (turns === 1) return toolUse('delete_task', { id: JSON.parse(lastResult).id });
    return say('Shall I delete it? Press Confirm.');
  }
  if (last.includes('CHAT-ASK')) {
    if (turns === 0) return toolUse('ask_couple', { question: 'Which florist?', options: ['Bloom', 'Petal'] });
    return say('I have asked which florist.');
  }
  if (last.includes('CHAT-FAIL')) return { __status: 400, error: { type: 'invalid_request_error', message: 'scripted failure' } };
  return say('Noted.');
}

const api = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const body = JSON.parse(raw);
    const call = { body, key: req.headers['x-api-key'], ok: false };
    apiCalls.push(call);
    const out = script(body);
    if (out.__status) {
      res.writeHead(out.__status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: out.error }));
      return;
    }
    call.ok = true;
    // Check-ins answer slowly, so a second request lands while one is running.
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Every call reports the same token mix, so the cost split can be checked exactly.
      res.end(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model, stop_sequence: null, usage: USAGE, ...out }));
    }, body.system.includes('regular check-in') ? 700 : 0);
  });
});

// ---------------------------------------------------------------------------
// Fake push service: a browser's subscription keys + RFC 8291 decryption
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
const concat = (...p) => Buffer.concat(p.map((x) => Buffer.from(x)));
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function newBrowser() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  return { keys, auth, pub, json: { p256dh: b64u(pub), auth: b64u(auth) } };
}
async function decrypt(body, browser) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, browser.keys.privateKey, 256));
  const ikm = await hkdf(browser.auth, shared, concat(enc.encode('WebPush: info\0'), browser.pub, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.subarray(21 + idlen)));
  return JSON.parse(Buffer.from(plain.subarray(0, -1)).toString('utf8'));
}

const pushes = []; // { path, headers, body: Buffer }
const pushSrv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    pushes.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(req.url.includes('gone') ? 410 : 201);
    res.end();
  });
});
const PUSH = 'http://127.0.0.1:8798';

// ---------------------------------------------------------------------------
// Fake SMTP (email fallback)
// ---------------------------------------------------------------------------

const sent = [];
const smtp = net.createServer((sock) => {
  sock.write('220 fake smtp\r\n');
  let buf = '';
  let data = null;
  let rcpts = [];
  sock.on('data', (d) => {
    buf += d.toString('latin1');
    for (;;) {
      if (data !== null) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end < 0) return;
        sent.push({ rcpts, raw: buf.slice(0, end) });
        buf = buf.slice(end + 5);
        data = null;
        rcpts = [];
        sock.write('250 queued\r\n');
        continue;
      }
      const i = buf.indexOf('\r\n');
      if (i < 0) return;
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (/^EHLO/i.test(line)) sock.write('250-fake\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH PLAIN /i.test(line)) sock.write(Buffer.from(line.slice(11), 'base64').toString() === `\0${MAILBOX}\0mailpass` ? '235 ok\r\n' : '535 no\r\n');
      else if (/^MAIL FROM/i.test(line)) sock.write('250 ok\r\n');
      else if (/^RCPT TO:<(.+)>/i.test(line)) { rcpts.push(RegExp.$1); sock.write('250 ok\r\n'); }
      else if (/^DATA/i.test(line)) { data = ''; sock.write('354 go\r\n'); }
      else if (/^QUIT/i.test(line)) sock.end('221 bye\r\n');
      else sock.write('500 what\r\n');
    }
  });
  sock.on('error', () => {});
});
const sentText = (msg) => {
  const m = msg.raw.match(/Content-Type: text\/plain[^\r]*\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/);
  return m ? Buffer.from(m[1].replace(/\s/g, ''), 'base64').toString('utf8') : '';
};

// ---------------------------------------------------------------------------

let cookie = '';
async function req(method, path, body, headers = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.startsWith('wp_session=')) cookie = setCookie.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('application/json') ? await res.json() : await res.text() };
}
const post = (id, body, device) => req('POST', `/api/chat/conversations/${id}/messages`, body, device ? { 'X-Device-Id': device } : {});
const lastCall = () => apiCalls[apiCalls.length - 1].body;
const assistantMsgs = (conv) => conv.messages.filter((m) => m.role === 'assistant');
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(300);
  }
  return null;
}
async function decodedPushes(browser, from = 0) {
  const out = [];
  for (const p of pushes.slice(from)) {
    try { out.push({ path: p.path, msg: await decrypt(p.body, browser), auth: p.headers.authorization }); } catch { out.push({ path: p.path, msg: null }); }
  }
  return out;
}

async function main() {
  await Promise.all([[api, 8797], [pushSrv, 8798], [smtp, 1026]].map(([s, port]) => new Promise((r) => s.listen(port, '127.0.0.1', r))));

  let r = await req('GET', '/api/chat/me');
  check('chat API needs a session', r.status === 401, r.status);
  await req('POST', '/api/auth/init', { password: 'PlannerTest2026!' });
  r = await req('POST', '/api/auth/login', { password: 'PlannerTest2026!' });
  check('logged in', r.status === 200 && cookie !== '', r);

  section('1. Who am I');
  r = await req('GET', '/api/chat/me?device=dev-A');
  const me = r.data;
  check('AI configured with the same model as the email assistant', r.status === 200 && me.ai.configured && me.ai.model === MODEL, me.ai);
  check('both partners listed, named from their addresses', me.couple.map((c) => c.name).join(',') === 'One,Two', me.couple);
  check('VAPID public key handed out (raw P-256)', Buffer.from(me.push.public_key, 'base64url').length === 65);
  check('password mode: no personal name, can\'t rename', me.email === '' && me.can_rename === false);
  r = await req('PUT', '/api/chat/me', { name: 'X' });
  check('renaming needs an email identity', r.status === 400, r);

  section('2. A chat that changes the plan');
  r = await req('POST', '/api/chat/conversations', {});
  const c1 = r.data.id;
  check('new chat created', r.status === 200 && r.data.title === 'New chat', r.data);
  r = await post(c1, { text: 'CHAT-TASK please add a task' });
  check('message answered in the same request', r.status === 200 && r.data.messages.length === 2, r.data);
  const reply = assistantMsgs(r.data)[0];
  check('reply saved with the change it made', reply.status === 'done' && reply.text.includes('Chat task') && reply.actions.length === 1 && /^Add task "Chat task"/.test(reply.actions[0].summary), reply);
  check('chat titled from its first message', r.data.conversation.title.startsWith('CHAT-TASK please'), r.data.conversation);
  check('same API key and model as email', apiCalls[0].key === 'chat-key' && apiCalls[0].body.model === MODEL);
  check('model gets every planner tool plus ask_couple', apiCalls[0].body.tools.some((t) => t.name === 'create_task') && apiCalls[0].body.tools.some((t) => t.name === 'ask_couple'));
  check('model told who wrote it and today\'s date', textOf(apiCalls[0].body.messages[0]).includes('Today is') && textOf(apiCalls[0].body.messages[0]).includes('One of you: CHAT-TASK'));
  const tasks = (await req('GET', '/api/tasks')).data;
  check('task really created', tasks.some((t) => t.title === 'Chat task'));

  section('3. Email fallback (no device has push yet)');
  await waitFor(() => sent.length >= 2, 5000);
  check('partner activity emailed to both of the couple (password mode: actor unknown)', sent.length === 2 && sent.map((s) => s.rcpts[0]).sort().join(',') === COUPLE.join(','), sent.map((s) => s.rcpts));
  check('email links to the chat', sentText(sent[0]).includes(`https://plan.planner.test/assistant?c=${c1}`), sentText(sent[0]));
  check('reply emails throttled: one per chat per hour', sent.length === 2);

  section('4. History is shared');
  r = await post(c1, { text: 'CHAT-NOTE and another thing' });
  const hist = lastCall().messages;
  check('earlier turns sent, alternating, starting with the user', hist.length === 3 && hist.map((m) => m.role).join(',') === 'user,assistant,user', hist.map((m) => m.role));
  check('earlier reply includes the changes it made', textOf(hist[1]).includes('Changes you made') && textOf(hist[1]).includes('Chat task'));
  check('still no more emails (throttled)', sent.length === 2, sent.length);

  section('5. Changes that need a yes');
  r = await post(c1, { text: 'CHAT-DELETE make then delete one' });
  const pend = r.data.pending.filter((p) => p.status === 'pending');
  check('delete queued as a Confirm card, not done', pend.length === 1 && /Delete task/i.test(pend[0].summary), r.data.pending);
  check('task still exists', (await req('GET', '/api/tasks')).data.some((t) => t.title === 'Delete me'));
  r = await req('GET', '/api/chat/unread');
  check('unread summary counts it', r.data.pending === 1, r.data);
  r = await req('POST', `/api/chat/pending/${pend[0].code}/confirm`, {});
  check('confirm runs it', r.status === 200 && r.data.status === 'confirmed', r);
  check('task deleted', !(await req('GET', '/api/tasks')).data.some((t) => t.title === 'Delete me'));
  r = await req('POST', `/api/chat/pending/${pend[0].code}/confirm`, {});
  check('a second confirm is refused', r.status === 409, r);
  r = await req('POST', `/api/chat/pending/${pend[0].code}/cancel`, {});
  check('cancel after confirm is refused', r.status === 409, r);
  r = await req('GET', `/api/chat/conversations/${c1}`);
  check('confirmation noted in the chat for both', r.data.messages.some((m) => m.role === 'event' && m.text.includes('confirmed')) && r.data.pending[0].status === 'confirmed');

  section('6. Turning push on');
  const browser = await newBrowser();
  r = await req('POST', '/api/push/subscriptions', { endpoint: 'https://evil.example.com/x', keys: browser.json });
  check('unknown push host refused', r.status === 400, r);
  r = await req('POST', '/api/push/subscriptions', { endpoint: `${PUSH}/push/a`, keys: { p256dh: 'AAAA', auth: 'BBBB' } });
  check('unreadable keys refused', r.status === 400, r);
  r = await req('POST', '/api/push/subscriptions', { endpoint: `${PUSH}/push/a`, keys: browser.json, device_id: 'dev-A', label: 'Test phone' });
  check('subscribed', r.status === 200, r);
  r = await req('GET', '/api/chat/me?device=dev-A');
  check('device listed as this device', r.data.push.devices.length === 1 && r.data.push.devices[0].this_device && r.data.push.devices[0].label === 'Test phone', r.data.push.devices);
  let from = pushes.length;
  r = await req('POST', '/api/push/test', { endpoint: `${PUSH}/push/a` });
  let got = await decodedPushes(browser, from);
  check('test push delivered and decrypts on the device', r.status === 200 && got.length === 1 && got[0].msg && got[0].msg.title === 'Notifications are on', got);
  check('push signed with VAPID', /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(got[0].auth || ''), got[0].auth);
  check('push carries Web Push headers', pushes[from].headers['content-encoding'] === 'aes128gcm' && !!pushes[from].headers.ttl);

  section('7. The assistant asks a question');
  r = await req('POST', '/api/chat/conversations', {});
  const c2 = r.data.id;
  const sentBefore = sent.length;
  from = pushes.length;
  r = await post(c2, { text: 'CHAT-ASK sort the flowers' }, 'dev-B');
  const qmsg = assistantMsgs(r.data)[0];
  check('question card saved with options', qmsg.questions.length === 1 && qmsg.questions[0].question === 'Which florist?' && qmsg.questions[0].options.join(',') === 'Bloom,Petal' && !qmsg.questions[0].answered_at, qmsg);
  got = await decodedPushes(browser, from);
  check('other device pinged about the message and the question', got.some((g) => g.msg && g.msg.kind === 'activity') && got.some((g) => g.msg && g.msg.kind === 'question' && g.msg.body.includes('Which florist?')), got.map((g) => g.msg));
  check('notification opens that chat', got.every((g) => g.msg && g.msg.url === `https://plan.planner.test/assistant?c=${c2}`), got.map((g) => g.msg && g.msg.url));
  check('no email when a device took the push', sent.length === sentBefore, sent.length - sentBefore);
  r = await req('GET', '/api/chat/unread');
  check('open question counted', r.data.open_questions === 1, r.data);
  r = await req('GET', '/api/chat/conversations');
  check('chat list flags the open question', r.data.find((c) => c.id === c2).open_questions === 1);

  from = pushes.length;
  r = await post(c2, { text: 'CHAT-NOTE from this phone' }, 'dev-A');
  check('a device is not pinged about its own message', pushes.length === from, pushes.length - from);

  r = await post(c2, { text: 'Bloom', answer_to: { message_id: qmsg.id, question_id: qmsg.questions[0].id } }, 'dev-B');
  const answered = r.data.messages.find((m) => m.id === qmsg.id).questions[0];
  check('question marked answered', !!answered.answered_at && answered.answer === 'Bloom', answered);
  check('answer linked to the question', r.data.messages.some((m) => m.role === 'user' && m.reply_to && m.reply_to.question === 'Which florist?'));
  check('model told what the answer is for', textOf(lastCall().messages[lastCall().messages.length - 1]).includes('answering your question "Which florist?"'));
  r = await post(c2, { text: 'Petal', answer_to: { message_id: qmsg.id, question_id: qmsg.questions[0].id } });
  check('a question can only be answered once', r.status === 409, r);
  r = await req('GET', '/api/chat/unread');
  check('no open questions left', r.data.open_questions === 0, r.data);

  section('8. Attachments');
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
  r = await post(c2, { text: 'CHAT-NOTE the quote', attachments: [{ name: 'quote.pdf', type: 'application/pdf', data: pdf }] });
  const lastUser = lastCall().messages[lastCall().messages.length - 1];
  check('PDF passed to the model with that message', lastUser.content.some((b) => b.type === 'document' && b.source.data === pdf && b.title === 'quote.pdf'));
  const um = r.data.messages.filter((m) => m.role === 'user').pop();
  check('only the file name is kept', um.attachments.length === 1 && um.attachments[0].name === 'quote.pdf' && !('data' in um.attachments[0]), um.attachments);
  r = await post(c2, { text: 'x', attachments: [{ name: 'a.txt', type: 'text/plain', data: 'aGk=' }] });
  check('other file types refused', r.status === 400, r);
  r = await post(c2, { text: 'x', attachments: Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.pdf`, type: 'application/pdf', data: pdf })) });
  check('more than 5 files refused', r.status === 400, r);
  r = await post(c2, { text: '   ' });
  check('empty message refused', r.status === 400, r);
  r = await req('POST', '/api/chat/conversations/nope/messages', { text: 'hi' });
  check('unknown chat is a 404', r.status === 404, r);

  section('9. Model failure');
  r = await post(c2, { text: 'CHAT-FAIL please' });
  const failedMsg = assistantMsgs(r.data).pop();
  check('failed reply shown as failed, with the reason', failedMsg.status === 'failed' && /scripted failure|Claude API error/.test(failedMsg.reason), failedMsg);
  r = await post(c2, { text: 'CHAT-NOTE after the failure' });
  check('the chat carries on afterwards', r.status === 200 && assistantMsgs(r.data).pop().status === 'done');

  section('10. Check-in on request');
  let calls = apiCalls.length;
  r = await req('POST', '/api/chat/checkin', {});
  check('check-in posted a question chat', r.status === 200 && r.data.status === 'asked' && r.data.count === 1 && r.data.conversationId, r.data);
  const ck = apiCalls.slice(calls).map((c) => c.body);
  check('check-in model gets read-only tools plus ask_couple only', ck[0].tools.some((t) => t.name === 'ask_couple') && !ck[0].tools.some((t) => /^(create|update|delete|mark|assign)_/.test(t.name)), ck[0].tools.map((t) => t.name));
  r = await req('GET', `/api/chat/conversations/${r.data.conversationId}`);
  check('check-in chat holds the question', r.data.conversation.kind === 'checkin' && assistantMsgs(r.data)[0].questions[0].about === 'Venue', r.data);

  section('11. One-off launch review on the first cron run');
  calls = apiCalls.length;
  await fetch(`${BASE}/__scheduled?cron=*/15+*+*+*+*`);
  const launch = await waitFor(async () => (await req('GET', '/api/chat/conversations')).data.find((c) => c.title === 'Getting started: a few questions'));
  check('launch questions posted as their own chat', !!launch && launch.kind === 'checkin' && launch.open_questions === 2, launch);
  const launchCalls = apiCalls.slice(calls).map((c) => c.body).filter((b) => b.system.includes('regular check-in'));
  check('launch review told it is the first check-in', launchCalls.length > 0 && textOf(launchCalls[0].messages[0]).includes('first check-in'));
  check('it is told what was already asked (no repeats)', textOf(launchCalls[0].messages[0]).includes('DAILY-Q'));
  check('a write tool is refused in a check-in', !(await req('GET', '/api/tasks')).data.some((t) => t.title === 'Sneaky check-in write'));
  if (launch) {
    r = await req('GET', `/api/chat/conversations/${launch.id}`);
    check('intro text from the model', assistantMsgs(r.data)[0].text.startsWith('LAUNCH-INTRO'), assistantMsgs(r.data)[0].text);
  }
  calls = apiCalls.length;
  const listBefore = (await req('GET', '/api/chat/conversations')).data.length;
  await fetch(`${BASE}/__scheduled?cron=*/15+*+*+*+*`);
  await sleep(2500);
  const checkinCallsAfter = apiCalls.slice(calls).filter((c) => c.body.system.includes('regular check-in')).length;
  check('launch runs once; the daily check-in already counts as done today', checkinCallsAfter === 0 && (await req('GET', '/api/chat/conversations')).data.length === listBefore, checkinCallsAfter);

  section('12. Dead subscriptions are dropped');
  const gone = await newBrowser();
  await req('POST', '/api/push/subscriptions', { endpoint: `${PUSH}/push/gone`, keys: gone.json, device_id: 'dev-C' });
  r = await req('GET', '/api/chat/me');
  check('two devices subscribed', r.data.push.devices.length === 2, r.data.push.devices.length);
  await post(c2, { text: 'CHAT-NOTE ping everyone' }, 'dev-B');
  r = await req('GET', '/api/chat/me');
  check('410 from the push service removes that device', r.data.push.devices.length === 1, r.data.push.devices.length);

  section('13. Archive, unsubscribe, backup');
  r = await req('PATCH', `/api/chat/conversations/${c1}`, { archived: true });
  check('archived', r.status === 200 && r.data.conversation.archived === true);
  check('archived chat leaves the main list', !(await req('GET', '/api/chat/conversations')).data.some((c) => c.id === c1));
  check('…and shows in the archived list', (await req('GET', '/api/chat/conversations?archived=1')).data.some((c) => c.id === c1));
  r = await req('PATCH', `/api/chat/conversations/${c1}`, { title: '  ' });
  check('blank title refused', r.status === 400, r);
  await req('POST', '/api/push/unsubscribe', { endpoint: `${PUSH}/push/a` });
  r = await req('GET', '/api/chat/me');
  check('unsubscribed', r.data.push.devices.length === 0, r.data.push.devices);
  r = await req('GET', '/api/export/all');
  check('backup includes the chats', typeof r.data === 'string' && r.data.includes('--- CHAT_MESSAGES ---') && r.data.includes('CHAT-TASK'));
  check('backup never includes the VAPID private key', !r.data.includes('push_vapid') && !r.data.includes('privateJwk'));

  section('14. Skipping questions, and no duplicate check-ins');
  const chatsNow = (await req('GET', '/api/chat/conversations')).data;
  const openCheckins = chatsNow.filter((c) => c.kind === 'checkin' && c.open_questions > 0);
  let calls14 = apiCalls.length;
  r = await req('POST', '/api/chat/checkin', {});
  check('"Any questions for us?" points to the questions still waiting instead of asking more', r.data.status === 'open questions' && r.data.count === 3 && r.data.conversationId === openCheckins[0].id, r.data);
  check('…without calling the model', apiCalls.length === calls14);
  const openQs = [];
  for (const c of openCheckins) {
    const conv = (await req('GET', `/api/chat/conversations/${c.id}`)).data;
    for (const m of assistantMsgs(conv)) for (const q of m.questions) if (!q.answered_at) openQs.push({ conv: c.id, m: m.id, q });
  }
  r = await req('POST', `/api/chat/questions/${openQs[0].m}/${openQs[0].q.id}/skip`, {});
  check('skip a question', r.status === 200 && r.data.skipped === true, r);
  r = await req('GET', `/api/chat/conversations/${openQs[0].conv}`);
  const skippedQ = r.data.messages.find((m) => m.id === openQs[0].m).questions.find((q) => q.id === openQs[0].q.id);
  check('shown as skipped, by whom', skippedQ.skipped === true && !!skippedQ.answered_at && skippedQ.answered_by_name === 'One of you' && skippedQ.answer === null, skippedQ);
  check('skip noted in the chat for both', r.data.messages.some((m) => m.role === 'event' && m.text.includes('skipped') && m.text.includes(openQs[0].q.question)));
  r = await req('POST', `/api/chat/questions/${openQs[0].m}/${openQs[0].q.id}/skip`, {});
  check('skipping twice is refused', r.status === 409, r);
  r = await post(openQs[0].conv, { text: 'late answer', answer_to: { message_id: openQs[0].m, question_id: openQs[0].q.id } });
  check('a skipped question can\'t be answered', r.status === 409, r);
  r = await req('POST', '/api/chat/questions/nope/nope/skip', {});
  check('unknown question is a 404', r.status === 404, r);
  for (const o of openQs.slice(1)) await req('POST', `/api/chat/questions/${o.m}/${o.q.id}/skip`, {});
  r = await req('GET', '/api/chat/unread');
  check('nothing left open', r.data.open_questions === 0, r.data);
  calls14 = apiCalls.length;
  r = await req('POST', '/api/chat/checkin', {});
  check('with nothing waiting, a check-in runs', r.data.status === 'asked', r.data);
  const ckText = textOf(apiCalls.slice(calls14).find((c) => c.body.system.includes('regular check-in')).body.messages[0]);
  check('check-in told which questions were skipped (never ask again)', (ckText.match(/SKIPPED/g) || []).length === 3, ckText);
  const fresh = (await req('GET', `/api/chat/conversations/${r.data.conversationId}`)).data;
  for (const m of assistantMsgs(fresh)) for (const q of m.questions) await req('POST', `/api/chat/questions/${m.id}/${q.id}/skip`, {});
  const first = req('POST', '/api/chat/checkin', {});
  await sleep(200);
  const second = await req('POST', '/api/chat/checkin', {});
  const firstR = await first;
  check('one check-in at a time: a second press while one runs is turned away', second.data.status === 'already running' && firstR.data.status === 'asked', { first: firstR.data, second: second.data });
  // Tidy up: nothing open for the next sections.
  const extra = (await req('GET', `/api/chat/conversations/${firstR.data.conversationId}`)).data;
  for (const m of assistantMsgs(extra)) for (const q of m.questions) await req('POST', `/api/chat/questions/${m.id}/${q.id}/skip`, {});

  section('15. Notification settings and quiet hours');
  r = await req('PUT', '/api/chat/me', { notify: { level: 'sometimes' } });
  check('unknown level refused', r.status === 400, r);
  r = await req('PUT', '/api/chat/me', { notify: { level: 'all', quiet_start: '25:00', quiet_end: '07:00' } });
  check('bad time refused', r.status === 400, r);
  r = await req('PUT', '/api/chat/me', { notify: { level: 'all', quiet_start: '22:00', quiet_end: '22:00' } });
  check('empty quiet window refused', r.status === 400, r);
  const phone = await newBrowser();
  await req('POST', '/api/push/subscriptions', { endpoint: `${PUSH}/push/phone`, keys: phone.json, device_id: 'dev-P' });
  r = await req('PUT', '/api/chat/me', { notify: { level: 'questions', quiet_start: '', quiet_end: '' } });
  check('"questions only" saved', r.status === 200 && r.data.notify.level === 'questions', r);
  check('…and read back', (await req('GET', '/api/chat/me')).data.notify.level === 'questions');
  const c3 = (await req('POST', '/api/chat/conversations', {})).data.id;
  let pushFrom = pushes.length;
  let sentFrom = sent.length;
  await post(c3, { text: 'CHAT-NOTE just chatting' }, 'dev-X');
  check('"questions only": no push and no email for chat activity', pushes.length === pushFrom && sent.length === sentFrom, { pushes: pushes.length - pushFrom, emails: sent.length - sentFrom });
  await post(c3, { text: 'CHAT-ASK the flowers again' }, 'dev-X');
  let got15 = await decodedPushes(phone, pushFrom);
  check('"questions only": questions still come through', got15.length === 1 && got15[0].msg.kind === 'question', got15.map((g) => g.msg));

  const ukNow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const shift = (hhmm, mins) => {
    const t = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + mins + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  r = await req('PUT', '/api/chat/me', { notify: { level: 'all', quiet_start: shift(ukNow, -60), quiet_end: shift(ukNow, 60) } });
  check('quiet hours saved', r.status === 200 && r.data.notify.quiet_start === shift(ukNow, -60), r);
  pushFrom = pushes.length;
  sentFrom = sent.length;
  r = await post(c3, { text: 'CHAT-ASK one more for the florist' }, 'dev-X');
  check('during quiet hours nothing is sent', pushes.length === pushFrom && sent.length === sentFrom, { pushes: pushes.length - pushFrom, emails: sent.length - sentFrom });
  await req('PUT', '/api/chat/me', { notify: { level: 'all', quiet_start: '', quiet_end: '' } });
  await fetch(`${BASE}/__scheduled?cron=*/15+*+*+*+*`);
  const summary = await waitFor(async () => (await decodedPushes(phone, pushFrom)).find((g) => g.msg && g.msg.title.startsWith('While you were away')), 10000);
  check('when quiet hours end, one summary arrives', !!summary && /1 question/.test(summary.msg.title) && /1 chat update/.test(summary.msg.title) && summary.msg.kind === 'question', summary && summary.msg);
  check('summary opens the chat it was about', !!summary && summary.msg.url === `https://plan.planner.test/assistant?c=${c3}`, summary && summary.msg.url);
  check('…and no email on top (a device took it)', sent.length === sentFrom, sent.length - sentFrom);
  const before15 = pushes.length;
  await fetch(`${BASE}/__scheduled?cron=*/15+*+*+*+*`);
  await sleep(1500);
  check('the summary is sent once', (await decodedPushes(phone, before15)).every((g) => !g.msg || !g.msg.title.startsWith('While you were away')));
  await req('POST', '/api/push/unsubscribe', { endpoint: `${PUSH}/push/phone` });

  section('16. Usage and cost');
  r = await req('GET', '/api/ai/usage');
  const u = r.data;
  check('usage report', r.status === 200 && u.currency === 'USD' && u.default_model === MODEL && !!u.prices[MODEL], u && u.default_model);
  const chatCalls = apiCalls.filter((c) => c.ok && c.body.system.includes('inside a couple')).length;
  const checkinCalls = apiCalls.filter((c) => c.ok && c.body.system.includes('regular check-in')).length;
  const chatU = u.periods.all.bySource.chat;
  const ckU = u.periods.all.bySource.checkin;
  check('every chat model call counted, tokens split the way they are billed', chatU.output === 20 * chatCalls && chatU.input === 100 * chatCalls && chatU.cacheWrite === 10 * chatCalls && chatU.cacheRead === 50 * chatCalls, { chatU, chatCalls });
  // Check-ins that ran: section 10, the launch review, and two in section 14.
  check('every check-in counted, one row per run', ckU.output === 20 * checkinCalls && ckU.runs === 4, { ckU, checkinCalls });
  const perCall = (100 * PRICE.input + 10 * PRICE.cacheWrite + 50 * PRICE.cacheRead + 20 * PRICE.output) / 1e6;
  check('cost uses the model price, cache writes at 1.25x and its cache-read rate', Math.abs(chatU.cost - perCall * chatCalls) < 1e-9, { cost: chatU.cost, want: perCall * chatCalls });
  check('a failed reply that used no tokens costs nothing', chatU.runs < apiCalls.filter((c) => c.body.system.includes('inside a couple')).length + 1);
  check('today, this month, 30 days and all time agree here', ['today', 'month', 'last30'].every((k) => Math.abs(u.periods[k].total.cost - u.periods.all.total.cost) < 1e-9));
  check('month list', u.by_month.length === 1 && Math.abs(u.by_month[0].cost - u.periods.all.total.cost) < 1e-9, u.by_month);
  check('nothing estimated (all runs logged with their model)', u.estimated_runs === 0, u.estimated_runs);

  console.log(`\n${passed} passed, ${failed} failed`);
  for (const s of [api, pushSrv, smtp]) s.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
