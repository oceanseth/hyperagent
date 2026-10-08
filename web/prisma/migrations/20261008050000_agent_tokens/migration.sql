-- Outside agents connect to one board over MCP with a bearer token
-- (`hak_<secret>`). Only the SHA-256 of the secret is stored; the token is
-- shown once at creation and revoking sets revoked_at instead of deleting,
-- so the board keeps the agent's name and color for attribution.
-- Expand-only and idempotent: safe to apply ahead of the code that uses it.
CREATE TABLE IF NOT EXISTS phab_board_agents (
  id           uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '',
  token_hash   text NOT NULL,
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS phab_board_agents_token_hash_key ON phab_board_agents (token_hash);
CREATE INDEX IF NOT EXISTS phab_board_agents_workspace_idx ON phab_board_agents (workspace_id);

-- Token hashes must never reach the Data API or Realtime: RLS on, no policies,
-- so the table stays server-only (Prisma connects as the owner and bypasses RLS).
ALTER TABLE phab_board_agents ENABLE ROW LEVEL SECURITY;
