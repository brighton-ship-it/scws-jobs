/**
 * Collections persistence. Tests use the memory store. The Supabase adapter
 * lives in supabase-store.ts and is only imported by Next routes.
 */

export type DoNotTextRow = {
  phone_e164: string;
  source: string | null;
  note: string | null;
};

export type HoldRow = {
  client_id: string | null;
  invoice_number: string | null;
  phone: string | null;
  reason: string | null;
};

export type SentRow = {
  client_id: string | null;
  phone_hash: string | null;
  created_at: string;
  status: string;
  error_code?: string | null;
};

export type SmsLogInsert = {
  client_id: string | null;
  invoice_numbers: string[];
  phone_last4: string | null;
  phone_hash: string | null;
  status: 'sent' | 'skipped' | 'failed' | 'dry_run';
  reason: string | null;
  twilio_sid: string | null;
  error_code: string | null;
  template_version: string | null;
};

export type AutoreplyInsert = {
  phone_hash: string | null;
  phone_last4: string | null;
  body_length: number;
  keyword: boolean;
  body: string | null;
  direction: 'inbound' | 'autoreply';
  twilio_sid: string | null;
  created_at?: string;
};

export type CollectionsStore = {
  getDoNotText(phoneE164: string): Promise<DoNotTextRow | null>;
  upsertDoNotText(row: DoNotTextRow): Promise<void>;
  listHolds(): Promise<HoldRow[]>;
  listSentSince(sinceIso: string): Promise<SentRow[]>;
  hasErrorCode(phoneHash: string, errorCode: string): Promise<boolean>;
  insertSmsLog(row: SmsLogInsert): Promise<void>;
  countAutorepliesSince(phoneHash: string, sinceIso: string): Promise<number>;
  hasSentCollectionSince(phoneHash: string, sinceIso: string): Promise<boolean>;
  insertAutoreply(row: AutoreplyInsert): Promise<void>;
};

export type MemoryCollectionsStore = CollectionsStore & {
  dnc: DoNotTextRow[];
  holds: HoldRow[];
  sent: SentRow[];
  errors: Array<{ phone_hash: string; error_code: string }>;
  smsLogs: SmsLogInsert[];
  autoreplyLogs: AutoreplyInsert[];
};

export function createMemoryCollectionsStore(seed?: {
  dnc?: DoNotTextRow[];
  holds?: HoldRow[];
  sent?: SentRow[];
  errors?: Array<{ phone_hash: string; error_code: string }>;
  autoreplies?: AutoreplyInsert[];
}): MemoryCollectionsStore {
  const dnc = [...(seed?.dnc || [])];
  const holds = [...(seed?.holds || [])];
  const sent = [...(seed?.sent || [])];
  const errors = [...(seed?.errors || [])];
  const smsLogs: SmsLogInsert[] = [];
  const autoreplyLogs: AutoreplyInsert[] = [...(seed?.autoreplies || [])];

  return {
    dnc,
    holds,
    sent,
    errors,
    smsLogs,
    autoreplyLogs,
    async getDoNotText(phoneE164) {
      return dnc.find((row) => row.phone_e164 === phoneE164) || null;
    },
    async upsertDoNotText(row) {
      const index = dnc.findIndex((existing) => existing.phone_e164 === row.phone_e164);
      if (index >= 0) dnc[index] = row;
      else dnc.push(row);
    },
    async listHolds() {
      return holds;
    },
    async listSentSince(sinceIso) {
      return sent.filter((row) => row.status === 'sent' && row.created_at >= sinceIso);
    },
    async hasErrorCode(phoneHash, errorCode) {
      if (errors.some((row) => row.phone_hash === phoneHash && row.error_code === errorCode)) return true;
      return smsLogs.some((row) => row.phone_hash === phoneHash && row.error_code === errorCode);
    },
    async insertSmsLog(row) {
      smsLogs.push(row);
      if (row.status === 'sent') {
        sent.push({
          client_id: row.client_id,
          phone_hash: row.phone_hash,
          created_at: new Date().toISOString(),
          status: 'sent',
          error_code: row.error_code,
        });
      }
      if (row.error_code && row.phone_hash) {
        errors.push({ phone_hash: row.phone_hash, error_code: row.error_code });
      }
    },
    async countAutorepliesSince(phoneHash, sinceIso) {
      return autoreplyLogs.filter(
        (row) => row.direction === 'autoreply' && row.phone_hash === phoneHash && (row.created_at || '') >= sinceIso
      ).length;
    },
    async hasSentCollectionSince(phoneHash, sinceIso) {
      return sent.some(
        (row) => row.status === 'sent' && row.phone_hash === phoneHash && row.created_at >= sinceIso
      );
    },
    async insertAutoreply(row) {
      autoreplyLogs.push({ ...row, created_at: row.created_at || new Date().toISOString() });
    },
  };
}
