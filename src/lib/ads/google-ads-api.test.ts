import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALL_VIEW_GAQL,
  CAMPAIGN_COST_GAQL,
  KEYWORD_COST_GAQL,
  allocateAdCosts,
  assertReadOnlyGaql,
  costMicrosToUsd,
  googleAdsConfig,
  parseCallViewRow,
  parseCampaignCostRow,
  parseKeywordCostRow,
  uploadClickConversions,
} from './google-ads-api.ts';

describe('Google Ads read-only queries', () => {
  it('accepts the call and cost selects and rejects writes', () => {
    assert.equal(assertReadOnlyGaql(CALL_VIEW_GAQL).startsWith('SELECT'), true);
    assert.match(assertReadOnlyGaql(KEYWORD_COST_GAQL), /FROM keyword_view/);
    assert.match(assertReadOnlyGaql(CAMPAIGN_COST_GAQL), /FROM campaign/);
    assert.throws(() => assertReadOnlyGaql('UPDATE campaign SET name = "x"'), /read-only/);
    assert.throws(() => assertReadOnlyGaql('SELECT campaign.name; UPDATE campaign SET x = 1'), /single SELECT/);
  });

  it('parses a call_view row without inventing a keyword or caller phone', () => {
    const parsed = parseCallViewRow({
      callView: {
        resourceName: 'customers/1/callViews/9',
        callDurationSeconds: '83',
        startCallDateTime: '2026-10-01 15:04:05',
        callerAreaCode: '760',
        callStatus: 'RECEIVED',
        callTrackingDisplayLocation: 'AD',
      },
      campaign: { id: '11', name: 'Search-1' },
      adGroup: { name: 'Pump' },
    });
    assert.equal(parsed?.resourceName, 'customers/1/callViews/9');
    assert.equal(parsed?.durationSeconds, 83);
    assert.equal(parsed?.campaignName, 'Search-1');
    assert.equal(parsed?.keyword, null);
    assert.equal(costMicrosToUsd('2904660000'), 2904.66);
  });

  it('keeps keyword cost and only the unexplained campaign remainder', () => {
    const rows = allocateAdCosts(
      [
        parseKeywordCostRow({
          campaign: { name: 'Search-1' },
          adGroupCriterion: { keyword: { text: 'well pump' } },
          metrics: { costMicros: '400000000' },
        })!,
      ],
      [parseCampaignCostRow({ campaign: { name: 'Search-1' }, metrics: { costMicros: '1000000000' } })!]
    );
    assert.deepEqual(rows, [
      { campaign: 'Search-1', keyword: 'well pump', costUsd: 400 },
      { campaign: 'Search-1', keyword: '', costUsd: 600 },
    ]);
  });
});

describe('offline upload request', () => {
  it('is not called unless a caller invokes it, and the body is conversions only', async () => {
    assert.equal(googleAdsConfig({}), null);
    let uploaded: string | null = null;
    const result = await uploadClickConversions(
      {
        developerToken: 'dev',
        clientId: 'id',
        clientSecret: 'secret',
        refreshToken: 'refresh',
        customerId: '123',
        loginCustomerId: null,
        apiVersion: 'v18',
        conversionAction: 'customers/123/conversionActions/9',
      },
      [{ order_id: 'J1', conversion_value: 10 }],
      async (url, init) => {
        uploaded = String(url);
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(Object.keys(body).sort(), ['conversions', 'partialFailure']);
        assert.equal(JSON.stringify(body).includes('campaignBudget'), false);
        return new Response(JSON.stringify({ results: [{}] }), { status: 200 });
      },
      'token'
    );
    assert.equal(result.ok, true);
    assert.match(uploaded ?? '', /customers\/123:uploadClickConversions$/);
  });
});
