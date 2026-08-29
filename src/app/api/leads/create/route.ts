import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import {
  extractAdsClickIds,
  isMissingClickIdColumnError,
  MISSING_CLICK_ID_COLUMNS_WARNING,
  omitClickIdColumns,
} from '@/lib/ads/click-ids';
import type { LeadSource } from '@/types/database';

const OFFICE_EMAIL = 'brighton@scwellservice.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * Detect lead source from UTM parameters
 */
function detectLeadSource(
  utm_source?: string | null,
  utm_medium?: string | null,
  referrer_url?: string | null
): LeadSource {
  // Google Ads detection
  if (utm_source === 'google' && (utm_medium === 'cpc' || utm_medium === 'ppc')) {
    return 'google_ads';
  }
  
  // Organic search detection
  if (utm_medium === 'organic' || 
      (['google', 'bing', 'yahoo', 'duckduckgo'].includes(utm_source || '') && !utm_medium)) {
    return 'organic_seo';
  }
  
  // Referral detection
  if (utm_medium === 'referral' || utm_source === 'referral') {
    return 'referral';
  }
  
  // Check referrer URL for search engines
  if (referrer_url) {
    if (referrer_url.includes('google.') || referrer_url.includes('bing.') || referrer_url.includes('yahoo.')) {
      return 'organic_seo';
    }
  }
  
  // Default to website form if UTM exists
  if (utm_source || utm_medium) {
    return 'website_form';
  }
  
  return 'website_form';
}

/**
 * POST /api/leads/create - Create a new lead/customer from website form
 * Public endpoint - no auth required
 * 
 * Accepts:
 * - customer_name, phone, email, address, city (required)
 * - service_type, notes, preferred_date, preferred_time (optional)
 * - utm_source, utm_medium, utm_campaign, utm_term, utm_content (optional)
 * - gclid, gbraid, wbraid, ga_client_id, ga_session_id (optional; stored when present)
 * - referrer_url (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    // Honeypot — bots that fill a hidden field get a fake success
    if (body.website_url || body.honeypot) {
      return NextResponse.json(
        { success: true, message: 'Request received' },
        { status: 200, headers: corsHeaders }
      );
    }

    const {
      customer_name,
      phone,
      email,
      address,
      city,
      county,
      zip,
      service_type,
      notes,
      preferred_date,
      preferred_time,
      // UTM parameters
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      referrer_url,
      // Manual lead source override (optional)
      lead_source: manual_lead_source,
      lead_source_detail,
    } = body;

    // Validate required fields
    if (!customer_name || !phone) {
      return NextResponse.json(
        { error: 'Missing required fields: customer_name, phone' },
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
    const clickIds = extractAdsClickIds(body);

    // Auto-detect lead source from UTM params
    const detected_lead_source = manual_lead_source || detectLeadSource(utm_source, utm_medium, referrer_url);
    
    // Build lead source detail string
    const utmDetail = [
      utm_source && `source=${utm_source}`,
      utm_medium && `medium=${utm_medium}`,
      utm_campaign && `campaign=${utm_campaign}`,
    ].filter(Boolean).join(', ');
    
    const finalLeadSourceDetail = lead_source_detail || utmDetail || null;

    // Check for existing customer by phone
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id, name')
      .eq('phone', cleanPhone)
      .single();

    let customerId: string;
    let isNewCustomer = false;

    if (existingCustomer) {
      const existingId = (existingCustomer as { id: string }).id;
      customerId = existingId;
      
      // Get current customer data to check what's already set
      const { data: currentData } = await supabase
        .from('customers')
        .select('lead_source, utm_source, utm_medium, utm_campaign, gclid, gbraid, wbraid, ga_client_id, ga_session_id')
        .eq('id', existingId)
        .single() as { data: {
          lead_source?: string;
          utm_source?: string;
          utm_medium?: string;
          utm_campaign?: string;
          gclid?: string | null;
          gbraid?: string | null;
          wbraid?: string | null;
          ga_client_id?: string | null;
          ga_session_id?: string | null;
        } | null };
      
      // Update existing customer with lead tracking if not already set
      const updateFields: Record<string, string | null> = {};
      if (!currentData?.lead_source) updateFields.lead_source = detected_lead_source;
      if (!currentData?.utm_source && utm_source) updateFields.utm_source = utm_source;
      if (!currentData?.utm_medium && utm_medium) updateFields.utm_medium = utm_medium;
      if (!currentData?.utm_campaign && utm_campaign) updateFields.utm_campaign = utm_campaign;
      if (!currentData?.gclid && clickIds.gclid) updateFields.gclid = clickIds.gclid;
      if (!currentData?.gbraid && clickIds.gbraid) updateFields.gbraid = clickIds.gbraid;
      if (!currentData?.wbraid && clickIds.wbraid) updateFields.wbraid = clickIds.wbraid;
      if (!currentData?.ga_client_id && clickIds.ga_client_id) updateFields.ga_client_id = clickIds.ga_client_id;
      if (!currentData?.ga_session_id && clickIds.ga_session_id) updateFields.ga_session_id = clickIds.ga_session_id;
      
      if (Object.keys(updateFields).length > 0) {
        const { error: updateError } = await (supabase
          .from('customers') as any)
          .update(updateFields)
          .eq('id', existingId);
          
        if (updateError) {
          console.warn('Could not update lead tracking on existing customer:', updateError);
        }
      }
    } else {
      // Create new customer
      const customerRow = {
        name: customer_name.trim(),
        email: email?.toLowerCase()?.trim() || null,
        phone: cleanPhone,
        billing_address: address ? `${address.trim()}, ${city?.trim() || ''} ${zip || ''}`.trim() : null,
        lead_source: detected_lead_source,
        lead_source_detail: finalLeadSourceDetail,
        utm_source: utm_source?.trim() || null,
        utm_medium: utm_medium?.trim() || null,
        utm_campaign: utm_campaign?.trim() || null,
        utm_term: utm_term?.trim() || null,
        utm_content: utm_content?.trim() || null,
        referrer_url: referrer_url?.trim() || null,
        lead_stage: 'lead',
        gclid: clickIds.gclid,
        gbraid: clickIds.gbraid,
        wbraid: clickIds.wbraid,
        ga_client_id: clickIds.ga_client_id,
        ga_session_id: clickIds.ga_session_id,
      };

      let { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert(customerRow as any)
        .select()
        .single();

      if (customerError && isMissingClickIdColumnError(customerError)) {
        console.warn(MISSING_CLICK_ID_COLUMNS_WARNING.replace('booking_requests', 'customers'), customerError.message);
        const retry = await supabase
          .from('customers')
          .insert(omitClickIdColumns(customerRow) as any)
          .select()
          .single();
        newCustomer = retry.data;
        customerError = retry.error;
      }

      if (customerError) {
        console.error('Error creating customer:', customerError);
        return NextResponse.json(
          { error: 'Failed to create lead', details: customerError.message },
          { status: 500, headers: corsHeaders }
        );
      }

      customerId = (newCustomer as { id: string }).id;
      isNewCustomer = true;

      // Create property if address provided
      if (address) {
        const { error: propertyError } = await supabase
          .from('properties')
          .insert({
            customer_id: customerId,
            address: address.trim(),
            city: city?.trim() || null,
            county: county?.trim() || null,
            zip: zip?.trim() || null,
          } as any);

        if (propertyError) {
          console.warn('Could not create property:', propertyError);
        }
      }
    }

    // Create a booking request for service tracking
    if (service_type) {
      const { error: bookingError } = await supabase
        .from('booking_requests')
        .insert({
          service_type,
          customer_name: customer_name.trim(),
          phone: cleanPhone,
          email: email?.toLowerCase()?.trim() || null,
          address: address?.trim() || '',
          city: city?.trim() || '',
          preferred_date: preferred_date || null,
          preferred_time: preferred_time || null,
          notes: notes?.trim() || null,
          status: 'pending',
          customer_id: customerId,
          source: 'website',
          ip_address,
          gclid: clickIds.gclid,
          gbraid: clickIds.gbraid,
          wbraid: clickIds.wbraid,
          ga_client_id: clickIds.ga_client_id,
          ga_session_id: clickIds.ga_session_id,
        } as any);

      if (bookingError) {
        console.warn('Could not create booking request:', bookingError);
      }
    }

    // Send email notification
    const leadSourceLabel = getLeadSourceLabel(detected_lead_source);
    const emailSubject = `🎯 New Lead: ${customer_name} (${leadSourceLabel})`;
    const emailContent = `
New lead received from website!

LEAD SOURCE: ${leadSourceLabel}
${utmDetail ? `UTM Parameters: ${utmDetail}` : ''}

CUSTOMER INFORMATION:
• Name: ${customer_name}
• Phone: ${formatPhone(cleanPhone)}
• Email: ${email || 'Not provided'}

${address ? `SERVICE ADDRESS:
${address}
${city || ''}${county ? `, ${county} County` : ''} ${zip || ''}` : ''}

${service_type ? `SERVICE REQUESTED: ${service_type}` : ''}
${preferred_date ? `PREFERRED DATE: ${preferred_date}` : ''}
${notes ? `NOTES: ${notes}` : ''}

---
${isNewCustomer ? '⚡ NEW CUSTOMER' : '✓ Existing customer in system'}

View in Jobs App: ${process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app'}/customers/${customerId}
    `.trim();

    await sendEmail({
      to: OFFICE_EMAIL,
      subject: emailSubject,
      html: textToHtml(emailContent),
      text: emailContent,
    });

    console.log(`[Lead] New ${isNewCustomer ? 'customer' : 'inquiry'} from ${customer_name} via ${detected_lead_source}`);

    return NextResponse.json({
      success: true,
      customer_id: customerId,
      is_new_customer: isNewCustomer,
      lead_source: detected_lead_source,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Lead create API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

// Helper functions
function getLeadSourceLabel(source: LeadSource): string {
  const labels: Record<LeadSource, string> = {
    google_ads: 'Google Ads',
    organic_seo: 'Organic Search',
    referral: 'Referral',
    repeat_customer: 'Repeat Customer',
    phone: 'Phone Call',
    walk_in: 'Walk-In',
    website_form: 'Website Form',
    other: 'Other',
  };
  return labels[source] || source;
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
