-- Log-only label for a service caller who reached Mike and hung up with no
-- booking and no callback. The end-of-call report sets this with a notes line.
-- Mike's callback cron does not read this column. It does not text or dial.
-- MIKE_CALLBACKS_ENABLED stays off. Until this is applied, the webhook retries
-- the call update without the column and still saves the note.

ALTER TABLE receptionist_calls
  ADD COLUMN IF NOT EXISTS needs_callback BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN receptionist_calls.needs_callback IS
  'True when the end-of-call report auto-flagged a service caller who hung up with no booking and no callback. Office follow-up only. Does not text or dial.';
