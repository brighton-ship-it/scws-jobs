-- Paid-ads attribution. Additive. Reversible with
-- supabase/migrations/20261010_paid_ads_attribution_rollback.sql
--
-- Apply in the Supabase SQL Editor. The app does not run this file.
-- booking_requests.source stays the intake channel (website/embed/manual/phone).
-- lead_source is a separate column so a google_ads value cannot trip
-- booking_requests_source_check.

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS lead_source text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_content text;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS lead_source text,
  ADD COLUMN IF NOT EXISTS lead_source_detail text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS utm_content text;

CREATE INDEX IF NOT EXISTS idx_booking_requests_lead_source
  ON booking_requests (lead_source)
  WHERE lead_source IS NOT NULL;

COMMENT ON COLUMN booking_requests.lead_source IS
  'Marketing source. google_ads when the submission has a click id or cpc/ppc medium. Not the intake channel.';
COMMENT ON COLUMN booking_requests.utm_campaign IS 'Ads campaign name from the landing URL, when present.';
COMMENT ON COLUMN booking_requests.utm_term IS 'Ads keyword from utm_term, when present.';

-- Existing book_job_conversions rows were sent (including historical last_resort fires).
ALTER TABLE book_job_conversions
  ADD COLUMN IF NOT EXISTS sent_to_google boolean,
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS value_usd numeric,
  ADD COLUMN IF NOT EXISTS value_source text,
  ADD COLUMN IF NOT EXISTS gclid text;

UPDATE book_job_conversions
SET sent_to_google = true
WHERE sent_to_google IS NULL;

COMMENT ON COLUMN book_job_conversions.sent_to_google IS
  'True when Measurement Protocol was called. False logs the job without a Google send.';
COMMENT ON COLUMN book_job_conversions.skip_reason IS
  'Why a logged job was not sent: no_match, click_id_only_offline, no_click_or_client_id.';

CREATE TABLE IF NOT EXISTS ads_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_view_resource text NOT NULL UNIQUE,
  started_at timestamptz,
  duration_seconds integer,
  campaign_id text,
  campaign_name text,
  ad_group_name text,
  keyword text,
  caller_area_code text,
  call_status text,
  call_source text,
  caller_phone text,
  voice_call_id text,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  jobber_client_id text,
  match_method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ads_calls_phone
  ON ads_calls (caller_phone)
  WHERE caller_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ads_calls_started
  ON ads_calls (started_at DESC);

COMMENT ON TABLE ads_calls IS
  'Google Ads call_view rows. Caller phone comes from the Voice log join, not from Ads. Keyword is null until Ads returns one; call_view does not include it.';

CREATE TABLE IF NOT EXISTS ads_offline_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jobber_job_id text NOT NULL UNIQUE,
  invoice_ids text,
  conversion_at timestamptz,
  value_usd numeric,
  gclid text,
  gbraid text,
  wbraid text,
  signal text,
  status text NOT NULL,
  mode text NOT NULL,
  payload jsonb,
  google_response jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ads_offline_conversions_status
  ON ads_offline_conversions (status, updated_at DESC);

COMMENT ON TABLE ads_offline_conversions IS
  'Would-be or uploaded offline click conversions. status dry_run means Google was not called.';

CREATE TABLE IF NOT EXISTS ads_closed_loop_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start date NOT NULL,
  period_end date NOT NULL,
  rows jsonb NOT NULL,
  email_to text,
  email_sent boolean NOT NULL DEFAULT false,
  sheet_appended boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ads_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_offline_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_closed_loop_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ads_calls_select ON ads_calls;
CREATE POLICY ads_calls_select ON ads_calls
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS ads_calls_service ON ads_calls;
CREATE POLICY ads_calls_service ON ads_calls
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS ads_offline_conversions_select ON ads_offline_conversions;
CREATE POLICY ads_offline_conversions_select ON ads_offline_conversions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS ads_offline_conversions_service ON ads_offline_conversions;
CREATE POLICY ads_offline_conversions_service ON ads_offline_conversions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS ads_closed_loop_reports_select ON ads_closed_loop_reports;
CREATE POLICY ads_closed_loop_reports_select ON ads_closed_loop_reports
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS ads_closed_loop_reports_service ON ads_closed_loop_reports;
CREATE POLICY ads_closed_loop_reports_service ON ads_closed_loop_reports
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
