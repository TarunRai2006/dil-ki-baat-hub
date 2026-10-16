-- Push endpoints are independent of submissions, rooms, auth users and IPs.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  expiration_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  CONSTRAINT push_endpoint_length CHECK (char_length(endpoint) BETWEEN 20 AND 2048),
  CONSTRAINT push_p256dh_length CHECK (char_length(p256dh) BETWEEN 80 AND 120),
  CONSTRAINT push_auth_length CHECK (char_length(auth) BETWEEN 16 AND 64)
);

CREATE INDEX IF NOT EXISTS push_subscriptions_created_idx ON public.push_subscriptions (created_at);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
-- No policies: only the server-side service role may read or write subscriptions.

-- A separate abuse bucket. It contains only a keyed digest of a request IP,
-- never an endpoint or subscription id, and cannot join to push_subscriptions.
CREATE TABLE IF NOT EXISTS public.push_request_limits (
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS push_request_limits_window_idx ON public.push_request_limits (window_start);
ALTER TABLE public.push_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_request_limits FROM anon, authenticated;
GRANT ALL ON public.push_request_limits TO service_role;

CREATE OR REPLACE FUNCTION public.push_check_rate_limit(_bucket text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _window_start timestamptz := to_timestamp(floor(extract(epoch FROM now()) / 3600) * 3600);
  _hits integer;
BEGIN
  INSERT INTO public.push_request_limits AS r (bucket, window_start, hits)
  VALUES (_bucket, _window_start, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO _hits;
  IF random() < 0.02 THEN
    DELETE FROM public.push_request_limits WHERE window_start < now() - interval '2 days';
  END IF;
  RETURN _hits <= 30;
END
$$;
REVOKE EXECUTE ON FUNCTION public.push_check_rate_limit(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_check_rate_limit(text) TO service_role;

-- Aggregate admin audit only. No recipient identifiers or notification content.
CREATE TABLE IF NOT EXISTS public.push_broadcast_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  total integer NOT NULL CHECK (total >= 0),
  successful integer NOT NULL DEFAULT 0 CHECK (successful >= 0),
  removed_invalid integer NOT NULL DEFAULT 0 CHECK (removed_invalid >= 0),
  failed_temporary integer NOT NULL DEFAULT 0 CHECK (failed_temporary >= 0)
);
CREATE INDEX IF NOT EXISTS push_broadcast_audit_started_idx
  ON public.push_broadcast_audit (started_at DESC);
ALTER TABLE public.push_broadcast_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_broadcast_audit FROM anon, authenticated;
GRANT ALL ON public.push_broadcast_audit TO service_role;
