-- San Bernardino County Data Migration

-- Add county column to parcel_infrastructure if not exists
ALTER TABLE parcel_infrastructure 
ADD COLUMN IF NOT EXISTS county VARCHAR(50) DEFAULT 'San Diego';

-- Remove unique constraint on just APN, make it APN + County
ALTER TABLE parcel_infrastructure DROP CONSTRAINT IF EXISTS parcel_infrastructure_apn_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_apn_county ON parcel_infrastructure(apn, county);

-- San Bernardino utilities table
CREATE TABLE IF NOT EXISTS sb_utilities (
    id SERIAL PRIMARY KEY,
    utility_type VARCHAR(50), -- water, sewer, storm
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create DWR Wells table (California Well Completion Reports)
CREATE TABLE IF NOT EXISTS dwr_wells (
    id SERIAL PRIMARY KEY,
    wcr_number VARCHAR(50) UNIQUE,
    county VARCHAR(50),
    permit_date DATE,
    permit_number VARCHAR(100),
    owner_well_number VARCHAR(100),
    city VARCHAR(100),
    planned_use VARCHAR(100),
    driller_name VARCHAR(200),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    township VARCHAR(20),
    range VARCHAR(20),
    section VARCHAR(20),
    apn VARCHAR(50),
    total_drill_depth DECIMAL(10, 2),
    total_completed_depth DECIMAL(10, 2),
    top_perforation DECIMAL(10, 2),
    bottom_perforation DECIMAL(10, 2),
    casing_diameter DECIMAL(6, 2),
    static_water_level DECIMAL(10, 2),
    well_yield DECIMAL(10, 2),
    well_yield_unit VARCHAR(20),
    source VARCHAR(50) DEFAULT 'ca_dwr',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for wells
CREATE INDEX IF NOT EXISTS idx_dwr_wells_county ON dwr_wells(county);
CREATE INDEX IF NOT EXISTS idx_dwr_wells_coords ON dwr_wells(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_dwr_wells_apn ON dwr_wells(apn);

-- Spatial index for utilities
CREATE INDEX IF NOT EXISTS idx_sb_utilities_geom ON sb_utilities USING GIST(geometry);
