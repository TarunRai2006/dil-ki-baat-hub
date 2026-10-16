-- Keep the visitor's self-declared age band so a 16–17 declaration cannot
-- enable public sharing by bypassing the form. This is not age verification.
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS age_group text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'submissions_age_group_check'
      AND conrelid = 'public.submissions'::regclass
  ) THEN
    ALTER TABLE public.submissions
      ADD CONSTRAINT submissions_age_group_check
      CHECK (age_group IS NULL OR age_group IN ('16-17', '18+'));
  END IF;
END $$;

-- Only the checked entry point is exposed to visitors. The earlier function
-- remains internal to avoid replacing its audited validation logic.
REVOKE EXECUTE ON FUNCTION public.submit_confession(text, text, text, integer, text, text, text, boolean, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_confession_v2(
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
  _age_group text
)
RETURNS TABLE (submission_id uuid, alias text, room_id uuid, room_token text, room_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _age_group IS NULL OR _age_group NOT IN ('16-17', '18+') THEN
    RAISE EXCEPTION 'invalid_age_group' USING ERRCODE = '22023';
  END IF;
  IF _age_group = '16-17' AND _highlight_on_instagram <> 'No' THEN
    RAISE EXCEPTION 'minor_public_sharing_disabled' USING ERRCODE = '22023';
  END IF;

  SELECT c.submission_id, c.alias, c.room_id, c.room_token, c.room_expires_at
  INTO submission_id, alias, room_id, room_token, room_expires_at
  FROM public.submit_confession(
    _content, _category, _intent, _emotional_state, _community_question,
    _highlight_on_instagram, _nickname, _chat_enabled, _chat_ttl,
    _anon_user_id, _client_request_id
  ) AS c;

  UPDATE public.submissions s
  SET age_group = _age_group
  WHERE s.id = submission_id AND (s.age_group IS NULL OR s.age_group = _age_group);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  RETURN NEXT;
END
$$;
REVOKE EXECUTE ON FUNCTION public.submit_confession_v2(text, text, text, integer, text, text, text, boolean, text, text, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_confession_v2(text, text, text, integer, text, text, text, boolean, text, text, uuid, text)
  TO anon, authenticated;
