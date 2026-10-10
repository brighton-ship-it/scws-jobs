import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeContact,
  buildClosedLoopReport,
  closedLoopEmailText,
  reportWindow,
  type ClosedLoopLead,
} from './closed-loop.ts';

function lead(partial: Partial<ClosedLoopLead> & Pick<ClosedLoopLead, 'id'>): ClosedLoopLead {
  return {
    source: 'booking_requests',
    phone: '7605550100',
    email: null,
    created_at: '2026-10-01T00:00:00.000Z',
    ...partial,
  };
}

describe('closed loop report', () => {
  it('groups ads revenue and leaves unmatched revenue unattributed', () => {
    const rows = buildClosedLoopReport({
      leads: [
        lead({
          id: '1',
          lead_source: 'google_ads',
          utm_campaign: 'Search-1',
          utm_term: 'pump',
          gclid: 'abc',
        }),
      ],
      calls: [{ campaign: 'Search-1', keyword: null }, { campaign: 'Drilling', keyword: null }],
      bookedJobs: [{ source: 'google_ads', campaign: 'Search-1', keyword: 'pump' }],
      quotes: [{ source: 'google_ads', campaign: 'Search-1', keyword: 'pump' }],
      invoices: [
        { source: 'google_ads', campaign: 'Search-1', keyword: 'pump', valueUsd: 11018 },
        { source: null, valueUsd: 500 },
      ],
      costs: [{ campaign: 'Search-1', keyword: 'pump', costUsd: 2904.66 }],
    });

    const ads = rows.find((row) => row.source === 'google_ads' && row.keyword === 'pump');
    assert.equal(ads?.leads, 1);
    assert.equal(ads?.calls, 0);
    assert.equal(ads?.bookedJobs, 1);
    assert.equal(ads?.quotes, 1);
    assert.equal(ads?.invoicedRevenue, 11018);
    assert.equal(ads?.cost, 2904.66);
    assert.equal(ads?.roas, 3.79);

    const calls = rows.find((row) => row.campaign === 'Search-1' && row.keyword === '');
    assert.equal(calls?.calls, 1);

    const unmatched = rows.find((row) => row.source === 'unattributed');
    assert.equal(unmatched?.invoicedRevenue, 500);
    assert.equal(unmatched?.roas, null);
    assert.equal(rows[rows.length - 1].source, 'unattributed');
    assert.match(closedLoopEmailText(rows, { start: '2026-10-03', end: '2026-10-10' }), /unattributed/);
  });

  it('attributes an invoice phone to the ads lead, else the call, else unattributed', () => {
    const leads = [
      lead({
        id: 'form',
        lead_source: 'google_ads',
        gclid: 'abc',
        utm_campaign: 'Search-1',
        utm_term: 'pump',
      }),
    ];
    assert.deepEqual(
      attributeContact({ phone: '(760) 555-0100', leads, now: new Date('2026-10-09T00:00:00Z') }),
      { source: 'google_ads', campaign: 'Search-1', keyword: 'pump' }
    );
    assert.deepEqual(
      attributeContact({
        phone: '7605552222',
        leads,
        adsCalls: [{ phone: '7605552222', campaign: 'Drilling', keyword: null }],
        now: new Date('2026-10-09T00:00:00Z'),
      }),
      { source: 'google_ads', campaign: 'Drilling', keyword: '' }
    );
    assert.equal(
      attributeContact({ phone: '7605553333', leads, now: new Date('2026-10-09T00:00:00Z') }).source,
      'unattributed'
    );
  });

  it('uses a 7-day window ending today UTC', () => {
    assert.deepEqual(reportWindow(new Date('2026-10-10T15:00:00.000Z')), {
      start: '2026-10-03',
      end: '2026-10-10',
    });
  });
});
