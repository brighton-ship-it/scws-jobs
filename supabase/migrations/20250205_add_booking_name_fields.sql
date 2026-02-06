-- Add first_name and last_name columns to booking_requests
ALTER TABLE booking_requests
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Add comment for clarity
COMMENT ON COLUMN booking_requests.first_name IS 'Customer first name';
COMMENT ON COLUMN booking_requests.last_name IS 'Customer last name';
