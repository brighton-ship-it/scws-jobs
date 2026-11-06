/**
 * Gated QuickBooks Online writes for the Jobber MCP.
 *
 * Preview is the default and does not call QuickBooks.
 * A real post requires confirm:true, QBO_WRITES_ENABLED=true, and a sandbox
 * realm that is not the production company. Every confirm is audited before
 * the post. Deletes are not implemented.
 */
import { createClient } from '@supabase/supabase-js';
import { QBO_SANDBOX_BASE, assertSandboxPersistAllowed, describeQboWriteGate, type Env, type QboWriteGate } from './write-gate.ts';
import {
  applyRead,
  buildQboPlan,
  confirmRequested,
  idempotencyPayload,
  resolveRequestId,
  type QboPlan,
} from './write-payloads.ts';

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

export type QboAuditEntry = {
  actor: string;
  tool: string;
  requestId: string;
  dryRun: boolean;
  confirmed: boolean;
  ok: boolean;
  refused: boolean;
  realmId: string | null;
  environment: 'sandbox';
  entity: string;
  payload: unknown;
  qboResponse: unknown;
  qboIds: Record<string, string | null>;
  error: string | null;
  reason: string | null;
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
  target: { enabled: boolean; environment: 'sandbox'; realmId: string | null; blockedReason: string | null };
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
  audit: { attempted: boolean; error?: string };
};

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
    entity: entry.entity,
    payload: cap(entry.payload),
    qbo_response: cap(entry.qboResponse),
    qbo_ids: entry.qboIds,
    error: entry.error,
    reason: entry.reason,
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

function writeUrl(realmId: string, path: string, query: Record<string, string>): string {
  const qs = new URLSearchParams(query);
  return `${QBO_SANDBOX_BASE}/v3/company/${encodeURIComponent(realmId)}${path}?${qs}`;
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
    target: {
      enabled: gate.enabled,
      environment: 'sandbox',
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
  const plan = buildQboPlan(tool, args);
  const confirm = confirmRequested(args);
  const requestId = resolveRequestId(tool, idempotencyPayload(plan), typeof args.requestId === 'string' ? args.requestId : undefined);
  const actor = deps.actor?.trim() || 'unknown';
  const env = deps.env || process.env;
  const gate = describeQboWriteGate(env);
  const base = resultBase(plan, requestId, actor, confirm, gate);
  const fetchImpl = deps.fetchImpl || fetch;

  if (!confirm) {
    const audit = await remember(
      {
        actor,
        tool: plan.tool,
        requestId,
        dryRun: true,
        confirmed: false,
        ok: true,
        refused: false,
        realmId: gate.realmId,
        environment: 'sandbox',
        entity: plan.entity,
        payload: { http: base.http, changes: plan.changes ?? null, reason: plan.reason || null },
        qboResponse: null,
        qboIds: {},
        error: null,
        reason: plan.reason || null,
      },
      deps,
      false
    );
    return { ...base, ok: true, audit: { attempted: true, error: audit.error } };
  }

  if (!gate.enabled || !gate.realmId) {
    const error = gate.blockedReason || 'QBO writes are off.';
    const audit = await remember(
      {
        actor,
        tool: plan.tool,
        requestId,
        dryRun: true,
        confirmed: true,
        ok: false,
        refused: true,
        realmId: gate.realmId,
        environment: 'sandbox',
        entity: plan.entity,
        payload: { http: base.http, changes: plan.changes ?? null },
        qboResponse: null,
        qboIds: {},
        error,
        reason: plan.reason || null,
      },
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
    await remember(
      {
        actor,
        tool: plan.tool,
        requestId,
        dryRun: true,
        confirmed: true,
        ok: false,
        refused: true,
        realmId: gate.realmId,
        environment: 'sandbox',
        entity: plan.entity,
        payload: { http: base.http },
        qboResponse: null,
        qboIds: {},
        error,
        reason: plan.reason || null,
      },
      deps,
      false
    );
    return { ...base, dryRun: true, refused: true, error, audit: { attempted: true } };
  }
  if (productionRealmId === gate.realmId) {
    const error = 'Refusing QBO write: QBO_WRITE_REALM_ID is the production company.';
    await remember(
      {
        actor,
        tool: plan.tool,
        requestId,
        dryRun: true,
        confirmed: true,
        ok: false,
        refused: true,
        realmId: gate.realmId,
        environment: 'sandbox',
        entity: plan.entity,
        payload: { http: base.http },
        qboResponse: null,
        qboIds: {},
        error,
        reason: plan.reason || null,
      },
      deps,
      false
    );
    return { ...base, dryRun: true, refused: true, error, audit: { attempted: true } };
  }

  await remember(
    {
      actor,
      tool: plan.tool,
      requestId,
      dryRun: false,
      confirmed: true,
      ok: false,
      refused: false,
      realmId: gate.realmId,
      environment: 'sandbox',
      entity: plan.entity,
      payload: { http: base.http, changes: plan.changes ?? null, reason: plan.reason || null },
      qboResponse: null,
      qboIds: {},
      error: null,
      reason: plan.reason || null,
    },
    deps,
    true
  );

  const token = await tokenFor(gate, productionRealmId, deps, fetchImpl);
  let body = plan.body;
  if (plan.read) {
    const got = await qboFetch(writeUrl(gate.realmId, plan.read.path, { minorversion: MINOR_VERSION }), token, fetchImpl);
    if (got.status < 200 || got.status >= 300) {
      const error = `QuickBooks read before write failed (${got.status}). Nothing was posted.`;
      await remember(failEntry(base, error, got.json), deps, false);
      return { ...base, error, qbo: slim(plan.entity, got.json), audit: { attempted: true } };
    }
    body = applyRead(plan, got.json || {});
  }
  if (!body) throw new Error('QuickBooks write had no body to post.');
  const query = queryOf(requestId, plan.operation);
  const posted = await qboFetch(writeUrl(gate.realmId, plan.path, query), token, fetchImpl, body);
  const ids = idsFrom(plan.entity, posted.json);
  const http = { ...base.http, body, query };
  if (posted.status < 200 || posted.status >= 300) {
    const error = `QuickBooks ${plan.path} failed (${posted.status}).`;
    await remember(
      {
        actor,
        tool: plan.tool,
        requestId,
        dryRun: false,
        confirmed: true,
        ok: false,
        refused: false,
        realmId: gate.realmId,
        environment: 'sandbox',
        entity: plan.entity,
        payload: { http, reason: plan.reason || null },
        qboResponse: cap(posted.json),
        qboIds: ids,
        error,
        reason: plan.reason || null,
      },
      deps,
      false
    );
    return { ...base, http, error, ids, qbo: slim(plan.entity, posted.json), audit: { attempted: true } };
  }
  let auditError: string | undefined;
  try {
    await remember(
      {
        actor,
        tool: plan.tool,
        requestId,
        dryRun: false,
        confirmed: true,
        ok: true,
        refused: false,
        realmId: gate.realmId,
        environment: 'sandbox',
        entity: plan.entity,
        payload: { http, reason: plan.reason || null },
        qboResponse: cap(posted.json),
        qboIds: ids,
        error: null,
        reason: plan.reason || null,
      },
      deps,
      true
    );
  } catch (error) {
    auditError = error instanceof Error ? error.message : String(error);
  }
  return {
    ...base,
    ok: true,
    dryRun: false,
    wrote: true,
    http,
    ids,
    qbo: slim(plan.entity, posted.json),
    error: auditError ? `Posted, but the audit log failed: ${auditError}` : undefined,
    audit: { attempted: true, error: auditError },
  };
}

function failEntry(base: QboWriteResult, error: string, qbo: unknown): QboAuditEntry {
  return {
    actor: base.actor,
    tool: base.tool,
    requestId: base.requestId,
    dryRun: false,
    confirmed: true,
    ok: false,
    refused: false,
    realmId: base.target.realmId,
    environment: 'sandbox',
    entity: base.tool,
    payload: { http: base.http },
    qboResponse: cap(qbo),
    qboIds: {},
    error,
    reason: base.reason || null,
  };
}

export function qboWriteSafety(env: Env = process.env) {
  const gate = describeQboWriteGate(env);
  return {
    quickbooksReadOnly: !gate.enabled,
    quickbooksWrites: gate.enabled,
    quickbooksWriteEnvironment: gate.enabled ? 'sandbox' : null,
    quickbooksWriteRealmConfigured: Boolean(gate.enabled && gate.realmId),
    quickbooksDeletes: false,
    quickbooksWriteBlockedReason: gate.enabled ? null : gate.blockedReason,
  };
}
