import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidatesFromInvoices,
  offlineUploadMode,
  runOfflineImport,
  type AttributedLead,
} from './offline-import.ts';

const NOW = new Date('2026-10-09T18:00:00.000Z');

function lead(partial: Partial<AttributedLead> & Pick<AttributedLead, 'id'>): AttributedLead {
  return {
    source: 'booking_requests',
    phone: '7605550100',
    email: 'pat@example.com',
    created_at: '2026-10-01T12:00:00.000Z',
    ...partial,
  };
}

describe('offline upload mode', () => {
  it('defaults to dry-run', () => {
    assert.equal(offlineUploadMode({}), 'dry_run');
    assert.equal(offlineUploadMode({ ADS_OFFLINE_UPLOAD: 'dry_run' }), 'dry_run');
    assert.equal(offlineUploadMode({ ADS_OFFLINE_UPLOAD: 'live' }), 'live');
  });
});

describe('offline candidates', () => {
  const invoices = [
    {
      id: 'inv-1',
      invoiceStatus: 'paid',
      issuedDate: '2026-10-08',
      jobIds: ['job-ads'],
      phone: '(760) 555-0100',
      email: 'pat@example.com',
      amounts: { subtotal: 1250, taxAmount: 100, total: 1350 },
    },
    {
      id: 'inv-shop',
      invoiceStatus: 'awaiting_payment',
      issuedDate: '2026-10-08',
      jobIds: ['job-shop'],
      phone: '7605559999',
      amounts: { subtotal: 400 },
    },
    {
      id: 'inv-draft',
      invoiceStatus: 'draft',
      jobIds: ['job-draft'],
      phone: '7605550100',
      amounts: { subtotal: 9999 },
    },
  ];

  it('uploads a click-id job and skips the rest of the shop', () => {
    const candidates = candidatesFromInvoices({
      invoices,
      leads: [lead({ id: 'lead-1', gclid: 'abc', utm_campaign: 'Search-1', utm_term: 'pump' })],
      now: NOW,
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].jobberJobId, 'job-ads');
    assert.equal(candidates[0].valueUsd, 1250);
    assert.equal(candidates[0].signal, 'click_id');
    assert.equal(candidates[0].gclid, 'abc');
    assert.equal(candidates[0].campaign, 'Search-1');
  });

  it('accepts an ads call match without a form click id', () => {
    const candidates = candidatesFromInvoices({
      invoices: [invoices[1]],
      leads: [],
      adsPhones: [{ phone: '760-555-9999', campaign: 'Drilling' }],
      now: NOW,
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].signal, 'ads_call');
    assert.equal(candidates[0].gclid, null);
  });
});

describe('runOfflineImport', () => {
  it('dry-run writes the row and does not call Google', async () => {
    const saved: string[] = [];
    const result = await runOfflineImport({
      mode: 'dry_run',
      conversionAction: 'customers/1/conversionActions/2',
      existing: [],
      candidates: [
        {
          jobberJobId: 'job-1',
          invoiceIds: ['inv-1'],
          conversionAt: '2026-10-08T12:00:00.000Z',
          valueUsd: 200,
          gclid: 'abc',
          gbraid: null,
          wbraid: null,
          email: 'pat@example.com',
          phone: '7605550100',
          signal: 'click_id',
          campaign: 'Search-1',
          keyword: 'pump',
        },
      ],
      save: async (row) => {
        saved.push(row.status);
        assert.equal(row.payload?.order_id, 'job-1');
        assert.equal(row.payload?.conversion_value, 200);
      },
      upload: async () => {
        throw new Error('upload must not run in dry-run');
      },
    });
    assert.equal(result.dryRun, 1);
    assert.equal(result.uploaded, 0);
    assert.deepEqual(saved, ['dry_run']);
  });

  it('live mode uploads and skips a job that already uploaded', async () => {
    let calls = 0;
    const result = await runOfflineImport({
      mode: 'live',
      conversionAction: 'customers/1/conversionActions/2',
      existing: [{ jobber_job_id: 'job-old', status: 'uploaded' }],
      candidates: [
        {
          jobberJobId: 'job-old',
          invoiceIds: ['a'],
          conversionAt: '2026-10-08T12:00:00.000Z',
          valueUsd: 10,
          gclid: 'old',
          gbraid: null,
          wbraid: null,
          email: null,
          phone: null,
          signal: 'click_id',
          campaign: null,
          keyword: null,
        },
        {
          jobberJobId: 'job-new',
          invoiceIds: ['b'],
          conversionAt: '2026-10-08T12:00:00.000Z',
          valueUsd: 20,
          gclid: 'new',
          gbraid: null,
          wbraid: null,
          email: null,
          phone: null,
          signal: 'click_id',
          campaign: null,
          keyword: null,
        },
      ],
      save: async (row) => {
        assert.equal(row.jobber_job_id, 'job-new');
        assert.equal(row.status, 'uploaded');
      },
      upload: async (conversions) => {
        calls += 1;
        assert.equal(conversions.length, 1);
        assert.equal(conversions[0].order_id, 'job-new');
        return { ok: true, status: 200, body: { results: [{}] } };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.uploaded, 1);
  });
});
