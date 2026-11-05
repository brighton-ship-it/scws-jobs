/**
 * QuickBooks write gate.
 *
 * Writes stay off unless QBO_WRITES_ENABLED is the string "true".
 * The only legal target is a sandbox company named by QBO_WRITE_REALM_ID.
 * The production host and the production realm are refused. There is no
 * env flag that turns production writes on.
 */
export type Env = Record<string, string | undefined>;

export type QboWriteGate = {
  enabled: boolean;
  blockedReason: string | null;
  environment: 'sandbox';
  realmId: string | null;
  baseUrl: string;
};

export const QBO_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com';

const REALM_RE = /^\d{5,30}$/;

export function qboWritesFlagOn(env: Env): boolean {
  return String(env.QBO_WRITES_ENABLED || '').trim().toLowerCase() === 'true';
}

/** Static config check. Does not read Supabase or compare the live production realm. */
export function describeQboWriteGate(env: Env = process.env): QboWriteGate {
  const realmRaw = String(env.QBO_WRITE_REALM_ID || '').trim();
  const realmId = realmRaw || null;
  const environmentRaw = String(env.QBO_WRITE_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  const declaredProduction = String(env.QBO_PRODUCTION_REALM_ID || '').trim();
  let blockedReason: string | null = null;
  if (!qboWritesFlagOn(env)) {
    blockedReason = 'QBO writes are off. Set QBO_WRITES_ENABLED=true to allow confirmed writes to a sandbox company.';
  } else if (environmentRaw !== 'sandbox') {
    blockedReason = 'QBO writes only target a sandbox company. QBO_WRITE_ENVIRONMENT must be sandbox or unset.';
  } else if (!realmId) {
    blockedReason = 'QBO_WRITE_REALM_ID is required and must be the sandbox company realm, not the production realm.';
  } else if (!REALM_RE.test(realmId)) {
    blockedReason = 'QBO_WRITE_REALM_ID must be the numeric sandbox realm id.';
  } else if (declaredProduction && realmId === declaredProduction) {
    blockedReason = 'Refusing QBO write: QBO_WRITE_REALM_ID is the production company.';
  }
  return {
    enabled: blockedReason === null,
    blockedReason,
    environment: 'sandbox',
    realmId: blockedReason === null ? realmId : realmId,
    baseUrl: QBO_SANDBOX_BASE,
  };
}

export function assertSandboxPersistAllowed(realmId: string, productionRealmId: string): void {
  if (!realmId || realmId === productionRealmId) {
    throw new Error('Refusing to store a write token for the production realm.');
  }
}
