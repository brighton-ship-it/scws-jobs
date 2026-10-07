/**
 * Authenticated collections batch. dryRun defaults to true.
 * One text per client. Enforces the Tue–Thu 10:00–17:59 PT window,
 * do-not-text, holds, and 3 texts per rolling 30 days.
 */

import {
  clientHubRoot,
  collectionMessage,
  collectionsMessagingServiceSid,
  COLLECTIONS_E164,
  FREQUENCY_LIMIT,
  FREQUENCY_WINDOW_MS,
  isCollectionsWindow,
  normalizeInvoiceNumber,
  PACING_MS,
  payableRefusal,
  phoneHash,
  selectPayLink,
  selectSmsPhone,
  templateVersion,
  toE164US,
} from './policy.ts';
import type { CollectionsInvoice, InvoiceRef } from './pay-link-sms.ts';
import { loadCollectionsInvoice } from './pay-link-sms.ts';
import type { CollectionsStore, HoldRow, SmsLogInsert } from './store.ts';

export type SmsBatchInput = {
  invoiceIds?: string[];
  invoiceNumbers?: string[];
  template?: string;
  dryRun?: boolean;
  maxSends?: number;
};

export type SmsBatchRow = {
  clientId?: string;
  invoiceNumbers: string[];
  phoneLast4?: string;
  linkPresent: boolean;
  message?: string;
  status: SmsLogInsert['status'];
  reason: string | null;
  twilioSid?: string;
  errorCode?: string;
};

type InternalRow = SmsBatchRow & { phoneHash?: string };

export type SmsBatchResult = {
  ok: boolean;
  dryRun: boolean;
  outsideWindow: boolean;
  aborted: boolean;
  abortReason?: string;
  reason?: string;
  results: SmsBatchRow[];
};

export type SmsBatchDeps = {
  now?: () => Date;
  loadInvoice?: (ref: InvoiceRef) => Promise<CollectionsInvoice | null>;
  store: CollectionsStore;
  sendSms?: (input: { to: string; body: string; messagingServiceSid: string }) => Promise<{
    sid?: string;
    errorCode?: string;
    error?: string;
  }>;
  listTwilioOptOuts?: () => Promise<{ stopPhones: string[]; error21610Phones: string[] }>;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
};

const HARD_ABORT_CODES = new Set(['30007', '30034']);

function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function holdReason(hold: HoldRow): string {
  const note = (hold.reason || '').trim();
  return note ? `hold:${note}` : 'hold';
}

function invoiceHold(invoice: CollectionsInvoice, holds: HoldRow[]): HoldRow | null {
  const number = normalizeInvoiceNumber(invoice.invoiceNumber);
  const clientId = invoice.client?.id || '';
  for (const hold of holds) {
    if (hold.client_id && clientId && hold.client_id === clientId) return hold;
    if (hold.invoice_number && number && normalizeInvoiceNumber(hold.invoice_number) === number) return hold;
  }
  return null;
}

function phoneHold(e164: string, holds: HoldRow[]): HoldRow | null {
  for (const hold of holds) {
    if (!hold.phone) continue;
    const normalized = toE164US(hold.phone);
    if (normalized && normalized === e164) return hold;
  }
  return null;
}

export async function runCollectionsSmsBatch(input: SmsBatchInput, deps: SmsBatchDeps): Promise<SmsBatchResult> {
  const dryRun = input.dryRun === false ? false : true;
  const now = (deps.now ?? (() => new Date()))();
  const outsideWindow = !isCollectionsWindow(now);
  const log = deps.log ?? ((message: string) => console.log(message));
  const load = deps.loadInvoice ?? ((ref: InvoiceRef) => loadCollectionsInvoice(ref));
  const template = typeof input.template === 'string' ? input.template : undefined;
  const version = templateVersion(template);
  const cap = Number.isFinite(input.maxSends) ? Math.max(0, Math.floor(input.maxSends as number)) : Number.POSITIVE_INFINITY;

  const refs: InvoiceRef[] = [
    ...cleanList(input.invoiceIds).map((invoiceId) => ({ invoiceId })),
    ...cleanList(input.invoiceNumbers).map((invoiceNumber) => ({ invoiceNumber })),
  ];
  if (refs.length === 0) {
    return { ok: false, dryRun, outsideWindow, aborted: false, reason: 'missing_invoices', results: [] };
  }

  const results: SmsBatchRow[] = [];
  const record = async (row: InternalRow) => {
    const { phoneHash: hash, ...publicRow } = row;
    results.push(publicRow);
    await deps.store.insertSmsLog({
      client_id: publicRow.clientId || null,
      invoice_numbers: publicRow.invoiceNumbers,
      phone_last4: publicRow.phoneLast4 || null,
      phone_hash: hash || null,
      status: publicRow.status,
      reason: publicRow.reason,
      twilio_sid: publicRow.twilioSid || null,
      error_code: publicRow.errorCode || null,
      template_version: version,
    });
  };

  const loaded: CollectionsInvoice[] = [];
  const seen = new Set<string>();

  for (const ref of refs) {
    let invoice: CollectionsInvoice | null = null;
    try {
      invoice = await load(ref);
    } catch {
      invoice = null;
    }
    if (!invoice?.id) {
      await record({
        invoiceNumbers: [ref.invoiceNumber || ref.invoiceId || ''],
        linkPresent: false,
        status: 'skipped',
        reason: 'not_found',
      });
      continue;
    }
    if (seen.has(invoice.id)) continue;
    seen.add(invoice.id);
    loaded.push(invoice);
  }

  const holds = await deps.store.listHolds();
  const eligible: CollectionsInvoice[] = [];

  for (const invoice of loaded) {
    if (outsideWindow) {
      await record(previewOutsideWindow(invoice, template));
      continue;
    }
    const refusal = payableRefusal(invoice.invoiceStatus, invoice.balance);
    if (refusal) {
      await record(rowFor(invoice, 'skipped', refusal, false));
      continue;
    }
    const held = invoiceHold(invoice, holds);
    if (held) {
      await record(rowFor(invoice, 'skipped', holdReason(held), false));
      continue;
    }
    eligible.push(invoice);
  }

  if (outsideWindow) {
    log(`[collections] sms-batch dryRun=${dryRun} outside_window rows=${results.length} sends=0`);
    return { ok: true, dryRun, outsideWindow: true, aborted: false, results };
  }

  let optOuts = { stopPhones: [] as string[], error21610Phones: [] as string[] };
  if (deps.listTwilioOptOuts) {
    try {
      optOuts = await deps.listTwilioOptOuts();
    } catch {
      if (!dryRun) {
        log('[collections] sms-batch optout_check_failed');
        return { ok: false, dryRun, outsideWindow: false, aborted: true, abortReason: 'optout_check_failed', reason: 'optout_check_failed', results };
      }
    }
  }

  const stopPhones = new Set(optOuts.stopPhones.map((phone) => toE164US(phone)).filter((phone): phone is string => Boolean(phone)));
  const errorPhones = new Set(
    optOuts.error21610Phones.map((phone) => toE164US(phone)).filter((phone): phone is string => Boolean(phone))
  );

  const groups = groupByClient(eligible);
  const since = new Date(now.getTime() - FREQUENCY_WINDOW_MS).toISOString();
  const planned = groups.length;
  let attempted = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let code21610 = 0;
  let abortReason: string | null = null;
  let sendCount = 0;

  for (const group of groups) {
    const numbers = group.map((invoice) => invoice.invoiceNumber);
    const clientId = group[0].client?.id || undefined;
    if (abortReason) {
      await record({
        clientId,
        invoiceNumbers: numbers,
        linkPresent: false,
        status: 'skipped',
        reason: abortReason,
      });
      continue;
    }

    const phone = selectSmsPhone(mergedPhones(group));
    if (!phone.ok) {
      await record({
        clientId,
        invoiceNumbers: numbers,
        linkPresent: false,
        status: 'skipped',
        reason: phone.reason,
      });
      continue;
    }
    const hash = phoneHash(phone.e164);

    const link = groupLink(group);
    if (!link) {
      await record({
        clientId,
        invoiceNumbers: numbers,
        phoneLast4: phone.last4,
        phoneHash: hash,
        linkPresent: false,
        status: 'skipped',
        reason: 'invalid_link',
      });
      continue;
    }

    const blocked = await doNotText(phone.e164, deps.store, stopPhones, errorPhones);
    if (blocked) {
      await record({
        clientId,
        invoiceNumbers: numbers,
        phoneLast4: phone.last4,
        phoneHash: hash,
        linkPresent: true,
        message: messageFor(group, link, template),
        status: 'skipped',
        reason: 'do_not_text',
      });
      continue;
    }

    const onPhoneHold = phoneHold(phone.e164, holds);
    if (onPhoneHold) {
      await record({
        clientId,
        invoiceNumbers: numbers,
        phoneLast4: phone.last4,
        phoneHash: hash,
        linkPresent: true,
        status: 'skipped',
        reason: holdReason(onPhoneHold),
      });
      continue;
    }

    const sentRows = await deps.store.listSentSince(since);
    const clientCount = sentRows.filter((row) => clientId && row.client_id === clientId).length;
    const phoneCount = sentRows.filter((row) => row.phone_hash === hash).length;
    if (clientCount >= FREQUENCY_LIMIT || phoneCount >= FREQUENCY_LIMIT) {
      await record({
        clientId,
        invoiceNumbers: numbers,
        phoneLast4: phone.last4,
        phoneHash: hash,
        linkPresent: true,
        message: messageFor(group, link, template),
        status: 'skipped',
        reason: 'frequency',
      });
      continue;
    }

    if (sendCount >= cap) {
      await record({
        clientId,
        invoiceNumbers: numbers,
        phoneLast4: phone.last4,
        phoneHash: hash,
        linkPresent: true,
        message: messageFor(group, link, template),
        status: 'skipped',
        reason: 'max_sends',
      });
      continue;
    }

    if (dryRun) {
      sendCount += 1;
      await record({
        clientId,
        invoiceNumbers: numbers,
        phoneLast4: phone.last4,
        phoneHash: hash,
        linkPresent: true,
        message: messageFor(group, link, template),
        status: 'dry_run',
        reason: null,
      });
      continue;
    }

    const fresh = await recheck(group, load);
    if (!fresh.ok) {
      await record({
        clientId,
        invoiceNumbers: numbers,
        phoneLast4: phone.last4,
        phoneHash: hash,
        linkPresent: true,
        status: 'skipped',
        reason: fresh.reason,
      });
      continue;
    }

    const liveLink = groupLink(fresh.invoices) || link;
    const livePhone = selectSmsPhone(mergedPhones(fresh.invoices));
    if (!livePhone.ok) {
      await record({
        clientId,
        invoiceNumbers: fresh.invoices.map((invoice) => invoice.invoiceNumber),
        linkPresent: false,
        status: 'skipped',
        reason: livePhone.reason,
      });
      continue;
    }
    const body = messageFor(fresh.invoices, liveLink, template);

    if (attempted > 0) await (deps.sleep ?? defaultSleep)(PACING_MS);
    attempted += 1;
    sendCount += 1;
    const sent = await deliver(livePhone.e164, body, deps);
    if (!sent.ok) {
      failures += 1;
      consecutiveFailures += 1;
      if (sent.errorCode === '21610') {
        code21610 += 1;
        await deps.store.upsertDoNotText({
          phone_e164: livePhone.e164,
          source: 'twilio_21610',
          note: 'Twilio 21610',
        });
      }
      await record({
        clientId,
        invoiceNumbers: fresh.invoices.map((invoice) => invoice.invoiceNumber),
        phoneLast4: livePhone.last4,
        phoneHash: phoneHash(livePhone.e164),
        linkPresent: true,
        message: body,
        status: 'failed',
        reason: 'send_failed',
        errorCode: sent.errorCode,
      });
      abortReason = abortAfter({
        errorCode: sent.errorCode,
        consecutiveFailures,
        failures,
        planned,
        code21610,
      });
      continue;
    }

    consecutiveFailures = 0;
    await record({
      clientId,
      invoiceNumbers: fresh.invoices.map((invoice) => invoice.invoiceNumber),
      phoneLast4: livePhone.last4,
      phoneHash: phoneHash(livePhone.e164),
      linkPresent: true,
      message: body,
      status: 'sent',
      reason: null,
      twilioSid: sent.sid,
    });
  }

  log(
    `[collections] sms-batch dryRun=${dryRun} outside_window=false rows=${results.length} attempted=${attempted} abort=${abortReason || ''}`
  );
  return {
    ok: true,
    dryRun,
    outsideWindow: false,
    aborted: Boolean(abortReason),
    abortReason: abortReason || undefined,
    results,
  };
}

function abortAfter(input: {
  errorCode?: string;
  consecutiveFailures: number;
  failures: number;
  planned: number;
  code21610: number;
}): string | null {
  if (input.errorCode && HARD_ABORT_CODES.has(input.errorCode)) return `abort_${input.errorCode}`;
  if (input.code21610 >= 2) return 'abort_21610_burst';
  if (input.consecutiveFailures >= 3) return 'abort_consecutive';
  if (input.planned > 0 && input.failures / input.planned > 0.1) return 'abort_failure_rate';
  return null;
}

async function doNotText(
  e164: string,
  store: CollectionsStore,
  stopPhones: Set<string>,
  errorPhones: Set<string>
): Promise<boolean> {
  if (await store.getDoNotText(e164)) return true;
  if (stopPhones.has(e164)) {
    await store.upsertDoNotText({ phone_e164: e164, source: 'twilio_inbound_stop', note: COLLECTIONS_E164 });
    return true;
  }
  if (errorPhones.has(e164)) {
    await store.upsertDoNotText({ phone_e164: e164, source: 'twilio_21610', note: 'Twilio 21610' });
    return true;
  }
  if (await store.hasErrorCode(phoneHash(e164), '21610')) {
    await store.upsertDoNotText({ phone_e164: e164, source: 'twilio_21610', note: 'prior send 21610' });
    return true;
  }
  return false;
}

async function recheck(
  group: CollectionsInvoice[],
  load: (ref: InvoiceRef) => Promise<CollectionsInvoice | null>
): Promise<{ ok: true; invoices: CollectionsInvoice[] } | { ok: false; reason: string }> {
  const fresh: CollectionsInvoice[] = [];
  let lastReason = 'zero_balance';
  for (const invoice of group) {
    let again: CollectionsInvoice | null = null;
    try {
      again = await load({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber });
    } catch {
      again = null;
    }
    if (!again) {
      lastReason = 'recheck_failed';
      continue;
    }
    const refusal = payableRefusal(again.invoiceStatus, again.balance);
    if (refusal) {
      lastReason = refusal;
      continue;
    }
    fresh.push(again);
  }
  if (!fresh.length) return { ok: false, reason: lastReason };
  return { ok: true, invoices: fresh };
}

function groupByClient(invoices: CollectionsInvoice[]): CollectionsInvoice[][] {
  const groups: CollectionsInvoice[][] = [];
  const index = new Map<string, CollectionsInvoice[]>();
  for (const invoice of invoices) {
    const key = invoice.client?.id || `invoice:${invoice.id}`;
    const existing = index.get(key);
    if (existing) existing.push(invoice);
    else {
      const created = [invoice];
      index.set(key, created);
      groups.push(created);
    }
  }
  return groups;
}

function mergedPhones(group: CollectionsInvoice[]) {
  const phones = group.flatMap((invoice) => invoice.client?.phones || []);
  const seen = new Set<string>();
  return phones.filter((phone) => {
    const key = `${phone.number || ''}|${phone.description || ''}|${phone.primary === true}|${phone.smsAllowed !== false}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupLink(group: CollectionsInvoice[]): string | null {
  const links = group
    .map((invoice) => selectPayLink(invoice.paymentUrl, invoice.publicUrl))
    .filter((link): link is string => Boolean(link));
  if (!links.length) return null;
  if (group.length > 1) return clientHubRoot(links[0]) || links[0];
  return links[0];
}

function messageFor(group: CollectionsInvoice[], link: string, template?: string): string {
  const balance = group.reduce((sum, invoice) => sum + (Number.isFinite(invoice.balance) ? invoice.balance : 0), 0);
  return collectionMessage({
    template,
    invoiceNumbers: group.map((invoice) => invoice.invoiceNumber),
    link,
    firstName: group[0].client?.firstName,
    balance,
  });
}

function rowFor(invoice: CollectionsInvoice, status: SmsLogInsert['status'], reason: string, linkPresent: boolean): InternalRow {
  return {
    clientId: invoice.client?.id || undefined,
    invoiceNumbers: [invoice.invoiceNumber],
    linkPresent,
    status,
    reason,
  };
}

function previewOutsideWindow(invoice: CollectionsInvoice, template?: string): InternalRow {
  const refusal = payableRefusal(invoice.invoiceStatus, invoice.balance);
  const phone = refusal ? null : selectSmsPhone(invoice.client?.phones);
  const link = refusal || !phone?.ok ? null : selectPayLink(invoice.paymentUrl, invoice.publicUrl);
  return {
    clientId: invoice.client?.id || undefined,
    invoiceNumbers: [invoice.invoiceNumber],
    phoneLast4: phone && phone.ok ? phone.last4 : undefined,
    phoneHash: phone && phone.ok ? phoneHash(phone.e164) : undefined,
    linkPresent: Boolean(link),
    message: link && phone && phone.ok ? messageFor([invoice], link, template) : undefined,
    status: 'skipped',
    reason: 'outside_window',
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliver(
  to: string,
  body: string,
  deps: SmsBatchDeps
): Promise<{ ok: true; sid: string } | { ok: false; errorCode?: string }> {
  if (!deps.sendSms) return { ok: false, errorCode: 'send_not_configured' };
  const result = await deps.sendSms({
    to,
    body,
    messagingServiceSid: collectionsMessagingServiceSid(deps.env),
  });
  if (result.sid && !result.error) return { ok: true, sid: result.sid };
  return { ok: false, errorCode: result.errorCode };
}
