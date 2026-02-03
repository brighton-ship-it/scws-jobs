-- ==================== COMMUNICATIONS LOG ====================

-- Communications Table
CREATE TABLE IF NOT EXISTS communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'sms', 'call', 'note')),
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  subject TEXT,
  body TEXT,
  sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================== TEAM ROLES ====================

-- Add role column to users if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'users' AND column_name = 'role') THEN
    ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'tech' CHECK (role IN ('admin', 'office', 'tech'));
  END IF;
END $$;

-- Update Brighton to admin
UPDATE users SET role = 'admin' WHERE email = 'brighton@scwellservice.com';
UPDATE users SET role = 'admin' WHERE email = 'info@scwellservice.com';

-- Update admins from team list
UPDATE users SET role = 'admin' WHERE email IN (
  'bschroeder@scwellservice.com',
  'lizbeth@scwellservice.com',
  'roger@scwellservice.com',
  'shanicey@scwellservice.com',
  'travis@scwellservice.com'
);

-- ==================== INDEXES ====================

CREATE INDEX IF NOT EXISTS idx_communications_customer ON communications(customer_id);
CREATE INDEX IF NOT EXISTS idx_communications_job ON communications(job_id);
CREATE INDEX IF NOT EXISTS idx_communications_type ON communications(type);
CREATE INDEX IF NOT EXISTS idx_communications_sent_at ON communications(sent_at);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ==================== RLS POLICIES ====================

ALTER TABLE communications ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Allow all access to communications" ON communications FOR ALL USING (true);
