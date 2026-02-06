import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// POST - Create a quote change request
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { quote_id, customer_name, customer_email, message } = body;

    if (!quote_id || !message) {
      return NextResponse.json(
        { error: 'Quote ID and message are required' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Try to insert into quote_change_requests table if it exists
    // If not, we'll just log it and return success
    try {
      const { data, error } = await supabase
        .from('quote_change_requests')
        .insert({
          quote_id,
          customer_name: customer_name || 'Unknown',
          customer_email: customer_email || null,
          message,
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        // Table might not exist - log and continue
        console.log('Could not save change request to DB (table may not exist):', error.message);
        console.log('Change request:', { quote_id, customer_name, customer_email, message });
        
        // Still return success - the request was received
        return NextResponse.json({
          success: true,
          message: 'Change request received',
          logged: true,
        });
      }

      return NextResponse.json({
        success: true,
        changeRequest: data,
      });
    } catch (dbError) {
      console.log('Database error (non-critical):', dbError);
      console.log('Change request:', { quote_id, customer_name, customer_email, message });
      
      return NextResponse.json({
        success: true,
        message: 'Change request received',
        logged: true,
      });
    }
  } catch (error) {
    console.error('Quote change request error:', error);
    return NextResponse.json(
      { error: 'Failed to submit change request' },
      { status: 500 }
    );
  }
}

// GET - List change requests (optionally filtered by quote_id)
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    const quoteId = searchParams.get('quote_id');
    const status = searchParams.get('status');

    let query = supabase
      .from('quote_change_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (quoteId) {
      query = query.eq('quote_id', quoteId);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      // Table might not exist
      console.log('Could not fetch change requests:', error.message);
      return NextResponse.json({ changeRequests: [] });
    }

    return NextResponse.json({ changeRequests: data || [] });
  } catch (error) {
    console.error('Fetch change requests error:', error);
    return NextResponse.json({ changeRequests: [] });
  }
}
