-- Plus-ones the guest adds themselves (additive only).
--
-- Until now a plus-one had to be a named guest row the couple created. These
-- two columns let the couple offer a guest a plus-one WITHOUT a name: the
-- guest adds the person on their RSVP, which creates the usual guest row
-- linked by plus_one_of.
--
--   plus_one_allowed   1 = this guest is offered a plus-one on the RSVP form.
--   plus_one_response  '' = not answered yet, 'accepted' = bringing someone,
--                      'declined' = not bringing anyone.
--
-- An offered plus-one that has not been answered (and has no linked guest
-- row) has no row of its own, but is counted in the headcounts until the
-- host RSVPs.
--
-- Pure addition: two columns with defaults. No existing row changes.
ALTER TABLE guests ADD COLUMN plus_one_allowed INTEGER DEFAULT 0;
ALTER TABLE guests ADD COLUMN plus_one_response TEXT DEFAULT '';
