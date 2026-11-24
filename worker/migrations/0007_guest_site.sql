-- 0007_guest_site.sql
-- Guest-facing website content (v3 RSVP site) — additive only.
-- Events gain public-presentation fields: only rows explicitly marked
-- guest_visible appear on the guest website; start/end times and the
-- guest-facing description are new, optional columns. Nothing existing is
-- altered; no rows are touched. After applying to live D1 out-of-band, also
-- INSERT the d1_migrations bookkeeping row (protocol documented in the
-- handoff, 2026-09-25).
ALTER TABLE events ADD COLUMN guest_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN start_time TEXT DEFAULT '';
ALTER TABLE events ADD COLUMN end_time TEXT DEFAULT '';
ALTER TABLE events ADD COLUMN guest_description TEXT DEFAULT '';