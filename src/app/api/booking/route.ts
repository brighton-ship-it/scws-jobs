import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import { notifyBooking } from '@/lib/notifications';
import { notifyNewBooking } from '@/lib/messaging/discord';
import { requireUser } from '@/lib/require-auth';
import {
  appendAttributionToNotes,
  inboundBookingSource,
  inboundLeadSourceLabel,
  extractBookingUtms,
  normalizeBookingSource,
} from '@/lib/booking-source';
import { InboundBodyError, inboundAdsFields, readInboundRecord, type InboundAdsFields } from '@/lib/ads/inbound-body';
import { customerAdsPatch } from '@/lib/ads/lead-tag';
import { missingColumnName, withoutColumn } from '@/lib/ads/optional-column';

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
    let rawBody: Record<string, unknown>;
    try {
      rawBody = await readInboundRecord(request);
    } catch (error) {
      if (error instanceof InboundBodyError) {
        return NextResponse.json({ error: error.message }, { status: error.status, headers: corsHeaders });
      }
      throw error;
    }
    const inbound = inboundAdsFields(rawBody, request.headers.get('cookie'), request.url);
    const body = inbound.body as Record<string, any>;

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
    } = body;

    // Intake channel only (website/embed/manual/phone). Ads labels such as
    // lead_source=google_ads from scwellservice.com map to website so the
    // live booking_requests_source_check cannot 500. Click IDs stay on the
    // row; remapped source + UTMs go on notes.
    const { source, original: remappedSource } = normalizeBookingSource(
      inboundBookingSource(body)
    );
    const leadSourceLabel = inboundLeadSourceLabel(body);
    const originalSource =
      remappedSource ||
      (leadSourceLabel && leadSourceLabel !== source ? leadSourceLabel : null);
    const utms = extractBookingUtms(body);
    if (remappedSource) {
      console.warn('[Booking] Source remapped to website:', remappedSource);
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
    const clickIds = inbound.clickIds;

    // Check for existing customer by phone
    let customer_id: string | null = null;
    let createdAdsCustomer = false;
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

    if (inbound.lead_source === 'google_ads') {
      if (customer_id) {
        await tagExistingCustomer(supabase, customer_id, inbound);
      } else {
        customer_id = await createAdsCustomer(supabase, {
          name: customer_name.trim(),
          phone: cleanPhone,
          email: email?.toLowerCase()?.trim() || null,
          address,
          city,
          inbound,
        });
        createdAdsCustomer = Boolean(customer_id);
      }
    }

    // Create the booking request
    const bookingRow = {
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
      notes: appendAttributionToNotes(notes, originalSource, utms),
      status: 'pending',
      customer_id,
      source,
      ip_address,
      lead_source: inbound.lead_source,
      utm_source: inbound.utms.utm_source,
      utm_medium: inbound.utms.utm_medium,
      utm_campaign: inbound.utms.utm_campaign,
      utm_term: inbound.utms.utm_term,
      utm_content: inbound.utms.utm_content,
      gclid: clickIds.gclid,
      gbraid: clickIds.gbraid,
      wbraid: clickIds.wbraid,
      ga_client_id: clickIds.ga_client_id,
      ga_session_id: clickIds.ga_session_id,
    };

    let { data: booking, error: bookingError } = await insertStrippingMissingColumns(
      supabase,
      'booking_requests',
      bookingRow
    );

    // Last resort if a CHECK we have not seen yet still rejects source.
    // lead_source stays google_ads on its own column; source is only the intake channel.
    if (bookingError && isSourceCheckError(bookingError) && bookingRow.source !== 'website') {
      console.warn('[Booking] source CHECK rejected', bookingRow.source, bookingError.message);
      const fallback = await insertStrippingMissingColumns(supabase, 'booking_requests', {
        ...bookingRow,
        source: 'website',
      });
      booking = fallback.data;
      bookingError = fallback.error;
    }

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
${createdAdsCustomer ? '⚡ New customer tagged google_ads' : customer_id ? '✓ Matched to existing customer in system' : '⚡ New customer - not yet in system'}

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

async function insertStrippingMissingColumns(
  supabase: ReturnType<typeof createServiceClient>,
  table: string,
  row: Record<string, unknown>
) {
  const db = supabase as any;
  let current = { ...row };
  let result = await db.from(table).insert(current).select().single();
  for (let attempt = 0; attempt < 12 && result.error; attempt += 1) {
    const column = missingColumnName(result.error);
    if (!column || !(column in current)) break;
    console.warn(`[Booking] ${table} is missing column ${column}; saving without it`);
    current = withoutColumn(current, column);
    result = await db.from(table).insert(current).select().single();
  }
  return result;
}

async function tagExistingCustomer(
  supabase: ReturnType<typeof createServiceClient>,
  customerId: string,
  inbound: InboundAdsFields
) {
  const { data, error } = await supabase
    .from('customers')
    .select('lead_source, lead_source_detail, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, gbraid, wbraid, ga_client_id, ga_session_id')
    .eq('id', customerId)
    .single();
  if (error) {
    console.warn('[Booking] Could not read customer attribution:', error.message);
    return;
  }
  const patch = customerAdsPatch(data, inbound);
  if (!Object.keys(patch).length) return;
  const db = supabase as any;
  let current: Record<string, string> = { ...patch };
  let update = await db.from('customers').update(current).eq('id', customerId);
  for (let attempt = 0; attempt < 12 && update.error; attempt += 1) {
    const column = missingColumnName(update.error);
    if (!column || !(column in current)) break;
    current = withoutColumn(current, column);
    update = await db.from('customers').update(current).eq('id', customerId);
  }
  if (update.error) {
    console.warn('[Booking] Could not tag customer google_ads:', update.error.message);
  }
}

async function createAdsCustomer(
  supabase: ReturnType<typeof createServiceClient>,
  input: {
    name: string;
    phone: string;
    email: string | null;
    address: string;
    city: string;
    inbound: InboundAdsFields;
  }
): Promise<string | null> {
  const row: Record<string, unknown> = {
    name: input.name,
    phone: input.phone,
    email: input.email,
    billing_address: `${input.address.trim()}, ${input.city.trim()}`.trim(),
    lead_source: 'google_ads',
    lead_source_detail: [
      input.inbound.campaign ? `campaign=${input.inbound.campaign}` : null,
      input.inbound.keyword ? `keyword=${input.inbound.keyword}` : null,
    ]
      .filter(Boolean)
      .join('; ') || null,
    utm_source: input.inbound.utms.utm_source,
    utm_medium: input.inbound.utms.utm_medium,
    utm_campaign: input.inbound.utms.utm_campaign,
    utm_term: input.inbound.utms.utm_term,
    utm_content: input.inbound.utms.utm_content,
    gclid: input.inbound.clickIds.gclid,
    gbraid: input.inbound.clickIds.gbraid,
    wbraid: input.inbound.clickIds.wbraid,
    ga_client_id: input.inbound.clickIds.ga_client_id,
    ga_session_id: input.inbound.clickIds.ga_session_id,
    lead_stage: 'lead',
  };
  const inserted = await insertStrippingMissingColumns(supabase, 'customers', row);
  if (inserted.error || !inserted.data?.id) {
    console.warn('[Booking] Could not create google_ads customer:', inserted.error?.message);
    return null;
  }
  return String(inserted.data.id);
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

function isSourceCheckError(
  error: { message?: string | null } | null | undefined
): boolean {
  return /booking_requests_source_check/i.test(error?.message ?? '');
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
