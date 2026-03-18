export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/equipment/warranty-alerts - Get equipment with expiring warranties
 * Query params: ?days=30 (default 30)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    // Calculate the date range
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    const { data: alerts, error } = await supabase
      .from('customer_equipment')
      .select(`
        *,
        customer:customers(id, name, phone, email),
        property:properties(id, address, city)
      `)
      .not('warranty_expires', 'is', null)
      .lte('warranty_expires', futureDate.toISOString().split('T')[0])
      .order('warranty_expires', { ascending: true });

    if (error) {
      console.error('Error fetching warranty alerts:', error);
      return NextResponse.json(
        { error: 'Failed to fetch warranty alerts', details: error.message },
        { status: 500 }
      );
    }

    // Add warranty status to each item
    const todayStr = today.toISOString().split('T')[0];
    const alertsWithStatus = alerts.map((item) => {
      const warrantyDate = item.warranty_expires;
      let warranty_status: 'expired' | 'expiring_soon' | 'valid' = 'valid';
      let days_until_expiry = 0;

      if (warrantyDate) {
        const warrantyTime = new Date(warrantyDate).getTime();
        const todayTime = new Date(todayStr).getTime();
        days_until_expiry = Math.ceil((warrantyTime - todayTime) / (1000 * 60 * 60 * 24));

        if (days_until_expiry < 0) {
          warranty_status = 'expired';
        } else if (days_until_expiry <= 30) {
          warranty_status = 'expiring_soon';
        }
      }

      return {
        ...item,
        warranty_status,
        days_until_expiry,
      };
    });

    return NextResponse.json({ alerts: alertsWithStatus });
  } catch (error) {
    console.error('Warranty alerts API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
