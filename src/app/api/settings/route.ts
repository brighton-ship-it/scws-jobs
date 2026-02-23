import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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
        // If not found, return defaults
        if (error.code === 'PGRST116') {
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

function getDefaultSettings(key: string): Record<string, any> {
  const defaults: Record<string, any> = {
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
  return defaults[key] || {};
}
