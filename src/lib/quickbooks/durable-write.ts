/**
 * Gated QuickBooks Online writes for the Jobber MCP.
 *
 * Preview is the default and does not call QuickBooks.
 * A real post requires confirm:true and QBO_WRITES_ENABLED=true.
 * Sandbox is the default. Production also requires QBO_WRITE_ENVIRONMENT=production
 * and QBO_WRITE_PRODUCTION_REALM_ID equal to the connected realm.
 * Every confirm is audited before the post (status pending) and again with the
 * response (status ok or failed). Both rows use the gate environment and the
 * batch id. A refused confirm is status refused and does not post. ok=false
 * on a pending or refused row is not a QuickBooks failure.
 * Deletes happen only inside qbo_revert_batch.
 */
import { createClient } from '@supabase/supabase-js';
import { productionWriteAccessToken } from './durable-read.ts';
import { assertSandboxPersistAllowed, describeQboWriteGate, type Env, type QboWriteEnvironment, type QboWriteGate } from './write-gate.ts';
import {
  applyRead,
  buildQboPlan,
  confirmRequested,
  idempotencyPayload,
  inspectSavedInvoiceTax,
  parseBatchId,
  resolveRequestId,
  savedTaxCode,
  taxableAmountOfBody,
  type QboPlan,
  type SavedTaxInspection,
} from './write-payloads.ts';
import { COUNTY_RATE_ID_BY_TAX_CODE, COUNTY_RATE_IDS } from './tax-codes.ts';

const MINOR_VERSION = '75';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

export type SandboxTokenRow = {
  id?: string;
  realmId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

type SbResult = { data: any; error: { message: string } | null };

export type SbClient = {
  from(table: string): any;
};

/** preview and refused never post. pending is the pre-write row. failed is a QuickBooks error. */
/**
 * unknown = the POST was sent but no answer came back (network error, timeout, or a
 * 408/500/502/503/504 status). QuickBooks may have saved it. Revert and
 * reconciliation must treat it as possibly written, never as failed.
 */
export type QboAuditStatus = 'preview' | 'pending' | 'refused' | 'ok' | 'failed' | 'tax_mismatch' | 'unknown' | 'tax_code_changed';

/**
 * HTTP statuses where the request may have reached QuickBooks and been saved.
 * An Intuit 500 is included: it can come back after the entity was committed.
 */
const OUTCOME_UNKNOWN_STATUSES = new Set([408, 500, 502, 503, 504]);

class PostOutcomeUnknownError extends Error {
  logged = true;
}

export type QboAuditEntry = {
  actor: string;
  tool: string;
  requestId: string;
  dryRun: boolean;
  confirmed: boolean;
  ok: boolean;
  refused: boolean;
  /** Distinguishes a pre-write or refused row from a QuickBooks failure. ok=false is not enough. */
  status: QboAuditStatus;
  realmId: string | null;
  environment: QboWriteEnvironment;
  entity: string;
  payload: unknown;
  qboResponse: unknown;
  qboIds: Record<string, string | null>;
  error: string | null;
  reason: string | null;
  batchId?: string | null;
  action?: string | null;
  created?: boolean;
  priorState?: unknown;
  syncToken?: string | null;
  txnDate?: string | null;
};

export type QboWriteDeps = {
  env?: Env;
  actor?: string;
  fetchImpl?: typeof fetch;
  accessToken?: string;
  productionRealmId?: string;
  loadProductionRealmId?: (env: Env) => Promise<string | null>;
  tokenStore?: {
    load(realmId: string): Promise<SandboxTokenRow | null>;
    save(row: SandboxTokenRow, productionRealmId: string): Promise<void>;
  };
  audit?: (entry: QboAuditEntry) => Promise<void>;
  now?: () => number;
  qboQuery?: (query: string) => Promise<unknown>;
  loadJobberInvoices?: (numbers: string[]) => Promise<any[]>;
  loadBatch?: (batchId: string) => Promise<any[]>;
  readCloseDate?: () => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
};

export type QboWriteResult = {
  ok: boolean;
  dryRun: boolean;
  wrote: boolean;
  refused: boolean;
  confirm: boolean;
  tool: string;
  actor: string;
  requestId: string;
  target: { enabled: boolean; environment: QboWriteEnvironment; realmId: string | null; blockedReason: string | null };
  batchId: string | null;
  http: {
    method: 'POST';
    path: string;
    query: Record<string, string>;
    body: Record<string, unknown> | null;
    readFirst: string | null;
  };
  changes: unknown;
  ids: Record<string, string | null>;
  qbo: unknown;
  error?: string;
  reason?: string;
  /** The POST was sent but the result is not known. QuickBooks may have saved it. */
  outcomeUnknown?: boolean;
  /** Invoice writes with plan.expectTaxCode: what was saved differs from what was asked (Automated Sales Tax re-picked the code, the county rate, or the taxable amount). The write happened; ok is false and status is tax_code_changed. */
  taxCodeChanged?: TaxCodeChange | null;
  /** CDTFA ship-address update: code, exact rate set, TotalTax, override flag, and lines. */
  savedTax?: SavedTaxInspection | null;
  status?: 'tax_code_changed' | 'tax_mismatch';
  audit: { attempted: boolean; error?: string };
};

export type TaxCodeChange = {
  requested: string;
  saved: string | null;
  expectedCountyRateId: string | null;
  savedRateIds: string[];
  expectedNetAmountTaxable: number | null;
  savedNetAmountTaxable: number[];
  reasons: string[];
};

/** Entities that carry TxnDate. Items, customers, vendors, and preferences do not. */
const TRANSACTION_ENTITIES = new Set([
  'Invoice',
  'SalesReceipt',
  'CreditMemo',
  'RefundReceipt',
  'Estimate',
  'Payment',
  'BillPayment',
  'Purchase',
  'Bill',
  'VendorCredit',
  'JournalEntry',
  'Deposit',
  'Transfer',
  'CreditCardPayment',
]);

export function isQboTransactionEntity(entity: string): boolean {
  return TRANSACTION_ENTITIES.has(entity);
}

/** TxnDate from a transaction body or a QBO entity response, as YYYY-MM-DD. */
export function txnDateFromQbo(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, any>;
  if (typeof record.TxnDate === 'string' && record.TxnDate) return record.TxnDate.slice(0, 10);
  for (const nested of Object.values(record)) {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const txn = (nested as { TxnDate?: unknown }).TxnDate;
    if (typeof txn === 'string' && txn) return txn.slice(0, 10);
  }
  return null;
}

/**
 * Audit date for a transaction: the write response, then the entity read before
 * the post, then the request body. Sparse edits omit TxnDate on the body.
 * Non-transaction entities (Item, Customer, Preferences) store no date.
 */
export function auditTxnDate(entity: string, sources: { response?: unknown; prior?: unknown; body?: unknown }): string | null {
  if (!isQboTransactionEntity(entity)) return null;
  return txnDateFromQbo(sources.response) || txnDateFromQbo(sources.prior) || txnDateFromQbo(sources.body);
}

export function sandboxTokenRecord(row: SandboxTokenRow, nowIso = new Date().toISOString()) {
  return {
    realm_id: row.realmId,
    environment: 'sandbox' as const,
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
    token_expires_at: row.expiresAt,
    updated_at: nowIso,
  };
}

export async function loadSandboxToken(client: SbClient, realmId: string): Promise<SandboxTokenRow | null> {
  const { data, error } = (await client
    .from('quickbooks_connections')
    .select('id, realm_id, access_token, refresh_token, token_expires_at, environment')
    .eq('realm_id', realmId)
    .eq('environment', 'sandbox')) as SbResult;
  if (error) throw new Error(`sandbox connection read failed: ${error.message}`);
  const row = (data || []).find((item: { environment?: string; realm_id?: string }) => item.environment === 'sandbox' && item.realm_id === realmId);
  if (!row) return null;
  return {
    id: row.id,
    realmId: row.realm_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.token_expires_at,
  };
}

export async function saveSandboxToken(client: SbClient, row: SandboxTokenRow, productionRealmId: string): Promise<void> {
  assertSandboxPersistAllowed(row.realmId, productionRealmId);
  const { data, error } = (await client
    .from('quickbooks_connections')
    .select('id, environment, realm_id')
    .eq('realm_id', row.realmId)) as SbResult;
  if (error) throw new Error(`sandbox connection lookup failed: ${error.message}`);
  if ((data || []).some((item: { environment?: string }) => item.environment === 'production')) {
    throw new Error('Refusing to store a write token on a production connection row.');
  }
  const payload = sandboxTokenRecord(row);
  const sandbox = (data || []).find((item: { environment?: string; id?: string }) => item.environment === 'sandbox');
  if (sandbox?.id) {
    const updated = (await client
      .from('quickbooks_connections')
      .update(payload)
      .eq('id', sandbox.id)
      .eq('environment', 'sandbox')) as SbResult;
    if (updated.error) throw new Error(`sandbox connection update failed: ${updated.error.message}`);
    return;
  }
  const inserted = (await client.from('quickbooks_connections').insert(payload)) as SbResult;
  if (inserted.error) throw new Error(`sandbox connection insert failed: ${inserted.error.message}`);
}

export async function insertQboAudit(client: SbClient, entry: QboAuditEntry): Promise<void> {
  const { error } = (await client.from('qbo_write_audit').insert({
    actor: entry.actor,
    tool: entry.tool,
    request_id: entry.requestId,
    dry_run: entry.dryRun,
    confirmed: entry.confirmed,
    ok: entry.ok,
    refused: entry.refused,
    realm_id: entry.realmId,
    environment: entry.environment,
    status: entry.status,
    entity: entry.entity,
    payload: cap(entry.payload),
    qbo_response: cap(entry.qboResponse),
    qbo_ids: entry.qboIds,
    error: entry.error,
    reason: entry.reason,
    batch_id: entry.batchId ?? null,
    action: entry.action ?? null,
    created: entry.created ?? false,
    prior_state: cap(entry.priorState),
    sync_token: entry.syncToken ?? entry.qboIds?.syncToken ?? null,
    txn_date: entry.txnDate ?? null,
  })) as SbResult;
  if (error) throw new Error(`qbo_write_audit insert failed: ${error.message}`);
}

function cap(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    if (text.length <= 80_000) return value;
    return { truncated: true, preview: text.slice(0, 80_000) };
  } catch {
    return { unserializable: true };
  }
}

function service(env: Env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key || url === 'your-supabase-url') return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function loadProductionRealmId(env: Env): Promise<string | null> {
  const client = service(env);
  if (!client) return null;
  const { data, error } = await client
    .from('quickbooks_connections')
    .select('realm_id, environment')
    .order('updated_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(`production realm read failed: ${error.message}`);
  const rows = (data || []) as { realm_id?: string; environment?: string | null }[];
  const prod = rows.find((row) => row.environment === 'production') || rows[0];
  return prod?.realm_id || null;
}

export async function recordQboAudit(entry: QboAuditEntry, deps: QboWriteDeps = {}): Promise<void> {
  if (deps.audit) {
    await deps.audit(entry);
    return;
  }
  await defaultAudit(entry, deps.env || process.env);
}

async function defaultAudit(entry: QboAuditEntry, env: Env): Promise<void> {
  console.log(`[qbo-write-audit] ${JSON.stringify({ ...entry, payload: cap(entry.payload), qboResponse: cap(entry.qboResponse) })}`);
  const client = service(env);
  if (!client) {
    if (entry.confirmed && !entry.dryRun) {
      throw new Error('Refusing QBO write because Supabase is not configured, so the audit row cannot be stored. Apply supabase/migrations/20261105_qbo_write_audit.sql and set SUPABASE_SERVICE_KEY.');
    }
    return;
  }
  await insertQboAudit(client, entry);
}

/**
 * Audit a confirm that a tool refused before any pending row or QuickBooks post
 * (for example the relink duplicate-payment check). Status refused is not a write,
 * so revert ignores it. An audit failure is returned, not thrown, so the caller's
 * own refusal error still reaches the user.
 */
export async function auditRefusal(
  fields: { tool: string; entity: string; requestId: string; batchId: string | null; error: string; payload?: unknown; reason?: string | null },
  deps: QboWriteDeps = {}
): Promise<{ ok: boolean; error?: string }> {
  const env = deps.env || process.env;
  const gate = describeQboWriteGate(env);
  const entry: QboAuditEntry = {
    actor: deps.actor?.trim() || 'unknown',
    tool: fields.tool,
    requestId: fields.requestId,
    dryRun: true,
    confirmed: true,
    ok: false,
    refused: true,
    status: 'refused',
    realmId: gate.realmId,
    environment: gate.environment,
    entity: fields.entity,
    payload: fields.payload ?? null,
    qboResponse: null,
    qboIds: {},
    error: fields.error,
    reason: fields.reason ?? null,
    batchId: fields.batchId,
  };
  try {
    if (deps.audit) await deps.audit(entry);
    else await defaultAudit(entry, env);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function oauthCreds(env: Env) {
  const clientId = env.QBO_WRITE_CLIENT_ID || env.QBO_CLIENT_ID || env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = env.QBO_WRITE_CLIENT_SECRET || env.QBO_CLIENT_SECRET || env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing QBO_WRITE_CLIENT_ID / QBO_WRITE_CLIENT_SECRET (or the existing QBO_CLIENT_ID / QBO_CLIENT_SECRET) for the sandbox company.');
  }
  return { clientId, clientSecret };
}

export async function refreshSandboxToken(
  row: SandboxTokenRow,
  env: Env,
  fetchImpl: typeof fetch,
  now = Date.now()
): Promise<SandboxTokenRow> {
  const exp = Date.parse(row.expiresAt);
  if (row.accessToken && Number.isFinite(exp) && exp - now > 5 * 60_000) return row;
  const { clientId, clientSecret } = oauthCreds(env);
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refreshToken }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sandbox token refresh failed (${res.status}): ${text.slice(0, 180).replace(/[A-Za-z0-9_\-]{20,}/g, '[redacted]')}`);
  }
  const tok = JSON.parse(text) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tok.access_token || !tok.refresh_token) throw new Error('Sandbox token refresh returned no token.');
  return {
    ...row,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token,
    expiresAt: new Date(now + (tok.expires_in || 3600) * 1000).toISOString(),
  };
}

async function tokenFor(gate: QboWriteGate, productionRealmId: string, deps: QboWriteDeps, fetchImpl: typeof fetch): Promise<string> {
  if (deps.accessToken) return deps.accessToken;
  const env = deps.env || process.env;
  if (gate.environment === 'production') {
    if (!gate.realmId) throw new Error('Production write realm is missing.');
    return productionWriteAccessToken(env, gate.realmId);
  }
  const store = deps.tokenStore || {
    load: async (realmId: string) => {
      const client = service(env);
      if (!client) return null;
      return loadSandboxToken(client, realmId);
    },
    save: async (row: SandboxTokenRow, prodRealm: string) => {
      const client = service(env);
      if (!client) throw new Error('Refusing QBO write because the rotated sandbox refresh token cannot be stored. Set SUPABASE_SERVICE_KEY.');
      await saveSandboxToken(client, row, prodRealm);
    },
  };
  let row = gate.realmId ? await store.load(gate.realmId) : null;
  if (!row) {
    const refresh = env.QBO_WRITE_REFRESH_TOKEN;
    if (!refresh || !gate.realmId) throw new Error('No sandbox token. Set QBO_WRITE_REFRESH_TOKEN for QBO_WRITE_REALM_ID.');
    row = { realmId: gate.realmId, accessToken: '', refreshToken: refresh, expiresAt: new Date(0).toISOString() };
  }
  const fresh = await refreshSandboxToken(row, env, fetchImpl, deps.now ? deps.now() : Date.now());
  if (fresh.refreshToken !== row.refreshToken || fresh.accessToken !== row.accessToken || !row.id) {
    await store.save(fresh, productionRealmId);
  }
  return fresh.accessToken;
}

function queryOf(requestId: string, operation?: string): Record<string, string> {
  const query: Record<string, string> = { minorversion: MINOR_VERSION, requestid: requestId };
  if (operation) query.operation = operation;
  return query;
}

function writeUrl(baseUrl: string, realmId: string, path: string, query: Record<string, string>): string {
  const qs = new URLSearchParams(query);
  return `${baseUrl}/v3/company/${encodeURIComponent(realmId)}${path}?${qs}`;
}

async function qboFetch(url: string, token: string, fetchImpl: typeof fetch, body?: Record<string, unknown>): Promise<{ status: number; json: any; text: string }> {
  const res = await fetchImpl(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 2000) };
  }
  return { status: res.status, json, text };
}

function idsFrom(entity: string, json: any): Record<string, string | null> {
  const row = json && typeof json === 'object' ? json[entity] : null;
  if (!row || typeof row !== 'object') return {};
  return {
    id: row.Id != null ? String(row.Id) : null,
    syncToken: row.SyncToken != null ? String(row.SyncToken) : null,
    docNumber: row.DocNumber != null ? String(row.DocNumber) : null,
  };
}

function slim(entity: string, json: any): unknown {
  if (entity === 'Preferences' && json?.Preferences) {
    const prefs = json.Preferences;
    return {
      Id: prefs.Id ?? null,
      SyncToken: prefs.SyncToken ?? null,
      BookCloseDate: prefs.AccountingInfoPrefs?.BookCloseDate ?? null,
    };
  }
  return json?.[entity] ?? json;
}

function resultBase(plan: QboPlan, requestId: string, actor: string, confirm: boolean, gate: QboWriteGate): QboWriteResult {
  return {
    ok: false,
    dryRun: !confirm,
    wrote: false,
    refused: false,
    confirm,
    tool: plan.tool,
    actor,
    requestId,
    batchId: null,
    target: {
      enabled: gate.enabled,
      environment: gate.environment,
      realmId: gate.realmId,
      blockedReason: gate.blockedReason,
    },
    http: {
      method: 'POST',
      path: plan.path,
      query: queryOf(requestId, plan.operation),
      body: plan.body,
      readFirst: plan.read?.path || null,
    },
    changes: plan.changes ?? null,
    ids: {},
    qbo: null,
    reason: plan.reason,
    audit: { attempted: false },
  };
}

async function remember(entry: QboAuditEntry, deps: QboWriteDeps, required: boolean): Promise<{ ok: boolean; error?: string }> {
  const env = deps.env || process.env;
  try {
    if (deps.audit) await deps.audit(entry);
    else await defaultAudit(entry, env);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (required) throw new Error(message);
    return { ok: false, error: message };
  }
}

export async function runQboWrite(tool: string, args: Record<string, unknown>, deps: QboWriteDeps = {}): Promise<QboWriteResult> {
  return runQboPlan(buildQboPlan(tool, args), args, deps);
}

export async function runQboPlan(plan: QboPlan, args: Record<string, unknown>, deps: QboWriteDeps = {}): Promise<QboWriteResult> {
  const tool = plan.tool;
  const confirm = confirmRequested(args);
  const requestId = resolveRequestId(tool, idempotencyPayload(plan), typeof args.requestId === 'string' ? args.requestId : undefined);
  const actor = deps.actor?.trim() || 'unknown';
  const env = deps.env || process.env;
  const gate = describeQboWriteGate(env);
  const base = resultBase(plan, requestId, actor, confirm, gate);
  const batchId = parseBatchId(args.batchId);
  base.batchId = batchId;
  const fetchImpl = deps.fetchImpl || fetch;
  // environment and batchId are applied after the caller's fields so a pre-write
  // row cannot be stored as sandbox, or without the batch id that was passed.
  // txnSources grows as the read and the response arrive. Sparse updates do not
  // put TxnDate on the body, so the outcome row uses the response or the prior entity.
  const txnSources: { response?: unknown; prior?: unknown; body?: unknown } = { body: plan.body };
  const logged = (status: QboAuditStatus, fields: Partial<QboAuditEntry> = {}): QboAuditEntry => ({
    actor,
    tool: plan.tool,
    requestId,
    dryRun: !confirm,
    confirmed: confirm,
    realmId: gate.realmId,
    entity: plan.entity,
    payload: null,
    qboResponse: null,
    qboIds: {},
    error: null,
    reason: plan.reason || null,
    ...fields,
    txnDate: auditTxnDate(plan.entity, txnSources),
    ok: status === 'ok' || status === 'preview',
    refused: status === 'refused',
    status,
    environment: gate.environment,
    batchId,
  });

  if (!confirm) {
    const audit = await remember(
      logged('preview', { payload: { http: base.http, changes: plan.changes ?? null, reason: plan.reason || null } }),
      deps,
      false
    );
    return { ...base, ok: true, audit: { attempted: true, error: audit.error } };
  }

  if (!gate.enabled || !gate.realmId) {
    const error = gate.blockedReason || 'QBO writes are off.';
    const audit = await remember(
      logged('refused', { dryRun: true, error, payload: { http: base.http, changes: plan.changes ?? null } }),
      deps,
      false
    );
    return { ...base, dryRun: true, refused: true, error, audit: { attempted: true, error: audit.error } };
  }

  let productionRealmId = deps.productionRealmId;
  if (!productionRealmId) {
    productionRealmId = deps.loadProductionRealmId ? (await deps.loadProductionRealmId(env)) || undefined : (await loadProductionRealmId(env)) || undefined;
  }
  if (!productionRealmId) {
    const error = 'Refusing QBO write until the production realm id can be read and compared.';
    await remember(logged('refused', { dryRun: true, error, payload: { http: base.http } }), deps, false);
    return { ...base, dryRun: true, refused: true, error, audit: { attempted: true } };
  }
  if (gate.environment === 'production' && productionRealmId !== gate.realmId) {
    const error = 'Refusing QBO write: QBO_WRITE_PRODUCTION_REALM_ID does not equal the connected realm.';
    await remember(logged('refused', { dryRun: true, error, payload: { http: base.http } }), deps, false);
    return { ...base, dryRun: true, refused: true, error, audit: { attempted: true } };
  }
  if (gate.environment !== 'production' && productionRealmId === gate.realmId) {
    const error = 'Refusing QBO write: QBO_WRITE_REALM_ID is the production company.';
    await remember(logged('refused', { dryRun: true, error, payload: { http: base.http } }), deps, false);
    return { ...base, dryRun: true, refused: true, error, audit: { attempted: true } };
  }

  // Intent row, written before the post so a missing audit blocks the write.
  // ok stays false until the response row. status pending keeps it from looking like a failure.
  await remember(
    logged('pending', {
      action: plan.action,
      payload: { http: base.http, changes: plan.changes ?? null, reason: plan.reason || null },
    }),
    deps,
    true
  );

  // From here on a pending row exists. Any throw before the POST is sent (token, the
  // read-before-write apply guard) leaves a failed row, so the pending row is not
  // orphaned. A throw while the POST is in flight is logged as unknown inside
  // postAfterPending, because QuickBooks may have saved it.
  const realmId: string = gate.realmId;
  const prodRealmId: string = productionRealmId;
  try {
    return await postAfterPending();
  } catch (error) {
    if (error instanceof PostOutcomeUnknownError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await remember(
      logged('failed', {
        action: plan.action,
        payload: { http: base.http, changes: plan.changes ?? null, reason: plan.reason || null },
        error: `Stopped after the pending row: ${message}`,
      }),
      deps,
      false
    );
    throw error;
  }

  async function postAfterPending(): Promise<QboWriteResult> {
  const token = await tokenFor(gate, prodRealmId, deps, fetchImpl);
  let body = plan.body;
  let priorState: unknown = null;
  if (plan.read) {
    const got = await qboFetch(writeUrl(gate.baseUrl, realmId, plan.read.path, { minorversion: MINOR_VERSION }), token, fetchImpl);
    if (got.status < 200 || got.status >= 300) {
      const error = `QuickBooks read before write failed (${got.status}). Nothing was posted.`;
      await remember(failEntry(base, plan.entity, error, got.json), deps, false);
      return { ...base, error, qbo: slim(plan.entity, got.json), audit: { attempted: true } };
    }
    const fetchedEntity = (got.json && (got.json[plan.entity] || got.json)) || null;
    if (plan.action !== 'create' && plan.action !== 'attach') priorState = cap(fetchedEntity);
    txnSources.prior = fetchedEntity;
    body = applyRead(plan, got.json || {});
    txnSources.body = body;
  }
  if (!body) throw new Error('QuickBooks write had no body to post.');
  const query = queryOf(requestId, plan.operation);
  const http = { ...base.http, body, query };
  let posted: { status: number; json: any; text: string };
  try {
    posted = await qboFetch(writeUrl(gate.baseUrl, realmId, plan.path, query), token, fetchImpl, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unknownError = `QuickBooks ${plan.path} outcome unknown: the request was sent but no response came back (${message}). It may have posted. Read QuickBooks before any retry or revert.`;
    await remember(logged('unknown', { action: plan.action, payload: { http, reason: plan.reason || null }, error: unknownError }), deps, false);
    throw new PostOutcomeUnknownError(unknownError);
  }
  txnSources.response = posted.json;
  txnSources.body = body;
  const ids = idsFrom(plan.entity, posted.json);
  if (OUTCOME_UNKNOWN_STATUSES.has(posted.status)) {
    const error = `QuickBooks ${plan.path} returned ${posted.status}, so the outcome is unknown. It may have posted. Read QuickBooks before any retry or revert.`;
    await remember(
      logged('unknown', { action: plan.action, payload: { http, reason: plan.reason || null }, qboResponse: cap(posted.json), qboIds: ids, error }),
      deps,
      false
    );
    return { ...base, http, error, ids, qbo: slim(plan.entity, posted.json), outcomeUnknown: true, audit: { attempted: true } };
  }
  if (posted.status < 200 || posted.status >= 300) {
    const error = `QuickBooks ${plan.path} failed (${posted.status}).`;
    await remember(
      logged('failed', {
        payload: { http, reason: plan.reason || null },
        qboResponse: cap(posted.json),
        qboIds: ids,
        error,
      }),
      deps,
      false
    );
    return { ...base, http, error, ids, qbo: slim(plan.entity, posted.json), audit: { attempted: true } };
  }
  let auditError: string | undefined;
  const savedTax = plan.expectSavedTax && plan.entity === 'Invoice' ? inspectSavedInvoiceTax(posted.json, plan.expectSavedTax, priorState) : null;
  const taxCodeChanged = savedTax ? null : taxCodeChangeOf(plan, posted.json, body);
  const heldBad = savedTax && !savedTax.ok ? savedTax : null;
  const changedText = heldBad
    ? `${heldBad.status}: ${heldBad.reasons.join(' ')}`
    : taxCodeChanged
      ? `tax_code_changed: ${taxCodeChanged.reasons.join(' ')}`
      : '';
  const outcomeStatus: QboAuditStatus = heldBad ? heldBad.status : taxCodeChanged ? 'tax_code_changed' : 'ok';
  try {
    await remember(
      logged(outcomeStatus, {
        action: plan.action,
        created: plan.action === 'create' || plan.action === 'attach',
        priorState,
        syncToken: ids.syncToken,
        payload: {
          http,
          reason: plan.reason || null,
          ...(plan.expectTaxCode ? { taxCodeChanged } : {}),
          ...(savedTax ? { savedTax } : {}),
        },
        qboResponse: cap(posted.json),
        qboIds: ids,
        ...(changedText ? { error: changedText } : {}),
      }),
      deps,
      true
    );
  } catch (error) {
    auditError = error instanceof Error ? error.message : String(error);
  }
  const errors = [changedText ? `Posted, but ${changedText}` : '', auditError ? `Posted, but the audit log failed: ${auditError}` : ''].filter(Boolean);
  return {
    ...base,
    ok: outcomeStatus === 'ok',
    dryRun: false,
    wrote: true,
    http,
    ids,
    qbo: slim(plan.entity, posted.json),
    error: errors.length ? errors.join(' ') : undefined,
    ...(plan.expectTaxCode ? { taxCodeChanged } : {}),
    ...(savedTax ? { savedTax } : {}),
    ...(outcomeStatus === 'ok' ? {} : { status: outcomeStatus }),
    audit: { attempted: true, error: auditError },
  };
  }
}

/**
 * Compare a saved invoice with plan.expectTaxCode: the header code, the county TaxRate id that code
 * must carry (4 San Diego, 25 Riverside; the other must be absent), and NetAmountTaxable on every
 * TaxLine when plan.expectNetAmountTaxable is set. Null when everything matches or nothing was expected.
 */
export function taxCodeChangeOf(plan: QboPlan, json: unknown, body?: Record<string, unknown> | null): TaxCodeChange | null {
  if (!plan.expectTaxCode || plan.entity !== 'Invoice') return null;
  const root = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
  const detail = (root.Invoice || root)?.TxnTaxDetail || {};
  const taxLines: any[] = Array.isArray(detail.TaxLine) ? detail.TaxLine : [];
  const saved = savedTaxCode(json);
  const savedRateIds = taxLines.map((line) => String(line?.TaxLineDetail?.TaxRateRef?.value ?? '')).filter(Boolean);
  const savedNet = taxLines.map((line) => Number(line?.TaxLineDetail?.NetAmountTaxable)).filter((n) => Number.isFinite(n));
  const expectedCounty = COUNTY_RATE_ID_BY_TAX_CODE[plan.expectTaxCode] || null;
  const expectedNet = plan.expectNetAmountTaxable === 'body' ? taxableAmountOfBody(body) : typeof plan.expectNetAmountTaxable === 'number' ? plan.expectNetAmountTaxable : null;
  const reasons: string[] = [];
  if (saved !== plan.expectTaxCode) reasons.push(`Requested TxnTaxCodeRef ${plan.expectTaxCode}, QuickBooks saved ${saved ?? 'none'}.`);
  if (expectedCounty) {
    if (!savedRateIds.includes(expectedCounty)) reasons.push(`Saved tax lines do not include county rate ${expectedCounty}.`);
    for (const other of COUNTY_RATE_IDS) {
      if (other !== expectedCounty && savedRateIds.includes(other)) reasons.push(`Saved tax lines include the other county rate ${other}.`);
    }
  }
  if (expectedNet !== null && (!savedNet.length || savedNet.some((n) => Math.abs(n - expectedNet) > 0.009))) {
    reasons.push(`NetAmountTaxable is ${savedNet.length ? savedNet.filter((n, i) => savedNet.indexOf(n) === i).join(', ') : 'missing'}, expected ${expectedNet}.`);
  }
  if (!reasons.length) return null;
  return { requested: plan.expectTaxCode, saved, expectedCountyRateId: expectedCounty, savedRateIds, expectedNetAmountTaxable: expectedNet, savedNetAmountTaxable: savedNet, reasons };
}

function failEntry(base: QboWriteResult, entity: string, error: string, qbo: unknown): QboAuditEntry {
  return {
    actor: base.actor,
    tool: base.tool,
    requestId: base.requestId,
    dryRun: false,
    confirmed: true,
    ok: false,
    refused: false,
    status: 'failed',
    realmId: base.target.realmId,
    environment: base.target.environment,
    entity,
    batchId: base.batchId,
    payload: { http: base.http },
    qboResponse: cap(qbo),
    qboIds: {},
    error,
    reason: base.reason || null,
  };
}

async function writeToken(deps: QboWriteDeps): Promise<{ gate: QboWriteGate; token: string }> {
  const env = deps.env || process.env;
  const gate = describeQboWriteGate(env);
  if (!gate.enabled || !gate.realmId) throw new Error(gate.blockedReason || 'QBO writes are off.');
  const productionRealmId = deps.productionRealmId || (await (deps.loadProductionRealmId ? deps.loadProductionRealmId(env) : loadProductionRealmId(env))) || '';
  if (gate.environment === 'production' && productionRealmId !== gate.realmId) {
    throw new Error('Refusing QBO write: QBO_WRITE_PRODUCTION_REALM_ID does not equal the connected realm.');
  }
  if (gate.environment !== 'production' && productionRealmId === gate.realmId) {
    throw new Error('Refusing QBO write: QBO_WRITE_REALM_ID is the production company.');
  }
  const token = await tokenFor(gate, productionRealmId, deps, deps.fetchImpl || fetch);
  return { gate, token };
}

/** Read on the write-target company when the gate is open, otherwise the production read connection. */
export async function writeRealmQuery(query: string, deps: QboWriteDeps = {}): Promise<unknown> {
  const env = deps.env || process.env;
  const gate = describeQboWriteGate(env);
  if (!gate.enabled || !gate.realmId) {
    const { runQboQuery } = await import('./durable-read.ts');
    return runQboQuery(query, env);
  }
  const { token } = await writeToken(deps);
  const got = await qboFetch(writeUrl(gate.baseUrl, gate.realmId, '/query', { minorversion: MINOR_VERSION, query }), token, deps.fetchImpl || fetch);
  if (got.status < 200 || got.status >= 300) throw new Error(`QuickBooks query failed (${got.status}).`);
  return got.json;
}

/** GET one entity on the write-target company. The gate must already be open. */
export async function readWriteRealm(path: string, deps: QboWriteDeps = {}): Promise<unknown> {
  const { gate, token } = await writeToken(deps);
  const got = await qboFetch(writeUrl(gate.baseUrl, gate.realmId || '', path, { minorversion: MINOR_VERSION }), token, deps.fetchImpl || fetch);
  if (got.status < 200 || got.status >= 300) throw new Error(`QuickBooks read failed (${got.status}).`);
  return got.json;
}

export async function readBookCloseDate(deps: QboWriteDeps = {}): Promise<string | null> {
  const { gate, token } = await writeToken(deps);
  const got = await qboFetch(writeUrl(gate.baseUrl, gate.realmId || '', '/preferences', { minorversion: MINOR_VERSION }), token, deps.fetchImpl || fetch);
  if (got.status < 200 || got.status >= 300) throw new Error(`Could not read BookCloseDate (${got.status}).`);
  const date = got.json?.Preferences?.AccountingInfoPrefs?.BookCloseDate;
  return typeof date === 'string' && date ? date : null;
}

export function qboWriteSafety(env: Env = process.env) {
  const gate = describeQboWriteGate(env);
  return {
    quickbooksReadOnly: !gate.enabled,
    quickbooksWrites: gate.enabled,
    quickbooksWriteEnvironment: gate.enabled ? gate.environment : null,
    quickbooksWriteRealmConfigured: Boolean(gate.enabled && gate.realmId),
    quickbooksDeletes: false,
    quickbooksBatchRevert: gate.enabled,
    quickbooksWriteBlockedReason: gate.enabled ? null : gate.blockedReason,
  };
}
