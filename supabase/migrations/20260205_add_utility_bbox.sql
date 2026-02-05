-- Add bounding box columns for efficient spatial queries
-- Without PostGIS extension, we use simple lat/lng bounds

-- SD Sewer Mains
ALTER TABLE sd_sewer_mains ADD COLUMN IF NOT EXISTS min_lat double precision;
ALTER TABLE sd_sewer_mains ADD COLUMN IF NOT EXISTS max_lat double precision;
ALTER TABLE sd_sewer_mains ADD COLUMN IF NOT EXISTS min_lng double precision;
ALTER TABLE sd_sewer_mains ADD COLUMN IF NOT EXISTS max_lng double precision;

CREATE INDEX IF NOT EXISTS idx_sd_sewer_mains_lat ON sd_sewer_mains (min_lat, max_lat);
CREATE INDEX IF NOT EXISTS idx_sd_sewer_mains_lng ON sd_sewer_mains (min_lng, max_lng);

-- SD Storm Drains
ALTER TABLE sd_storm_drains ADD COLUMN IF NOT EXISTS min_lat double precision;
ALTER TABLE sd_storm_drains ADD COLUMN IF NOT EXISTS max_lat double precision;
ALTER TABLE sd_storm_drains ADD COLUMN IF NOT EXISTS min_lng double precision;
ALTER TABLE sd_storm_drains ADD COLUMN IF NOT EXISTS max_lng double precision;

CREATE INDEX IF NOT EXISTS idx_sd_storm_drains_lat ON sd_storm_drains (min_lat, max_lat);
CREATE INDEX IF NOT EXISTS idx_sd_storm_drains_lng ON sd_storm_drains (min_lng, max_lng);

-- SD Water Mains (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sd_water_mains') THEN
    ALTER TABLE sd_water_mains ADD COLUMN IF NOT EXISTS min_lat double precision;
    ALTER TABLE sd_water_mains ADD COLUMN IF NOT EXISTS max_lat double precision;
    ALTER TABLE sd_water_mains ADD COLUMN IF NOT EXISTS min_lng double precision;
    ALTER TABLE sd_water_mains ADD COLUMN IF NOT EXISTS max_lng double precision;
    CREATE INDEX IF NOT EXISTS idx_sd_water_mains_lat ON sd_water_mains (min_lat, max_lat);
    CREATE INDEX IF NOT EXISTS idx_sd_water_mains_lng ON sd_water_mains (min_lng, max_lng);
  END IF;
END $$;

-- Riverside Sewer Mains
ALTER TABLE riverside_sewer_mains ADD COLUMN IF NOT EXISTS min_lat double precision;
ALTER TABLE riverside_sewer_mains ADD COLUMN IF NOT EXISTS max_lat double precision;
ALTER TABLE riverside_sewer_mains ADD COLUMN IF NOT EXISTS min_lng double precision;
ALTER TABLE riverside_sewer_mains ADD COLUMN IF NOT EXISTS max_lng double precision;

CREATE INDEX IF NOT EXISTS idx_riverside_sewer_lat ON riverside_sewer_mains (min_lat, max_lat);
CREATE INDEX IF NOT EXISTS idx_riverside_sewer_lng ON riverside_sewer_mains (min_lng, max_lng);

-- Create function to extract bbox from geometry JSONB
CREATE OR REPLACE FUNCTION extract_geojson_bbox(geom jsonb)
RETURNS TABLE (min_lat double precision, max_lat double precision, min_lng double precision, max_lng double precision)
LANGUAGE plpgsql
AS $$
DECLARE
  coords jsonb;
  coord jsonb;
  lng double precision;
  lat double precision;
  _min_lat double precision := 90;
  _max_lat double precision := -90;
  _min_lng double precision := 180;
  _max_lng double precision := -180;
BEGIN
  -- Get coordinates based on geometry type
  IF geom->>'type' = 'Point' THEN
    coords := jsonb_build_array(geom->'coordinates');
  ELSIF geom->>'type' = 'LineString' THEN
    coords := geom->'coordinates';
  ELSIF geom->>'type' = 'MultiLineString' THEN
    SELECT jsonb_agg(c) INTO coords
    FROM jsonb_array_elements(geom->'coordinates') AS lines,
         jsonb_array_elements(lines) AS c;
  ELSIF geom->>'type' = 'Polygon' THEN
    coords := geom->'coordinates'->0;
  ELSE
    RETURN QUERY SELECT NULL::double precision, NULL::double precision, NULL::double precision, NULL::double precision;
    RETURN;
  END IF;
  
  -- Calculate bounds
  FOR coord IN SELECT * FROM jsonb_array_elements(coords)
  LOOP
    lng := (coord->>0)::double precision;
    lat := (coord->>1)::double precision;
    IF lat < _min_lat THEN _min_lat := lat; END IF;
    IF lat > _max_lat THEN _max_lat := lat; END IF;
    IF lng < _min_lng THEN _min_lng := lng; END IF;
    IF lng > _max_lng THEN _max_lng := lng; END IF;
  END LOOP;
  
  RETURN QUERY SELECT _min_lat, _max_lat, _min_lng, _max_lng;
END;
$$;

-- Backfill SD sewer mains
UPDATE sd_sewer_mains
SET 
  min_lat = bbox.min_lat,
  max_lat = bbox.max_lat,
  min_lng = bbox.min_lng,
  max_lng = bbox.max_lng
FROM extract_geojson_bbox(geometry) AS bbox
WHERE sd_sewer_mains.min_lat IS NULL;

-- Backfill SD storm drains
UPDATE sd_storm_drains
SET 
  min_lat = bbox.min_lat,
  max_lat = bbox.max_lat,
  min_lng = bbox.min_lng,
  max_lng = bbox.max_lng
FROM extract_geojson_bbox(geometry) AS bbox
WHERE sd_storm_drains.min_lat IS NULL;

-- Backfill Riverside sewer
UPDATE riverside_sewer_mains
SET 
  min_lat = bbox.min_lat,
  max_lat = bbox.max_lat,
  min_lng = bbox.min_lng,
  max_lng = bbox.max_lng
FROM extract_geojson_bbox(geometry) AS bbox
WHERE riverside_sewer_mains.min_lat IS NULL;
