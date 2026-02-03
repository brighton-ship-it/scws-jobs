-- Parcel Infrastructure Data
-- Stores septic/sewer designation, water/sewer main proximity for each parcel

-- Main parcel data table (septic vs sewer designation)
CREATE TABLE IF NOT EXISTS parcel_infrastructure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apn VARCHAR(20) NOT NULL UNIQUE,
  
  -- Septic/Sewer designation from SanGIS WW_Septic_Sewer_Public
  sewer_septic_designation VARCHAR(50), -- 'Known Septic Connected', 'Sewer Connected', 'Not Known'
  designation_confidence VARCHAR(50),
  designation_updated_at TIMESTAMPTZ,
  
  -- Coordinates
  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),
  x_coord DECIMAL(12, 4), -- State Plane
  y_coord DECIMAL(12, 4),
  
  -- Address info (from address_points join)
  full_address TEXT,
  city VARCHAR(100),
  zip VARCHAR(10),
  
  -- Nearest infrastructure distances (calculated)
  nearest_sewer_main_ft DECIMAL(10, 2),
  nearest_water_main_ft DECIMAL(10, 2),
  
  -- Well setback info
  has_existing_well BOOLEAN DEFAULT FALSE,
  well_count INTEGER DEFAULT 0,
  
  -- Metadata
  data_source VARCHAR(50) DEFAULT 'sangis',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast APN lookups
CREATE INDEX IF NOT EXISTS idx_parcel_infrastructure_apn ON parcel_infrastructure(apn);
CREATE INDEX IF NOT EXISTS idx_parcel_infrastructure_designation ON parcel_infrastructure(sewer_septic_designation);
CREATE INDEX IF NOT EXISTS idx_parcel_infrastructure_coords ON parcel_infrastructure(latitude, longitude);

-- Water main lines (for proximity calculations)
CREATE TABLE IF NOT EXISTS water_mains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id VARCHAR(50),
  material VARCHAR(50),
  diameter_inches DECIMAL(6, 2),
  install_date DATE,
  status VARCHAR(20),
  geom_json TEXT, -- GeoJSON LineString
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sewer main lines
CREATE TABLE IF NOT EXISTS sewer_mains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id VARCHAR(50),
  material VARCHAR(50),
  diameter_inches DECIMAL(6, 2),
  install_date DATE,
  status VARCHAR(20),
  forced_main BOOLEAN DEFAULT FALSE,
  geom_json TEXT, -- GeoJSON LineString
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link customer records to parcel infrastructure
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS apn VARCHAR(20),
ADD COLUMN IF NOT EXISTS parcel_infrastructure_id UUID REFERENCES parcel_infrastructure(id);

CREATE INDEX IF NOT EXISTS idx_customers_apn ON customers(apn);

-- Function to get infrastructure summary for a customer
CREATE OR REPLACE FUNCTION get_customer_infrastructure(customer_uuid UUID)
RETURNS TABLE (
  apn VARCHAR(20),
  sewer_septic VARCHAR(50),
  nearest_sewer_ft DECIMAL,
  nearest_water_ft DECIMAL,
  has_well BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pi.apn,
    pi.sewer_septic_designation,
    pi.nearest_sewer_main_ft,
    pi.nearest_water_main_ft,
    pi.has_existing_well
  FROM customers c
  JOIN parcel_infrastructure pi ON c.parcel_infrastructure_id = pi.id
  WHERE c.id = customer_uuid;
END;
$$ LANGUAGE plpgsql;

-- View for quick infrastructure lookup
CREATE OR REPLACE VIEW customer_infrastructure_view AS
SELECT 
  c.id AS customer_id,
  c.name AS customer_name,
  c.address,
  pi.apn,
  pi.sewer_septic_designation,
  CASE 
    WHEN pi.sewer_septic_designation = 'Known Septic Connected' THEN 'SEPTIC'
    WHEN pi.sewer_septic_designation LIKE '%Sewer%' THEN 'SEWER'
    ELSE 'UNKNOWN'
  END AS water_type,
  pi.nearest_sewer_main_ft,
  pi.nearest_water_main_ft,
  pi.has_existing_well,
  pi.well_count
FROM customers c
LEFT JOIN parcel_infrastructure pi ON c.parcel_infrastructure_id = pi.id;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER parcel_infrastructure_updated_at
  BEFORE UPDATE ON parcel_infrastructure
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Comments
COMMENT ON TABLE parcel_infrastructure IS 'Parcel-level infrastructure data from SanGIS - septic/sewer designation and utility distances';
COMMENT ON COLUMN parcel_infrastructure.sewer_septic_designation IS 'From SanGIS WW_Septic_Sewer_Public layer';
COMMENT ON COLUMN parcel_infrastructure.nearest_sewer_main_ft IS 'Distance in feet to nearest sewer main line';
COMMENT ON COLUMN parcel_infrastructure.nearest_water_main_ft IS 'Distance in feet to nearest water main line';
