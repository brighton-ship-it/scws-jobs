import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPayEmailBody,
  buildPaySmsMessage,
  handleSendPayEmail,
  handleSendPayLink,
  paymentHostForLog,
  toE164US,
} from './pay-link.ts';
import type { CollectionsInvoice } from '../collections/pay-link-sms.ts';

const PAY_URL = 'https://secure.jobber.com/pay/abc?token=SUPERSECRET&invoice=99';
const FORBIDDEN = /collect|lawyer|urgent|broke|past due|15 minutes|within 15/i;

describe('toE164US', () => {
  it('normalizes 10-digit US numbers to +1', () => {
    assert.equal(toE164US('7602195877'), '+17602195877');
    assert.equal(toE164US('(760) 219-5877'), '+17602195877');
    assert.equal(toE164US('760-219-5877'), '+17602195877');
  });

  it('keeps 11-digit and existing E.164 US numbers', () => {
    assert.equal(toE164US('17602195877'), '+17602195877');
    assert.equal(toE164US('+17602195877'), '+17602195877');
    assert.equal(toE164US('+1 760 219 5877'), '+17602195877');
  });

  it('rejects short or empty numbers', () => {
    assert.equal(toE164US('2195877'), null);
    assert.equal(toE164US(''), null);
    assert.equal(toE164US(undefined), null);
  });
});

describe('paymentHostForLog', () => {
  it('returns host only and drops query tokens', () => {
    assert.equal(paymentHostForLog(PAY_URL), 'secure.jobber.com');
    assert.ok(!paymentHostForLog(PAY_URL).includes('token'));
    assert.ok(!paymentHostForLog(PAY_URL).includes('SUPERSECRET'));
  });
});

describe('pay message copy', () => {
  it('builds SMS with invoice, optional amount, pay URL, and office voice line', () => {
    const withAmount = buildPaySmsMessage('INV-100', '$120.00', PAY_URL);
    assert.equal(
      withAmount,
      `Southern California Well Service — invoice INV-100 for $120.00. Pay here: ${PAY_URL}\nQuestions: (760) 440-8520`
    );
    assert.equal(
      buildPaySmsMessage('INV-100', '', PAY_URL),
      `Southern California Well Service — invoice INV-100. Pay here: ${PAY_URL}\nQuestions: (760) 440-8520`
    );
    assert.equal(FORBIDDEN.test(withAmount), false);
  });

  it('builds a short email with pay URL, voice, and text numbers', () => {
    const body = buildPayEmailBody('INV-100', '$120.00', PAY_URL, 'Pat');
    assert.match(body, /^Hi Pat,/);
    assert.match(body, /invoice INV-100 for \$120\.00/);
    assert.match(body, /Pay here: https:\/\/secure\.jobber\.com\/pay\/abc/);
    assert.match(body, /\(760\) 440-8520/);
    assert.match(body, /760-219-5877/);
    assert.equal(FORBIDDEN.test(body), false);
  });
});

const JOBBER_LINK = 'https://clienthub.getjobber.com/client_hubs/abc/invoices/88';

function invoiceOnFile(): CollectionsInvoice {
  return {
    id: 'inv-88',
    invoiceNumber: '88',
    invoiceStatus: 'past_due',
    balance: 45,
    dueDate: '2026-01-01',
    paymentUrl: JOBBER_LINK,
    publicUrl: JOBBER_LINK,
    client: {
      id: 'client-88',
      firstName: 'Pat',
      lastName: 'Example',
      companyName: null,
      isCompany: false,
      phones: [{ number: '7605550100', description: 'Mobile', primary: true, smsAllowed: true }],
      emails: [{ address: 'pat.onfile@example.com', primary: true }],
    },
  };
}

describe('handleSendPayLink', () => {
  it('ignores a model phone and URL and texts the Jobber phone and link', async () => {
    let sent: { to: string; body: string; messagingServiceSid: string } | null = null;
    const result = await handleSendPayLink(
      {
        to: '760-219-5877',
        invoiceNumber: '88',
        amount: '$1',
        paymentUrl: 'https://evil.example/pay?token=NOPE',
      },
      {
        loadInvoice: async () => invoiceOnFile(),
        sendSms: async (input) => {
          sent = input;
          return { sid: 'SM123' };
        },
      }
    );

    assert.equal(result.result.success, true);
    assert.equal(result.result.phoneLast4, '0100');
    assert.equal(sent?.to, '+17605550100');
    assert.match(sent?.body || '', /clienthub\.getjobber\.com/);
    assert.equal((sent?.body || '').includes('evil.example'), false);
    assert.equal((sent?.body || '').includes('760-219-5877'), false);
    assert.ok(sent?.messagingServiceSid);
    assert.equal(FORBIDDEN.test(sent?.body || ''), false);
  });

  it('refuses when the invoice reference is missing', async () => {
    const result = await handleSendPayLink(
      { to: '+17602195877', paymentUrl: PAY_URL },
      { loadInvoice: async () => { throw new Error('should not load'); } }
    );
    assert.equal(result.result.success, false);
    assert.equal(result.result.error, 'missing_invoice');
  });

  it('returns the server refusal when the send fails', async () => {
    const result = await handleSendPayLink(
      { invoiceNumber: '88' },
      {
        loadInvoice: async () => invoiceOnFile(),
        sendSms: async () => ({ error: 'send_failed', errorCode: '30007' }),
      }
    );
    assert.equal(result.result.success, false);
    assert.equal(result.result.error, 'send_failed');
  });
});

describe('handleSendPayEmail', () => {
  it('emails the address on file and ignores the model to and URL', async () => {
    let sent: any = null;
    const result = await handleSendPayEmail(
      {
        to: 'attacker@example.com',
        invoiceNumber: '88',
        amount: '$1',
        paymentUrl: 'https://evil.example/pay',
        customerName: 'Not Pat',
      },
      {
        loadInvoice: async () => invoiceOnFile(),
        sendEmailFn: async (opts) => {
          sent = opts;
          return { success: true, messageId: 'msg_1' };
        },
      }
    );

    assert.deepEqual(result.result, {
      success: true,
      channel: 'email',
      to: 'pat.onfile@example.com',
      invoiceNumber: '88',
    });
    assert.equal(sent.to, 'pat.onfile@example.com');
    assert.equal(sent.subject, 'Invoice 88 from Southern California Well Service');
    assert.match(sent.text, /Pay here: https:\/\/clienthub\.getjobber\.com/);
    assert.equal(sent.text.includes('evil.example'), false);
    assert.equal(sent.text.includes('attacker@example.com'), false);
    assert.match(sent.text, /\(760\) 440-8520/);
    assert.match(sent.text, /760-219-5877/);
    assert.equal(FORBIDDEN.test(sent.text), false);
  });

  it('returns success:false with channel when the mailer fails', async () => {
    const result = await handleSendPayEmail(
      { to: 'attacker@example.com', invoiceNumber: '88' },
      {
        loadInvoice: async () => invoiceOnFile(),
        sendEmailFn: async () => ({ success: false, error: 'Resend not configured' }),
      }
    );
    assert.equal(result.result.success, false);
    assert.equal(result.result.channel, 'email');
    assert.equal(result.result.to, 'pat.onfile@example.com');
    assert.equal(result.result.invoiceNumber, '88');
    assert.equal(result.result.error, 'Resend not configured');
  });
});
