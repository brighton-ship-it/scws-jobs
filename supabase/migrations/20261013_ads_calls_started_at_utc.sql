-- Repair ads_calls.started_at and backfill caller links.
-- Apply in the Supabase SQL Editor. The app does not run this file.
--
-- started_at used to store the Pacific wall clock with no offset, so Postgres
-- read it as UTC (about 7h early in PDT, 8h in PST). The ads-calls cron now
-- writes a real UTC instant and performs this same repair. Both paths share
-- settings key ads_calls_started_at_utc_v1: a call_view_resource in that
-- ledger, or a row with started_at_utc = true, is not shifted again.
--
-- Safe to re-run. Customer and Jobber links only fill rows that have neither id.
-- The cron also backfills those ids (including a live Jobber search the SQL
-- cannot do) on its next run, including rows older than the Ads lookback.

ALTER TABLE ads_calls
  ADD COLUMN IF NOT EXISTS started_at_utc boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ads_calls.started_at_utc IS
  'True once started_at is a real UTC instant. Legacy rows stored the Pacific wall clock as UTC.';

UPDATE ads_calls AS a
SET customer_id = match.id,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (a2.call_view_resource)
    a2.call_view_resource,
    c.id
  FROM ads_calls a2
  JOIN customers c
    ON length(regexp_replace(COALESCE(c.phone, ''), '\D', '', 'g')) >= 10
   AND right(regexp_replace(c.phone, '\D', '', 'g'), 10)
     = right(regexp_replace(COALESCE(a2.caller_phone, ''), '\D', '', 'g'), 10)
  WHERE a2.customer_id IS NULL
    AND a2.jobber_client_id IS NULL
    AND a2.caller_phone IS NOT NULL
  ORDER BY a2.call_view_resource, c.created_at DESC NULLS LAST
) AS match
WHERE a.call_view_resource = match.call_view_resource
  AND a.customer_id IS NULL
  AND a.jobber_client_id IS NULL;

UPDATE ads_calls AS a
SET customer_id = match.customer_id,
    updated_at = now()
FROM (
  SELECT DISTINCT ON (a2.call_view_resource)
    a2.call_view_resource,
    b.customer_id
  FROM ads_calls a2
  JOIN booking_requests b
    ON b.customer_id IS NOT NULL
   AND length(regexp_replace(COALESCE(b.phone, ''), '\D', '', 'g')) >= 10
   AND right(regexp_replace(b.phone, '\D', '', 'g'), 10)
     = right(regexp_replace(COALESCE(a2.caller_phone, ''), '\D', '', 'g'), 10)
  WHERE a2.customer_id IS NULL
    AND a2.jobber_client_id IS NULL
    AND a2.caller_phone IS NOT NULL
  ORDER BY a2.call_view_resource, b.created_at DESC NULLS LAST
) AS match
WHERE a.call_view_resource = match.call_view_resource
  AND a.customer_id IS NULL
  AND a.jobber_client_id IS NULL;

DO $$
BEGIN
  IF to_regclass('public.jobber_clients') IS NULL THEN
    RETURN;
  END IF;
  UPDATE ads_calls AS a
  SET jobber_client_id = match.id,
      updated_at = now()
  FROM (
    SELECT DISTINCT ON (a2.call_view_resource)
      a2.call_view_resource,
      j.id
    FROM ads_calls a2
    JOIN jobber_clients j
      ON j.phones_digits @> ARRAY[
        right(regexp_replace(COALESCE(a2.caller_phone, ''), '\D', '', 'g'), 10)
      ]
    WHERE a2.customer_id IS NULL
      AND a2.jobber_client_id IS NULL
      AND a2.caller_phone IS NOT NULL
    ORDER BY a2.call_view_resource
  ) AS match
  WHERE a.call_view_resource = match.call_view_resource
    AND a.customer_id IS NULL
    AND a.jobber_client_id IS NULL;
END $$;

INSERT INTO settings (key, value)
VALUES ('ads_calls_started_at_utc_v1', '{"resources":[]}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Legacy wall clock labeled UTC -> real Pacific instant. Skip anything the
-- cron already corrected (ledger) or a previous run of this file flagged.
UPDATE ads_calls AS a
SET started_at = (a.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Los_Angeles',
    started_at_utc = true,
    updated_at = now()
WHERE a.started_at IS NOT NULL
  AND a.started_at_utc = false
  AND NOT EXISTS (
    SELECT 1
    FROM settings s
    WHERE s.key = 'ads_calls_started_at_utc_v1'
      AND (COALESCE(s.value->'resources', '[]'::jsonb) ? a.call_view_resource)
  );

UPDATE ads_calls AS a
SET started_at_utc = true,
    updated_at = now()
WHERE a.started_at_utc = false
  AND EXISTS (
    SELECT 1
    FROM settings s
    WHERE s.key = 'ads_calls_started_at_utc_v1'
      AND (COALESCE(s.value->'resources', '[]'::jsonb) ? a.call_view_resource)
  );

UPDATE settings
SET value = jsonb_build_object(
      'resources', COALESCE((SELECT jsonb_agg(call_view_resource) FROM ads_calls), '[]'::jsonb),
      'via', 'sql',
      'at', to_jsonb(now())
    ),
    updated_at = now()
WHERE key = 'ads_calls_started_at_utc_v1';
