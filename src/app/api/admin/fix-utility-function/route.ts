import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// This endpoint fixes the get_nearby_utilities function
// Run once then delete this file

const FIX_SQL = `
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
`;

function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: NextRequest) {
  // Check for admin secret
  const authHeader = request.headers.get('authorization');
  const expectedSecret = process.env.ADMIN_SECRET;
  
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const supabase = createServiceClient();
    
    // We can't run raw SQL via the REST API, but we can create a helper
    // The fix needs to be run in the Supabase SQL Editor
    
    return NextResponse.json({
      status: 'manual_action_required',
      message: 'The SQL fix needs to be run in Supabase SQL Editor',
      sql: FIX_SQL,
      instructions: [
        '1. Go to https://supabase.com/dashboard/project/htzsnpqrrrdfleldgybn/sql/new',
        '2. Paste the SQL from the "sql" field',
        '3. Click "Run"',
        '4. Test with: SELECT * FROM get_nearby_utilities(\'sd_sewer_mains\', 32.77, -117.07, 500);'
      ]
    });
  } catch (error) {
    console.error('Fix utility function error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
