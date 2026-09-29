/**
 * Shared guard for Jobber write tools.
 * Nothing in this gateway emails, texts, or notifies the client.
 */

const DELIVERY_MUTATION =
  /invoiceMarkAsSent|invoiceSend|quoteSend|sendJob|sendInvoice|sendQuote|emailCreate|\bsms\b|clientHubMessage|workObjectSend|bookingConfirmation|visitReminder|requestSend|assessmentSend/i;

/** Flags that would notify, remind, or mark a client confirmation. Must stay false when present. */
const NOTIFY_FLAGS = new Set([
  'notifyTeam',
  'smsAllowed',
  'receivesReminders',
  'receivesFollowUps',
  'receivesQuoteFollowUps',
  'receivesInvoiceFollowUps',
  'allowReviewRequest',
  'visitConfirmationStatus',
  'clientConfirmed',
]);

const NOTIFY_ARG =
  /notify|sendEmail|emailClient|textClient|sms|reminder|bookingConfirm|markSent|clientConfirmed|visitConfirmation/i;

export function assertWriteDoesNotDeliver(query: string): void {
  if (DELIVERY_MUTATION.test(query)) {
    throw new Error('This gateway cannot send, email, text, or notify a client');
  }
}

export function assertNoClientNotification(value: unknown): void {
  walk(value);
}

function walk(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (NOTIFY_FLAGS.has(key) && child === true) {
      throw new Error(`${key} must stay off. This gateway does not notify the client.`);
    }
    walk(child);
  }
}

export function assertNoNotifyArgs(args: Record<string, unknown>): void {
  const present = Object.keys(args).filter((key) => NOTIFY_ARG.test(key));
  if (!present.length) return;
  throw new Error(
    `This gateway cannot send, email, text, or notify a client (${present.join(', ')}).`
  );
}
