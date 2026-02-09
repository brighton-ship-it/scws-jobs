-- Drilling Projects Pipeline Tracker
-- Tracks approved drilling quotes through the permit and scheduling process

CREATE TABLE IF NOT EXISTS drilling_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Jobber reference
  quote_id TEXT,
  quote_number TEXT UNIQUE NOT NULL,
  customer_id TEXT,
  
  -- Basic info
  customer_name TEXT NOT NULL,
  property_address TEXT,
  total DECIMAL(10,2) DEFAULT 0,
  quote_date TIMESTAMPTZ,
  
  -- Pipeline stage
  stage TEXT NOT NULL DEFAULT 'deposit' CHECK (
    stage IN ('deposit', 'site_visit', 'permit_prep', 'customer_signature', 'submitted', 'approved', 'scheduled')
  ),
  stage_changed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Stage-specific data
  deposit_amount DECIMAL(10,2),
  deposit_date TIMESTAMPTZ,
  
  site_visit_date TIMESTAMPTZ,
  site_visit_notes TEXT,
  
  permit_submitted_date TIMESTAMPTZ,
  county_tracking_number TEXT,
  county TEXT, -- San Diego, Riverside, etc.
  
  county_approved_date TIMESTAMPTZ,
  permit_number TEXT,
  
  scheduled_date DATE,
  
  -- General notes
  notes TEXT,
  
  -- Raw Jobber data for reference
  jobber_data JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_drilling_projects_stage ON drilling_projects(stage);
CREATE INDEX IF NOT EXISTS idx_drilling_projects_quote_number ON drilling_projects(quote_number);
CREATE INDEX IF NOT EXISTS idx_drilling_projects_customer ON drilling_projects(customer_name);
CREATE INDEX IF NOT EXISTS idx_drilling_projects_stage_changed ON drilling_projects(stage_changed_at);

-- Enable RLS
ALTER TABLE drilling_projects ENABLE ROW LEVEL SECURITY;

-- Policy for authenticated users (full access for now)
CREATE POLICY "Full access for authenticated users" ON drilling_projects
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy for service role (API access)
CREATE POLICY "Service role full access" ON drilling_projects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_drilling_projects_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_drilling_projects_updated_at ON drilling_projects;
CREATE TRIGGER trigger_drilling_projects_updated_at
  BEFORE UPDATE ON drilling_projects
  FOR EACH ROW
  EXECUTE FUNCTION update_drilling_projects_updated_at();
