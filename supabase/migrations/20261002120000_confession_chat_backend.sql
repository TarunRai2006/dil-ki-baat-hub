-- =============================================================================
-- Dil Ki Baat: confession + moderation + anonymous chat backend
--
-- Builds on the existing `submissions`, `chat_messages` and `user_roles` tables.
-- Nothing is dropped and no existing row is deleted. Re-running is safe: every
-- statement is guarded with IF [NOT] EXISTS / OR REPLACE / ON CONFLICT.
--
-- Security model (summary)
--   * The browser only ever holds the public (publishable) key.
--   * Anonymous visitors cannot read, update or delete any table directly.
--     They write through SECURITY DEFINER functions that validate every field,
--     rate-limit, and never touch admin columns.
--   * An anonymous chat room is a capability: its creator receives a random
--     secret token exactly once; the database stores only its SHA-256 hash.
--   * Admin access = Supabase Auth user + row in `user_roles` with role 'admin',
--     checked inside the database (RLS + function guards), never in the UI.
--   * The database is the source of truth for chat expiry.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1. Authorization helper
-- -----------------------------------------------------------------------------

-- Is the *calling* user an admin? Exposes nothing but the caller's own status.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::public.app_role
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
END
$$;
REVOKE EXECUTE ON FUNCTION public.assert_admin() FROM PUBLIC, anon, authenticated;

-- Roles are granted by the project owner only (service role / SQL editor).
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;

-- Trim all surrounding whitespace (not just spaces) and drop control characters,
-- keeping ordinary line breaks inside the text.
CREATE OR REPLACE FUNCTION public.clean_text(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
    regexp_replace(coalesce(t, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'),
    '^[[:space:]]+|[[:space:]]+$', '', 'g'
  )
$$;

-- -----------------------------------------------------------------------------
-- 2. Submissions: lifecycle, moderation columns, constraints, indexes
-- -----------------------------------------------------------------------------

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

-- Archiving used to be a status. It is now a flag, so restoring an archived
-- confession brings back its real moderation status.
UPDATE public.submissions
SET is_archived = true, status = 'Reviewed'
WHERE status = 'Archived';

UPDATE public.submissions SET status = 'Pending'
WHERE status NOT IN ('Pending', 'Reviewed', 'Approved', 'Rejected');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submissions_status_check') THEN
    ALTER TABLE public.submissions ADD CONSTRAINT submissions_status_check
      CHECK (status IN ('Pending', 'Reviewed', 'Approved', 'Rejected'));
  END IF;
  -- NOT VALID: enforced for every new/updated row, without rejecting legacy rows.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submissions_intent_check') THEN
    ALTER TABLE public.submissions ADD CONSTRAINT submissions_intent_check
      CHECK (intent IN ('Advice', 'Express', 'Both')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submissions_highlight_check') THEN
    ALTER TABLE public.submissions ADD CONSTRAINT submissions_highlight_check
      CHECK (highlight_on_instagram IN ('Yes', 'No', 'Maybe')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submissions_chat_ttl_check') THEN
    ALTER TABLE public.submissions ADD CONSTRAINT submissions_chat_ttl_check
      CHECK (chat_ttl IN ('1h', '24h', 'never')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submissions_lengths_check') THEN
    ALTER TABLE public.submissions ADD CONSTRAINT submissions_lengths_check CHECK (
      char_length(content) BETWEEN 1 AND 5000
      AND (nickname IS NULL OR char_length(nickname) <= 40)
      AND (community_question IS NULL OR char_length(community_question) <= 200)
      AND (admin_notes IS NULL OR char_length(admin_notes) <= 5000)
    ) NOT VALID;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS submissions_client_request_id_key
  ON public.submissions (client_request_id);
CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON public.submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_status_idx ON public.submissions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_category_idx ON public.submissions (category);
CREATE INDEX IF NOT EXISTS submissions_emotional_state_idx ON public.submissions (emotional_state);
CREATE INDEX IF NOT EXISTS submissions_featured_idx
  ON public.submissions (created_at DESC) WHERE is_featured;
CREATE INDEX IF NOT EXISTS submissions_archived_idx ON public.submissions (is_archived, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_deleted_idx
  ON public.submissions (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS submissions_touch_updated_at ON public.submissions;
CREATE TRIGGER submissions_touch_updated_at
  BEFORE UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Search column for the admin filter (generated, so it can never drift),
-- trigram-indexed so ILIKE search does not scan the table.
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    content || ' ' || coalesce(nickname, '') || ' ' || coalesce(community_question, '') || ' ' || alias
  ) STORED;
CREATE INDEX IF NOT EXISTS submissions_search_text_trgm_idx
  ON public.submissions USING gin (search_text extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 3. Moderation log: who changed what, for admins only
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.moderation_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  submission_id uuid NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS moderation_log_submission_idx
  ON public.moderation_log (submission_id, created_at DESC);
ALTER TABLE public.moderation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_log FROM anon, authenticated;
GRANT SELECT ON public.moderation_log TO authenticated;
GRANT ALL ON public.moderation_log TO service_role;
DROP POLICY IF EXISTS "Admins can read moderation log" ON public.moderation_log;
CREATE POLICY "Admins can read moderation log" ON public.moderation_log
  FOR SELECT TO authenticated USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 4. Rate limiting (fixed window counters, internal only)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON public.rate_limits (window_start);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;
-- (no policies: only SECURITY DEFINER functions below touch this table)

-- Hashed client address from the API gateway headers. Hashed so raw IPs are
-- never stored; used only as a rate-limit key.
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
  ip := coalesce(
    headers ->> 'cf-connecting-ip',
    split_part(headers ->> 'x-forwarded-for', ',', 1),
    headers ->> 'x-real-ip'
  );
  IF ip IS NULL OR btrim(ip) = '' THEN
    RETURN NULL;
  END IF;
  RETURN encode(extensions.digest(btrim(ip), 'sha256'), 'hex');
END
$$;
REVOKE EXECUTE ON FUNCTION public.request_fingerprint() FROM PUBLIC, anon, authenticated;

-- Count one hit against `bucket`; raise rate_limited when over `max_hits`.
CREATE OR REPLACE FUNCTION public.hit_rate_limit(_bucket text, _max_hits integer, _window interval)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  win timestamptz := to_timestamp(
    floor(extract(epoch FROM now()) / extract(epoch FROM _window)) * extract(epoch FROM _window)
  );
  n integer;
BEGIN
  INSERT INTO public.rate_limits AS r (bucket, window_start, hits)
  VALUES (_bucket, win, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO n;

  -- opportunistic cleanup keeps the table tiny without a scheduler
  IF random() < 0.02 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
  END IF;

  IF n > _max_hits THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0429';
  END IF;
END
$$;
REVOKE EXECUTE ON FUNCTION public.hit_rate_limit(text, integer, interval) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Chat rooms: one per confession that asked for a live chat
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.chat_rooms (
  -- the room id is the confession id (1:1), so existing chat_messages.room_id values stay valid
  id uuid PRIMARY KEY REFERENCES public.submissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired')),
  -- SHA-256 of the anonymous creator's secret token; NULL for legacy rooms
  token_hash text,
  last_message_at timestamptz
);
CREATE INDEX IF NOT EXISTS chat_rooms_expires_at_idx ON public.chat_rooms (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_rooms_status_idx ON public.chat_rooms (status, last_message_at DESC NULLS LAST);
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_rooms FROM anon, authenticated;
GRANT SELECT ON public.chat_rooms TO authenticated;
GRANT ALL ON public.chat_rooms TO service_role;
DROP POLICY IF EXISTS "Admins can read chat rooms" ON public.chat_rooms;
CREATE POLICY "Admins can read chat rooms" ON public.chat_rooms
  FOR SELECT TO authenticated USING (public.is_admin());

-- Backfill a room for every confession that already had chat or messages.
INSERT INTO public.chat_rooms (id, created_at, expires_at, last_message_at)
SELECT
  s.id,
  s.created_at,
  CASE s.chat_ttl
    WHEN '1h' THEN s.created_at + interval '1 hour'
    WHEN '24h' THEN s.created_at + interval '24 hours'
    ELSE NULL
  END,
  (SELECT max(m.created_at) FROM public.chat_messages m WHERE m.room_id = s.id)
FROM public.submissions s
WHERE s.chat_enabled OR EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.room_id = s.id)
ON CONFLICT (id) DO NOTHING;

-- Is a room usable right now? The single definition of "expired".
CREATE OR REPLACE FUNCTION public.room_is_live(r public.chat_rooms)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT r.status = 'open' AND (r.expires_at IS NULL OR r.expires_at > now())
$$;

-- -----------------------------------------------------------------------------
-- 6. Chat messages: room FK, idempotency, validation trigger, realtime signal
-- -----------------------------------------------------------------------------

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS client_msg_id uuid,
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_room_fk') THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_room_fk
      FOREIGN KEY (room_id) REFERENCES public.chat_rooms(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_sender_check') THEN
    ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_sender_check
      CHECK (sender_type IN ('user', 'admin')) NOT VALID;
  END IF;
END
$$;
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_msg_key
  ON public.chat_messages (room_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON public.chat_messages (created_at);
CREATE INDEX IF NOT EXISTS chat_messages_expires_at_idx ON public.chat_messages (expires_at) WHERE expires_at IS NOT NULL;

-- Every insert, whatever the path: trim, length, live room, inherit expiry.
CREATE OR REPLACE FUNCTION public.chat_messages_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room public.chat_rooms;
BEGIN
  NEW.message := public.clean_text(NEW.message);
  IF NEW.message = '' THEN
    RAISE EXCEPTION 'message_empty' USING ERRCODE = '22023';
  END IF;
  IF char_length(NEW.message) > 1000 THEN
    RAISE EXCEPTION 'message_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO room FROM public.chat_rooms WHERE id = NEW.room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.room_is_live(room) THEN
    RAISE EXCEPTION 'room_expired' USING ERRCODE = 'P0410';
  END IF;

  NEW.expires_at := room.expires_at;
  NEW.created_at := clock_timestamp();
  UPDATE public.chat_rooms SET last_message_at = NEW.created_at WHERE id = NEW.room_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chat_messages_validate ON public.chat_messages;
CREATE TRIGGER chat_messages_validate
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_before_insert();

-- Broadcast topic for a room: derived from the secret token hash, so only the
-- token holder (and admins, who can read the hash) can know it.
CREATE OR REPLACE FUNCTION public.room_topic(token_hash text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 'room:' || token_hash $$;

-- After insert: tell the anonymous participant something arrived. The payload
-- carries no message text; the client re-reads through get_room_messages, so a
-- forged broadcast can never inject content.
CREATE OR REPLACE FUNCTION public.chat_messages_after_insert()
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
        jsonb_build_object('id', NEW.id, 'created_at', NEW.created_at),
        'message',
        public.room_topic(hash),
        false
      );
    EXCEPTION WHEN others THEN
      -- realtime is best effort; the client also resyncs on reconnect
      NULL;
    END;
  END IF;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS chat_messages_signal ON public.chat_messages;
CREATE TRIGGER chat_messages_signal
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_messages_after_insert();

-- -----------------------------------------------------------------------------
-- 7. Table privileges + RLS: anonymous users get no direct table access
-- -----------------------------------------------------------------------------

REVOKE INSERT, SELECT, UPDATE, DELETE ON public.submissions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.submissions FROM authenticated;
GRANT SELECT ON public.submissions TO authenticated;

REVOKE INSERT, SELECT, UPDATE, DELETE ON public.chat_messages FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.chat_messages FROM authenticated;
GRANT SELECT ON public.chat_messages TO authenticated;

DROP POLICY IF EXISTS "Anyone can submit a story" ON public.submissions;
DROP POLICY IF EXISTS "Admins can update submissions" ON public.submissions;
DROP POLICY IF EXISTS "Admins can delete submissions" ON public.submissions;
DROP POLICY IF EXISTS "Admins can read submissions" ON public.submissions;
CREATE POLICY "Admins can read submissions" ON public.submissions
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Room holders can send messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Room holders can read unexpired messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Admins can send messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Admins can delete messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Admins can read messages" ON public.chat_messages;
CREATE POLICY "Admins can read messages" ON public.chat_messages
  FOR SELECT TO authenticated USING (public.is_admin());

-- -----------------------------------------------------------------------------
-- 8. Public API: anonymous confession + chat (validated, rate-limited)
-- -----------------------------------------------------------------------------

-- The old room reader trusted the room id alone. Rooms now need their token.
DROP FUNCTION IF EXISTS public.get_room_messages(uuid);

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

-- Resolve a room from (id, secret token). Raises when the pair is wrong.
CREATE OR REPLACE FUNCTION public.room_for_token(_room_id uuid, _token text)
RETURNS public.chat_rooms
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room public.chat_rooms;
BEGIN
  IF _room_id IS NULL OR _token IS NULL OR _token !~ '^[0-9a-f]{48}$' THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO room FROM public.chat_rooms r
  WHERE r.id = _room_id AND r.token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN room;
END
$$;
REVOKE EXECUTE ON FUNCTION public.room_for_token(uuid, text) FROM PUBLIC, anon, authenticated;

-- Room metadata for its anonymous holder: state, expiry and the broadcast topic.
CREATE OR REPLACE FUNCTION public.get_chat_room(_room_id uuid, _token text)
RETURNS TABLE (room_id uuid, alias text, status text, expires_at timestamptz, topic text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room public.chat_rooms := public.room_for_token(_room_id, _token);
BEGIN
  RETURN QUERY
    SELECT room.id,
           s.alias,
           CASE WHEN public.room_is_live(room) THEN 'open'
                WHEN room.status = 'closed' THEN 'closed'
                ELSE 'expired' END,
           room.expires_at,
           public.room_topic(room.token_hash)
    FROM public.submissions s WHERE s.id = room.id;
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_chat_room(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_chat_room(uuid, text) TO anon, authenticated;

-- Messages for the token holder, oldest first. `_after` fetches only what is new.
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
  RETURN QUERY
    SELECT m.id, m.sender_type, m.message, m.created_at, m.client_msg_id
    FROM public.chat_messages m
    WHERE m.room_id = room.id
      AND NOT m.is_hidden
      AND (_after IS NULL OR m.created_at > _after)
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT 500;
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_room_messages(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_room_messages(uuid, text, timestamptz) TO anon, authenticated;

-- Anonymous send. Idempotent per client_msg_id, rate-limited per room and address.
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

-- -----------------------------------------------------------------------------
-- 9. Admin API (every function re-checks is_admin() inside the database)
-- -----------------------------------------------------------------------------

-- One entry point for moderation changes. NULL arguments mean "leave as is".
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
    reviewed_by = CASE WHEN _status IS NOT NULL AND _status <> s.status THEN auth.uid() ELSE s.reviewed_by END
  WHERE s.id = _id
  RETURNING * INTO next_row;

  -- archiving or deleting a confession also closes its live chat
  IF next_row.is_archived OR next_row.deleted_at IS NOT NULL THEN
    UPDATE public.chat_rooms SET status = 'closed' WHERE id = _id AND status = 'open';
  END IF;

  INSERT INTO public.moderation_log (submission_id, actor_id, action, detail)
  VALUES (_id, auth.uid(), 'update', jsonb_strip_nulls(jsonb_build_object(
    'status', CASE WHEN next_row.status IS DISTINCT FROM prev_row.status THEN jsonb_build_array(prev_row.status, next_row.status) END,
    'featured', CASE WHEN next_row.is_featured IS DISTINCT FROM prev_row.is_featured THEN to_jsonb(next_row.is_featured) END,
    'archived', CASE WHEN next_row.is_archived IS DISTINCT FROM prev_row.is_archived THEN to_jsonb(next_row.is_archived) END,
    'deleted', CASE WHEN next_row.deleted_at IS DISTINCT FROM prev_row.deleted_at THEN to_jsonb(next_row.deleted_at IS NOT NULL) END,
    'notes', CASE WHEN next_row.admin_notes IS DISTINCT FROM prev_row.admin_notes THEN to_jsonb(true) END
  )));

  RETURN next_row;
END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_update_submission(uuid, text, boolean, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_submission(uuid, text, boolean, boolean, text, boolean) TO authenticated;

-- Mentor reply into a live room.
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

-- Open or close a room by hand.
CREATE OR REPLACE FUNCTION public.admin_set_room_status(_room_id uuid, _status text)
RETURNS public.chat_rooms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  room public.chat_rooms;
BEGIN
  PERFORM public.assert_admin();
  IF _status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  UPDATE public.chat_rooms SET status = _status WHERE id = _room_id RETURNING * INTO room;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN room;
END
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_room_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_room_status(uuid, text) TO authenticated;

-- Dashboard aggregates in one round trip, computed in the database.
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_admin();
  SELECT jsonb_build_object(
    'total', count(*) FILTER (WHERE deleted_at IS NULL),
    'pending', count(*) FILTER (WHERE deleted_at IS NULL AND NOT is_archived AND status = 'Pending'),
    'featured', count(*) FILTER (WHERE deleted_at IS NULL AND is_featured),
    'archived', count(*) FILTER (WHERE deleted_at IS NULL AND is_archived),
    'pulse', round(avg(emotional_state) FILTER (WHERE deleted_at IS NULL), 2),
    'live_chats', (SELECT count(*) FROM public.chat_rooms r WHERE public.room_is_live(r)),
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
-- 10. Expiry housekeeping (the database stays the source of truth without it)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.expire_chat_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.chat_rooms SET status = 'expired'
  WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  -- disappearing chats really disappear: purge message text a day after expiry
  DELETE FROM public.chat_messages WHERE expires_at IS NOT NULL AND expires_at < now() - interval '1 day';
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
  RETURN n;
END
$$;
REVOKE EXECUTE ON FUNCTION public.expire_chat_rooms() FROM PUBLIC, anon, authenticated;

-- Schedule it every 10 minutes when pg_cron is available on this project.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
      PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'dkb-expire-chat-rooms';
      PERFORM cron.schedule('dkb-expire-chat-rooms', '*/10 * * * *', 'SELECT public.expire_chat_rooms()');
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'pg_cron unavailable (%); chat expiry is still enforced on every read and write', SQLERRM;
    END;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 11. Realtime: admins receive row changes (RLS applies to realtime too)
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'submissions') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_rooms') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
  END IF;
END
$$;
