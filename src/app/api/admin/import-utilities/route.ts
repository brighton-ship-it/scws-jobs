import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

// Valid table names for import
const VALID_TABLES = [
  'sd_sewer_mains', 'sd_sewer_manholes', 'sd_water_mains', 'sd_water_hydrants', 'sd_storm_drains',
  'riverside_sewer_mains', 'riverside_sewer_manholes', 'riverside_storm_drains', 'riverside_water_hydrants',
  'ca_electric_transmission', 'ca_water_districts', 'utility_coverage'
];

/**
 * POST /api/admin/import-utilities
 * Import GeoJSON features into utility tables
 * 
 * Body:
 * - table: target table name
 * - features: array of GeoJSON features
 * - city: optional city name for Riverside tables
 * - source: source file name for tracking
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin secret
    const authHeader = request.headers.get('authorization');
    const adminSecret = process.env.SUPABASE_SERVICE_KEY;
    
    if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { table, features, city, source } = body;

    if (!table || !VALID_TABLES.includes(table)) {
      return NextResponse.json(
        { error: `Invalid table. Must be one of: ${VALID_TABLES.join(', ')}` },
        { status: 400 }
      );
    }

    if (!features || !Array.isArray(features) || features.length === 0) {
      return NextResponse.json(
        { error: 'features array is required' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < features.length; i += batchSize) {
      const batch = features.slice(i, i + batchSize);
      
      const rows = batch.map((feature: any) => {
        const row: any = {
          properties: feature.properties || {},
          geometry: feature.geometry ? JSON.stringify(feature.geometry) : null,
        };
        if (city && table.startsWith('riverside_')) {
          row.city = city;
        }
        return row;
      }).filter((r: any) => r.geometry); // Skip features without geometry

      if (rows.length === 0) continue;

      const { data, error } = await supabase
        .from(table)
        .insert(rows);

      if (error) {
        failed += rows.length;
        errors.push(`Batch ${i}-${i + rows.length}: ${error.message}`);
      } else {
        imported += rows.length;
      }
    }

    // Update coverage tracking
    if (imported > 0 && source) {
      const county = table.startsWith('sd_') ? 'San Diego' : 
                     table.startsWith('riverside_') ? 'Riverside' : 'California';
      const utilityType = table.replace(/^(sd_|riverside_|ca_)/, '').replace(/_/g, ' ');

      await supabase.from('utility_coverage').upsert({
        county,
        city: city || null,
        utility_type: utilityType,
        source,
        feature_count: imported,
        last_updated: new Date().toISOString(),
      }, {
        onConflict: 'county,city,utility_type',
        ignoreDuplicates: false,
      });
    }

    return NextResponse.json({
      success: true,
      table,
      imported,
      failed,
      total: features.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Limit error output
    });
  } catch (error) {
    console.error('Import utilities error:', error);
    return NextResponse.json(
      { error: 'Import failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/import-utilities
 * Get import status / table row counts
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const adminSecret = process.env.SUPABASE_SERVICE_KEY;
    
    if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const counts: Record<string, number> = {};

    for (const table of VALID_TABLES) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (!error) {
        counts[table] = count || 0;
      } else {
        counts[table] = -1; // Table doesn't exist
      }
    }

    // Get coverage summary
    const { data: coverage } = await supabase
      .from('utility_coverage')
      .select('*')
      .order('county', { ascending: true });

    return NextResponse.json({
      tables: counts,
      coverage: coverage || [],
      totalFeatures: Object.values(counts).filter(c => c > 0).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    console.error('Import status error:', error);
    return NextResponse.json(
      { error: 'Status check failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    );
  }
}
