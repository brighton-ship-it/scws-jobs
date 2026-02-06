import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';

const OFFICE_EMAIL = 'brighton@scwellservice.com';

/**
 * POST /api/booking - Create a new booking request
 * Public endpoint - no auth required
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

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
      source = 'website',
    } = body;

    // Validate required fields
    if (!service_type || !customer_name || !phone || !address || !city) {
      return NextResponse.json(
        { error: 'Missing required fields: service_type, customer_name, phone, address, city' },
        { status: 400 }
      );
    }

    // Validate phone format (basic)
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      return NextResponse.json(
        { error: 'Invalid phone number' },
        { status: 400 }
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
        notes: notes?.trim() || null,
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
        { status: 500 }
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
    });
  } catch (error) {
    console.error('Booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/booking - List booking requests (for office staff)
 */
export async function GET(request: NextRequest) {
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
