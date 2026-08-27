import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SMS_SEND_URL,
  buildPayEmailBody,
  buildPaySmsMessage,
  handleSendPayEmail,
  handleSendPayLink,
  paymentHostForLog,
  toE164US,
} from './pay-link.ts';

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

describe('handleSendPayLink', () => {
  it('rejects missing to, invoiceNumber, or paymentUrl', async () => {
    const result = await handleSendPayLink(
      { invoiceNumber: 'INV-1', paymentUrl: PAY_URL },
      { fetchFn: async () => { throw new Error('should not fetch'); } }
    );
    assert.equal(result.result.success, false);
    assert.match(String(result.result.error), /Missing/);
  });

  it('POSTs E.164 to the live SMS endpoint and returns Vapi-shaped success', async () => {
    let posted: { url: string; init: RequestInit } | null = null;
    const result = await handleSendPayLink(
      {
        to: '760-219-5877',
        invoiceNumber: 'INV-88',
        amount: '$45',
        paymentUrl: PAY_URL,
      },
      {
        fetchFn: async (url, init) => {
          posted = { url: String(url), init: init || {} };
          return new Response(JSON.stringify({ success: true, sid: 'SM123' }), { status: 200 });
        },
      }
    );

    assert.equal(result.result.success, true);
    assert.deepEqual(result.result, {
      success: true,
      channel: 'sms',
      to: '+17602195877',
      invoiceNumber: 'INV-88',
    });
    assert.equal(posted?.url, SMS_SEND_URL);
    const body = JSON.parse(String(posted?.init.body));
    assert.equal(body.to, '+17602195877');
    assert.match(body.message, /INV-88 for \$45/);
    assert.match(body.message, /Pay here:/);
    assert.equal(FORBIDDEN.test(body.message), false);
  });

  it('returns success:false with HTTP status text when sms/send fails', async () => {
    const result = await handleSendPayLink(
      { to: '+17602195877', invoiceNumber: 'INV-88', paymentUrl: PAY_URL },
      {
        fetchFn: async () =>
          new Response('nope', { status: 503, statusText: 'Service Unavailable' }),
      }
    );
    assert.equal(result.result.success, false);
    assert.equal(result.result.error, 'Service Unavailable');
  });
});

describe('handleSendPayEmail', () => {
  it('sends a short invoice email through sendEmail and returns Vapi-shaped success', async () => {
    let sent: any = null;
    const result = await handleSendPayEmail(
      {
        to: 'pat@example.com',
        invoiceNumber: 'INV-88',
        amount: '$45',
        paymentUrl: PAY_URL,
        customerName: 'Pat',
      },
      {
        sendEmailFn: async (opts) => {
          sent = opts;
          return { success: true, messageId: 'msg_1' };
        },
      }
    );

    assert.deepEqual(result.result, {
      success: true,
      channel: 'email',
      to: 'pat@example.com',
      invoiceNumber: 'INV-88',
    });
    assert.equal(sent.subject, 'Invoice INV-88 from Southern California Well Service');
    assert.match(sent.text, /Pay here:/);
    assert.match(sent.text, /\(760\) 440-8520/);
    assert.match(sent.text, /760-219-5877/);
    assert.equal(FORBIDDEN.test(sent.text), false);
    assert.equal(/15 minutes/i.test(sent.text), false);
  });

  it('returns success:false with channel when the mailer fails', async () => {
    const result = await handleSendPayEmail(
      { to: 'pat@example.com', invoiceNumber: 'INV-88', paymentUrl: PAY_URL },
      { sendEmailFn: async () => ({ success: false, error: 'Resend not configured' }) }
    );
    assert.equal(result.result.success, false);
    assert.equal(result.result.channel, 'email');
    assert.equal(result.result.to, 'pat@example.com');
    assert.equal(result.result.invoiceNumber, 'INV-88');
    assert.equal(result.result.error, 'Resend not configured');
  });
});
