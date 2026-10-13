-- A browser with an open anonymous room cannot create another submission.
-- The browser id is client generated, so this is a per-browser guard, not an
-- identity claim. A room token is still required for every chat operation.
CREATE INDEX IF NOT EXISTS submissions_chat_anon_idx
  ON public.submissions (anon_user_id)
  WHERE chat_enabled AND anon_user_id IS NOT NULL;

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
  existing_room public.chat_rooms;
  new_id uuid;
  new_alias text;
  token text;
  expires timestamptz;
  fp text := public.request_fingerprint();
BEGIN
  IF _client_request_id IS NULL OR anon_id IS NULL OR char_length(anon_id) > 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  -- Serialise all submissions for this browser as well as retries of one
  -- request. The room guard below is then safe from concurrent submissions.
  PERFORM pg_advisory_xact_lock(hashtextextended('submit-browser:' || anon_id, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('submit:' || _client_request_id::text, 0));

  SELECT * INTO existing FROM public.submissions s WHERE s.client_request_id = _client_request_id;
  IF FOUND THEN
    -- A request id is not a room token. Never rotate a token for a different
    -- browser id or different story that happens to reuse that id.
    IF existing.anon_user_id IS DISTINCT FROM anon_id OR existing.content IS DISTINCT FROM content THEN
      RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
    END IF;
    token := NULL;
    IF existing.chat_enabled THEN
      SELECT * INTO existing_room FROM public.chat_rooms r WHERE r.id = existing.id FOR UPDATE;
      IF FOUND AND public.room_is_live(existing_room) THEN
        token := encode(extensions.gen_random_bytes(24), 'hex');
        UPDATE public.chat_rooms
        SET token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
        WHERE id = existing.id;
      END IF;
    END IF;
    RETURN QUERY
      SELECT existing.id, existing.alias,
             CASE WHEN token IS NOT NULL THEN existing.id END,
             token, existing_room.expires_at;
    RETURN;
  END IF;

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

  IF EXISTS (
    SELECT 1 FROM public.submissions s
    JOIN public.chat_rooms r ON r.id = s.id
    WHERE s.anon_user_id = anon_id AND public.room_is_live(r)
  ) THEN
    RAISE EXCEPTION 'active_chat_exists' USING ERRCODE = 'P0409';
  END IF;

  IF fp IS NOT NULL THEN
    PERFORM public.hit_rate_limit('submit:ip:' || fp, 5, interval '10 minutes');
    PERFORM public.hit_rate_limit('submit:ip-day:' || fp, 30, interval '1 day');
  END IF;
  PERFORM public.hit_rate_limit('submit:anon:' || anon_id, 5, interval '10 minutes');

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

-- Closing a room deletes its messages in the live database, no matter whether
-- the visitor or a mentor closes it. The original submission remains for
-- moderation and follows its separate retention policy.
CREATE OR REPLACE FUNCTION public.purge_closed_chat_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.chat_messages WHERE room_id = NEW.id;
  RETURN NULL;
END
$$;
REVOKE EXECUTE ON FUNCTION public.purge_closed_chat_messages() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS chat_rooms_purge_closed ON public.chat_rooms;
CREATE TRIGGER chat_rooms_purge_closed
  AFTER UPDATE OF status ON public.chat_rooms
  FOR EACH ROW WHEN (NEW.status = 'closed' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.purge_closed_chat_messages();

CREATE OR REPLACE FUNCTION public.end_chat_room(_room_id uuid, _token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room public.chat_rooms := public.room_for_token(_room_id, _token);
BEGIN
  UPDATE public.chat_rooms SET status = 'closed'
  WHERE id = room.id AND status <> 'closed';
  -- Idempotent for a valid room token. The status trigger purges messages on
  -- the first transition to closed.
  RETURN true;
END
$$;
REVOKE EXECUTE ON FUNCTION public.end_chat_room(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_chat_room(uuid, text) TO anon, authenticated;
