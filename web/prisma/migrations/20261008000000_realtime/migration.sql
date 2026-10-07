-- Realtime (hyperagent-0z7.3): row changes ping a private per-board channel so
-- open boards refresh at once. The topic is 'board:' || sha256(board id); the
-- board id itself never reaches the browser. Only signed-in board members
-- (private.is_board_member's rule) may join, through RLS on realtime.messages.

CREATE OR REPLACE FUNCTION private.board_topic(ws uuid) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'board:' || encode(sha256(convert_to(ws::text, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION private.can_use_board_topic(topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.phab_board_members m
    JOIN public.phab_share_codes s ON s.code = m.code
    WHERE m.sub = (SELECT auth.uid())::text AND private.board_topic(s.workspace_id) = topic
  )
$$;

REVOKE ALL ON FUNCTION private.board_topic(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_use_board_topic(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.board_topic(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_use_board_topic(text) TO authenticated;

-- A failed ping must never fail the write that caused it.
CREATE OR REPLACE FUNCTION private.ping_board() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ws uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
BEGIN
  BEGIN
    PERFORM realtime.send(jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP), 'board-changed', private.board_topic(ws), true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NULL;
END $$;

CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.phab_canvas_stacks FOR EACH ROW EXECUTE FUNCTION private.ping_board();
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.phab_canvas_notes FOR EACH ROW EXECUTE FUNCTION private.ping_board();
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.phab_canvas_layout FOR EACH ROW EXECUTE FUNCTION private.ping_board();
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.phab_chat_messages FOR EACH ROW EXECUTE FUNCTION private.ping_board();
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.phab_canvas_browsers FOR EACH ROW EXECUTE FUNCTION private.ping_board();
CREATE TRIGGER board_ping AFTER INSERT OR UPDATE OR DELETE ON public.phab_plans FOR EACH ROW EXECUTE FUNCTION private.ping_board();
-- Jobs ping only when created, removed or their status changes, not on every heartbeat.
CREATE TRIGGER board_ping AFTER INSERT OR DELETE OR UPDATE OF status ON public.phab_canvas_jobs FOR EACH ROW EXECUTE FUNCTION private.ping_board();

CREATE POLICY board_member_receive ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.messages.extension IN ('broadcast', 'presence') AND (SELECT private.can_use_board_topic((SELECT realtime.topic()))));
CREATE POLICY board_member_send ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (realtime.messages.extension IN ('broadcast', 'presence') AND (SELECT private.can_use_board_topic((SELECT realtime.topic()))));
