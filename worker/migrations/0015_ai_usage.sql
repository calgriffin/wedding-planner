-- 0015: AI usage + cost log (additive-only).
--
-- One row per model run: an in-app chat reply, a check-in, an email the
-- assistant handled, a morning brief. Tokens are split the way Anthropic
-- bills them (uncached input, cache writes, cache reads, output); the cost
-- is worked out when the report is read (src/ai-usage.js), so a price
-- change only needs a code change, not a data fix.
--
-- (source, ref) is unique: ref is the chat message / email row id, so the
-- backfill below can be re-run safely and never double-counts.

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source TEXT NOT NULL,                       -- 'chat' | 'checkin' | 'email' | 'brief'
  ref TEXT NOT NULL,                          -- chat message id / assistant_messages id / random
  model TEXT NOT NULL DEFAULT '',             -- '' = not recorded (backfilled history)
  actor_email TEXT NOT NULL DEFAULT '',       -- who it was for, when known
  input_tokens INTEGER NOT NULL DEFAULT 0,    -- uncached input
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_usage_source_ref ON ai_usage(source, ref);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);

-- Backfill from the token counts already stored. These were saved as one
-- input total (cache reads and writes included), so history is costed at the
-- full input price: an upper estimate.
INSERT OR IGNORE INTO ai_usage (id, created_at, source, ref, model, actor_email, input_tokens, output_tokens)
  SELECT lower(hex(randomblob(16))), created_at, 'email', id, '', from_email, input_tokens, output_tokens
  FROM assistant_messages WHERE input_tokens > 0 OR output_tokens > 0;

INSERT OR IGNORE INTO ai_usage (id, created_at, source, ref, model, actor_email, input_tokens, output_tokens)
  SELECT lower(hex(randomblob(16))), m.created_at,
         CASE WHEN c.kind = 'checkin' THEN 'checkin' ELSE 'chat' END,
         m.id, '', '', m.input_tokens, m.output_tokens
  FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
  WHERE m.role = 'assistant' AND (m.input_tokens > 0 OR m.output_tokens > 0);
