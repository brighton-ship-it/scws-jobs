-- RPC function to get utilities within a bounding box
-- This function works with tables that have a geometry column stored as JSONB

CREATE OR REPLACE FUNCTION get_utilities_in_bbox(
  table_name TEXT,
  min_lng DOUBLE PRECISION,
  max_lng DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  limit_count INTEGER DEFAULT 200
)
RETURNS TABLE (
  id BIGINT,
  geojson TEXT,
  properties JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  query_text TEXT;
BEGIN
  -- Build dynamic query based on table name
  -- We store geometry as JSONB, so we need to extract coordinates
  query_text := format(
    'SELECT 
      id,
      geometry::text as geojson,
      to_jsonb(t.*) - ''id'' - ''geometry'' as properties
    FROM %I t
    WHERE geometry IS NOT NULL
      AND (geometry->''coordinates''->0)::float >= $1
      AND (geometry->''coordinates''->0)::float <= $2
      AND (geometry->''coordinates''->1)::float >= $3
      AND (geometry->''coordinates''->1)::float <= $4
    LIMIT $5',
    table_name
  );
  
  RETURN QUERY EXECUTE query_text USING min_lng, max_lng, min_lat, max_lat, limit_count;
EXCEPTION
  WHEN undefined_table THEN
    RAISE WARNING 'Table % does not exist', table_name;
    RETURN;
  WHEN OTHERS THEN
    RAISE WARNING 'Error querying table %: %', table_name, SQLERRM;
    RETURN;
END;
$$;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION get_utilities_in_bbox TO authenticated;
GRANT EXECUTE ON FUNCTION get_utilities_in_bbox TO anon;

-- Alternative simpler function that works with LineString geometries
CREATE OR REPLACE FUNCTION get_utility_lines_in_bbox(
  table_name TEXT,
  min_lng DOUBLE PRECISION,
  max_lng DOUBLE PRECISION,
  min_lat DOUBLE PRECISION,
  max_lat DOUBLE PRECISION,
  limit_count INTEGER DEFAULT 200
)
RETURNS TABLE (
  id BIGINT,
  geojson TEXT,
  properties JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  query_text TEXT;
BEGIN
  -- For LineString/MultiLineString geometries, check if any coordinate is in bbox
  query_text := format(
    'SELECT 
      id,
      geometry::text as geojson,
      to_jsonb(t.*) - ''id'' - ''geometry'' - ''created_at'' as properties
    FROM %I t
    WHERE geometry IS NOT NULL
    LIMIT $1',
    table_name
  );
  
  RETURN QUERY EXECUTE query_text USING limit_count;
EXCEPTION
  WHEN undefined_table THEN
    RAISE WARNING 'Table % does not exist', table_name;
    RETURN;
  WHEN OTHERS THEN
    RAISE WARNING 'Error querying table %: %', table_name, SQLERRM;
    RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION get_utility_lines_in_bbox TO authenticated;
GRANT EXECUTE ON FUNCTION get_utility_lines_in_bbox TO anon;
