/**
 * Weekly closed loop: leads, calls, booked jobs, quotes, invoiced revenue,
 * cost, and ROAS by source, campaign, and keyword. Revenue we cannot tie to
 * a lead or an ads call is source "unattributed".
 */

import { normalizeEmail, normalizePhone, type WebsiteLead } from './book-job.ts';
import type { AdCostRow } from './google-ads-api.ts';

export interface ClosedLoopLead extends WebsiteLead {
  lead_source?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
}

export interface ClosedLoopGroup {
  source: string;
  campaign: string;
  keyword: string;
  leads: number;
  calls: number;
  bookedJobs: number;
  quotes: number;
  invoicedRevenue: number;
  cost: number;
  roas: number | null;
}

export interface ContactAttribution {
  source: string;
  campaign: string;
  keyword: string;
}

function blank(value: string | null | undefined): string {
  return value?.trim() || '';
}

function keyOf(source: string, campaign: string, keyword: string): string {
  return `${source}\u0000${campaign}\u0000${keyword}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function attributeContact(input: {
  phone?: string | null;
  email?: string | null;
  leads: ClosedLoopLead[];
  adsCalls?: Array<{ phone?: string | null; campaign?: string | null; keyword?: string | null }>;
  now?: Date;
}): ContactAttribution {
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const leads = input.leads
    .map((lead) => ({
      lead,
      phone: normalizePhone(lead.phone),
      email: normalizeEmail(lead.email),
      created: Date.parse(lead.created_at),
    }))
    .filter((row) => Number.isFinite(row.created) && row.created >= cutoff)
    .filter((row) => (phone && row.phone === phone) || (email && row.email === email))
    .sort((a, b) => {
      const aAds = isAdsLead(a.lead) ? 1 : 0;
      const bAds = isAdsLead(b.lead) ? 1 : 0;
      if (aAds !== bAds) return bAds - aAds;
      return b.created - a.created;
    });

  const winner = leads[0]?.lead;
  if (winner) {
    return {
      source: sourceOfLead(winner),
      campaign: blank(winner.utm_campaign),
      keyword: blank(winner.utm_term),
    };
  }

  const call = (input.adsCalls ?? []).find((row) => phone && normalizePhone(row.phone) === phone);
  if (call) {
    return {
      source: 'google_ads',
      campaign: blank(call.campaign),
      keyword: blank(call.keyword),
    };
  }

  return { source: 'unattributed', campaign: '', keyword: '' };
}

function isAdsLead(lead: ClosedLoopLead): boolean {
  return (
    (lead.lead_source || '').trim().toLowerCase() === 'google_ads' ||
    Boolean(lead.gclid?.trim() || lead.gbraid?.trim() || lead.wbraid?.trim())
  );
}

function sourceOfLead(lead: ClosedLoopLead): string {
  if (isAdsLead(lead)) return 'google_ads';
  const source = (lead.lead_source || lead.source || '').trim().toLowerCase();
  return source || 'unattributed';
}

export function reportWindow(now: Date = new Date()): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

interface MutableGroup {
  source: string;
  campaign: string;
  keyword: string;
  leads: number;
  calls: number;
  bookedJobs: number;
  quotes: number;
  invoicedRevenue: number;
  cost: number;
}

function ensure(groups: Map<string, MutableGroup>, source: string, campaign: string, keyword: string): MutableGroup {
  const key = keyOf(source, campaign, keyword);
  const existing = groups.get(key);
  if (existing) return existing;
  const created: MutableGroup = {
    source,
    campaign,
    keyword,
    leads: 0,
    calls: 0,
    bookedJobs: 0,
    quotes: 0,
    invoicedRevenue: 0,
    cost: 0,
  };
  groups.set(key, created);
  return created;
}

export function buildClosedLoopReport(input: {
  leads: ClosedLoopLead[];
  calls: Array<{ campaign?: string | null; keyword?: string | null }>;
  bookedJobs: Array<{ source: string; campaign?: string | null; keyword?: string | null }>;
  quotes: Array<{ source: string; campaign?: string | null; keyword?: string | null }>;
  invoices: Array<{ source: string | null; campaign?: string | null; keyword?: string | null; valueUsd: number }>;
  costs: AdCostRow[];
}): ClosedLoopGroup[] {
  const groups = new Map<string, MutableGroup>();

  for (const lead of input.leads) {
    const source = sourceOfLead(lead);
    ensure(groups, source, blank(lead.utm_campaign), blank(lead.utm_term)).leads += 1;
  }
  for (const call of input.calls) {
    ensure(groups, 'google_ads', blank(call.campaign), blank(call.keyword)).calls += 1;
  }
  for (const job of input.bookedJobs) {
    ensure(groups, job.source || 'unattributed', blank(job.campaign), blank(job.keyword)).bookedJobs += 1;
  }
  for (const quote of input.quotes) {
    ensure(groups, quote.source || 'unattributed', blank(quote.campaign), blank(quote.keyword)).quotes += 1;
  }
  for (const invoice of input.invoices) {
    if (!(invoice.valueUsd > 0)) continue;
    const source = blank(invoice.source) || 'unattributed';
    const group = ensure(groups, source, blank(invoice.campaign), blank(invoice.keyword));
    group.invoicedRevenue = roundMoney(group.invoicedRevenue + invoice.valueUsd);
  }
  for (const cost of input.costs) {
    if (!(cost.costUsd > 0)) continue;
    const group = ensure(groups, 'google_ads', blank(cost.campaign), blank(cost.keyword));
    group.cost = roundMoney(group.cost + cost.costUsd);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      roas: group.cost > 0 ? roundMoney(group.invoicedRevenue / group.cost) : null,
    }))
    .sort((a, b) => {
      if (a.source === 'unattributed' && b.source !== 'unattributed') return 1;
      if (b.source === 'unattributed' && a.source !== 'unattributed') return -1;
      return (
        a.source.localeCompare(b.source) ||
        a.campaign.localeCompare(b.campaign) ||
        a.keyword.localeCompare(b.keyword)
      );
    });
}

export function closedLoopSheetValues(
  rows: ClosedLoopGroup[],
  period: { start: string; end: string }
): string[][] {
  const header = [
    'period_start',
    'period_end',
    'source',
    'campaign',
    'keyword',
    'leads',
    'calls',
    'booked_jobs',
    'quotes',
    'invoiced_revenue',
    'cost',
    'roas',
  ];
  return [
    header,
    ...rows.map((row) => [
      period.start,
      period.end,
      row.source,
      row.campaign,
      row.keyword,
      String(row.leads),
      String(row.calls),
      String(row.bookedJobs),
      String(row.quotes),
      row.invoicedRevenue.toFixed(2),
      row.cost.toFixed(2),
      row.roas == null ? '' : row.roas.toFixed(2),
    ]),
  ];
}

export function closedLoopEmailText(rows: ClosedLoopGroup[], period: { start: string; end: string }): string {
  const lines = [
    `SCWS paid-ads closed loop ${period.start} to ${period.end}`,
    '',
    'source | campaign | keyword | leads | calls | booked | quotes | invoiced | cost | roas',
  ];
  for (const row of rows) {
    lines.push(
      [
        row.source,
        row.campaign || '—',
        row.keyword || '—',
        row.leads,
        row.calls,
        row.bookedJobs,
        row.quotes,
        `$${row.invoicedRevenue.toFixed(2)}`,
        `$${row.cost.toFixed(2)}`,
        row.roas == null ? '—' : `${row.roas.toFixed(2)}x`,
      ].join(' | ')
    );
  }
  if (!rows.length) lines.push('No rows in this window.');
  lines.push('', 'Unmatched invoiced revenue is source unattributed.');
  return lines.join('\n');
}
