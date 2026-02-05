-- ============================================
-- SAN BERNARDINO COUNTY UTILITIES MIGRATION
-- Water Service Area Boundaries from CA State Water Board
-- ============================================

-- Create table for San Bernardino water service areas
CREATE TABLE IF NOT EXISTS sb_water_service_areas (
    id SERIAL PRIMARY KEY,
    water_system_number VARCHAR(20),
    water_system_name VARCHAR(255),
    county VARCHAR(100) DEFAULT 'SAN BERNARDINO',
    population INTEGER,
    service_connections INTEGER,
    owner_type VARCHAR(10),
    regulating_agency VARCHAR(100),
    boundary_type VARCHAR(50),
    verified_status VARCHAR(50),
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    bbox BOX2D GENERATED ALWAYS AS (ST_Extent(geometry::geometry)) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create spatial index
CREATE INDEX IF NOT EXISTS idx_sb_water_service_areas_geom 
ON sb_water_service_areas USING GIST (geometry);

-- Create index on water system name
CREATE INDEX IF NOT EXISTS idx_sb_water_service_areas_name 
ON sb_water_service_areas (water_system_name);

-- Create index on county (for multi-county queries)
CREATE INDEX IF NOT EXISTS idx_sb_water_service_areas_county 
ON sb_water_service_areas (county);

-- Imperial County water service areas (same source)
CREATE TABLE IF NOT EXISTS imperial_water_service_areas (
    id SERIAL PRIMARY KEY,
    water_system_number VARCHAR(20),
    water_system_name VARCHAR(255),
    county VARCHAR(100) DEFAULT 'IMPERIAL',
    population INTEGER,
    service_connections INTEGER,
    owner_type VARCHAR(10),
    regulating_agency VARCHAR(100),
    boundary_type VARCHAR(50),
    verified_status VARCHAR(50),
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_imperial_water_service_areas_geom 
ON imperial_water_service_areas USING GIST (geometry);

-- Update utility coverage tracking
INSERT INTO utility_coverage (county, city, utility_type, source, feature_count, last_updated, notes)
VALUES 
    ('San Bernardino', NULL, 'water_service_areas', 'CA State Water Resources Control Board', 0, NOW(), 'Water system service area boundaries'),
    ('Imperial', NULL, 'water_service_areas', 'CA State Water Resources Control Board', 0, NOW(), 'Water system service area boundaries')
ON CONFLICT DO NOTHING;

-- Create function to find water service area at a point
CREATE OR REPLACE FUNCTION get_water_service_area_at_point(
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION
)
RETURNS TABLE (
    id INTEGER,
    water_system_number VARCHAR,
    water_system_name VARCHAR,
    county VARCHAR,
    population INTEGER,
    service_connections INTEGER,
    regulating_agency VARCHAR,
    verified_status VARCHAR,
    properties JSONB,
    geometry JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        s.water_system_number,
        s.water_system_name,
        s.county,
        s.population,
        s.service_connections,
        s.regulating_agency,
        s.verified_status,
        s.properties,
        ST_AsGeoJSON(s.geometry)::JSONB as geometry
    FROM sb_water_service_areas s
    WHERE ST_Contains(s.geometry, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
    
    UNION ALL
    
    SELECT 
        i.id,
        i.water_system_number,
        i.water_system_name,
        i.county,
        i.population,
        i.service_connections,
        i.regulating_agency,
        i.verified_status,
        i.properties,
        ST_AsGeoJSON(i.geometry)::JSONB as geometry
    FROM imperial_water_service_areas i
    WHERE ST_Contains(i.geometry, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
    
    LIMIT 10;
END;
$$;
