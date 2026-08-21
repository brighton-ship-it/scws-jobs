-- Allow booking_requests.source values the live site and this app actually send.
-- Production was 500ing Google Ads form posts (source = google_ads) because
-- booking_requests_source_check only allowed website/embed/manual/phone.
--
-- Safe on the existing production table: DROP/ADD the CHECK only. No data wipe.

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
    'cost-calculator',
    'other'
  ));

COMMENT ON COLUMN booking_requests.source IS
  'Intake channel: website, embed, manual, phone, google_ads, cost-calculator, or other (unknown sources normalized by the API).';
