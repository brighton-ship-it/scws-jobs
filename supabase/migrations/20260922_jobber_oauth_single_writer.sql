-- Single-writer lock for settings.key = 'jobber_oauth'.
--
-- Jobber rotates refresh tokens on every successful refresh. This file is
-- safe to re-run. It ensures public.settings exists, hides jobber_oauth
-- from authenticated / admin CRM reads, and adds advisory-lock functions
-- so two Production isolates cannot refresh the same token.
--
-- Apply in the Supabase SQL Editor. Do not paste tokens or encryption keys.
-- The app refuses to call Jobber's token endpoint when public.settings
-- cannot be read. Env JOBBER_*_TOKEN is only a one-time seed when the
-- jobber_oauth row is confirmed empty.

CREATE TABLE IF NOT EXISTS public.settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.settings;
CREATE POLICY "Authenticated users can view settings" ON public.settings
    FOR SELECT USING (
        auth.role() = 'authenticated'
        AND key <> 'jobber_oauth'
    );

DROP POLICY IF EXISTS "Admins can manage settings" ON public.settings;
CREATE POLICY "Admins can manage settings" ON public.settings
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
        AND key <> 'jobber_oauth'
    );

-- Stable lock id for settings.key = jobber_oauth. Claim and commit take
-- this advisory lock so the empty-row insert cannot race either.
CREATE OR REPLACE FUNCTION public.jobber_oauth_lock_key()
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 814217150::bigint;
$$;

CREATE OR REPLACE FUNCTION public.jobber_oauth_lock_status()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing public.settings%ROWTYPE;
  lease_until text;
  lease_ms bigint;
  held boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(public.jobber_oauth_lock_key());
  SELECT * INTO existing FROM public.settings WHERE key = 'jobber_oauth';
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'settings_table', true,
      'stored_row', false,
      'generation', 0,
      'expires_at', NULL,
      'seeded_from', NULL,
      'lease_held', false,
      'has_ciphertext', false
    );
  END IF;

  lease_until := NULLIF(existing.value->>'leaseUntil', '');
  IF NULLIF(existing.value->>'leaseOwner', '') IS NOT NULL
     AND lease_until IS NOT NULL
     AND lease_until ~ '^[0-9]+$' THEN
    lease_ms := lease_until::bigint;
    held := lease_ms > (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  END IF;

  RETURN jsonb_build_object(
    'settings_table', true,
    'stored_row', true,
    'generation', CASE
      WHEN existing.value->>'generation' ~ '^[0-9]+$' THEN (existing.value->>'generation')::integer
      ELSE 0
    END,
    'expires_at', NULLIF(existing.value->>'expiresAt', ''),
    'seeded_from', NULLIF(existing.value->>'seededFrom', ''),
    'lease_held', held,
    'has_ciphertext', COALESCE(length(existing.value->>'data') > 0, false)
      AND COALESCE(existing.value->>'bootstrap', '') IS DISTINCT FROM 'true'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.jobber_oauth_claim(
  p_owner text,
  p_expected_generation integer,
  p_expected_fingerprint text,
  p_now_ms bigint,
  p_lease_until text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing public.settings%ROWTYPE;
  gen integer;
  fp text;
  lease_owner text;
  lease_until text;
  lease_ms bigint;
  held boolean := false;
  new_value jsonb;
BEGIN
  IF p_owner IS NULL OR length(p_owner) < 8 OR length(p_owner) > 80 THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'bad_owner');
  END IF;

  PERFORM pg_advisory_xact_lock(public.jobber_oauth_lock_key());
  SELECT * INTO existing FROM public.settings WHERE key = 'jobber_oauth' FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_generation IS DISTINCT FROM 0 OR p_expected_fingerprint IS NOT NULL THEN
      RETURN jsonb_build_object('acquired', false, 'reason', 'empty_mismatch');
    END IF;
    new_value := jsonb_build_object(
      'bootstrap', true,
      'generation', 0,
      'leaseOwner', p_owner,
      'leaseUntil', p_lease_until,
      'seededFrom', NULL,
      'expiresAt', NULL
    );
    BEGIN
      INSERT INTO public.settings (key, value) VALUES ('jobber_oauth', new_value);
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('acquired', false, 'reason', 'insert_race');
    END;
    RETURN jsonb_build_object('acquired', true, 'value', new_value);
  END IF;

  IF existing.value->>'generation' ~ '^[0-9]+$' THEN
    gen := (existing.value->>'generation')::integer;
  ELSE
    gen := 0;
  END IF;
  fp := NULLIF(existing.value->>'refreshFingerprint', '');
  lease_owner := NULLIF(existing.value->>'leaseOwner', '');
  lease_until := NULLIF(existing.value->>'leaseUntil', '');
  IF lease_owner IS NOT NULL AND lease_until IS NOT NULL AND lease_until ~ '^[0-9]+$' THEN
    lease_ms := lease_until::bigint;
    held := lease_ms > p_now_ms AND lease_owner IS DISTINCT FROM p_owner;
  END IF;

  IF held THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'lease_held', 'value', existing.value);
  END IF;
  IF gen IS DISTINCT FROM p_expected_generation OR fp IS DISTINCT FROM p_expected_fingerprint THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'version_mismatch', 'value', existing.value);
  END IF;

  new_value := existing.value || jsonb_build_object(
    'generation', gen,
    'leaseOwner', p_owner,
    'leaseUntil', p_lease_until
  );
  UPDATE public.settings
    SET value = new_value, updated_at = now()
    WHERE key = 'jobber_oauth';
  RETURN jsonb_build_object('acquired', true, 'value', new_value);
END;
$$;

CREATE OR REPLACE FUNCTION public.jobber_oauth_commit(
  p_owner text,
  p_expected_generation integer,
  p_expected_fingerprint text,
  p_value jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing public.settings%ROWTYPE;
  gen integer;
  fp text;
  lease_owner text;
BEGIN
  IF p_owner IS NULL OR p_value IS NULL THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'bad_args');
  END IF;

  PERFORM pg_advisory_xact_lock(public.jobber_oauth_lock_key());
  SELECT * INTO existing FROM public.settings WHERE key = 'jobber_oauth' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'missing');
  END IF;

  IF existing.value->>'generation' ~ '^[0-9]+$' THEN
    gen := (existing.value->>'generation')::integer;
  ELSE
    gen := 0;
  END IF;
  fp := NULLIF(existing.value->>'refreshFingerprint', '');
  lease_owner := NULLIF(existing.value->>'leaseOwner', '');

  IF lease_owner IS DISTINCT FROM p_owner
     OR gen IS DISTINCT FROM p_expected_generation
     OR fp IS DISTINCT FROM p_expected_fingerprint THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'mismatch', 'value', existing.value);
  END IF;

  UPDATE public.settings
    SET value = p_value, updated_at = now()
    WHERE key = 'jobber_oauth';
  RETURN jsonb_build_object('committed', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.jobber_oauth_release(p_owner text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  existing public.settings%ROWTYPE;
BEGIN
  IF p_owner IS NULL THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(public.jobber_oauth_lock_key());
  SELECT * INTO existing FROM public.settings WHERE key = 'jobber_oauth' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF NULLIF(existing.value->>'leaseOwner', '') IS DISTINCT FROM p_owner THEN
    RETURN;
  END IF;
  UPDATE public.settings
    SET value = (existing.value - 'leaseOwner' - 'leaseUntil'),
        updated_at = now()
    WHERE key = 'jobber_oauth';
END;
$$;

REVOKE ALL ON FUNCTION public.jobber_oauth_lock_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jobber_oauth_lock_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jobber_oauth_claim(text, integer, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jobber_oauth_commit(text, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jobber_oauth_release(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.jobber_oauth_lock_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.jobber_oauth_lock_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.jobber_oauth_claim(text, integer, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jobber_oauth_commit(text, integer, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.jobber_oauth_release(text) TO service_role;
