-- 0003_master_timeline.sql
-- Additive-only migration for the Master Timeline (calendar) feature.
--
-- SAFETY CONTRACT (same as every migration in this repo):
--   * Every statement is CREATE TABLE / CREATE INDEX IF NOT EXISTS or
--     ADD COLUMN (idempotent where possible, safe).
--   * NO drops, NO deletes, NO renames, NO column-type changes.
--   * Existing rows -- tasks, guests, budget, payments, households, suppliers,
--     events, decisions, auth settings -- are never modified.
--   * Everything here is pure addition: new tables/columns only.

-- Couple-managed appointments (dress fittings, tastings, venue walkthroughs,
-- registrar meetings, etc.) shown on the Master Timeline calendar.
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,          -- ISO date YYYY-MM-DD (calendar day)
  time TEXT,                   -- HH:MM optional
  location TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);

-- Supplier "confirm by / decision deadline" date, surfaced on the Master
-- Timeline (e.g. when a quote expires or a decision must be made).
ALTER TABLE suppliers ADD COLUMN deadline TEXT;