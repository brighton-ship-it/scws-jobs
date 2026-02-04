-- Fix get_nearby_utilities function to handle tables without city column
DROP FUNCTION IF EXISTS get_nearby_utilities(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER);

CREATE OR REPLACE FUNCTION get_nearby_utilities(
    p_table_name TEXT,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_radius_meters INTEGER DEFAULT 500
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
DECLARE
    has_city_col BOOLEAN;
BEGIN
    -- Check if table has city column
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = p_table_name 
        AND column_name = 'city'
    ) INTO has_city_col;
    
    IF has_city_col THEN
        RETURN QUERY EXECUTE format(
            'SELECT 
                t.id,
                t.properties,
                ST_AsGeoJSON(t.geometry)::jsonb as geometry,
                t.city,
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
            p_table_name
        ) USING p_lat, p_lng, p_radius_meters;
    ELSE
        RETURN QUERY EXECUTE format(
            'SELECT 
                t.id,
                t.properties,
                ST_AsGeoJSON(t.geometry)::jsonb as geometry,
                NULL::VARCHAR(100) as city,
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
            p_table_name
        ) USING p_lat, p_lng, p_radius_meters;
    END IF;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_nearby_utilities TO authenticated;
GRANT EXECUTE ON FUNCTION get_nearby_utilities TO service_role;
GRANT EXECUTE ON FUNCTION get_nearby_utilities TO anon;
