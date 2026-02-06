-- Online Booking / Service Requests
-- Public booking form submissions from website/embed widget

-- ============================================
-- BOOKING REQUESTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Service Info
  service_type VARCHAR(100) NOT NULL,
  
  -- Contact Info  
  customer_name VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  
  -- Address
  address VARCHAR(500) NOT NULL,
  city VARCHAR(100) NOT NULL,
  
  -- Scheduling Preference
  preferred_date DATE,
  preferred_time VARCHAR(20),
  
  -- Notes
  notes TEXT,
  
  -- Status & Linking
  status VARCHAR(20) NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'confirmed', 'scheduled', 'cancelled')),
  customer_id UUID REFERENCES customers(id),  -- Linked if matched/created
  job_id UUID REFERENCES jobs(id),  -- Linked if scheduled
  
  -- Tracking
  source VARCHAR(20) DEFAULT 'website' CHECK (source IN ('website', 'embed', 'manual')),
  ip_address VARCHAR(45),  -- IPv4 or IPv6
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_booking_requests_status ON booking_requests(status);
CREATE INDEX idx_booking_requests_created ON booking_requests(created_at DESC);
CREATE INDEX idx_booking_requests_phone ON booking_requests(phone);
CREATE INDEX idx_booking_requests_customer ON booking_requests(customer_id) WHERE customer_id IS NOT NULL;

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE TRIGGER update_booking_requests_updated_at
  BEFORE UPDATE ON booking_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view booking requests
CREATE POLICY booking_requests_select ON booking_requests
  FOR SELECT TO authenticated
  USING (true);

-- All authenticated users can insert/update booking requests  
CREATE POLICY booking_requests_insert ON booking_requests
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY booking_requests_update ON booking_requests
  FOR UPDATE TO authenticated
  USING (true);

-- Allow public/anon to insert (for public booking form)
CREATE POLICY booking_requests_public_insert ON booking_requests
  FOR INSERT TO anon
  WITH CHECK (true);

-- ============================================
-- ADD recurring_schedule_id TO JOBS
-- ============================================
-- Add column to link jobs back to recurring schedule
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jobs' AND column_name = 'recurring_schedule_id'
  ) THEN
    ALTER TABLE jobs ADD COLUMN recurring_schedule_id UUID REFERENCES recurring_jobs(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_recurring ON jobs(recurring_schedule_id) WHERE recurring_schedule_id IS NOT NULL;

-- ============================================
-- CREATE RECURRING_SCHEDULES VIEW (alias)
-- ============================================
-- Create a view that maps to our API expectations
CREATE OR REPLACE VIEW recurring_schedules AS
SELECT 
  id,
  customer_id,
  property_id,
  title AS job_type,
  description,
  estimated_duration_minutes::text AS estimated_duration,
  frequency,
  next_scheduled AS next_run,
  last_job_created_at::date AS last_run,
  (status = 'active') AS active,
  assigned_to,
  price,
  internal_notes,
  jobs_created,
  created_at,
  updated_at,
  NULL::uuid AS job_id
FROM recurring_jobs;

-- Comment
COMMENT ON TABLE booking_requests IS 'Online booking form submissions from website and embed widget';
