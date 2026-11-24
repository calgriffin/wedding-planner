-- 0011: Email assistant (additive-only).
--
-- The assistant reads its own mailbox, acts on emails from the couple and
-- replies to them. Mailbox credentials and the model API key are Worker
-- secrets — never in schema, settings or this repo.
--
-- assistant_messages: one row per email handled (or deliberately ignored),
--   plus one per daily brief sent, so a reply can be matched to its thread.
-- assistant_pending:  changes that need a "yes" from the couple first
--   (marking payments paid, deletions, master settings).

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'inbound',     -- 'inbound' | 'brief'
  message_id TEXT NOT NULL DEFAULT '',      -- Message-ID of the email received
  thread_id TEXT NOT NULL DEFAULT '',       -- id of the first row in the conversation
  from_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_excerpt TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'direct',      -- 'direct' (reply on the thread) | 'copied' (cc/bcc with others: separate note to the couple)
  status TEXT NOT NULL DEFAULT 'processing',-- 'processing' | 'done' | 'ignored' | 'failed'
  reason TEXT NOT NULL DEFAULT '',          -- why it was ignored / what failed
  reply_text TEXT NOT NULL DEFAULT '',
  reply_message_id TEXT NOT NULL DEFAULT '',-- Message-ID of what we sent
  actions TEXT NOT NULL DEFAULT '[]',       -- JSON: planner changes made
  attempts INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  dry_run INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_message ON assistant_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_reply ON assistant_messages(reply_message_id);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread ON assistant_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_created ON assistant_messages(created_at);

CREATE TABLE IF NOT EXISTS assistant_pending (
  code TEXT PRIMARY KEY,                    -- short code quoted in the reply
  thread_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '{}',          -- JSON
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'confirmed' | 'cancelled'
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_assistant_pending_thread ON assistant_pending(thread_id, status);
