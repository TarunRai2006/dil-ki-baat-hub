-- =============================================================================
-- Dil Ki Baat: moderation audit trail, dashboard analytics, chat moderation and
-- the consented public "whispers" feed.
--
-- Builds on 20261002120000_confession_chat_backend.sql. Non-destructive and
-- re-runnable: functions are CREATE OR REPLACE, triggers are dropped and
-- re-created, no table or row is removed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Audit trail: one row per changed field, with old and new values, written
--    in the same transaction as the change itself (all or nothing).
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS moderation_log_created_at_idx ON public.moderation_log (created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_updated_at_idx ON public.submissions (updated_at DESC);
CREATE INDEX IF NOT EXISTS submissions_intent_idx ON public.submissions (intent);

CREATE OR REPLACE FUNCTION public.admin_update_submission(
  _id uuid,
  _status text DEFAULT NULL,
  _is_featured boolean DEFAULT NULL,
  _is_archived boolean DEFAULT NULL,
  _admin_notes text DEFAULT NULL,
  _deleted boolean DEFAULT NULL
)
RETURNS public.submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prev_row public.submissions;
  next_row public.submissions;
  notes text := CASE WHEN _admin_notes IS NULL THEN NULL ELSE public.clean_text(_admin_notes) END;
  actor uuid := auth.uid();
BEGIN
  PERFORM public.assert_admin();
  IF _status IS NOT NULL AND _status NOT IN ('Pending', 'Reviewed', 'Approved', 'Rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF notes IS NOT NULL AND char_length(notes) > 5000 THEN
    RAISE EXCEPTION 'invalid_notes' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO prev_row FROM public.submissions WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.submissions s SET
    status = coalesce(_status, s.status),
    is_featured = coalesce(_is_featured, s.is_featured),
    is_archived = coalesce(_is_archived, s.is_archived),
    admin_notes = CASE WHEN notes IS NULL THEN s.admin_notes ELSE nullif(notes, '') END,
    deleted_at = CASE WHEN _deleted IS NULL THEN s.deleted_at
                      WHEN _deleted THEN coalesce(s.deleted_at, now())
                      ELSE NULL END,
    reviewed_at = CASE WHEN _status IS NOT NULL AND _status <> s.status THEN now() ELSE s.reviewed_at END,
    reviewed_by = CASE WHEN _status IS NOT NULL AND _status <> s.status THEN actor ELSE s.reviewed_by END
  WHERE s.id = _id
  RETURNING * INTO next_row;

  -- archiving or trashing a confession also closes its live chat
  IF next_row.is_archived OR next_row.deleted_at IS NOT NULL THEN
    UPDATE public.chat_rooms SET status = 'closed' WHERE id = _id AND status = 'open';
  END IF;

  INSERT INTO public.moderation_log (submission_id, actor_id, action, detail)
  SELECT _id, actor, a.action, a.detail
  FROM (VALUES
    (CASE WHEN next_row.status IS DISTINCT FROM prev_row.status THEN 'STATUS_CHANGED' END,
     jsonb_build_object('old', prev_row.status, 'new', next_row.status)),
    (CASE WHEN next_row.is_featured IS DISTINCT FROM prev_row.is_featured
          THEN CASE WHEN next_row.is_featured THEN 'FEATURED' ELSE 'UNFEATURED' END END,
     jsonb_build_object('old', prev_row.is_featured, 'new', next_row.is_featured)),
    (CASE WHEN next_row.is_archived IS DISTINCT FROM prev_row.is_archived
          THEN CASE WHEN next_row.is_archived THEN 'ARCHIVED' ELSE 'RESTORED' END END,
     jsonb_build_object('old', prev_row.is_archived, 'new', next_row.is_archived)),
    (CASE WHEN (next_row.deleted_at IS NULL) IS DISTINCT FROM (prev_row.deleted_at IS NULL)
          THEN CASE WHEN next_row.deleted_at IS NOT NULL THEN 'TRASHED' ELSE 'UNTRASHED' END END,
     jsonb_build_object('old', prev_row.deleted_at IS NOT NULL, 'new', next_row.deleted_at IS NOT NULL)),
    -- the notes themselves stay in the row; the log only records that they changed
    (CASE WHEN next_row.admin_notes IS DISTINCT FROM prev_row.admin_notes THEN 'NOTE_UPDATED' END,
     jsonb_build_object('had_notes', prev_row.admin_notes IS NOT NULL, 'has_notes', next_row.admin_notes IS NOT NULL))
  ) AS a(action, detail)
  WHERE a.action IS NOT NULL;

  RETURN next_row;
END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_update_submission(uuid, text, boolean, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_submission(uuid, text, boolean, boolean, text, boolean) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Dashboard analytics, aggregated in the database in one round trip.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  today_start timestamptz := date_trunc('day', now());
  week_start timestamptz := now() - interval '7 days';
BEGIN
  PERFORM public.assert_admin();
  SELECT jsonb_build_object(
    'total', count(*) FILTER (WHERE deleted_at IS NULL),
    'pending', count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_archived AND status = 'Pending'),
    'reviewed', count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_archived AND status = 'Reviewed'),
    'approved', count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_archived AND status = 'Approved'),
    'rejected', count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_archived AND status = 'Rejected'),
    'archived', count(*) FILTER (WHERE deleted_at IS NULL AND is_archived),
    'featured', count(*) FILTER (WHERE deleted_at IS NULL AND is_featured),
    'trashed', count(*) FILTER (WHERE deleted_at IS NOT NULL),
    'today', count(*) FILTER (WHERE deleted_at IS NULL AND created_at >= today_start),
    'week', count(*) FILTER (WHERE deleted_at IS NULL AND created_at >= week_start),
    'pulse', round(avg(emotional_state) FILTER (WHERE deleted_at IS NULL), 2),
    'live_chats', (SELECT count(*) FROM public.chat_rooms r WHERE public.room_is_live(r)),
    'moods', (
      SELECT jsonb_agg(jsonb_build_object('mood', m, 'count', (
        SELECT count(*) FROM public.submissions s3 WHERE s3.deleted_at IS NULL AND s3.emotional_state = m
      )) ORDER BY m)
      FROM generate_series(1, 5) m
    ),
    'categories', coalesce((
      SELECT jsonb_agg(jsonb_build_object('name', c.name, 'count', c.n) ORDER BY c.n DESC)
      FROM (
        SELECT btrim(part) AS name, count(*) AS n
        FROM public.submissions s2, unnest(string_to_array(s2.category, ',')) part
        WHERE s2.deleted_at IS NULL
        GROUP BY btrim(part)
      ) c
    ), '[]'::jsonb)
  ) INTO result
  FROM public.submissions;
  RETURN result;
END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. Chat moderation: hide / unhide a message. Hidden messages disappear from
--    the anonymous holder's view (get_room_messages already filters them) and a
--    content-free signal tells their open chat to drop it immediately.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_message_hidden(_message_id uuid, _hidden boolean)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg public.chat_messages;
BEGIN
  PERFORM public.assert_admin();
  IF _hidden IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  UPDATE public.chat_messages SET is_hidden = _hidden WHERE id = _message_id RETURNING * INTO msg;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN msg;
END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_message_hidden(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_message_hidden(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_messages_after_hide()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hash text;
BEGIN
  SELECT token_hash INTO hash FROM public.chat_rooms WHERE id = NEW.room_id;
  IF hash IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object('id', NEW.id, 'hidden', NEW.is_hidden),
        'moderated',
        public.room_topic(hash),
        false
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS chat_messages_moderated ON public.chat_messages;
CREATE TRIGGER chat_messages_moderated
  AFTER UPDATE OF is_hidden ON public.chat_messages
  FOR EACH ROW WHEN (OLD.is_hidden IS DISTINCT FROM NEW.is_hidden)
  EXECUTE FUNCTION public.chat_messages_after_hide();

-- room status changes (closed by a mentor) also reach the anonymous holder
CREATE OR REPLACE FUNCTION public.chat_rooms_after_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.token_hash IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(
        jsonb_build_object('status', NEW.status),
        'room',
        public.room_topic(NEW.token_hash),
        false
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS chat_rooms_status_signal ON public.chat_rooms;
CREATE TRIGGER chat_rooms_status_signal
  AFTER UPDATE OF status ON public.chat_rooms
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.chat_rooms_after_status();

-- -----------------------------------------------------------------------------
-- 4. Public whispers: the only confession text anyone outside the team can
--    read. All three must hold: the writer said "Yes" to anonymous sharing, a
--    mentor approved it, and a mentor featured it. Only a short excerpt of the
--    words leaves the database: no id, nickname, alias, question or dates.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_public_whispers(_limit integer DEFAULT 12)
RETURNS TABLE (excerpt text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN char_length(c) > 140 THEN left(c, 137) || '…' ELSE c END
  FROM (
    SELECT regexp_replace(s.content, '[[:space:]]+', ' ', 'g') AS c, s.updated_at
    FROM public.submissions s
    WHERE s.highlight_on_instagram = 'Yes'
      AND s.status = 'Approved'
      AND s.is_featured
      AND NOT s.is_archived
      AND s.deleted_at IS NULL
    ORDER BY s.updated_at DESC
    LIMIT least(greatest(coalesce(_limit, 12), 1), 30)
  ) w
$$;
REVOKE EXECUTE ON FUNCTION public.get_public_whispers(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_whispers(integer) TO anon, authenticated;

-- internal helpers that should never be callable from the API
REVOKE EXECUTE ON FUNCTION public.room_is_live(public.chat_rooms) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.room_topic(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clean_text(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
