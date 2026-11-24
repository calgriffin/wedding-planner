-- 0002_guest_portal.sql
-- Additive-only migration for the guest-facing RSVP portal.
--
-- SAFETY CONTRACT (same as every migration in this repo):
--   * Every statement is CREATE TABLE / CREATE INDEX IF NOT EXISTS
--     / ADD COLUMN (idempotent, safe to re-run).
--   * NO drops, NO deletes, NO renames, NO column-type changes.
--   * Existing rows -- tasks, guests, budget, payments, households, your
--     password_hash/auth_secret/initialized flag -- are never modified.
--   * Runs under the same wrangler migrations mechanism as 0001_init.sql.

-- Pretty printed QR codes per household
CREATE TABLE guest_qr_codes (
  household_id TEXT PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  code TEXT NOT NULL,                 -- short human-typable code, e.g. SMITH-7K2Q4
  qr_svg TEXT DEFAULT '',
  qr_payload TEXT DEFAULT '',         -- canonical scan payload (URL without host)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_guest_qr_codes_code ON guest_qr_codes(code);

-- RSVP journey steps so you can see exactly where each household is blocked
CREATE TABLE rsvp_journeys (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  access_code_used INTEGER DEFAULT 0,
  rsvp_started_at TEXT,
  rsvp_submitted_at TEXT,
  dietary_sent INTEGER DEFAULT 0,
  travel_seen INTEGER DEFAULT 0,
  details_seen INTEGER DEFAULT 0,
  qr_scanned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- RSVP question bank (couple-configurable, shown on the guest RSVP page)
CREATE TABLE rsvp_questions (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  field_type TEXT DEFAULT 'text',     -- text | textarea | select | radio | checkbox
  options TEXT DEFAULT '[]',          -- JSON array of choices
  required INTEGER DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Answers to custom questions, one row per guest per question
CREATE TABLE rsvp_answers (
  id TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES rsvp_questions(id) ON DELETE CASCADE,
  answer TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_rsvp_answers_guest ON rsvp_answers(guest_id);
CREATE INDEX idx_rsvp_answers_question ON rsvp_answers(question_id);

-- Open/close windows per event for the guest RSVP flow
CREATE TABLE rsvp_event_windows (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,            -- e.g. main_reception
  label TEXT DEFAULT '',
  opens_at TEXT,
  closes_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_rsvp_event_windows_id ON rsvp_event_windows(id);

-- Colour-coded guest tags

-- Colour-coded guest tags (Family / Close friends / VIP / B-list etc)
CREATE TABLE guest_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT 'sage',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE guest_tag_assignments (
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES guest_tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (guest_id, tag_id)
);
CREATE INDEX idx_guest_tag_assignments_tag ON guest_tag_assignments(tag_id);

-- Additive guest columns only (defaults, never destructive)
ALTER TABLE guests ADD COLUMN access_code TEXT;
ALTER TABLE guests ADD COLUMN rsvp_reminded_at TEXT;
ALTER TABLE guests ADD COLUMN dietary_choice TEXT DEFAULT '';
ALTER TABLE guests ADD COLUMN song_request TEXT DEFAULT '';
ALTER TABLE guests ADD COLUMN tags_json TEXT DEFAULT '[]';
