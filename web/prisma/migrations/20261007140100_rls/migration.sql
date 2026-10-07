-- Member SELECT policies for the Data API and Realtime.
-- Prisma connects as the table owner and bypasses these (RLS is not FORCE).
-- Table names stay unqualified so the migration also applies in a non-public schema.
-- The helper is schema-qualified and pinned to public, which is what auth.uid() checks.

SET LOCAL check_function_bodies = off;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_board_member(ws uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.phab_share_codes s
    JOIN public.phab_board_members m ON m.code = s.code
    WHERE s.workspace_id = ws
      AND m.sub = (SELECT auth.uid())::text
  );
$$;

REVOKE ALL ON FUNCTION private.is_board_member(uuid) FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_board_member(uuid) TO authenticated;

ALTER TABLE phab_canvas_stacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_canvas_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_canvas_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_canvas_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_share_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_board_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_canvas_browsers ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_published_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE phab_workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE _prisma_migrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_select ON phab_canvas_stacks FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY member_select ON phab_canvas_jobs FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY member_select ON phab_job_events FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY member_select ON phab_chat_messages FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY member_select ON phab_canvas_notes FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY member_select ON phab_canvas_layout FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY member_select ON phab_canvas_browsers FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY member_select ON phab_plans FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY member_select ON phab_share_codes FOR SELECT TO authenticated USING ((SELECT private.is_board_member(workspace_id)));
CREATE POLICY self_select ON phab_board_members FOR SELECT TO authenticated USING (sub = (SELECT auth.uid())::text);

GRANT SELECT ON TABLE
  phab_canvas_stacks,
  phab_canvas_jobs,
  phab_job_events,
  phab_chat_messages,
  phab_canvas_notes,
  phab_canvas_layout,
  phab_share_codes,
  phab_board_members,
  phab_canvas_browsers,
  phab_plans,
  phab_published_plans,
  phab_payment_methods,
  phab_workspace_settings,
  _prisma_migrations
TO authenticated, anon;
