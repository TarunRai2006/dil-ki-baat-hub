-- The form no longer asks for an age band. Submitting the form confirms
-- the 13+ rule and terms acceptance. New submissions stay private.
-- Keep historical age bands and consented public stories unchanged.
REVOKE EXECUTE ON FUNCTION public.submit_confession_v2(text, text, text, integer, text, text, text, boolean, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_confession_v3(
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
  _client_request_id uuid,
  _consent_confirmed boolean
)
RETURNS TABLE (submission_id uuid, alias text, room_id uuid, room_token text, room_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _consent_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '22023';
  END IF;
  IF _highlight_on_instagram IS DISTINCT FROM 'No' THEN
    RAISE EXCEPTION 'public_sharing_disabled' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT c.submission_id, c.alias, c.room_id, c.room_token, c.room_expires_at
  FROM public.submit_confession(
    _content, _category, _intent, _emotional_state, _community_question,
    _highlight_on_instagram, _nickname, _chat_enabled, _chat_ttl,
    _anon_user_id, _client_request_id
  ) AS c;
  -- age_group remains NULL because no age band was collected.
END
$$;
REVOKE EXECUTE ON FUNCTION public.submit_confession_v3(text, text, text, integer, text, text, text, boolean, text, text, uuid, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_confession_v3(text, text, text, integer, text, text, text, boolean, text, text, uuid, boolean)
  TO anon, authenticated;
