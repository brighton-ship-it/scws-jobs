-- AI Receptionist Call Records
-- Stores all calls processed by the Vapi AI receptionist

-- ============================================
-- RECEPTIONIST CALLS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS receptionist_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Vapi Integration
  vapi_call_id VARCHAR(100) UNIQUE NOT NULL,
  
  -- Caller Info
  phone VARCHAR(20) NOT NULL,
  customer_name VARCHAR(255),
  customer_id UUID REFERENCES customers(id),
  
  -- Location (extracted from call)
  address VARCHAR(500),
  city VARCHAR(100),
  
  -- Call Content
  service_needed VARCHAR(255),
  transcript TEXT,
  summary TEXT,
  
  -- Call Metadata
  duration_sec INTEGER,
  called_at TIMESTAMPTZ NOT NULL,
  
  -- Processing Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'reviewed', 'scheduled', 'completed', 'spam')),
  priority VARCHAR(20) NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'urgent')),
  
  -- Follow-up Tracking
  assigned_to UUID,  -- Will reference team_members when table exists
  notes TEXT,
  followed_up_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_receptionist_calls_phone ON receptionist_calls(phone);
CREATE INDEX idx_receptionist_calls_status ON receptionist_calls(status);
CREATE INDEX idx_receptionist_calls_priority ON receptionist_calls(priority);
CREATE INDEX idx_receptionist_calls_called_at ON receptionist_calls(called_at DESC);
CREATE INDEX idx_receptionist_calls_customer ON receptionist_calls(customer_id);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_receptionist_calls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receptionist_calls_updated_at
  BEFORE UPDATE ON receptionist_calls
  FOR EACH ROW
  EXECUTE FUNCTION update_receptionist_calls_updated_at();

-- ============================================
-- ADD 'phone' TO BOOKING SOURCE ENUM
-- ============================================
ALTER TABLE booking_requests 
  DROP CONSTRAINT IF EXISTS booking_requests_source_check;

ALTER TABLE booking_requests 
  ADD CONSTRAINT booking_requests_source_check 
  CHECK (source IN ('website', 'embed', 'manual', 'phone'));

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE receptionist_calls IS 'AI Receptionist (Vapi) call records - all incoming phone calls';
COMMENT ON COLUMN receptionist_calls.vapi_call_id IS 'Unique call ID from Vapi API';
COMMENT ON COLUMN receptionist_calls.status IS 'pending=needs review, reviewed=seen, scheduled=job created, completed=done, spam=junk call';
COMMENT ON COLUMN receptionist_calls.priority IS 'urgent=no water/emergency, normal=standard, low=general inquiry';
