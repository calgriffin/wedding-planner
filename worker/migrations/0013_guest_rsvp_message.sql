-- A guest's own message from the RSVP form (additive only).
--
-- Until now the RSVP form's free-text box read and wrote guests.notes, which
-- is the couple's private note about the guest: guests could see it, and
-- whatever they typed replaced it. guests.notes is now plan-only, and the
-- guest's message lives here.
--
-- Pure addition: one column with a default. No existing row changes.
ALTER TABLE guests ADD COLUMN rsvp_message TEXT DEFAULT '';
