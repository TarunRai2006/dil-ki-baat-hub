-- The written intake does not ask visitors to classify their story or rate
-- their mood. Unknown answers must stay NULL, rather than becoming fake data.
ALTER TABLE public.submissions
  ALTER COLUMN category DROP NOT NULL,
  ALTER COLUMN category DROP DEFAULT,
  ALTER COLUMN intent DROP NOT NULL,
  ALTER COLUMN intent DROP DEFAULT,
  ALTER COLUMN emotional_state DROP NOT NULL,
  ALTER COLUMN emotional_state DROP DEFAULT;

-- Retire the previous public entry point, which accepted invented metadata.
REVOKE EXECUTE ON FUNCTION public.submit_confession_v3(text, text, text, integer, text, text, text, boolean, text, text, uuid, boolean)
  FROM PUBLIC, anon, authenticated;

-- All choices are server-owned: private sharing, one indefinite chat, and no
-- fabricated topic/intent/mood. The existing internal function still enforces
-- content length, rate limits, one active chat and idempotent retries.
CREATE OR REPLACE FUNCTION public.submit_confession_v4(
  _content text,
  _anon_user_id text,
  _client_request_id uuid,
  _consent_confirmed boolean
)
RETURNS TABLE (submission_id uuid, alias text, room_id uuid, room_token text, room_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  created record;
BEGIN
  IF _consent_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'consent_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO created
  FROM public.submit_confession(
    _content, 'Other', 'Both', 3, '', 'No', '', true, 'never',
    _anon_user_id, _client_request_id
  );

  -- The internal function has validated and inserted (or found the same
  -- request). This update is in the same transaction; no reader sees defaults.
  UPDATE public.submissions
  SET category = NULL, intent = NULL, emotional_state = NULL
  WHERE id = created.submission_id;

  RETURN QUERY SELECT created.submission_id::uuid, created.alias::text,
    created.room_id::uuid, created.room_token::text,
    created.room_expires_at::timestamptz;
END
$$;

REVOKE EXECUTE ON FUNCTION public.submit_confession_v4(text, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_confession_v4(text, text, uuid, boolean)
  TO anon, authenticated;
