export const SMS_SEND_URL = 'https://scws-receptionist.vercel.app/sms/send';
const VOICE_PHONE = '(760) 440-8520';
const TEXT_PHONE = '760-219-5877';

export type SendPayParams = {
  to?: unknown;
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
  fetchFn?: typeof fetch;
  sendEmailFn?: SendEmailFn;
  textToHtmlFn?: (text: string) => string;
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
  const fetchFn = deps.fetchFn ?? fetch;
  const invoiceNumber = asTrimmedString(params.invoiceNumber);
  const paymentUrl = asTrimmedString(params.paymentUrl);
  const host = paymentUrl ? paymentHostForLog(paymentUrl) : 'missing-url';

  if (!asTrimmedString(params.to) || !invoiceNumber || !paymentUrl) {
    console.log(`[Receptionist] sendPayLink fail invoice=${invoiceNumber || 'missing'} host=${host} error=missing-fields`);
    return {
      result: { success: false, error: 'Missing to, invoiceNumber, or paymentUrl' },
    };
  }

  const to = toE164US(params.to);
  if (!to) {
    console.log(`[Receptionist] sendPayLink fail invoice=${invoiceNumber} host=${host} error=invalid-phone`);
    return {
      result: { success: false, error: 'Invalid phone number' },
    };
  }

  const message = buildPaySmsMessage(invoiceNumber, params.amount, paymentUrl);

  try {
    const response = await fetchFn(SMS_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message }),
    });

    if (!response.ok) {
      const error = response.statusText || `HTTP ${response.status}`;
      console.log(`[Receptionist] sendPayLink fail invoice=${invoiceNumber} host=${host} error=${error}`);
      return { result: { success: false, error } };
    }

    console.log(`[Receptionist] sendPayLink success invoice=${invoiceNumber} host=${host}`);
    return {
      result: { success: true, channel: 'sms' as const, to, invoiceNumber },
    };
  } catch (error: any) {
    const messageText = error?.message || 'Failed to send SMS';
    console.log(`[Receptionist] sendPayLink fail invoice=${invoiceNumber} host=${host} error=${messageText}`);
    return { result: { success: false, error: messageText } };
  }
}

export async function handleSendPayEmail(
  params: SendPayParams,
  deps: PayLinkDeps = {}
) {
  const to = asTrimmedString(params.to);
  const invoiceNumber = asTrimmedString(params.invoiceNumber);
  const paymentUrl = asTrimmedString(params.paymentUrl);
  const host = paymentUrl ? paymentHostForLog(paymentUrl) : 'missing-url';

  if (!to || !invoiceNumber || !paymentUrl || !to.includes('@')) {
    console.log(`[Receptionist] sendPayEmail fail invoice=${invoiceNumber || 'missing'} host=${host} error=missing-fields`);
    return {
      result: {
        success: false,
        channel: 'email' as const,
        to,
        invoiceNumber,
        error: 'Missing to, invoiceNumber, or paymentUrl',
      },
    };
  }

  if (!deps.sendEmailFn) {
    console.log(`[Receptionist] sendPayEmail fail invoice=${invoiceNumber} host=${host} error=mailer-missing`);
    return {
      result: {
        success: false,
        channel: 'email' as const,
        to,
        invoiceNumber,
        error: 'Email sender not configured',
      },
    };
  }

  const text = buildPayEmailBody(invoiceNumber, params.amount, paymentUrl, params.customerName);
  const emailResult = await deps.sendEmailFn({
    to,
    subject: `Invoice ${invoiceNumber} from Southern California Well Service`,
    text,
    html: (deps.textToHtmlFn ?? ((body: string) => body))(text),
  });

  if (emailResult.success) {
    console.log(`[Receptionist] sendPayEmail success invoice=${invoiceNumber} host=${host}`);
  } else {
    console.log(`[Receptionist] sendPayEmail fail invoice=${invoiceNumber} host=${host} error=${emailResult.error || 'send-failed'}`);
  }

  return {
    result: {
      success: emailResult.success,
      channel: 'email' as const,
      to,
      invoiceNumber,
      ...(emailResult.success ? {} : { error: emailResult.error || 'Failed to send email' }),
    },
  };
}
