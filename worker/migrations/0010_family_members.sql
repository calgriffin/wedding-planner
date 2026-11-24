-- Family access list (additive only).
--
-- The email addresses of family who may open the read-only family portal
-- (family.<apex>). The couple manage the list from the plan portal; the
-- Worker mirrors it into the Cloudflare Access "Family" policy and also
-- checks it itself on every family-host request (see src/family-access.js).
-- The couple's own addresses are NOT stored here — they come from the plan's
-- email settings and are always allowed.
--
-- Pure addition: one new table. No existing row or behaviour changes.
CREATE TABLE IF NOT EXISTS family_members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE, -- always stored trimmed + lower-cased
  label TEXT,
  created_at TEXT NOT NULL
);
