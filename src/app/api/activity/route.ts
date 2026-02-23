import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface Activity {
  id: string;
  type: 'job' | 'invoice' | 'quote' | 'customer' | 'payment' | 'booking';
  description: string;
  timestamp: string;
  entity_id: string;
  entity_type: string;
  user_name?: string;
}

// GET - Fetch recent activity from multiple sources
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

    const activities: Activity[] = [];

    // Fetch recent jobs (created or updated recently)
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, job_number, status, job_type, customer_name, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (jobs) {
      jobs.forEach(job => {
        const isNew = new Date(job.created_at).getTime() > Date.now() - 86400000; // Last 24 hours
        activities.push({
          id: `job-${job.id}`,
          type: 'job',
          description: isNew 
            ? `New job #${job.job_number} created for ${job.customer_name || 'customer'}`
            : `Job #${job.job_number} updated to ${job.status || 'pending'}`,
          timestamp: job.updated_at || job.created_at,
          entity_id: job.id,
          entity_type: 'job',
        });
      });
    }

    // Fetch recent invoices
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, status, total, customer_name, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (invoices) {
      invoices.forEach(inv => {
        const amount = inv.total ? `$${Number(inv.total).toLocaleString()}` : '';
        activities.push({
          id: `invoice-${inv.id}`,
          type: inv.status === 'paid' ? 'payment' : 'invoice',
          description: inv.status === 'paid'
            ? `Payment received ${amount} from ${inv.customer_name || 'customer'}`
            : `Invoice #${inv.invoice_number} ${inv.status || 'created'} ${amount}`,
          timestamp: inv.updated_at || inv.created_at,
          entity_id: inv.id,
          entity_type: 'invoice',
        });
      });
    }

    // Fetch recent quotes
    const { data: quotes } = await supabase
      .from('quotes')
      .select('id, quote_number, status, total, customer_name, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (quotes) {
      quotes.forEach(quote => {
        const amount = quote.total ? `$${Number(quote.total).toLocaleString()}` : '';
        activities.push({
          id: `quote-${quote.id}`,
          type: 'quote',
          description: quote.status === 'accepted'
            ? `Quote #${quote.quote_number} accepted ${amount} by ${quote.customer_name || 'customer'}`
            : `Quote #${quote.quote_number} ${quote.status || 'created'} ${amount}`,
          timestamp: quote.updated_at || quote.created_at,
          entity_id: quote.id,
          entity_type: 'quote',
        });
      });
    }

    // Fetch recent booking requests
    const { data: bookings } = await supabase
      .from('booking_requests')
      .select('id, customer_name, service_type, status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (bookings) {
      bookings.forEach(booking => {
        activities.push({
          id: `booking-${booking.id}`,
          type: 'booking',
          description: `New booking request from ${booking.customer_name || 'customer'} - ${booking.service_type || 'Service'}`,
          timestamp: booking.created_at,
          entity_id: booking.id,
          entity_type: 'booking',
        });
      });
    }

    // Sort all activities by timestamp
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Return limited results
    return NextResponse.json({ 
      activities: activities.slice(0, limit),
      total: activities.length
    });
  } catch (error) {
    console.error('Activity API error:', error);
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 });
  }
}
