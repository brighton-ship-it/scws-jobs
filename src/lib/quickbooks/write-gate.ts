/**
 * QuickBooks write gate.
 *
 * Writes stay off unless QBO_WRITES_ENABLED is the string "true".
 * Sandbox is the default target (QBO_WRITE_REALM_ID, not the production realm).
 * Production writes require a second opt-in: QBO_WRITE_ENVIRONMENT=production
 * and QBO_WRITE_PRODUCTION_REALM_ID equal to the connected company realm.
 */
export type Env = Record<string, string | undefined>;

export type QboWriteEnvironment = 'sandbox' | 'production';

export type QboWriteGate = {
  enabled: boolean;
  blockedReason: string | null;
  environment: QboWriteEnvironment;
  realmId: string | null;
  baseUrl: string;
  productionOptIn: boolean;
};

export const QBO_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com';
export const QBO_PRODUCTION_BASE = 'https://quickbooks.api.intuit.com';

const REALM_RE = /^\d{5,30}$/;

export function qboWritesFlagOn(env: Env): boolean {
  return String(env.QBO_WRITES_ENABLED || '').trim().toLowerCase() === 'true';
}

function realm(value: string, field: string): string | null {
  if (!value) return null;
  if (!REALM_RE.test(value)) return null;
  return value;
}

/** Static config check. Confirm also compares the live connected realm. */
export function describeQboWriteGate(env: Env = process.env): QboWriteGate {
  const environmentRaw = String(env.QBO_WRITE_ENVIRONMENT || 'sandbox').trim().toLowerCase();
  const sandboxRealm = String(env.QBO_WRITE_REALM_ID || '').trim();
  const productionOptIn = String(env.QBO_WRITE_PRODUCTION_REALM_ID || '').trim();
  const declaredProduction = String(env.QBO_PRODUCTION_REALM_ID || '').trim();
  const sandbox: QboWriteGate = {
    enabled: false,
    blockedReason: null,
    environment: 'sandbox',
    realmId: sandboxRealm || null,
    baseUrl: QBO_SANDBOX_BASE,
    productionOptIn: false,
  };
  if (!qboWritesFlagOn(env)) {
    sandbox.blockedReason = 'QBO writes are off. Set QBO_WRITES_ENABLED=true to allow confirmed writes.';
    return sandbox;
  }
  if (environmentRaw === 'production') {
    const id = realm(productionOptIn, 'QBO_WRITE_PRODUCTION_REALM_ID');
    const gate: QboWriteGate = {
      enabled: false,
      blockedReason: null,
      environment: 'production',
      realmId: productionOptIn || null,
      baseUrl: QBO_PRODUCTION_BASE,
      productionOptIn: true,
    };
    if (!productionOptIn) {
      gate.blockedReason = 'Production writes require QBO_WRITE_PRODUCTION_REALM_ID set to the connected company realm.';
    } else if (!id) {
      gate.blockedReason = 'QBO_WRITE_PRODUCTION_REALM_ID must be the numeric connected realm id.';
    } else if (sandboxRealm && sandboxRealm !== productionOptIn) {
      gate.blockedReason = 'QBO_WRITE_REALM_ID does not match QBO_WRITE_PRODUCTION_REALM_ID.';
    } else if (declaredProduction && declaredProduction !== productionOptIn) {
      gate.blockedReason = 'QBO_WRITE_PRODUCTION_REALM_ID does not equal QBO_PRODUCTION_REALM_ID.';
    } else {
      gate.enabled = true;
      gate.realmId = id;
      gate.blockedReason = null;
    }
    return gate;
  }
  if (environmentRaw !== 'sandbox') {
    sandbox.blockedReason = 'QBO_WRITE_ENVIRONMENT must be sandbox or production.';
    return sandbox;
  }
  const id = realm(sandboxRealm, 'QBO_WRITE_REALM_ID');
  if (!sandboxRealm) {
    sandbox.blockedReason = 'QBO_WRITE_REALM_ID is required and must be the sandbox company realm.';
  } else if (!id) {
    sandbox.blockedReason = 'QBO_WRITE_REALM_ID must be the numeric sandbox realm id.';
  } else if (declaredProduction && sandboxRealm === declaredProduction) {
    sandbox.blockedReason = 'Refusing QBO write: QBO_WRITE_REALM_ID is the production company. Production writes need QBO_WRITE_ENVIRONMENT=production and QBO_WRITE_PRODUCTION_REALM_ID.';
  } else if (productionOptIn && sandboxRealm === productionOptIn) {
    sandbox.blockedReason = 'Refusing QBO write: QBO_WRITE_REALM_ID is the production opt-in realm. Set QBO_WRITE_ENVIRONMENT=production to write there.';
  } else {
    sandbox.enabled = true;
    sandbox.realmId = id;
  }
  return sandbox;
}

export function assertSandboxPersistAllowed(realmId: string, productionRealmId: string): void {
  if (!realmId || realmId === productionRealmId) {
    throw new Error('Refusing to store a write token for the production realm.');
  }
}
