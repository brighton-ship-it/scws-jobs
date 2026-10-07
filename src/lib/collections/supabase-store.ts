/**
 * Service-role adapter for the collections tables.
 * The migration is migrations/2026-10-07-collections-sms.sql and is not applied here.
 */

import { createServiceClient } from '@/lib/supabase/service';
import type {
  AutoreplyInsert,
  CollectionsStore,
  DoNotTextRow,
  HoldRow,
  SentRow,
  SmsLogInsert,
} from './store.ts';

// The generated Database type does not include these tables yet.
function table(name: string): any {
  return (createServiceClient() as any).from(name);
}

function fail(error: { message?: string } | null | undefined, what: string): void {
  if (error) throw new Error(`${what} failed`);
}

export function createSupabaseCollectionsStore(): CollectionsStore {
  return {
    async getDoNotText(phoneE164) {
      const { data, error } = await table('sms_do_not_text')
        .select('phone_e164, source, note')
        .eq('phone_e164', phoneE164)
        .maybeSingle();
      fail(error, 'sms_do_not_text read');
      if (!data) return null;
      return {
        phone_e164: String(data.phone_e164),
        source: data.source == null ? null : String(data.source),
        note: data.note == null ? null : String(data.note),
      } satisfies DoNotTextRow;
    },

    async upsertDoNotText(row: DoNotTextRow) {
      const { error } = await table('sms_do_not_text').upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: 'phone_e164' }
      );
      fail(error, 'sms_do_not_text upsert');
    },

    async listHolds() {
      const { data, error } = await table('collection_holds')
        .select('client_id, invoice_number, phone, reason')
        .limit(1000);
      fail(error, 'collection_holds read');
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row: Record<string, unknown>) => ({
        client_id: row.client_id == null ? null : String(row.client_id),
        invoice_number: row.invoice_number == null ? null : String(row.invoice_number),
        phone: row.phone == null ? null : String(row.phone),
        reason: row.reason == null ? null : String(row.reason),
      })) satisfies HoldRow[];
    },

    async listSentSince(sinceIso) {
      const { data, error } = await table('collection_sms_log')
        .select('client_id, phone_hash, created_at, status, error_code')
        .eq('status', 'sent')
        .gte('created_at', sinceIso)
        .limit(1000);
      fail(error, 'collection_sms_log read');
      const rows = Array.isArray(data) ? data : [];
      return rows.map((row: Record<string, unknown>) => ({
        client_id: row.client_id == null ? null : String(row.client_id),
        phone_hash: row.phone_hash == null ? null : String(row.phone_hash),
        created_at: String(row.created_at || ''),
        status: String(row.status || ''),
        error_code: row.error_code == null ? null : String(row.error_code),
      })) satisfies SentRow[];
    },

    async hasErrorCode(phoneHash, errorCode) {
      const { data, error } = await table('collection_sms_log')
        .select('error_code')
        .eq('phone_hash', phoneHash)
        .eq('error_code', errorCode)
        .limit(1);
      fail(error, 'collection_sms_log error read');
      return Array.isArray(data) && data.length > 0;
    },

    async insertSmsLog(row: SmsLogInsert) {
      const { error } = await table('collection_sms_log').insert(row);
      fail(error, 'collection_sms_log insert');
    },

    async countAutorepliesSince(phoneHash, sinceIso) {
      const { data, error } = await table('collection_autoreply_log')
        .select('id')
        .eq('phone_hash', phoneHash)
        .eq('direction', 'autoreply')
        .gte('created_at', sinceIso)
        .limit(20);
      fail(error, 'collection_autoreply_log read');
      return Array.isArray(data) ? data.length : 0;
    },

    async hasSentCollectionSince(phoneHash, sinceIso) {
      const { data, error } = await table('collection_sms_log')
        .select('id')
        .eq('phone_hash', phoneHash)
        .eq('status', 'sent')
        .gte('created_at', sinceIso)
        .limit(1);
      fail(error, 'collection_sms_log eligibility read');
      return Array.isArray(data) && data.length > 0;
    },

    async insertAutoreply(row: AutoreplyInsert) {
      const { error } = await table('collection_autoreply_log').insert({
        phone_hash: row.phone_hash,
        phone_last4: row.phone_last4,
        body_length: row.body_length,
        keyword: row.keyword,
        body: row.body,
        direction: row.direction,
        twilio_sid: row.twilio_sid,
      });
      fail(error, 'collection_autoreply_log insert');
    },
  };
}
