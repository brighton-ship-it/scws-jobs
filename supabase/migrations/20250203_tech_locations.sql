-- Tech Locations for GPS Tracking
-- Stores real-time location data for field technicians

CREATE TABLE IF NOT EXISTS tech_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tech_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    accuracy DOUBLE PRECISION, -- GPS accuracy in meters
    heading DOUBLE PRECISION,  -- Direction of travel (degrees from north)
    speed DOUBLE PRECISION,    -- Speed in m/s
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Each tech can only have one current location
    CONSTRAINT tech_locations_tech_id_unique UNIQUE (tech_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_tech_locations_tech_id ON tech_locations(tech_id);
CREATE INDEX IF NOT EXISTS idx_tech_locations_updated_at ON tech_locations(updated_at);

-- Enable RLS
ALTER TABLE tech_locations ENABLE ROW LEVEL SECURITY;

-- Policies
-- Field techs can update their own location
CREATE POLICY "Techs can update their own location"
    ON tech_locations
    FOR ALL
    USING (auth.uid() = tech_id)
    WITH CHECK (auth.uid() = tech_id);

-- Admins and office staff can view all locations
CREATE POLICY "Staff can view all locations"
    ON tech_locations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('admin', 'office')
        )
    );

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE tech_locations;

-- Function to update location (upsert)
CREATE OR REPLACE FUNCTION update_tech_location(
    p_tech_id UUID,
    p_lat DOUBLE PRECISION,
    p_lng DOUBLE PRECISION,
    p_accuracy DOUBLE PRECISION DEFAULT NULL,
    p_heading DOUBLE PRECISION DEFAULT NULL,
    p_speed DOUBLE PRECISION DEFAULT NULL
)
RETURNS tech_locations AS $$
DECLARE
    result tech_locations;
BEGIN
    INSERT INTO tech_locations (tech_id, lat, lng, accuracy, heading, speed, updated_at)
    VALUES (p_tech_id, p_lat, p_lng, p_accuracy, p_heading, p_speed, NOW())
    ON CONFLICT (tech_id) 
    DO UPDATE SET
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        accuracy = EXCLUDED.accuracy,
        heading = EXCLUDED.heading,
        speed = EXCLUDED.speed,
        updated_at = NOW()
    RETURNING * INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_tech_location TO authenticated;

COMMENT ON TABLE tech_locations IS 'Real-time GPS locations for field technicians';
COMMENT ON COLUMN tech_locations.accuracy IS 'GPS accuracy in meters';
COMMENT ON COLUMN tech_locations.heading IS 'Direction of travel in degrees from north (0-360)';
COMMENT ON COLUMN tech_locations.speed IS 'Speed in meters per second';
