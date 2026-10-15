import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionEmailEvents, invoiceNumbersIn } from './gmail-collections.ts';

test('shop Gmail counts invoice mail and skips review requests', () => {
  assert.deepEqual(invoiceNumbersIn('Invoice #5818 from SCWS and #5621 ($200.00)'), ['5818', '5621']);
  assert.deepEqual(invoiceNumbersIn('invoice number 5504 needs to get closed'), ['5504']);
  const events = collectionEmailEvents([
    {
      id: 'm1',
      internalDate: String(Date.parse('2026-10-05T18:25:18Z')),
      from: 'Brighton Scala <brighton@scwellservice.com>',
      to: 'Nancy Cooper <nancy@pacificaglass.net>',
      subject: 'Invoice #5818 from SCWS',
      snippet: 'Please pay this invoice.',
    },
    {
      id: 'm2',
      internalDate: String(Date.parse('2026-10-01T17:00:00Z')),
      from: 'brighton@scwellservice.com',
      to: 'nancy@pacificaglass.net',
      subject: "How'd we do, Nancy?",
      snippet: 'Leave us a Google review.',
    },
    {
      id: 'm3',
      internalDate: String(Date.parse('2026-10-14T23:35:10Z')),
      from: 'brighton@scwellservice.com',
      to: 'NConner@hometownamerica.net',
      subject: 'Re: Invoice from Southern California Well Service - Yearly Service',
      snippet: 'Invoice #5621 ($200.00) is still open.',
    },
    {
      id: 'm4',
      internalDate: String(Date.parse('2026-10-13T18:41:26Z')),
      from: 'brighton@scwellservice.com',
      to: 'pwrobinson33@yahoo.com',
      subject: 'Paul — invoice #5504 needs to get closed',
      snippet: 'Balance is still open.',
    },
    {
      id: 'm5',
      internalDate: String(Date.parse('2026-10-10T18:00:00Z')),
      from: 'brighton@scwellservice.com',
      to: 'lawyer@example.com',
      subject: 'Account balance',
      snippet: 'The balance of $15,276.37 is with counsel.',
    },
  ], 'brighton@scwellservice.com');
  assert.deepEqual(events.map((event) => event.invoiceNumbers), [['5818'], ['5621'], ['5504'], []]);
  assert.equal(events[0].by, 'Brighton');
  assert.equal(events[0].channel, 'email');
  assert.equal(events[0].source, 'gmail');
  assert.deepEqual(events[0].toEmails, ['nancy@pacificaglass.net']);
  assert.deepEqual(events[2].toEmails, ['pwrobinson33@yahoo.com']);
  assert.equal(events[3].toEmails?.[0], 'lawyer@example.com');
  assert.equal(events.some((event) => /review/i.test(event.invoiceNumbers?.join('') ?? '')), false);
  assert.equal(JSON.stringify(events).includes('Please pay'), false);
});
