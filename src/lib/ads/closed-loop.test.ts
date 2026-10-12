import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  attributeContact,
  buildClosedLoopReport,
  campaignTotals,
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

  it('credits an ad caller to the ad campaign even when Sarah logged a phone lead', () => {
    const result = attributeContact({
      phone: '(760) 555-0100',
      leads: [lead({ id: 'p1', lead_source: 'phone' })],
      adsCalls: [{ phone: '7605550100', campaign: 'Leads-Search-1', keyword: null }],
      now: new Date('2026-10-12T00:00:00Z'),
    });
    assert.deepEqual(result, { source: 'google_ads', campaign: 'Leads-Search-1', keyword: '' });
  });

  it('fills a blank campaign on a google_ads lead from the ad call', () => {
    const result = attributeContact({
      phone: '7605550100',
      leads: [lead({ id: 'c1', lead_source: 'google_ads' })],
      adsCalls: [{ phone: '7605550100', campaign: 'Leads-Search-Drilling', keyword: null }],
      now: new Date('2026-10-12T00:00:00Z'),
    });
    assert.equal(result.campaign, 'Leads-Search-Drilling');
  });

  it('keeps a click-id lead keyword over an ad call', () => {
    const result = attributeContact({
      phone: '7605550100',
      leads: [lead({ id: 'g', lead_source: 'google_ads', gclid: 'x', utm_campaign: 'S1', utm_term: 'pump' })],
      adsCalls: [{ phone: '7605550100', campaign: 'Drilling', keyword: null }],
      now: new Date('2026-10-12T00:00:00Z'),
    });
    assert.deepEqual(result, { source: 'google_ads', campaign: 'S1', keyword: 'pump' });
  });

  it('rolls keyword rows up to campaign totals', () => {
    const rows = buildClosedLoopReport({
      leads: [],
      calls: [{ campaign: 'S1' }, { campaign: 'S1' }],
      bookedJobs: [],
      quotes: [],
      invoices: [{ source: 'google_ads', campaign: 'S1', valueUsd: 1000 }],
      costs: [
        { campaign: 'S1', keyword: 'a', costUsd: 100 },
        { campaign: 'S1', keyword: 'b', costUsd: 150 },
      ],
    });
    const totals = campaignTotals(rows);
    assert.equal(totals.length, 1);
    assert.equal(totals[0].calls, 2);
    assert.equal(totals[0].cost, 250);
    assert.equal(totals[0].roas, 4);
    assert.match(closedLoopEmailText(rows, { start: 'a', end: 'b' }), /S1 \| 0 \| 2 \| 0 \| 0 \| \$1000\.00 \| \$250\.00 \| 4\.00x/);
  });
});
