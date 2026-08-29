-- Fortune-500 CRM conversion: store website click IDs on leads,
-- and remember which Jobber jobs already fired GA4 book_job.
--
-- HUMAN ACTION REQUIRED if this has not been applied in production:
-- Open the Supabase SQL Editor for this project and paste/run this entire file.
-- Do not apply it from the app repo (no service-role migrate-from-git).
-- Until this runs, booking still saves the lead but drops click IDs
-- (PGRST204: missing ga_client_id / gclid / gbraid / wbraid / ga_session_id).

ALTER TABLE booking_requests
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS gbraid text,
  ADD COLUMN IF NOT EXISTS wbraid text,
  ADD COLUMN IF NOT EXISTS ga_client_id text,
  ADD COLUMN IF NOT EXISTS ga_session_id text;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS gclid text,
  ADD COLUMN IF NOT EXISTS gbraid text,
  ADD COLUMN IF NOT EXISTS wbraid text,
  ADD COLUMN IF NOT EXISTS ga_client_id text,
  ADD COLUMN IF NOT EXISTS ga_session_id text;

CREATE INDEX IF NOT EXISTS idx_booking_requests_email
  ON booking_requests (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_requests_gclid
  ON booking_requests (gclid)
  WHERE gclid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_gclid
  ON customers (gclid)
  WHERE gclid IS NOT NULL;

-- One GA4 book_job per Jobber job id (idempotency).
CREATE TABLE IF NOT EXISTS book_job_conversions (
  jobber_job_id text PRIMARY KEY,
  booking_request_id uuid REFERENCES booking_requests(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  client_id text,
  client_id_source text,
  matched_by text,
  fired_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_book_job_conversions_fired_at
  ON book_job_conversions (fired_at DESC);

-- Last-seen schedule state so we only fire on the first transition onto a schedule.
CREATE TABLE IF NOT EXISTS jobber_job_schedule_state (
  jobber_job_id text PRIMARY KEY,
  is_scheduled boolean NOT NULL,
  jobber_created_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE book_job_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobber_job_schedule_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY book_job_conversions_select ON book_job_conversions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY jobber_job_schedule_state_select ON jobber_job_schedule_state
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY book_job_conversions_service ON book_job_conversions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY jobber_job_schedule_state_service ON jobber_job_schedule_state
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON COLUMN booking_requests.gclid IS 'Google Ads click id from the marketing site form, when present';
COMMENT ON COLUMN booking_requests.ga_client_id IS 'GA4 client_id from the marketing site, used as MP client_id for book_job';
COMMENT ON TABLE book_job_conversions IS 'Jobber job ids that already fired the one-shot GA4 book_job conversion';
COMMENT ON TABLE jobber_job_schedule_state IS 'Last observed Jobber schedule state; used to detect first transition onto a start date';
