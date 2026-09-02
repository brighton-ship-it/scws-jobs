import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/require-auth';
import { createServiceClient } from '@/lib/supabase/server';
import { mapTrackerRows } from '@/lib/wells/tracker';

export const dynamic = 'force-dynamic';

/**
 * GET /api/wells/tracker
 * Real CRM well_info only. Empty list if none — never dummy Oak Tree / Johnson / Chen.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('well_info')
      .select(
        `
        id,
        property_id,
        well_depth,
        static_water_level,
        pump_hp,
        pump_model,
        notes,
        properties (
          id,
          address,
          city,
          county,
          customer_id,
          customers (
            id,
            name
          )
        )
      `
      )
      .order('well_depth', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Well tracker CRM error:', error.message);
      return NextResponse.json({
        wells: [],
        source: 'crm',
        message: 'No CRM well records available.',
      });
    }

    return NextResponse.json({
      wells: mapTrackerRows(data),
      source: 'crm',
    });
  } catch (err: unknown) {
    console.error('Well tracker error:', err);
    return NextResponse.json({
      wells: [],
      source: 'crm',
      message: 'No CRM well records available.',
    });
  }
}
