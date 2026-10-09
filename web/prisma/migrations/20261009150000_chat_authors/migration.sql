-- Expand-only chat attribution. Existing rows stay NULL and render as
-- someone. Columns are nullable and have no default, so Postgres does not
-- rewrite the table. author_kind is human, agent, or phab.

ALTER TABLE phab_chat_messages ADD COLUMN IF NOT EXISTS author_id text;
ALTER TABLE phab_chat_messages ADD COLUMN IF NOT EXISTS author_name text;
ALTER TABLE phab_chat_messages ADD COLUMN IF NOT EXISTS author_kind text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phab_chat_messages_author_kind_check'
      AND conrelid = 'public.phab_chat_messages'::regclass
  ) THEN
    ALTER TABLE phab_chat_messages
      ADD CONSTRAINT phab_chat_messages_author_kind_check
      CHECK (author_kind IS NULL OR author_kind IN ('human', 'agent', 'phab')) NOT VALID;
  END IF;
END $$;

ALTER TABLE phab_chat_messages VALIDATE CONSTRAINT phab_chat_messages_author_kind_check;
