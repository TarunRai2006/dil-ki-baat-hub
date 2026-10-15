-- Restore the original context choices while keeping all new stories private.
-- The three written answers remain the main story; unanswered choices stay NULL.
REVOKE EXECUTE ON FUNCTION public.submit_confession_v5(text, text, uuid, boolean, text, integer)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_confession_v6(
  _content text,
  _anon_user_id text,
  _client_request_id uuid,
  _consent_confirmed boolean,
  _category text,
  _intent text,
  _emotional_state integer,
  _community_question text,
  _nickname text,
  _chat_ttl text
)
RETURNS TABLE (submission_id uuid, alias text, room_id uuid, room_token text, room_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  created record;
  already_submitted boolean := false;
BEGIN
  IF _consent_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '22023';
  END IF;
  IF _category IS NOT NULL AND _category NOT IN
    ('Relationship','Career','Family','Anxiety','Self thoughts','Social taboos','Confusion','Other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF _intent IS NOT NULL AND _intent NOT IN ('Advice', 'Express', 'Both') THEN
    RAISE EXCEPTION 'invalid_intent' USING ERRCODE = '22023';
  END IF;
  IF _emotional_state IS NOT NULL AND _emotional_state NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_emotional_state' USING ERRCODE = '22023';
  END IF;
  IF _chat_ttl IS NULL OR _chat_ttl NOT IN ('1h', '24h', 'never') THEN
    RAISE EXCEPTION 'invalid_chat' USING ERRCODE = '22023';
  END IF;

  -- Keep the same lock order as the internal function. Retrying an already
  -- saved request returns its first answers without overwriting them.
  IF _client_request_id IS NOT NULL AND nullif(btrim(coalesce(_anon_user_id, '')), '') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('submit-browser:' || btrim(_anon_user_id), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('submit:' || _client_request_id::text, 0));
    SELECT EXISTS (
      SELECT 1 FROM public.submissions s WHERE s.client_request_id = _client_request_id
    ) INTO already_submitted;
  END IF;

  SELECT * INTO created
  FROM public.submit_confession(
    _content, coalesce(_category, 'Other'), coalesce(_intent, 'Both'),
    coalesce(_emotional_state, 3), coalesce(_community_question, ''),
    'No', coalesce(_nickname, ''), true, _chat_ttl,
    _anon_user_id, _client_request_id
  );

  -- The internal function handles content validation, rate limits, one live
  -- chat, and idempotent retries. This update shares its transaction.
  IF NOT already_submitted THEN
    UPDATE public.submissions
    SET category = _category, intent = _intent, emotional_state = _emotional_state
    WHERE id = created.submission_id;
  END IF;

  RETURN QUERY SELECT created.submission_id::uuid, created.alias::text,
    created.room_id::uuid, created.room_token::text,
    created.room_expires_at::timestamptz;
END
$$;

REVOKE EXECUTE ON FUNCTION public.submit_confession_v6(text, text, uuid, boolean, text, text, integer, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_confession_v6(text, text, uuid, boolean, text, text, integer, text, text, text)
  TO anon, authenticated;
