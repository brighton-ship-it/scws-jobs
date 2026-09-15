/**
 * Bearer API-key gate for the shared Jobber MCP gateway.
 *
 * Shop bots (Travis, Damien, Brighton) send Authorization: Bearer <key>.
 * Jobber OAuth tokens stay on the Vercel app — never on bot machines.
 *
 * JOBBER_MCP_API_KEYS accepts:
 *   JSON map:  {"travis":"…","damien":"…","brighton":"…"}
 *   named CSV: travis:…,damien:…
 *   bare CSV:  key1,key2
 *
 * Never log key values.
 */

import { timingSafeEqual } from 'node:crypto';
import { readAuthorizationHeader } from '../cron-auth.ts';

export const JOBBER_MCP_API_KEYS_ENV = 'JOBBER_MCP_API_KEYS';

export type JobberMcpNamedKey = {
  name: string;
  key: string;
};

export type JobberMcpAuthResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'missing_secret' | 'missing_key' | 'unauthorized' };

function trimEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value || null;
}

function isSimpleName(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value);
}

function pushUnique(keys: JobberMcpNamedKey[], name: string, key: string): void {
  const trimmedName = name.trim();
  const trimmedKey = key.trim();
  if (!trimmedName || !trimmedKey) return;
  if (keys.some((entry) => entry.key === trimmedKey)) return;
  keys.push({ name: trimmedName, key: trimmedKey });
}

function parseJsonKeys(raw: string): JobberMcpNamedKey[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const keys: JobberMcpNamedKey[] = [];
      parsed.forEach((item, index) => {
        if (typeof item === 'string') {
          pushUnique(keys, `key-${index + 1}`, item);
          return;
        }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const name = typeof record.name === 'string' ? record.name : `key-${index + 1}`;
          const key = typeof record.key === 'string' ? record.key : '';
          pushUnique(keys, name, key);
        }
      });
      return keys;
    }
    if (parsed && typeof parsed === 'object') {
      const keys: JobberMcpNamedKey[] = [];
      for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') pushUnique(keys, name, value);
      }
      return keys;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseJobberMcpApiKeys(
  env: NodeJS.ProcessEnv = process.env
): JobberMcpNamedKey[] {
  const raw = trimEnv(env, JOBBER_MCP_API_KEYS_ENV);
  if (!raw) return [];

  if (raw.startsWith('{') || raw.startsWith('[')) {
    const fromJson = parseJsonKeys(raw);
    if (fromJson) return fromJson;
  }

  const keys: JobberMcpNamedKey[] = [];
  raw.split(',').forEach((part, index) => {
    const token = part.trim();
    if (!token) return;
    const colon = token.indexOf(':');
    if (colon > 0) {
      const name = token.slice(0, colon).trim();
      const key = token.slice(colon + 1).trim();
      if (isSimpleName(name) && key) {
        pushUnique(keys, name, key);
        return;
      }
    }
    pushUnique(keys, `key-${index + 1}`, token);
  });
  return keys;
}

export function readMcpBearerToken(headers: Headers): string | null {
  const authorization = readAuthorizationHeader(headers);
  if (!authorization) return null;
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token || null;
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) {
    timingSafeEqual(leftBuf, leftBuf);
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

export function matchJobberMcpApiKey(
  provided: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): JobberMcpNamedKey | null {
  if (!provided) return null;
  for (const entry of parseJobberMcpApiKeys(env)) {
    if (timingSafeEqualString(provided, entry.key)) return entry;
  }
  return null;
}

export function authorizeJobberMcpRequest(
  request: { headers: Headers },
  env: NodeJS.ProcessEnv = process.env
): JobberMcpAuthResult {
  const configured = parseJobberMcpApiKeys(env);
  if (!configured.length) {
    return { ok: false, reason: 'missing_secret' };
  }

  const provided = readMcpBearerToken(request.headers);
  if (!provided) {
    return { ok: false, reason: 'missing_key' };
  }

  const match = matchJobberMcpApiKey(provided, env);
  if (!match) {
    return { ok: false, reason: 'unauthorized' };
  }
  return { ok: true, name: match.name };
}

export function jobberMcpUnauthorizedLog(
  reason: 'missing_secret' | 'missing_key' | 'unauthorized'
): void {
  if (reason === 'missing_secret') {
    console.error(
      '[jobber-mcp] JOBBER_MCP_API_KEYS is not set. Add a JSON map or comma-separated named keys in Vercel → Project → Settings → Environment Variables for Production.'
    );
    return;
  }
  if (reason === 'missing_key') {
    console.warn('[jobber-mcp] Rejected request: missing Authorization Bearer key.');
    return;
  }
  console.warn('[jobber-mcp] Rejected request: invalid MCP API key.');
}
