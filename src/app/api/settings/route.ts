import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Check if error indicates missing table
function isTableMissingError(error: { code?: string; message?: string }): boolean {
  // PostgreSQL error code 42P01 = undefined_table
  // PostgREST may also return 404 or specific messages
  return (
    error.code === '42P01' ||
    error.message?.includes('relation') && error.message?.includes('does not exist') ||
    error.message?.includes('Could not find') ||
    false
  );
}

// GET /api/settings?key=company or /api/settings (all)
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const key = request.nextUrl.searchParams.get('key');

    if (key) {
      const { data, error } = await supabase
        .from('settings')
        .select('key, value, updated_at')
        .eq('key', key)
        .single();

      if (error) {
        // If not found OR table doesn't exist, return defaults
        if (error.code === 'PGRST116' || isTableMissingError(error)) {
          return NextResponse.json({ settings: getDefaultSettings(key) });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ settings: data.value });
    }

    // Get all settings
    const { data, error } = await supabase
      .from('settings')
      .select('key, value, updated_at');

    if (error) {
      // If table doesn't exist, return all defaults
      if (isTableMissingError(error)) {
        return NextResponse.json({ settings: getAllDefaultSettings() });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const settings: Record<string, any> = {};
    (data || []).forEach((row) => {
      settings[row.key] = row.value;
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Error in settings GET:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

// PUT /api/settings
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    const { key, value } = body;

    if (!key || !value) {
      return NextResponse.json(
        { error: 'key and value are required' },
        { status: 400 }
      );
    }

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('settings')
      .upsert({
        key,
        value,
        updated_at: new Date().toISOString(),
        updated_by: user?.id || null,
      }, {
        onConflict: 'key',
      })
      .select()
      .single();

    if (error) {
      // If table doesn't exist, acknowledge but can't save
      if (isTableMissingError(error)) {
        return NextResponse.json({ 
          success: false, 
          warning: 'Settings table not yet created. Settings cannot be persisted.',
          settings: value 
        });
      }
      console.error('Error saving settings:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, settings: data.value });
  } catch (error) {
    console.error('Error in settings PUT:', error);
    return NextResponse.json(
      { error: 'Failed to save settings' },
      { status: 500 }
    );
  }
}

const DEFAULT_SETTINGS: Record<string, any> = {
  company: {
    company_name: 'Southern California Well Service',
    address: '1077 Main St',
    city: 'Ramona',
    state: 'CA',
    zip: '92065',
    phone: '(760) 440-8520',
    email: 'info@scwellservice.com',
    website: 'www.scwellservice.com',
  },
  billing: {
    tax_rate: 8.75,
    payment_terms_days: 30,
    invoice_prefix: 'INV',
    invoice_notes: 'Thank you for your business!',
    late_fee_percentage: 1.5,
    accept_credit_cards: true,
    accept_checks: true,
    accept_cash: true,
  },
};

function getDefaultSettings(key: string): Record<string, any> {
  return DEFAULT_SETTINGS[key] || {};
}

function getAllDefaultSettings(): Record<string, any> {
  return DEFAULT_SETTINGS;
}
