-- Room-plan seating layout (Deploy C).
-- Additive only: never touches guest/RSVP rows.
-- Tables get on-canvas positions for the visual room plan; room dimensions
-- are stored in the settings table (seating_room_w / seating_room_h) so no
-- schema change is needed for the room itself.
ALTER TABLE tables ADD COLUMN pos_x INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN pos_y INTEGER NOT NULL DEFAULT 0;