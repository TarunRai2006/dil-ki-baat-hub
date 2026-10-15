-- The three written answers stay private. Visitors may also share a feeling
-- rating and the kind of reply they want; unanswered choices stay NULL.
REVOKE EXECUTE ON FUNCTION public.submit_confession_v4(text, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_confession_v5(
  _content text,
  _anon_user_id text,
  _client_request_id uuid,
  _consent_confirmed boolean,
  _intent text,
  _emotional_state integer
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
  IF _intent IS NOT NULL AND _intent NOT IN ('Advice', 'Express', 'Both') THEN
    RAISE EXCEPTION 'invalid_intent' USING ERRCODE = '22023';
  END IF;
  IF _emotional_state IS NOT NULL AND _emotional_state NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'invalid_emotional_state' USING ERRCODE = '22023';
  END IF;

  -- Match the inner function's lock order. Once a request has landed, a
  -- retry must return it without changing the first recorded choices.
  IF _client_request_id IS NOT NULL AND nullif(btrim(coalesce(_anon_user_id, '')), '') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('submit-browser:' || btrim(_anon_user_id), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('submit:' || _client_request_id::text, 0));
    SELECT EXISTS (
      SELECT 1 FROM public.submissions s WHERE s.client_request_id = _client_request_id
    ) INTO already_submitted;
  END IF;

  SELECT * INTO created
  FROM public.submit_confession(
    _content, 'Other', coalesce(_intent, 'Both'), coalesce(_emotional_state, 3),
    '', 'No', '', true, 'never', _anon_user_id, _client_request_id
  );

  -- This is one transaction. No reader sees an invented answer, and the
  -- internal function still enforces rate limits and one live chat.
  IF NOT already_submitted THEN
    UPDATE public.submissions
    SET category = NULL, intent = _intent, emotional_state = _emotional_state
    WHERE id = created.submission_id;
  END IF;

  RETURN QUERY SELECT created.submission_id::uuid, created.alias::text,
    created.room_id::uuid, created.room_token::text,
    created.room_expires_at::timestamptz;
END
$$;

REVOKE EXECUTE ON FUNCTION public.submit_confession_v5(text, text, uuid, boolean, text, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_confession_v5(text, text, uuid, boolean, text, integer)
  TO anon, authenticated;
