import { createHash } from 'node:crypto';
import type { AdsClickIds } from './click-ids';

export const BOOK_JOB_EVENT_NAME = 'book_job';
export const DEFAULT_GA4_MEASUREMENT_ID = 'G-5LL1YRWT5T';
export const LEAD_MATCH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const NEW_JOB_LOOKBACK_MS = 2 * 60 * 60 * 1000;

/** Website form Ads labels — never send these on the CRM book_job event. */
export const FORBIDDEN_ADS_LABELS = [
  'AW-490838730/nFeMCN_cyegcEMq1huoB',
  'aFiRCMDlofAbEMq1huoB',
] as const;

export interface WebsiteLead {
  id: string;
  source: 'booking_requests' | 'customers';
  phone: string | null;
  email: string | null;
  created_at: string;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  ga_client_id?: string | null;
  ga_session_id?: string | null;
}

export interface JobberClientContact {
  phones?: Array<string | null | undefined>;
  emails?: Array<string | null | undefined>;
}

export interface JobberJobLike {
  id: string;
  startAt?: string | null;
  createdAt?: string | null;
  jobStatus?: string | null;
  total?: number | { amount?: number | null } | null;
  visits?: { nodes?: Array<{ startAt?: string | null } | null> | null } | null;
  client?: {
    emails?: Array<{ address?: string | null } | null> | null;
    phones?: Array<{ number?: string | null } | null> | null;
  } | null;
}

export type BookJobSkipReason =
  | 'already_converted'
  | 'not_scheduled'
  | 'already_on_schedule'
  | 'bootstrap_existing_scheduled';

export type BookJobEmitReason =
  | 'first_schedule_transition'
  | 'new_job_already_scheduled';

export type BookJobDecision =
  | { emit: false; reason: BookJobSkipReason }
  | { emit: true; reason: BookJobEmitReason };

export type ClientIdSource = 'ga_client_id' | 'last_resort';

export interface BookJobEventParams {
  jobber_job_id: string;
  currency: 'USD';
  engagement: true;
  engagement_time_msec: number;
  client_id_source: ClientIdSource;
  value?: number;
  gclid?: string;
  session_id?: string;
}

export interface BookJobMeasurementPayload {
  client_id: string;
  user_data?: {
    sha256_email_address?: string[];
    sha256_phone_number?: string[];
  };
  events: Array<{
    name: typeof BOOK_JOB_EVENT_NAME;
    params: BookJobEventParams;
  }>;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Last 10 national digits; strips a leading US country code. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.slice(-10);
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.includes('@') ? trimmed : null;
}

/** GA4 MP hashed user-provided email: trim, lowercase, SHA-256 hex. */
export function hashEmailForMp(email: string | null | undefined): string | null {
  const normalized = normalizeEmail(email);
  return normalized ? sha256Hex(normalized) : null;
}

/** GA4 MP hashed user-provided phone: E.164 then SHA-256 hex. US assumed for 10 digits. */
export function hashPhoneForMp(phone: string | null | undefined): string | null {
  const national = normalizePhone(phone);
  if (!national) return null;
  return sha256Hex(`+1${national}`);
}

/**
 * Stable last-resort GA4 client_id. Prefix is intentional so logs and payloads
 * show this is not a real browser client_id.
 */
export function lastResortClientId(jobberJobId: string): string {
  return `last-resort.${sha256Hex(`book_job:${jobberJobId}`).slice(0, 32)}`;
}

export function isJobScheduled(job: JobberJobLike): boolean {
  if (job.startAt) return true;
  const visits = job.visits?.nodes ?? [];
  return visits.some((visit) => Boolean(visit?.startAt));
}

export function jobCreatedRecently(
  createdAt: string | null | undefined,
  now: Date = new Date(),
  lookbackMs: number = NEW_JOB_LOOKBACK_MS
): boolean {
  if (!createdAt) return false;
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return false;
  return now.getTime() - created <= lookbackMs;
}

export function jobValueUsd(job: JobberJobLike): number | null {
  const total = job.total;
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    return total;
  }
  if (total && typeof total === 'object' && typeof total.amount === 'number') {
    return Number.isFinite(total.amount) && total.amount > 0 ? total.amount : null;
  }
  return null;
}

export function clientContactFromJob(job: JobberJobLike): JobberClientContact {
  return {
    phones: (job.client?.phones ?? []).map((row) => row?.number ?? null),
    emails: (job.client?.emails ?? []).map((row) => row?.address ?? null),
  };
}

/**
 * Fire only on the first transition onto a schedule, or a brand-new job that
 * already has a start date. Never on later job updates.
 */
export function decideBookJob(input: {
  isScheduled: boolean;
  alreadyConverted: boolean;
  previouslyScheduled: boolean | null;
  createdRecently: boolean;
}): BookJobDecision {
  if (input.alreadyConverted) {
    return { emit: false, reason: 'already_converted' };
  }
  if (!input.isScheduled) {
    return { emit: false, reason: 'not_scheduled' };
  }
  if (input.previouslyScheduled === true) {
    return { emit: false, reason: 'already_on_schedule' };
  }
  if (input.previouslyScheduled === false) {
    return { emit: true, reason: 'first_schedule_transition' };
  }
  if (input.createdRecently) {
    return { emit: true, reason: 'new_job_already_scheduled' };
  }
  return { emit: false, reason: 'bootstrap_existing_scheduled' };
}

function scoreLead(lead: WebsiteLead, phones: Set<string>, emails: Set<string>): number {
  const phoneHit = lead.phone ? phones.has(lead.phone) : false;
  const emailHit = lead.email ? emails.has(lead.email) : false;
  if (phoneHit && emailHit) return 3;
  if (phoneHit) return 2;
  if (emailHit) return 1;
  return 0;
}

/**
 * Match a Jobber client to a recent website lead by phone and/or email.
 * Prefer phone+email, then phone, then email; newest lead wins ties.
 */
export function matchWebsiteLead(
  leads: WebsiteLead[],
  client: JobberClientContact,
  options?: { now?: Date; maxAgeMs?: number }
): { lead: WebsiteLead; matchedBy: 'phone_and_email' | 'phone' | 'email' } | null {
  const now = options?.now ?? new Date();
  const maxAgeMs = options?.maxAgeMs ?? LEAD_MATCH_MAX_AGE_MS;
  const cutoff = now.getTime() - maxAgeMs;

  const phones = new Set(
    (client.phones ?? []).map(normalizePhone).filter((value): value is string => Boolean(value))
  );
  const emails = new Set(
    (client.emails ?? []).map(normalizeEmail).filter((value): value is string => Boolean(value))
  );

  if (phones.size === 0 && emails.size === 0) return null;

  const ranked = leads
    .map((lead) => ({
      lead: {
        ...lead,
        phone: normalizePhone(lead.phone),
        email: normalizeEmail(lead.email),
      },
      createdMs: Date.parse(lead.created_at),
    }))
    .filter((row) => Number.isFinite(row.createdMs) && row.createdMs >= cutoff)
    .map((row) => ({
      ...row,
      score: scoreLead(row.lead, phones, emails),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.createdMs - a.createdMs;
    });

  const winner = ranked[0];
  if (!winner) return null;

  const matchedBy =
    winner.score === 3 ? 'phone_and_email' : winner.score === 2 ? 'phone' : 'email';

  return { lead: winner.lead, matchedBy };
}

export function buildBookJobPayload(input: {
  jobberJobId: string;
  lead?: Pick<
    WebsiteLead,
    'email' | 'phone' | 'gclid' | 'ga_client_id' | 'ga_session_id'
  > | null;
  jobberEmail?: string | null;
  jobberPhone?: string | null;
  valueUsd?: number | null;
}): BookJobMeasurementPayload {
  const storedClientId = input.lead?.ga_client_id?.trim() || null;
  const clientId = storedClientId || lastResortClientId(input.jobberJobId);
  const clientIdSource: ClientIdSource = storedClientId ? 'ga_client_id' : 'last_resort';

  const email = input.lead?.email || input.jobberEmail || null;
  const phone = input.lead?.phone || input.jobberPhone || null;
  const hashedEmail = hashEmailForMp(email);
  const hashedPhone = hashPhoneForMp(phone);

  const params: BookJobEventParams = {
    jobber_job_id: input.jobberJobId,
    currency: 'USD',
    engagement: true,
    engagement_time_msec: 1,
    client_id_source: clientIdSource,
  };

  if (input.valueUsd != null && input.valueUsd > 0) {
    params.value = input.valueUsd;
  }

  const gclid = input.lead?.gclid?.trim();
  if (gclid) {
    params.gclid = gclid;
  }

  const sessionId = input.lead?.ga_session_id?.trim();
  if (sessionId) {
    params.session_id = sessionId;
  }

  const payload: BookJobMeasurementPayload = {
    client_id: clientId,
    events: [{ name: BOOK_JOB_EVENT_NAME, params }],
  };

  if (hashedEmail || hashedPhone) {
    payload.user_data = {};
    if (hashedEmail) payload.user_data.sha256_email_address = [hashedEmail];
    if (hashedPhone) payload.user_data.sha256_phone_number = [hashedPhone];
  }

  return payload;
}

export function assertNoForbiddenAdsLabels(payload: BookJobMeasurementPayload): void {
  const serialized = JSON.stringify(payload);
  for (const label of FORBIDDEN_ADS_LABELS) {
    if (serialized.includes(label)) {
      throw new Error('book_job payload must not include website or phone Ads labels');
    }
  }
}

export function clickIdsFromLead(lead: WebsiteLead | null | undefined): AdsClickIds {
  return {
    gclid: lead?.gclid ?? null,
    gbraid: lead?.gbraid ?? null,
    wbraid: lead?.wbraid ?? null,
    ga_client_id: lead?.ga_client_id ?? null,
    ga_session_id: lead?.ga_session_id ?? null,
  };
}
