-- 0014: In-app assistant chat + push notifications (additive-only).
--
-- The planner's assistant (the same Claude model and API key as the email
-- assistant) also answers in the app. Every chat is shared: both partners see
-- every conversation and every message, labelled with who wrote it.
--
-- chat_conversations: one row per chat. kind 'chat' (started by one of the
--   couple), 'checkin' (questions the assistant raised by itself, daily or
--   the one-off launch review) or 'email' (questions from the email
--   assistant, source_ref = the email thread id).
-- chat_messages: role 'user' (one of the couple), 'assistant' or 'event'
--   (a note such as "confirmed: …"). questions is a JSON list of questions
--   the assistant asked in that message, each with its answer once given.
-- chat_pending: changes that wait for a Confirm button press (marking
--   payments paid, deletions, master settings), as in assistant_pending.
-- chat_reads: when each partner last opened each chat (unread badges).
-- push_subscriptions: Web Push endpoints, one per device that turned
--   notifications on. The endpoint + keys are the device's own; the VAPID
--   signing key lives in settings (push_vapid, excluded from the backup).
-- chat_email_notices: when an email notification for a chat last went to
--   someone without push, so chat activity emails are throttled.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'chat',          -- 'chat' | 'checkin' | 'email'
  source_ref TEXT NOT NULL DEFAULT '',        -- email thread id / check-in date
  created_by TEXT NOT NULL DEFAULT '',        -- email of whoever started it ('' = assistant or unknown)
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON chat_conversations(archived, updated_at);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_source ON chat_conversations(kind, source_ref);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- 'user' | 'assistant' | 'event'
  author_email TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done',        -- 'done' | 'thinking' | 'failed'
  reason TEXT NOT NULL DEFAULT '',            -- what failed
  actions TEXT NOT NULL DEFAULT '[]',         -- JSON: planner changes made
  attachments TEXT NOT NULL DEFAULT '[]',     -- JSON: file names only (files are never stored)
  questions TEXT NOT NULL DEFAULT '[]',       -- JSON: [{ id, question, options, answer, answered_by, answered_at }]
  reply_to TEXT NOT NULL DEFAULT '',          -- JSON { message_id, question_id, question } when answering a question
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  dry_run INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(role, created_at);

CREATE TABLE IF NOT EXISTS chat_pending (
  code TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',        -- the assistant message that proposed it
  tool TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '{}',            -- JSON
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'confirmed' | 'cancelled' | 'failed'
  result TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_pending_conversation ON chat_pending(conversation_id, status);

CREATE TABLE IF NOT EXISTS chat_reads (
  email TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (email, conversation_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',             -- the partner signed in when it was turned on ('' in password mode)
  device_id TEXT NOT NULL DEFAULT '',         -- random id the browser keeps, so a device isn't pinged about its own messages
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_success_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_email ON push_subscriptions(email);

CREATE TABLE IF NOT EXISTS chat_email_notices (
  email TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (email, conversation_id)
);
