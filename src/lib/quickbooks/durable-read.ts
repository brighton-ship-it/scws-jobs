/**
 * Durable, read-only QuickBooks Online access for Production.
 *
 * Single writer: only Production refreshes the Intuit token. Rotated refresh
 * tokens are written back to public.quickbooks_connections with a
 * compare-and-swap on the previous refresh token, so two isolates cannot
 * overwrite a newer pair with an older one. The box never refreshes; it calls
 * the Production MCP tools (qbo_report, qbo_query, qbo_status).
 *
 * Intuit refresh tokens expire after 100 days without use, so a daily cron
 * (/api/cron/qbo-refresh) keeps the token alive.
 *
 * READ-ONLY: only GET requests to /reports/* and /query (SELECT) are allowed.
 */
import { createClient } from '@supabase/supabase-js';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const PROD_BASE = 'https://quickbooks.api.intuit.com';
const SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com';
const MINOR_VERSION = '75';

export const QBO_READ_REPORTS = [
  'TaxSummary',
  'ProfitAndLoss',
  'ProfitAndLossDetail',
  'BalanceSheet',
  'GeneralLedger',
  'TransactionList',
  'TrialBalance',
  'CashFlow',
  'AgedReceivables',
  'AgedReceivableDetail',
  'AgedPayables',
  'CustomerSales',
  'ItemSales',
  'CustomerIncome',
  'VendorExpenses',
  'AccountList',
  'JournalReport',
] as const;

export type QboConnRow = {
  id: string;
  realm_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  environment: string | null;
  connected_at: string | null;
  updated_at: string | null;
  refresh_token_expires_at?: string | null;
};

type Env = Record<string, string | undefined>;

function serviceClient(env: Env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service configuration');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function oauthCreds(env: Env) {
  const clientId = env.QBO_CLIENT_ID || env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = env.QBO_CLIENT_SECRET || env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Missing QBO_CLIENT_ID / QBO_CLIENT_SECRET');
  return { clientId, clientSecret };
}

export function connectUrl(env: Env = process.env): string {
  const base = env.NEXT_PUBLIC_APP_URL || 'https://jobs.scwellservice.com';
  return `${base.replace(/\/$/, '')}/api/quickbooks/connect`;
}

async function loadConnection(env: Env): Promise<QboConnRow | null> {
  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('quickbooks_connections')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(`quickbooks_connections read failed: ${error.message}`);
  const rows = (data || []) as QboConnRow[];
  return rows.find((r) => r.environment === 'production') || rows[0] || null;
}

export function needsRefresh(row: Pick<QboConnRow, 'token_expires_at'>, nowMs = Date.now(), bufferMs = 5 * 60_000) {
  const exp = Date.parse(row.token_expires_at);
  return !Number.isFinite(exp) || exp - nowMs < bufferMs;
}

export class QboReconnectRequired extends Error {
  constructor(detail: string, env: Env = process.env) {
    super(`QuickBooks needs a one-time reconnect: ${detail}. Open ${connectUrl(env)} while signed in to the jobs app.`);
  }
}

/** Refresh with CAS on the old refresh token. Returns the freshest row. */
export async function refreshConnection(row: QboConnRow, env: Env = process.env, force = false): Promise<QboConnRow> {
  if (!force && !needsRefresh(row)) return row;
  const { clientId, clientSecret } = oauthCreds(env);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token }),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    // Another isolate may already have rotated the token.
    const latest = await loadConnection(env);
    if (latest && latest.refresh_token !== row.refresh_token && !needsRefresh(latest)) return latest;
    if (res.status === 400 || res.status === 401) throw new QboReconnectRequired(`Intuit refresh rejected (${res.status} ${text.replace(/[A-Za-z0-9_\-]{30,}/g, '[redacted]')})`, env);
    throw new Error(`Intuit refresh failed (${res.status})`);
  }
  const tok = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; x_refresh_token_expires_in?: number };
  const now = Date.now();
  const update: Record<string, unknown> = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    token_expires_at: new Date(now + tok.expires_in * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  const sb = serviceClient(env);
  const { data, error } = await sb
    .from('quickbooks_connections')
    .update(update)
    .eq('id', row.id)
    .eq('refresh_token', row.refresh_token)
    .select('*');
  if (error) throw new Error(`quickbooks_connections write failed: ${error.message}`);
  if (!data || data.length === 0) {
    // Lost the CAS race: someone else committed a newer pair; use theirs.
    const latest = await loadConnection(env);
    if (latest) return latest;
  }
  return { ...row, ...(update as Partial<QboConnRow>), refresh_token_expires_at: tok.x_refresh_token_expires_in ? new Date(now + tok.x_refresh_token_expires_in * 1000).toISOString() : null };
}

async function readyConnection(env: Env): Promise<QboConnRow> {
  const row = await loadConnection(env);
  if (!row) throw new QboReconnectRequired('no connection is stored', env);
  return refreshConnection(row, env);
}

function baseUrl(row: QboConnRow, env: Env) {
  const envName = row.environment || env.QBO_ENVIRONMENT || env.QUICKBOOKS_ENVIRONMENT;
  return envName === 'sandbox' ? SANDBOX_BASE : PROD_BASE;
}

async function qboGet(path: string, params: Record<string, string>, env: Env): Promise<unknown> {
  let row = await readyConnection(env);
  for (let attempt = 0; attempt < 2; attempt++) {
    const qs = new URLSearchParams({ ...params, minorversion: MINOR_VERSION });
    const url = `${baseUrl(row, env)}/v3/company/${encodeURIComponent(row.realm_id)}${path}?${qs}`;
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${row.access_token}`, Accept: 'application/json' } });
    if (res.status === 401 && attempt === 0) {
      row = await refreshConnection(row, env, true);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`QuickBooks ${path} failed (${res.status}): ${text.slice(0, 400)}`);
    return JSON.parse(text);
  }
  throw new Error('QuickBooks request failed after refresh');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function sanitizeReportParams(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!/^[a-z_]+$/.test(k)) throw new Error(`Bad report param name: ${k}`);
    if (v === undefined || v === null || v === '') continue;
    const s = String(v);
    if (s.length > 500) throw new Error(`Param ${k} too long`);
    if ((k === 'start_date' || k === 'end_date') && !DATE_RE.test(s)) throw new Error(`${k} must be YYYY-MM-DD`);
    out[k] = s;
  }
  return out;
}

export async function runQboReport(report: string, params: Record<string, unknown>, env: Env = process.env) {
  if (!(QBO_READ_REPORTS as readonly string[]).includes(report)) {
    throw new Error(`Report not allowed. Use one of: ${QBO_READ_REPORTS.join(', ')}`);
  }
  return qboGet(`/reports/${report}`, sanitizeReportParams(params), env);
}

export function assertReadOnlyQuery(q: string): string {
  const s = String(q || '').trim();
  if (!/^select\s/i.test(s)) throw new Error('Only SELECT queries are allowed');
  if (/;/.test(s)) throw new Error('One statement only');
  if (s.length > 2000) throw new Error('Query too long');
  return s;
}

export async function runQboQuery(query: string, env: Env = process.env) {
  return qboGet('/query', { query: assertReadOnlyQuery(query) }, env);
}

export async function qboStatus(env: Env = process.env) {
  try {
    const row = await loadConnection(env);
    if (!row) return { connected: false, reconnectUrl: connectUrl(env) };
    const fresh = await refreshConnection(row, env);
    const info = (await qboGet('/companyinfo/' + encodeURIComponent(fresh.realm_id), {}, env)) as { CompanyInfo?: { CompanyName?: string } };
    return {
      connected: true,
      environment: fresh.environment,
      realmId: fresh.realm_id,
      companyName: info?.CompanyInfo?.CompanyName ?? null,
      accessTokenExpiresAt: fresh.token_expires_at,
      lastRotatedAt: fresh.updated_at,
      connectedAt: fresh.connected_at,
    };
  } catch (e) {
    return { connected: false, error: e instanceof Error ? e.message : String(e), reconnectUrl: connectUrl(env) };
  }
}

/** Daily keep-alive: force a rotation so the 100-day idle window never lapses. */
export async function keepAliveRefresh(env: Env = process.env) {
  const row = await loadConnection(env);
  if (!row) throw new QboReconnectRequired('no connection is stored', env);
  const fresh = await refreshConnection(row, env, true);
  return { realmId: fresh.realm_id, environment: fresh.environment, accessTokenExpiresAt: fresh.token_expires_at, rotatedAt: fresh.updated_at };
}
