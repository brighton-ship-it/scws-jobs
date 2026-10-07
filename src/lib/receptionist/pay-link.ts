import {
  resolveInvoicePayEmail,
  sendInvoicePayLinkSms,
  type CollectionsInvoice,
  type InvoiceRef,
} from '../collections/pay-link-sms.ts';
import { formatUsd } from '../collections/policy.ts';
import type { JobberDeps } from '../jobber/quotes.ts';

const VOICE_PHONE = '(760) 440-8520';
const TEXT_PHONE = '760-219-5877';

export type SendPayParams = {
  to?: unknown;
  invoiceId?: unknown;
  invoiceNumber?: unknown;
  amount?: unknown;
  paymentUrl?: unknown;
  customerName?: unknown;
};

export type SendEmailFn = (opts: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}) => Promise<{ success: boolean; messageId?: string; error?: string }>;

export type PayLinkDeps = {
  sendEmailFn?: SendEmailFn;
  textToHtmlFn?: (text: string) => string;
  loadInvoice?: (ref: InvoiceRef) => Promise<CollectionsInvoice | null>;
  sendSms?: (input: { to: string; body: string; messagingServiceSid: string }) => Promise<{
    sid?: string;
    errorCode?: string;
    error?: string;
  }>;
  jobber?: JobberDeps;
};

function asTrimmedString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

/**
 * Normalize a US phone to E.164 (+1XXXXXXXXXX).
 * Accepts 10-digit national numbers or 11-digit numbers starting with 1.
 */
export function toE164US(phone: unknown): string | null {
  const raw = asTrimmedString(phone);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Host only — never log query strings (pay links often carry tokens). */
export function paymentHostForLog(paymentUrl: string): string {
  try {
    return new URL(paymentUrl).host;
  } catch {
    return 'invalid-url';
  }
}

export function optionalAmountSuffix(amount: unknown): string {
  const value = asTrimmedString(amount);
  return value ? ` for ${value}` : '';
}

export function buildPaySmsMessage(
  invoiceNumber: string,
  amount: unknown,
  paymentUrl: string
): string {
  return `Southern California Well Service — invoice ${invoiceNumber}${optionalAmountSuffix(amount)}. Pay here: ${paymentUrl}\nQuestions: ${VOICE_PHONE}`;
}

export function buildPayEmailBody(
  invoiceNumber: string,
  amount: unknown,
  paymentUrl: string,
  customerName?: unknown
): string {
  const name = asTrimmedString(customerName);
  const greeting = name ? `Hi ${name},\n\n` : '';
  return (
    `${greeting}Southern California Well Service — invoice ${invoiceNumber}${optionalAmountSuffix(amount)}.\n\n` +
    `Pay here: ${paymentUrl}\n\n` +
    `Questions? Call ${VOICE_PHONE} or text ${TEXT_PHONE}.`
  );
}

export async function handleSendPayLink(
  params: SendPayParams,
  deps: PayLinkDeps = {}
) {
  // Model-supplied `to` and `paymentUrl` are ignored. Jobber is the source of both.
  const invoiceNumber = asTrimmedString(params.invoiceNumber);
  const invoiceId = asTrimmedString(params.invoiceId);
  const outcome = await sendInvoicePayLinkSms(
    { invoiceId: invoiceId || undefined, invoiceNumber: invoiceNumber || undefined },
    {
      dryRun: false,
      deps: {
        loadInvoice: deps.loadInvoice,
        sendSms: deps.sendSms,
        jobber: deps.jobber,
      },
    }
  );

  if (!outcome.ok) {
    console.log(
      `[Receptionist] sendPayLink fail invoice=${outcome.invoiceNumber || invoiceNumber || invoiceId || 'missing'} reason=${outcome.reason || 'failed'}`
    );
    return { result: { success: false, error: outcome.reason || 'Failed to send SMS' } };
  }

  console.log(
    `[Receptionist] sendPayLink success invoice=${outcome.invoiceNumber || invoiceNumber} last4=${outcome.phoneLast4 || ''}`
  );
  return {
    result: {
      success: true,
      channel: 'sms' as const,
      phoneLast4: outcome.phoneLast4,
      invoiceNumber: outcome.invoiceNumber,
      linkPresent: outcome.linkPresent,
    },
  };
}

export async function handleSendPayEmail(
  params: SendPayParams,
  deps: PayLinkDeps = {}
) {
  // Model-supplied `to` is ignored. The address on the Jobber client is used.
  const invoiceNumber = asTrimmedString(params.invoiceNumber);
  const invoiceId = asTrimmedString(params.invoiceId);
  const resolved = await resolveInvoicePayEmail(
    { invoiceId: invoiceId || undefined, invoiceNumber: invoiceNumber || undefined },
    { loadInvoice: deps.loadInvoice, jobber: deps.jobber }
  );

  if (!resolved.ok) {
    console.log(
      `[Receptionist] sendPayEmail fail invoice=${resolved.invoiceNumber || invoiceNumber || invoiceId || 'missing'} reason=${resolved.reason}`
    );
    return {
      result: {
        success: false,
        channel: 'email' as const,
        invoiceNumber: resolved.invoiceNumber || invoiceNumber,
        error: resolved.reason,
      },
    };
  }

  const host = paymentHostForLog(resolved.link);
  if (!deps.sendEmailFn) {
    console.log(`[Receptionist] sendPayEmail fail invoice=${resolved.invoice.invoiceNumber} host=${host} error=mailer-missing`);
    return {
      result: {
        success: false,
        channel: 'email' as const,
        to: resolved.email,
        invoiceNumber: resolved.invoice.invoiceNumber,
        error: 'Email sender not configured',
      },
    };
  }

  const text = buildPayEmailBody(
    resolved.invoice.invoiceNumber,
    formatUsd(resolved.invoice.balance),
    resolved.link,
    resolved.invoice.client?.firstName
  );
  const emailResult = await deps.sendEmailFn({
    to: resolved.email,
    subject: `Invoice ${resolved.invoice.invoiceNumber} from Southern California Well Service`,
    text,
    html: (deps.textToHtmlFn ?? ((body: string) => body))(text),
  });

  if (emailResult.success) {
    console.log(`[Receptionist] sendPayEmail success invoice=${resolved.invoice.invoiceNumber} host=${host}`);
  } else {
    console.log(
      `[Receptionist] sendPayEmail fail invoice=${resolved.invoice.invoiceNumber} host=${host} error=${emailResult.error || 'send-failed'}`
    );
  }

  return {
    result: {
      success: emailResult.success,
      channel: 'email' as const,
      to: resolved.email,
      invoiceNumber: resolved.invoice.invoiceNumber,
      ...(emailResult.success ? {} : { error: emailResult.error || 'Failed to send email' }),
    },
  };
}
