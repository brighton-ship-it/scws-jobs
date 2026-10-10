-- Reverses supabase/migrations/20261010_paid_ads_attribution.sql
-- Drops the new tables and columns. Does not delete booking or customer rows.
-- Run only in the Supabase SQL Editor, and only to undo that migration.

DROP POLICY IF EXISTS ads_closed_loop_reports_service ON ads_closed_loop_reports;
DROP POLICY IF EXISTS ads_closed_loop_reports_select ON ads_closed_loop_reports;
DROP POLICY IF EXISTS ads_offline_conversions_service ON ads_offline_conversions;
DROP POLICY IF EXISTS ads_offline_conversions_select ON ads_offline_conversions;
DROP POLICY IF EXISTS ads_calls_service ON ads_calls;
DROP POLICY IF EXISTS ads_calls_select ON ads_calls;

DROP TABLE IF EXISTS ads_closed_loop_reports;
DROP TABLE IF EXISTS ads_offline_conversions;
DROP TABLE IF EXISTS ads_calls;

ALTER TABLE book_job_conversions
  DROP COLUMN IF EXISTS sent_to_google,
  DROP COLUMN IF EXISTS skip_reason,
  DROP COLUMN IF EXISTS value_usd,
  DROP COLUMN IF EXISTS value_source,
  DROP COLUMN IF EXISTS gclid;

ALTER TABLE booking_requests
  DROP COLUMN IF EXISTS lead_source,
  DROP COLUMN IF EXISTS utm_source,
  DROP COLUMN IF EXISTS utm_medium,
  DROP COLUMN IF EXISTS utm_campaign,
  DROP COLUMN IF EXISTS utm_term,
  DROP COLUMN IF EXISTS utm_content;

DROP INDEX IF EXISTS idx_booking_requests_lead_source;
