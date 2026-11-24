/**
 * Minimal IMAP + SMTP clients for the email assistant's own mailbox.
 *
 * The domain's mail is hosted outside Cloudflare, so the Worker talks to the
 * mailbox like any mail app would: IMAP over TLS to read, SMTP over TLS to
 * send, both via the Workers TCP socket API. Only the handful of commands the
 * assistant needs are implemented.
 */
import { connect } from 'cloudflare:sockets';

const SESSION_TIMEOUT_MS = 45000;
const MAX_LINE_BYTES = 64 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

export class MailError extends Error {}

// Buffered reader over the socket: CRLF-terminated lines and fixed-size
// literals (IMAP sends message bodies as `{n}` followed by n raw bytes).
class Reader {
  constructor(readable) {
    this.reader = readable.getReader();
    this.buf = new Uint8Array(0);
  }

  async fill() {
    const { value, done } = await this.reader.read();
    if (done) throw new MailError('The mail server closed the connection.');
    return value;
  }

  async line() {
    for (;;) {
      for (let i = 0; i + 1 < this.buf.length; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const text = dec.decode(this.buf.subarray(0, i));
          this.buf = this.buf.subarray(i + 2);
          return text;
        }
      }
      if (this.buf.length > MAX_LINE_BYTES) throw new MailError('The mail server sent an over-long line.');
      const chunk = await this.fill();
      const next = new Uint8Array(this.buf.length + chunk.length);
      next.set(this.buf);
      next.set(chunk, this.buf.length);
      this.buf = next;
    }
  }

  async bytes(n) {
    const out = new Uint8Array(n);
    let have = Math.min(n, this.buf.length);
    out.set(this.buf.subarray(0, have));
    this.buf = this.buf.subarray(have);
    while (have < n) {
      const chunk = await this.fill();
      const take = Math.min(n - have, chunk.length);
      out.set(chunk.subarray(0, take), have);
      have += take;
      if (take < chunk.length) this.buf = chunk.subarray(take);
    }
    return out;
  }
}

async function withSocket({ host, port, tls }, fn) {
  const socket = connect({ hostname: host, port }, { secureTransport: tls ? 'on' : 'off', allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const io = {
    reader: new Reader(socket.readable),
    write: (data) => writer.write(typeof data === 'string' ? enc.encode(data) : data),
  };
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new MailError(`Timed out talking to ${host}:${port}.`)), SESSION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fn(io), timeout]);
  } finally {
    clearTimeout(timer);
    try {
      await socket.close();
    } catch {
      // Already closed.
    }
  }
}

// ---------------------------------------------------------------------------
// IMAP
// ---------------------------------------------------------------------------

const imapQuote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

class ImapSession {
  constructor(io) {
    this.io = io;
    this.seq = 0;
  }

  // Sends one command and collects the untagged response lines (and any
  // literals) up to the tagged completion line.
  async command(text) {
    const tag = `a${++this.seq}`;
    await this.io.write(`${tag} ${text}\r\n`);
    const lines = [];
    const literals = [];
    for (;;) {
      const line = await this.io.reader.line();
      if (line.startsWith(`${tag} `)) {
        if (!/^\S+ OK\b/i.test(line)) throw new MailError(`IMAP ${text.split(' ')[0]} failed: ${line.slice(tag.length + 1)}`);
        return { lines, literals };
      }
      lines.push(line);
      const literal = line.match(/\{(\d+)\}$/);
      if (literal) literals.push(await this.io.reader.bytes(Number(literal[1])));
    }
  }

  async unseenUids() {
    const { lines } = await this.command('UID SEARCH UNSEEN');
    const uids = [];
    for (const line of lines) {
      const m = line.match(/^\* SEARCH\b(.*)$/i);
      if (m) uids.push(...m[1].trim().split(/\s+/).filter(Boolean).map(Number));
    }
    return uids.filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  }

  async size(uid) {
    const { lines } = await this.command(`UID FETCH ${uid} (RFC822.SIZE)`);
    const m = lines.join(' ').match(/RFC822\.SIZE (\d+)/i);
    return m ? Number(m[1]) : 0;
  }

  // BODY.PEEK leaves the message unseen, so a run that dies half-way picks
  // it up again next time.
  async raw(uid) {
    const { literals } = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`);
    if (!literals.length) throw new MailError(`IMAP returned no body for message ${uid}.`);
    return literals[0];
  }

  async markSeen(uids) {
    if (uids.length) await this.command(`UID STORE ${uids.join(',')} +FLAGS.SILENT (\\Seen)`);
  }
}

/** Opens the mailbox's INBOX and runs `fn(session)`. */
export function imapSession(mail, fn) {
  return withSocket({ host: mail.imapHost, port: mail.imapPort, tls: mail.tls }, async (io) => {
    const greeting = await io.reader.line();
    if (!/^\* (OK|PREAUTH)\b/i.test(greeting)) throw new MailError(`Unexpected IMAP greeting: ${greeting}`);
    const session = new ImapSession(io);
    await session.command(`LOGIN ${imapQuote(mail.user)} ${imapQuote(mail.password)}`);
    await session.command('SELECT INBOX');
    const result = await fn(session);
    try {
      await session.command('LOGOUT');
    } catch {
      // The work is done; a failed goodbye doesn't matter.
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

async function smtpReply(io, expect) {
  let line;
  do {
    line = await io.reader.line();
  } while (/^\d{3}-/.test(line)); // multi-line replies end on "250 ..."
  if (!line.startsWith(String(expect))) throw new MailError(`SMTP error: ${line}`);
}

const b64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64Text = (text) => b64(enc.encode(text));
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
const encodeHeader = (text) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64Text(text)}?=`);

/**
 * Sends already-built RFC 5322 messages ({ to: [addresses], raw }) over one
 * connection. Resolves to one { ok, error } per message, in order; a message
 * the server refuses doesn't stop the ones after it.
 */
export async function smtpSendMany(mail, messages) {
  const results = [];
  try {
    await withSocket({ host: mail.smtpHost, port: mail.smtpPort, tls: mail.tls }, async (io) => {
      await smtpReply(io, 220);
      await io.write('EHLO wedding-planner\r\n');
      await smtpReply(io, 250);
      await io.write(`AUTH PLAIN ${b64Text(`\0${mail.user}\0${mail.password}`)}\r\n`);
      await smtpReply(io, 235);
      for (const { to, raw } of messages) {
        try {
          await io.write(`MAIL FROM:<${mail.user}>\r\n`);
          await smtpReply(io, 250);
          for (const rcpt of to) {
            await io.write(`RCPT TO:<${rcpt}>\r\n`);
            await smtpReply(io, 250);
          }
          await io.write('DATA\r\n');
          await smtpReply(io, 354);
          // Dot-stuffing: a line starting with "." would otherwise end the message.
          await io.write(raw.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n');
          await smtpReply(io, 250);
          results.push({ ok: true, error: '' });
        } catch (e) {
          if (!(e instanceof MailError) || !e.message.startsWith('SMTP error')) throw e;
          results.push({ ok: false, error: e.message });
          await io.write('RSET\r\n');
          await smtpReply(io, 250);
        }
      }
      await io.write('QUIT\r\n');
    });
  } catch (e) {
    // The connection itself failed: everything not yet sent is a failure.
    const error = e instanceof Error ? e.message : String(e);
    while (results.length < messages.length) results.push({ ok: false, error });
  }
  return results;
}

/** Sends one message; throws if the server won't take it. */
export async function smtpSend(mail, message) {
  const [result] = await smtpSendMany(mail, [message]);
  if (!result.ok) throw new MailError(result.error);
}

/**
 * Builds a UTF-8 message (plain text, plus an HTML alternative when given).
 * Returns { raw, messageId } so the caller can thread later replies.
 */
export function buildMessage({ from, fromName = '', to, subject, text, html = '', inReplyTo = '', references = '' }) {
  const domain = from.split('@')[1] || 'localhost';
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const headers = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${from}>` : from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    // Tells other mail systems not to auto-respond to us.
    'Auto-Submitted: auto-generated',
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references || inReplyTo) headers.push(`References: ${[references, inReplyTo].filter(Boolean).join(' ')}`);

  const part = (type, body) => `Content-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64Text(body))}`;
  // Single-part: the part's own headers simply continue the message headers.
  let body = part('text/plain', text);
  if (html) {
    const boundary = `alt-${crypto.randomUUID()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = `\r\n--${boundary}\r\n${part('text/plain', text)}\r\n--${boundary}\r\n${part('text/html', html)}\r\n--${boundary}--`;
  }
  return { raw: `${headers.join('\r\n')}\r\n${body}`, messageId };
}

export { b64 };
