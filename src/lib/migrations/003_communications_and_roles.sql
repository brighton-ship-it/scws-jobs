-- Migration: Communications Log & Team Roles
-- Run this in Supabase SQL Editor

-- ==================== COMMUNICATIONS TABLE ====================
CREATE TABLE IF NOT EXISTS communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('email', 'sms', 'call', 'note')),
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  subject VARCHAR(255),
  body TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_communications_customer ON communications(customer_id);
CREATE INDEX IF NOT EXISTS idx_communications_job ON communications(job_id);
CREATE INDEX IF NOT EXISTS idx_communications_type ON communications(type);
CREATE INDEX IF NOT EXISTS idx_communications_sent_at ON communications(sent_at DESC);

-- ==================== USERS ROLE UPDATE ====================
-- Ensure role column exists with proper enum values
DO $$ BEGIN
  -- Check if role column needs updating
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    -- Update any existing roles to match new schema
    UPDATE users SET role = 'admin' WHERE role NOT IN ('admin', 'office', 'tech', 'field');
  ELSE
    -- Add role column if it doesn't exist
    ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'tech';
  END IF;
END $$;

-- Add constraint to ensure valid roles
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('admin', 'office', 'tech', 'field'));

-- ==================== RLS POLICIES ====================
-- Enable RLS on communications
ALTER TABLE communications ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view communications for customers they have access to
CREATE POLICY IF NOT EXISTS "Users can view communications"
  ON communications FOR SELECT
  USING (
    -- Admins and office can see all
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() 
      AND u.role IN ('admin', 'office')
    )
    OR
    -- Techs can see communications related to their jobs
    EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.id = communications.job_id
      AND j.assigned_to = auth.uid()
    )
  );

-- Policy: Admins and office can insert communications
CREATE POLICY IF NOT EXISTS "Admins and office can insert communications"
  ON communications FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u 
      WHERE u.id = auth.uid() 
      AND u.role IN ('admin', 'office')
    )
  );

-- Grant permissions
GRANT ALL ON communications TO authenticated;
GRANT SELECT ON communications TO anon;
