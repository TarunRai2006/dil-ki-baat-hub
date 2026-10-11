-- =============================================================================
-- Dil Ki Baat: hardening found during the production audit.
--
--   1. Idempotency race: two requests with the same client id arriving at the
--      same time (a timeout retry overlapping the original) could both miss the
--      "already stored?" check; the second then failed on the unique index and
--      the visitor saw an error although their words were saved. Same window
--      for chat messages. Fixed with a transaction-scoped advisory lock per id.
--   2. Rate-limit key: prefer headers set by the edge over the client-settable
--      left-most X-Forwarded-For entry.
--   3. Long rooms: the widget loaded the OLDEST 500 messages; now the newest.
--   4. Message order: messages written in the same instant tied on created_at
--      and fell back to a random uuid, and the "newer than" cursor could skip a
--      message sharing the last-seen timestamp. Insertion order (seq) now breaks
--      ties and the cursor is inclusive.
--   5. Supporting indexes for the admin room list and room history.
--
-- Function bodies are the reviewed ones from 20261002120000 with only these
-- edits. Non-destructive and re-runnable.
-- =============================================================================

-- monotonic insertion order; existing rows are numbered when the column is added
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX IF NOT EXISTS chat_messages_room_order_idx ON public.chat_messages (room_id, created_at, seq);

CREATE OR REPLACE FUNCTION public.request_fingerprint()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  headers json;
  ip text;
BEGIN
  BEGIN
    headers := nullif(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN others THEN
    headers := NULL;
  END;
  -- headers the edge sets itself first; the left-most x-forwarded-for entry can
  -- be supplied by the client, so it is only the last resort
  ip := coalesce(
    nullif(btrim(headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(headers ->> 'x-real-ip'), ''),
    split_part(headers ->> 'x-forwarded-for', ',', 1)
  );
  IF ip IS NULL OR btrim(ip) = '' THEN
    RETURN NULL;
  END IF;
  RETURN encode(extensions.digest(btrim(ip), 'sha256'), 'hex');
END
$$;
REVOKE EXECUTE ON FUNCTION public.request_fingerprint() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_confession(
  _content text,
  _category text,
  _intent text,
  _emotional_state integer,
  _community_question text,
  _highlight_on_instagram text,
  _nickname text,
  _chat_enabled boolean,
  _chat_ttl text,
  _anon_user_id text,
  _client_request_id uuid
)
RETURNS TABLE (submission_id uuid, alias text, room_id uuid, room_token text, room_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_categories text[] := ARRAY['Relationship','Career','Family','Anxiety','Self thoughts','Social taboos','Confusion','Other'];
  content text := public.clean_text(_content);
  question text := nullif(public.clean_text(_community_question), '');
  nick text := nullif(public.clean_text(_nickname), '');
  anon_id text := nullif(btrim(coalesce(_anon_user_id, '')), '');
  cat text;
  parts text[];
  existing public.submissions;
  new_id uuid;
  new_alias text;
  token text;
  expires timestamptz;
  fp text := public.request_fingerprint();
BEGIN
  IF _client_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  -- serialise concurrent requests carrying the same id (a retry racing the
  -- original): the second waits here, then takes the replay path below
  PERFORM pg_advisory_xact_lock(hashtextextended('submit:' || _client_request_id::text, 0));

  -- idempotency: a retried or double-clicked request returns the original row
  SELECT * INTO existing FROM public.submissions s WHERE s.client_request_id = _client_request_id;
  IF FOUND THEN
    token := NULL;
    IF existing.chat_enabled THEN
      -- the original token was never stored; rotate it for the same requester
      token := encode(extensions.gen_random_bytes(24), 'hex');
      UPDATE public.chat_rooms
      SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
      WHERE id = existing.id;
    END IF;
    RETURN QUERY
      SELECT existing.id, existing.alias,
             CASE WHEN existing.chat_enabled THEN existing.id END,
             token,
             (SELECT r.expires_at FROM public.chat_rooms r WHERE r.id = existing.id);
    RETURN;
  END IF;

  -- validation (the client validates for UX; this is the real boundary)
  IF char_length(content) < 10 OR char_length(content) > 2000 THEN
    RAISE EXCEPTION 'invalid_content' USING ERRCODE = '22023';
  END IF;
  parts := string_to_array(coalesce(_category, ''), ',');
  IF array_length(parts, 1) IS NULL OR array_length(parts, 1) > 4 THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  FOREACH cat IN ARRAY parts LOOP
    IF NOT (btrim(cat) = ANY (allowed_categories)) THEN
      RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF _intent IS NULL OR _intent NOT IN ('Advice', 'Express', 'Both') THEN
    RAISE EXCEPTION 'invalid_intent' USING ERRCODE = '22023';
  END IF;
  IF _emotional_state IS NULL OR _emotional_state NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_emotional_state' USING ERRCODE = '22023';
  END IF;
  IF question IS NOT NULL AND char_length(question) > 200 THEN
    RAISE EXCEPTION 'invalid_question' USING ERRCODE = '22023';
  END IF;
  IF _highlight_on_instagram IS NULL OR _highlight_on_instagram NOT IN ('Yes', 'No', 'Maybe') THEN
    RAISE EXCEPTION 'invalid_highlight' USING ERRCODE = '22023';
  END IF;
  IF nick IS NOT NULL AND char_length(nick) > 40 THEN
    RAISE EXCEPTION 'invalid_nickname' USING ERRCODE = '22023';
  END IF;
  IF _chat_enabled IS NULL OR _chat_ttl IS NULL OR _chat_ttl NOT IN ('1h', '24h', 'never') THEN
    RAISE EXCEPTION 'invalid_chat' USING ERRCODE = '22023';
  END IF;
  IF anon_id IS NOT NULL AND char_length(anon_id) > 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  -- abuse protection: per network address and per browser
  IF fp IS NOT NULL THEN
    PERFORM public.hit_rate_limit('submit:ip:' || fp, 5, interval '10 minutes');
    PERFORM public.hit_rate_limit('submit:ip-day:' || fp, 30, interval '1 day');
  END IF;
  IF anon_id IS NOT NULL THEN
    PERFORM public.hit_rate_limit('submit:anon:' || anon_id, 5, interval '10 minutes');
  END IF;

  INSERT INTO public.submissions (
    content, category, intent, emotional_state, community_question,
    highlight_on_instagram, nickname, anon_user_id, chat_enabled, chat_ttl,
    status, client_request_id
  ) VALUES (
    content,
    array_to_string(ARRAY(SELECT btrim(p) FROM unnest(parts) p), ', '),
    _intent, _emotional_state, question,
    _highlight_on_instagram, nick, anon_id, _chat_enabled, _chat_ttl,
    'Pending', _client_request_id
  )
  RETURNING id, submissions.alias INTO new_id, new_alias;

  IF _chat_enabled THEN
    token := encode(extensions.gen_random_bytes(24), 'hex');
    expires := CASE _chat_ttl
      WHEN '1h' THEN now() + interval '1 hour'
      WHEN '24h' THEN now() + interval '24 hours'
      ELSE NULL
    END;
    INSERT INTO public.chat_rooms (id, expires_at, token_hash)
    VALUES (new_id, expires, encode(extensions.digest(token, 'sha256'), 'hex'));
  END IF;

  RETURN QUERY SELECT new_id, new_alias, CASE WHEN _chat_enabled THEN new_id END, token, expires;
END
$$;
REVOKE EXECUTE ON FUNCTION public.submit_confession(text, text, text, integer, text, text, text, boolean, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_confession(text, text, text, integer, text, text, text, boolean, text, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_chat_message(_room_id uuid, _token text, _message text, _client_msg_id uuid)
RETURNS TABLE (id uuid, sender_type text, message text, created_at timestamptz, client_msg_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room public.chat_rooms := public.room_for_token(_room_id, _token);
  fp text := public.request_fingerprint();
BEGIN
  IF _client_msg_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  -- a resend racing the original waits here, then returns the stored row
  PERFORM pg_advisory_xact_lock(hashtextextended('msg:' || _room_id::text || ':' || _client_msg_id::text, 0));
  IF NOT public.room_is_live(room) THEN
    RAISE EXCEPTION 'room_expired' USING ERRCODE = 'P0410';
  END IF;

  -- a resend of the same message returns the stored row instead of duplicating it
  RETURN QUERY
    SELECT m.id, m.sender_type, m.message, m.created_at, m.client_msg_id
    FROM public.chat_messages m
    WHERE m.room_id = room.id AND m.client_msg_id = _client_msg_id;
  IF FOUND THEN
    RETURN;
  END IF;

  PERFORM public.hit_rate_limit('chat:room:' || room.id, 12, interval '1 minute');
  PERFORM public.hit_rate_limit('chat:room-day:' || room.id, 400, interval '1 day');
  IF fp IS NOT NULL THEN
    PERFORM public.hit_rate_limit('chat:ip:' || fp, 30, interval '1 minute');
  END IF;

  RETURN QUERY
    INSERT INTO public.chat_messages AS m (room_id, sender_type, message, client_msg_id)
    VALUES (room.id, 'user', coalesce(_message, ''), _client_msg_id)
    RETURNING m.id, m.sender_type, m.message, m.created_at, m.client_msg_id;
END
$$;
REVOKE EXECUTE ON FUNCTION public.send_chat_message(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid, text, text, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_send_chat_message(_room_id uuid, _message text, _client_msg_id uuid)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg public.chat_messages;
BEGIN
  PERFORM public.assert_admin();
  IF _client_msg_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('msg:' || _room_id::text || ':' || _client_msg_id::text, 0));
    SELECT * INTO msg FROM public.chat_messages m WHERE m.room_id = _room_id AND m.client_msg_id = _client_msg_id;
    IF FOUND THEN
      RETURN msg;
    END IF;
  END IF;
  INSERT INTO public.chat_messages (room_id, sender_type, message, client_msg_id)
  VALUES (_room_id, 'admin', coalesce(_message, ''), _client_msg_id)
  RETURNING * INTO msg;
  RETURN msg;
END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_send_chat_message(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_chat_message(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_room_messages(_room_id uuid, _token text, _after timestamptz DEFAULT NULL)
RETURNS TABLE (id uuid, sender_type text, message text, created_at timestamptz, client_msg_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room public.chat_rooms := public.room_for_token(_room_id, _token);
BEGIN
  IF NOT public.room_is_live(room) THEN
    RAISE EXCEPTION 'room_expired' USING ERRCODE = 'P0410';
  END IF;
  -- the most recent 500 (older history beyond that is not needed in the
  -- widget), returned oldest first. The _after cursor is inclusive so a
  -- message sharing the last-seen timestamp is never skipped (clients
  -- de-duplicate by id); insertion order (seq) breaks timestamp ties.
  RETURN QUERY
    SELECT w.id, w.sender_type, w.message, w.created_at, w.client_msg_id
    FROM (
      SELECT m.id, m.sender_type, m.message, m.created_at, m.client_msg_id, m.seq
      FROM public.chat_messages m
      WHERE m.room_id = room.id
        AND NOT m.is_hidden
        AND (_after IS NULL OR m.created_at >= _after)
      ORDER BY m.created_at DESC, m.seq DESC
      LIMIT 500
    ) w
    ORDER BY w.created_at ASC, w.seq ASC;
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_room_messages(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_messages(uuid, text, timestamptz) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS chat_rooms_last_message_idx ON public.chat_rooms (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS chat_messages_room_created_desc_idx ON public.chat_messages (room_id, created_at DESC);
