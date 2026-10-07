/**
 * Server-locked invoice pay link.
 * Phone and URL always come from Jobber. Caller-supplied phones and URLs are ignored.
 * dryRun defaults to true. Nothing is texted unless dryRun is explicitly false.
 */

import { jobberGraphql, type JobberGraphqlOptions } from '../jobber/client.ts';
import { getInvoice, type JobberInvoiceSummary } from '../jobber/mcp-invoices.ts';
import type { JobberDeps } from '../jobber/quotes.ts';
import {
  collectionMessage,
  collectionsMessagingServiceSid,
  linkHost,
  payableRefusal,
  selectClientEmail,
  selectPayLink,
  selectSmsPhone,
  type CollectionsEmail,
  type CollectionsPhone,
} from './policy.ts';
import { sendViaMessagingService, type CollectionsSendResult } from './twilio-send.ts';

export type InvoiceRef = {
  invoiceId?: string;
  invoiceNumber?: string;
};

export type CollectionsInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceStatus: string;
  balance: number;
  dueDate: string | null;
  paymentUrl: string | null;
  publicUrl: string | null;
  client: {
    id: string | null;
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    isCompany: boolean | null;
    phones: CollectionsPhone[];
    emails: CollectionsEmail[];
  } | null;
};

export type PayLinkSmsResult = {
  ok: boolean;
  reason?: string;
  phoneLast4?: string;
  invoiceNumber?: string;
  clientId?: string;
  linkPresent: boolean;
  message?: string;
  dryRun?: boolean;
  twilioSid?: string;
  errorCode?: string;
};

export type PayLinkSmsDeps = {
  loadInvoice?: (ref: InvoiceRef) => Promise<CollectionsInvoice | null>;
  sendSms?: (input: { to: string; body: string; messagingServiceSid: string }) => Promise<{
    sid?: string;
    errorCode?: string;
    error?: string;
  }>;
  jobber?: JobberDeps;
  log?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
};

const CLIENT_QUERIES = [
  `query CollectionsClient($id: EncodedId!) {
    client(id: $id) {
      id
      firstName
      lastName
      companyName
      isCompany
      emails { address primary }
      phones { number primary description smsAllowed }
    }
  }`,
  `query CollectionsClient($id: EncodedId!) {
    client(id: $id) {
      id
      firstName
      lastName
      companyName
      emails { address }
      phones { number primary description }
    }
  }`,
  `query CollectionsClient($id: EncodedId!) {
    client(id: $id) {
      id
      firstName
      lastName
      companyName
      emails { address }
      phones { number }
    }
  }`,
];

type ClientContact = NonNullable<CollectionsInvoice['client']>;

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function mapSummary(summary: JobberInvoiceSummary, contact: ClientContact | null): CollectionsInvoice {
  const emails =
    contact?.emails?.length
      ? contact.emails
      : (summary.client?.emails || []).map((address) => ({ address, primary: null }));
  return {
    id: summary.id,
    invoiceNumber: String(summary.invoiceNumber ?? ''),
    invoiceStatus: summary.invoiceStatus || '',
    balance: asNumber(summary.balance ?? summary.amounts?.invoiceBalance),
    dueDate: summary.dueDate,
    paymentUrl: summary.paymentUrl,
    publicUrl: summary.publicUrl,
    client: {
      id: summary.client?.id ?? contact?.id ?? null,
      firstName: contact?.firstName ?? null,
      lastName: contact?.lastName ?? null,
      companyName: contact?.companyName ?? summary.client?.companyName ?? null,
      isCompany: contact?.isCompany ?? null,
      phones: contact?.phones || [],
      emails,
    },
  };
}

function mapContact(node: Record<string, unknown> | null | undefined): ClientContact | null {
  if (!node) return null;
  const phones = Array.isArray(node.phones) ? node.phones : [];
  const emails = Array.isArray(node.emails) ? node.emails : [];
  return {
    id: typeof node.id === 'string' ? node.id : null,
    firstName: typeof node.firstName === 'string' ? node.firstName : null,
    lastName: typeof node.lastName === 'string' ? node.lastName : null,
    companyName: typeof node.companyName === 'string' ? node.companyName : null,
    isCompany: typeof node.isCompany === 'boolean' ? node.isCompany : null,
    phones: phones.filter((phone): phone is CollectionsPhone => Boolean(phone && typeof phone === 'object')),
    emails: emails.filter((email): email is CollectionsEmail => Boolean(email && typeof email === 'object')),
  };
}

async function fetchClientContact(clientId: string, jobber?: JobberDeps): Promise<ClientContact | null> {
  const options: JobberGraphqlOptions = {
    token: jobber?.token,
    fetchImpl: jobber?.fetchImpl,
    env: jobber?.env,
  };
  let lastMessage = '';
  for (const query of CLIENT_QUERIES) {
    const result = await jobberGraphql<{ client?: Record<string, unknown> | null }>(query, { id: clientId }, options);
    if (!result.errors?.length && result.data?.client) return mapContact(result.data.client);
    lastMessage = (result.errors || []).map((error) => error.message || '').join(' ');
    if (!/smsAllowed|isCompany|primary|description|ClientPhone|emails/i.test(lastMessage)) break;
  }
  if (lastMessage) throw new Error('Jobber client contact query failed');
  return null;
}

export async function loadCollectionsInvoice(ref: InvoiceRef, jobber?: JobberDeps): Promise<CollectionsInvoice | null> {
  const invoiceId = ref.invoiceId?.trim() || '';
  const invoiceNumber = ref.invoiceNumber?.trim() || '';
  if (!invoiceId && !invoiceNumber) return null;
  try {
    const summary = await getInvoice(
      { invoiceId, invoiceNumber, includeLineItems: false, includeJobs: false },
      jobber
    );
    const clientId = summary.client?.id || '';
    let contact: ClientContact | null = null;
    if (clientId) {
      try {
        contact = await fetchClientContact(clientId, jobber);
      } catch {
        contact = null;
      }
    }
    return mapSummary(summary, contact);
  } catch {
    return null;
  }
}

function logPayLink(
  log: (message: string) => void,
  fields: { invoiceNumber?: string; last4?: string; host?: string; ok: boolean; reason?: string; dryRun: boolean }
): void {
  log(
    `[collections] pay-link invoice=${fields.invoiceNumber || 'missing'} last4=${fields.last4 || ''} host=${fields.host || ''} ok=${fields.ok} reason=${fields.reason || ''} dryRun=${fields.dryRun}`
  );
}

export async function sendInvoicePayLinkSms(
  invoiceRef: InvoiceRef,
  opts: { dryRun?: boolean; template?: string; deps?: PayLinkSmsDeps } = {}
): Promise<PayLinkSmsResult> {
  const dryRun = opts.dryRun === false ? false : true;
  const deps = opts.deps || {};
  const log = deps.log ?? ((message: string) => console.log(message));
  const load = deps.loadInvoice ?? ((ref: InvoiceRef) => loadCollectionsInvoice(ref, deps.jobber));

  const invoiceId = invoiceRef.invoiceId?.trim() || '';
  const invoiceNumber = invoiceRef.invoiceNumber?.trim() || '';
  if (!invoiceId && !invoiceNumber) {
    logPayLink(log, { ok: false, reason: 'missing_invoice', dryRun });
    return { ok: false, reason: 'missing_invoice', linkPresent: false, dryRun };
  }

  const invoice = await load({ invoiceId: invoiceId || undefined, invoiceNumber: invoiceNumber || undefined });
  if (!invoice) {
    logPayLink(log, { invoiceNumber: invoiceNumber || invoiceId, ok: false, reason: 'not_found', dryRun });
    return { ok: false, reason: 'not_found', invoiceNumber: invoiceNumber || undefined, linkPresent: false, dryRun };
  }

  const base = {
    invoiceNumber: invoice.invoiceNumber,
    clientId: invoice.client?.id || undefined,
    linkPresent: false as boolean,
    dryRun,
  };
  const refusal = payableRefusal(invoice.invoiceStatus, invoice.balance);
  if (refusal) {
    logPayLink(log, { invoiceNumber: invoice.invoiceNumber, ok: false, reason: refusal, dryRun });
    return { ok: false, reason: refusal, ...base };
  }

  const phone = selectSmsPhone(invoice.client?.phones);
  if (!phone.ok) {
    logPayLink(log, { invoiceNumber: invoice.invoiceNumber, ok: false, reason: phone.reason, dryRun });
    return { ok: false, reason: phone.reason, ...base };
  }

  const link = selectPayLink(invoice.paymentUrl, invoice.publicUrl);
  if (!link) {
    logPayLink(log, { invoiceNumber: invoice.invoiceNumber, last4: phone.last4, host: 'invalid-url', ok: false, reason: 'invalid_link', dryRun });
    return { ok: false, reason: 'invalid_link', phoneLast4: phone.last4, ...base };
  }

  const message = collectionMessage({
    template: opts.template,
    invoiceNumbers: [invoice.invoiceNumber],
    link,
    firstName: invoice.client?.firstName,
    balance: invoice.balance,
  });
  const host = linkHost(link);
  const ready: PayLinkSmsResult = {
    ok: true,
    phoneLast4: phone.last4,
    invoiceNumber: invoice.invoiceNumber,
    clientId: invoice.client?.id || undefined,
    linkPresent: true,
    message,
    dryRun,
  };

  if (dryRun) {
    logPayLink(log, { invoiceNumber: invoice.invoiceNumber, last4: phone.last4, host, ok: true, dryRun: true });
    return ready;
  }

  const sent = await deliver(phone.e164, message, deps);
  if (!sent.ok) {
    logPayLink(log, {
      invoiceNumber: invoice.invoiceNumber,
      last4: phone.last4,
      host,
      ok: false,
      reason: sent.errorCode ? `send_failed:${sent.errorCode}` : sent.error,
      dryRun: false,
    });
    return {
      ...ready,
      ok: false,
      reason: 'send_failed',
      errorCode: sent.errorCode,
    };
  }

  logPayLink(log, { invoiceNumber: invoice.invoiceNumber, last4: phone.last4, host, ok: true, dryRun: false });
  return { ...ready, dryRun: false, twilioSid: sent.sid };
}

async function deliver(to: string, body: string, deps: PayLinkSmsDeps): Promise<CollectionsSendResult> {
  if (deps.sendSms) {
    const result = await deps.sendSms({
      to,
      body,
      messagingServiceSid: collectionsMessagingServiceSid(deps.env),
    });
    if (result.sid && !result.error) return { ok: true, sid: result.sid };
    return { ok: false, error: result.error || 'send_failed', errorCode: result.errorCode };
  }
  return sendViaMessagingService({ to, body }, { env: deps.env });
}

export async function resolveInvoicePayEmail(
  invoiceRef: InvoiceRef,
  deps: { loadInvoice?: (ref: InvoiceRef) => Promise<CollectionsInvoice | null>; jobber?: JobberDeps } = {}
): Promise<
  | {
      ok: true;
      invoice: CollectionsInvoice;
      email: string;
      link: string;
    }
  | { ok: false; reason: string; invoiceNumber?: string; clientId?: string }
> {
  const invoiceId = invoiceRef.invoiceId?.trim() || '';
  const invoiceNumber = invoiceRef.invoiceNumber?.trim() || '';
  if (!invoiceId && !invoiceNumber) return { ok: false, reason: 'missing_invoice' };
  const load = deps.loadInvoice ?? ((ref: InvoiceRef) => loadCollectionsInvoice(ref, deps.jobber));
  const invoice = await load({ invoiceId: invoiceId || undefined, invoiceNumber: invoiceNumber || undefined });
  if (!invoice) return { ok: false, reason: 'not_found', invoiceNumber: invoiceNumber || undefined };
  const refusal = payableRefusal(invoice.invoiceStatus, invoice.balance);
  if (refusal) {
    return { ok: false, reason: refusal, invoiceNumber: invoice.invoiceNumber, clientId: invoice.client?.id || undefined };
  }
  const link = selectPayLink(invoice.paymentUrl, invoice.publicUrl);
  if (!link) {
    return { ok: false, reason: 'invalid_link', invoiceNumber: invoice.invoiceNumber, clientId: invoice.client?.id || undefined };
  }
  const email = selectClientEmail(invoice.client?.emails);
  if (!email.ok) {
    return { ok: false, reason: email.reason, invoiceNumber: invoice.invoiceNumber, clientId: invoice.client?.id || undefined };
  }
  return { ok: true, invoice, email: email.email, link };
}
