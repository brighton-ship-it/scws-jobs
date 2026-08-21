import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import { notifyBooking } from '@/lib/notifications';
import { notifyNewBooking } from '@/lib/messaging/discord';
import { requireUser } from '@/lib/require-auth';
import { appendSourceToNotes, normalizeBookingSource } from '@/lib/booking-source';

const OFFICE_EMAIL = 'brighton@scwellservice.com';

// CORS headers for cross-origin requests from the main website
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

// Handle OPTIONS preflight requests
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * POST /api/booking - Create a new booking request
 * Public endpoint - no auth required
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    // Honeypot spam check - if this field is filled, it's a bot
    if (body.website_url) {
      console.log('Spam detected - honeypot field filled:', body.website_url);
      // Return success to not alert the bot, but don't process
      return NextResponse.json(
        { success: true, message: 'Request received' },
        { status: 200, headers: corsHeaders }
      );
    }

    // Gibberish detection - reject random character strings
    const isGibberish = (text: string): boolean => {
      if (!text || text.length < 10) return false;
      // Check for too many consonant clusters (no vowels)
      const vowelRatio = (text.match(/[aeiouAEIOU]/g) || []).length / text.length;
      // Normal text has ~40% vowels, gibberish has very few
      if (vowelRatio < 0.15) return true;
      // Check for suspiciously random capitalization
      const capsPattern = text.match(/[a-z][A-Z][a-z]/g);
      if (capsPattern && capsPattern.length > 2) return true;
      return false;
    };

    if (isGibberish(body.customer_name) || isGibberish(body.address)) {
      console.log('Spam detected - gibberish content:', { name: body.customer_name, address: body.address });
      return NextResponse.json(
        { success: true, message: 'Request received' },
        { status: 200, headers: corsHeaders }
      );
    }

    const {
      service_type,
      customer_name,
      first_name,
      last_name,
      phone,
      email,
      address,
      city,
      preferred_date,
      preferred_time,
      notes,
      source: rawSource = 'website',
    } = body;

    // Known sources insert as-is. Unknown UTMs / landing pages become `other`
    // so a new channel never 500s and silently drops the lead.
    const { source, original: originalSource } = normalizeBookingSource(rawSource);
    if (originalSource) {
      console.warn('[Booking] Unknown source remapped to other:', originalSource);
    }

    // Validate required fields
    if (!service_type || !customer_name || !phone || !address || !city) {
      return NextResponse.json(
        { error: 'Missing required fields: service_type, customer_name, phone, address, city' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Validate phone format (basic)
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return NextResponse.json(
        { error: 'Invalid phone number' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Get IP address for tracking
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip_address = forwardedFor ? forwardedFor.split(',')[0].trim() : null;

    // Check for existing customer by phone
    let customer_id: string | null = null;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', cleanPhone)
      .single();

    if (existingCustomer) {
      customer_id = existingCustomer.id;
    } else {
      // Try to match by email if provided
      if (email) {
        const { data: customerByEmail } = await supabase
          .from('customers')
          .select('id')
          .eq('email', email.toLowerCase())
          .single();
        
        if (customerByEmail) {
          customer_id = customerByEmail.id;
        }
      }
    }

    // Create the booking request
    const { data: booking, error: bookingError } = await supabase
      .from('booking_requests')
      .insert({
        service_type,
        customer_name: customer_name.trim(),
        first_name: first_name?.trim() || null,
        last_name: last_name?.trim() || null,
        phone: cleanPhone,
        email: email?.toLowerCase()?.trim() || null,
        address: address.trim(),
        city: city.trim(),
        preferred_date: preferred_date || null,
        preferred_time: preferred_time || null,
        notes: originalSource
          ? appendSourceToNotes(notes, originalSource)
          : notes?.trim() || null,
        status: 'pending',
        customer_id,
        source,
        ip_address,
      })
      .select()
      .single();

    if (bookingError) {
      console.error('Error creating booking:', bookingError);
      return NextResponse.json(
        { error: 'Failed to create booking request', details: bookingError.message },
        { status: 500, headers: corsHeaders }
      );
    }

    // Send email notification to office
    const serviceTypeLabel = getServiceTypeLabel(service_type);
    const emailSubject = `🔔 New Booking Request: ${serviceTypeLabel}`;
    const emailContent = `
New online booking request received!

SERVICE TYPE: ${serviceTypeLabel}
${service_type === 'no_water' ? '⚠️ URGENT - NO WATER EMERGENCY' : ''}

CUSTOMER INFORMATION:
• First Name: ${first_name || 'N/A'}
• Last Name: ${last_name || 'N/A'}
• Full Name: ${customer_name}
• Phone: ${formatPhone(cleanPhone)}
• Email: ${email || 'Not provided'}

SERVICE ADDRESS:
${address}
${city}, CA

PREFERRED SCHEDULE:
• Date: ${preferred_date ? new Date(preferred_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : 'Flexible'}
• Time: ${preferred_time || 'Flexible'}

NOTES:
${notes || 'None'}

---
${customer_id ? '✓ Matched to existing customer in system' : '⚡ New customer - not yet in system'}

View in Jobs App: ${process.env.NEXT_PUBLIC_APP_URL || 'https://jobs.scwellservice.com'}/requests
    `.trim();

    await sendEmail({
      to: OFFICE_EMAIL,
      subject: emailSubject,
      html: textToHtml(emailContent),
      text: emailContent,
    });

    // In-app notification (bell icon)
    await notifyBooking({
      customerName: customer_name,
      serviceType: serviceTypeLabel,
      phone: cleanPhone,
      requestId: booking.id,
    });

    // Discord notification (optional - if configured)
    await notifyNewBooking({
      customerName: customer_name,
      serviceType: serviceTypeLabel,
      phone: cleanPhone,
      address: `${address}, ${city}`,
      preferredDate: preferred_date,
    });

    // Also log that we got a new booking
    console.log(`[Booking] New request from ${customer_name} for ${serviceTypeLabel}`);

    return NextResponse.json({
      success: true,
      booking: {
        id: booking.id,
        service_type: booking.service_type,
        preferred_date: booking.preferred_date,
        preferred_time: booking.preferred_time,
      },
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * GET /api/booking - List booking requests (office staff only)
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const supabase = createServiceClient();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');

    let query = supabase
      .from('booking_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: bookings, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch bookings', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ bookings });
  } catch (error) {
    console.error('Get bookings API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Helper functions
function getServiceTypeLabel(serviceType: string): string {
  const labels: Record<string, string> = {
    pump_repair: 'Well Pump Repair',
    no_water: 'No Water Emergency',
    low_pressure: 'Low Water Pressure',
    inspection: 'Well Inspection',
    new_well: 'New Well Drilling',
    other: 'Other Service',
  };
  return labels[serviceType] || serviceType;
}

function formatPhone(phone: string): string {
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  }
  if (phone.length === 11 && phone[0] === '1') {
    return `(${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7)}`;
  }
  return phone;
}
