-- Family payment portal (additive only).
--
-- Each payment can be hidden from the read-only family portal
-- (family.<apex>, behind Cloudflare Access). Defaults to visible so the
-- portal shows the full "what's due next" plan out of the box; the couple
-- untick "Show on family portal" for anything private.
--
-- Pure addition: one INTEGER column with a default. No existing row is
-- touched and no existing behaviour changes.
ALTER TABLE payments ADD COLUMN family_visible INTEGER DEFAULT 1;
