-- ============================================
-- UTILITY INFRASTRUCTURE MIGRATION
-- Run this in Supabase Dashboard SQL Editor
-- ============================================

-- Enable PostGIS if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- San Diego County Utilities
CREATE TABLE IF NOT EXISTS sd_sewer_mains (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sd_sewer_manholes (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sd_water_mains (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sd_water_hydrants (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sd_storm_drains (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Riverside County Utilities
CREATE TABLE IF NOT EXISTS riverside_sewer_mains (
    id SERIAL PRIMARY KEY,
    city VARCHAR(100),
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS riverside_sewer_manholes (
    id SERIAL PRIMARY KEY,
    city VARCHAR(100),
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS riverside_storm_drains (
    id SERIAL PRIMARY KEY,
    city VARCHAR(100),
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS riverside_water_hydrants (
    id SERIAL PRIMARY KEY,
    city VARCHAR(100),
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Statewide/Regional
CREATE TABLE IF NOT EXISTS ca_electric_transmission (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ca_water_districts (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geometry GEOMETRY(Geometry, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Utility coverage tracking
CREATE TABLE IF NOT EXISTS utility_coverage (
    id SERIAL PRIMARY KEY,
    county VARCHAR(50),
    city VARCHAR(100),
    utility_type VARCHAR(50),
    source VARCHAR(255),
    feature_count INT,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(county, city, utility_type)
);

-- Spatial indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_sd_sewer_mains_geom ON sd_sewer_mains USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_sd_sewer_manholes_geom ON sd_sewer_manholes USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_sd_water_mains_geom ON sd_water_mains USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_sd_water_hydrants_geom ON sd_water_hydrants USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_sd_storm_drains_geom ON sd_storm_drains USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_riverside_sewer_mains_geom ON riverside_sewer_mains USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_riverside_sewer_manholes_geom ON riverside_sewer_manholes USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_riverside_storm_drains_geom ON riverside_storm_drains USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_riverside_water_hydrants_geom ON riverside_water_hydrants USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_ca_electric_geom ON ca_electric_transmission USING GIST (geometry);
CREATE INDEX IF NOT EXISTS idx_ca_water_districts_geom ON ca_water_districts USING GIST (geometry);

-- ============================================
-- RPC FUNCTION FOR NEARBY UTILITY QUERIES
-- ============================================

CREATE OR REPLACE FUNCTION get_nearby_utilities(
    table_name TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    radius_meters INTEGER DEFAULT 500
)
RETURNS TABLE (
    id INTEGER,
    properties JSONB,
    geometry JSONB,
    city VARCHAR(100),
    distance_meters DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY EXECUTE format(
        'SELECT 
            t.id,
            t.properties,
            ST_AsGeoJSON(t.geometry)::jsonb as geometry,
            COALESCE(t.city, NULL) as city,
            ST_Distance(
                t.geometry::geography,
                ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
            ) as distance_meters
        FROM %I t
        WHERE ST_DWithin(
            t.geometry::geography,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
            $3
        )
        ORDER BY distance_meters
        LIMIT 500',
        table_name
    ) USING lat, lng, radius_meters;
END;
$$;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION get_nearby_utilities TO authenticated;
GRANT EXECUTE ON FUNCTION get_nearby_utilities TO service_role;
GRANT EXECUTE ON FUNCTION get_nearby_utilities TO anon;

-- ============================================
-- DONE!
-- ============================================
