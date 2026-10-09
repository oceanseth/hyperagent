-- Palette colors are assigned in application code. An omitted agent color
-- must land as NULL. The original column is text NOT NULL DEFAULT '', and
-- ADD COLUMN IF NOT EXISTS cannot change that, so this migration relaxes it
-- in place. Real #RRGGBB values stay. Empty strings become unassigned.
-- Expand-only and idempotent: no rewrite, no drop, no rename.
-- Members did not have a color column on origin/dev (20261008160000 is not
-- on this branch and is left untouched). Add the nullable column here.

ALTER TABLE phab_board_members ADD COLUMN IF NOT EXISTS color text;

ALTER TABLE phab_board_agents ALTER COLUMN color DROP NOT NULL;
ALTER TABLE phab_board_agents ALTER COLUMN color DROP DEFAULT;

UPDATE phab_board_agents SET color = NULL WHERE color = '';
