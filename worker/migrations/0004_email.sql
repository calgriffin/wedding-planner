-- 0004: Email campaigns + per-recipient send log (additive-only).
--
-- Nothing existing is altered. Email configuration (provider API key, from
-- address, couple email, digest schedule, simulation flag) is stored in the
-- settings table (key/value) — never in schema and never in this repo.
--
-- email_campaigns: one row per composed send (digest to the couple, a guest
-- campaign, or an RSVP reminder run).
-- email_log:        one row per recipient email actually sent (or simulated).
--   dry_run (email_dry_run setting) marks simulated sends: provider_id = 'dry-*'
--   so the couple can try the whole flow without a real API key.

CREATE TABLE IF NOT EXISTS email_campaigns (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                       -- 'couple_reminder' | 'guest_campaign' | 'rsvp_reminder'
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',            -- template, may contain {name} / {code}
  audience TEXT NOT NULL DEFAULT '',        -- 'all' | 'unresponded' | 'confirmed' | 'declined' | 'household' | 'self'
  household_id TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent',      -- 'sent' | 'partial' | 'failed'
  error TEXT NOT NULL DEFAULT '',
  dry_run INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_sent ON email_campaigns(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_kind ON email_campaigns(kind);

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,                      -- provider message id (or 'dry-*' in simulation)
  campaign_id TEXT REFERENCES email_campaigns(id),
  to_email TEXT NOT NULL,
  to_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',      -- 'sent' | 'failed'
  provider_id TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_email_log_campaign ON email_log(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_log_email ON email_log(to_email);