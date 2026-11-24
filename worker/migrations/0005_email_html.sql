-- 0005: Store rendered HTML alongside campaign plain text (additive-only).
--
-- Newer emails are styled HTML (brand shell, RSVP buttons, KPI digest cards)
-- with a plain-text fallback on every send. This column keeps a rendered
-- snapshot per campaign so Send History can show exactly what went out.
-- The plain `body` column still holds the template source. Existing rows get
-- an empty default; nothing existing is altered.

ALTER TABLE email_campaigns ADD COLUMN body_html TEXT NOT NULL DEFAULT '';