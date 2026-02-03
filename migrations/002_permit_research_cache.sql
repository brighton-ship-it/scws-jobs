-- Permit Research Cache Tables
-- Stores cached data from external GIS services to avoid repeated API calls

-- Main parcel cache table
CREATE TABLE IF NOT EXISTS permit_research_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Search identifiers
  apn TEXT,
  address TEXT,
  county TEXT NOT NULL CHECK (county IN ('san_diego', 'riverside')),
  
  -- Parcel data
  parcel_data JSONB,
  parcel_geometry JSONB, -- GeoJSON geometry for parcel boundary
  
  -- Well data from DWR
  wells_data JSONB,
  
  -- Septic data (if available)
  septic_data JSONB,
  
  -- Zoning data
  zoning_data JSONB,
  
  -- Metadata
  data_sources JSONB DEFAULT '[]', -- Track which sources returned data
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  
  -- Constraints
  CONSTRAINT unique_apn_county UNIQUE NULLS NOT DISTINCT (apn, county)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_permit_cache_apn ON permit_research_cache (apn);
CREATE INDEX IF NOT EXISTS idx_permit_cache_county ON permit_research_cache (county);
CREATE INDEX IF NOT EXISTS idx_permit_cache_expires ON permit_research_cache (expires_at);

-- Saved permit research reports linked to customers/jobs
CREATE TABLE IF NOT EXISTS permit_research_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Link to customer or job
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  
  -- Report data
  apn TEXT,
  address TEXT NOT NULL,
  county TEXT NOT NULL,
  
  -- Full research results snapshot
  parcel_info JSONB,
  wells_info JSONB,
  septic_info JSONB,
  zoning_info JSONB,
  
  -- PDF link if generated
  pdf_url TEXT,
  
  -- Notes
  notes TEXT,
  
  -- Metadata
  created_by UUID REFERENCES team_members(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for customer/job lookups
CREATE INDEX IF NOT EXISTS idx_permit_reports_customer ON permit_research_reports (customer_id);
CREATE INDEX IF NOT EXISTS idx_permit_reports_job ON permit_research_reports (job_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_permit_cache_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating timestamp
DROP TRIGGER IF EXISTS permit_cache_updated_at ON permit_research_cache;
CREATE TRIGGER permit_cache_updated_at
  BEFORE UPDATE ON permit_research_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_permit_cache_timestamp();

-- RLS Policies
ALTER TABLE permit_research_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE permit_research_reports ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write cache
CREATE POLICY "Authenticated users can manage permit cache"
  ON permit_research_cache FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can manage permit reports"
  ON permit_research_reports FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
