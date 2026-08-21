-- Allow Google Ads (and other live intake channels) on booking_requests.source.
-- Production was rejecting source = 'google_ads' via booking_requests_source_check
-- and dropping real website/ads form leads.
--
-- Safe on the existing table: drop/recreate the check only. No data wipe.

ALTER TABLE booking_requests
  DROP CONSTRAINT IF EXISTS booking_requests_source_check;

ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_source_check
  CHECK (source IN (
    'website',
    'embed',
    'manual',
    'phone',
    'google_ads',
    'cost-calculator'
  ));

COMMENT ON COLUMN booking_requests.source IS
  'Intake channel: website, embed, manual, phone, google_ads, cost-calculator';
