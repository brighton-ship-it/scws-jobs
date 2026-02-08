-- Permits table for tracking well permits
CREATE TABLE IF NOT EXISTS permits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_number VARCHAR(50),
  wp_number VARCHAR(50),
  county VARCHAR(100),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(2) DEFAULT 'CA',
  zip VARCHAR(10),
  customer_id UUID REFERENCES customers(id),
  job_id UUID REFERENCES jobs(id),
  status VARCHAR(50) DEFAULT 'active',
  issue_date DATE,
  expiration_date DATE,
  permit_type VARCHAR(50) DEFAULT 'well',
  pdf_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookups
CREATE INDEX idx_permits_permit_number ON permits(permit_number);
CREATE INDEX idx_permits_wp_number ON permits(wp_number);
CREATE INDEX idx_permits_address ON permits(address);
CREATE INDEX idx_permits_customer_id ON permits(customer_id);

-- RLS
ALTER TABLE permits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permits are viewable by authenticated users"
  ON permits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Permits are insertable by authenticated users"
  ON permits FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Permits are updatable by authenticated users"
  ON permits FOR UPDATE
  TO authenticated
  USING (true);
