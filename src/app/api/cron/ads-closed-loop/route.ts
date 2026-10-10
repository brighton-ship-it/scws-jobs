import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import {
  CAMPAIGN_COST_GAQL,
  KEYWORD_COST_GAQL,
  allocateAdCosts,
  googleAdsConfig,
  googleAdsSearch,
  parseCampaignCostRow,
  parseKeywordCostRow,
  refreshGoogleAccessToken,
  searchResultRows,
  type AdCostRow,
} from '@/lib/ads/google-ads-api';
import {
  attributeContact,
  buildClosedLoopReport,
  closedLoopEmailText,
  closedLoopSheetValues,
  reportWindow,
  type ClosedLoopLead,
} from '@/lib/ads/closed-loop';
import { invoicePretaxUsd } from '@/lib/ads/invoice-value';
import { appendSheetValues, sheetsConfig } from '@/lib/ads/voice-log';
import { fetchRecentInvoices, fetchRecentQuotes } from '@/lib/jobber/attribution-reads';
import { selectLeadRows } from '@/lib/ads/lead-query';

export const dynamic = 'force-dynamic';

const REPORT_EMAIL = process.env.ADS_REPORT_EMAIL?.trim() || 'brighton@scwellservice.com';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function mapLead(row: Record<string, unknown>, source: ClosedLoopLead['source']): ClosedLoopLead {
  return {
    id: String(row.id),
    source,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    gclid: (row.gclid as string | null) ?? null,
    gbraid: (row.gbraid as string | null) ?? null,
    wbraid: (row.wbraid as string | null) ?? null,
    lead_source: (row.lead_source as string | null) ?? (row.source as string | null) ?? null,
    utm_campaign: (row.utm_campaign as string | null) ?? null,
    utm_term: (row.utm_term as string | null) ?? null,
  };
}

async function adCosts(): Promise<{ costs: AdCostRow[]; error: string | null }> {
  const config = googleAdsConfig();
  if (!config) return { costs: [], error: 'google_ads_not_configured' };
  try {
    const token = await refreshGoogleAccessToken(config);
    const [keywords, campaigns] = await Promise.all([
      googleAdsSearch(config, KEYWORD_COST_GAQL, fetch, token),
      googleAdsSearch(config, CAMPAIGN_COST_GAQL, fetch, token),
    ]);
    return {
      costs: allocateAdCosts(
        searchResultRows(keywords).map(parseKeywordCostRow).filter((row): row is AdCostRow => Boolean(row)),
        searchResultRows(campaigns).map(parseCampaignCostRow).filter((row): row is AdCostRow => Boolean(row))
      ),
      error: null,
    };
  } catch (error) {
    return { costs: [], error: error instanceof Error ? error.message : 'cost query failed' };
  }
}

export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return unauthorized();
  }

  const started = Date.now();
  const period = reportWindow();
  const notes: string[] = [];
  try {
    const supabase = createServiceClient();
    const db = supabase as any;
    const matchSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const bookingColumns = [
      'id',
      'phone',
      'email',
      'created_at',
      'source',
      'gclid',
      'gbraid',
      'wbraid',
      'lead_source',
      'utm_campaign',
      'utm_term',
    ];
    const customerColumns = [
      'id',
      'phone',
      'email',
      'created_at',
      'gclid',
      'gbraid',
      'wbraid',
      'lead_source',
      'utm_campaign',
      'utm_term',
    ];

    const [bookings, customers, calls, booked, costResult] = await Promise.all([
      selectLeadRows(db.from('booking_requests'), bookingColumns, matchSince),
      selectLeadRows(db.from('customers'), customerColumns, matchSince),
      db
        .from('ads_calls')
        .select('caller_phone, campaign_name, keyword, started_at')
        .gte('started_at', period.start)
        .limit(2000),
      db
        .from('book_job_conversions')
        .select('jobber_job_id, booking_request_id, customer_id, sent_to_google, fired_at')
        .gte('fired_at', period.start)
        .limit(2000),
      adCosts(),
    ]);

    if (bookings.error) notes.push(`bookings: ${bookings.error.message}`);
    if (customers.error) notes.push(`customers: ${customers.error.message}`);
    if (calls.error) notes.push(`calls: ${calls.error.message}`);
    if (booked.error) notes.push(`booked: ${booked.error.message}`);
    if (costResult.error) notes.push(`cost: ${costResult.error}`);

    const allLeads = [
      ...(bookings.data ?? []).map((row) => mapLead(row, 'booking_requests')),
      ...(customers.data ?? []).map((row) => mapLead(row, 'customers')),
    ];
    const leadsInWindow = allLeads.filter((lead) => lead.created_at >= period.start);
    const adsCalls = (calls.data ?? []).map(
      (row: { caller_phone: string | null; campaign_name: string | null; keyword: string | null }) => ({
        phone: row.caller_phone,
        campaign: row.campaign_name,
        keyword: row.keyword,
      })
    );

    const leadById = new Map(allLeads.map((lead) => [lead.id, lead]));
    const bookedJobs = (booked.data ?? [])
      .filter((row: { sent_to_google?: boolean | null }) => row.sent_to_google !== false)
      .map((row: { booking_request_id?: string | null; customer_id?: string | null }) => {
        const lead =
          leadById.get(String(row.booking_request_id || '')) ||
          leadById.get(String(row.customer_id || ''));
        if (!lead) return { source: 'unattributed', campaign: '', keyword: '' };
        return attributeContact({
          phone: lead.phone,
          email: lead.email,
          leads: [lead],
          adsCalls,
        });
      });

    let quotes: Array<{ source: string; campaign: string; keyword: string }> = [];
    let invoices: Array<{ source: string; campaign: string; keyword: string; valueUsd: number }> = [];
    try {
      const quoteRows = await fetchRecentQuotes();
      quotes = quoteRows
        .filter((row) => !row.createdAt || row.createdAt >= period.start)
        .map((row) => attributeContact({ phone: row.phone, email: row.email, leads: allLeads, adsCalls }));
    } catch (error) {
      notes.push(`quotes: ${error instanceof Error ? error.message : 'failed'}`);
    }
    try {
      const invoiceRows = await fetchRecentInvoices({ maxPages: 4 });
      invoices = invoiceRows
        .filter((row) => {
          const stamp = row.issuedDate || row.createdAt || '';
          return stamp >= period.start && invoicePretaxUsd(row);
        })
        .map((row) => ({
          ...attributeContact({ phone: row.phone, email: row.email, leads: allLeads, adsCalls }),
          valueUsd: invoicePretaxUsd(row) ?? 0,
        }));
    } catch (error) {
      notes.push(`invoices: ${error instanceof Error ? error.message : 'failed'}`);
    }

    const rows = buildClosedLoopReport({
      leads: leadsInWindow,
      calls: adsCalls,
      bookedJobs,
      quotes,
      invoices,
      costs: costResult.costs,
    });
    const text = closedLoopEmailText(rows, period);
    const note = notes.length ? `\n\nNotes:\n${notes.join('\n')}` : '';

    let emailSent = false;
    const email = await sendEmail({
      to: REPORT_EMAIL,
      subject: `SCWS ads closed loop ${period.start} to ${period.end}`,
      text: text + note,
      html: textToHtml(text + note),
    });
    emailSent = email.success;
    if (!email.success) notes.push(`email: ${email.error || 'not sent'}`);

    let sheetAppended = false;
    const sheet = sheetsConfig();
    if (sheet) {
      try {
        await appendSheetValues(sheet, closedLoopSheetValues(rows, period), fetch);
        sheetAppended = true;
      } catch (error) {
        notes.push(`sheet: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }

    const { error: saveError } = await db.from('ads_closed_loop_reports').insert({
      period_start: period.start,
      period_end: period.end,
      rows,
      email_to: REPORT_EMAIL,
      email_sent: emailSent,
      sheet_appended: sheetAppended,
      note: notes.join('\n') || null,
    });
    if (saveError) notes.push(`report table: ${saveError.message}`);

    return NextResponse.json({
      success: !saveError,
      period,
      rows: rows.length,
      emailSent,
      sheetAppended,
      notes,
      duration_ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[ads_closed_loop] Cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
