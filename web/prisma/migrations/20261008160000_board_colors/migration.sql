-- Stable display colors for people and agents on a board.
-- Expand-only: add the nullable column where it is missing. No drops, no rewrites.
ALTER TABLE phab_board_members ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE phab_board_agents ADD COLUMN IF NOT EXISTS color text;
