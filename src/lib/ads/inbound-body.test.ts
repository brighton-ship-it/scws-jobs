import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inboundAdsFields, readInboundRecord, recordFromUrlEncoded } from './inbound-body.ts';
import { ADS_ATTRIBUTION_COOKIE, serializeAttributionCookie, mergeAttribution } from './attribution.ts';
import { customerAdsPatch } from './lead-tag.ts';
import { missingColumnName, withoutColumn } from './optional-column.ts';

describe('form-encoded booking bodies', () => {
  it('parses application/x-www-form-urlencoded without throwing', async () => {
    const body = new URLSearchParams({
      service_type: 'pump_repair',
      customer_name: 'Pat Example',
      phone: '7605551212',
      address: '1 Well Rd',
      city: 'Ramona',
      gclid: 'click-from-form',
      utm_medium: 'cpc',
      utm_campaign: 'Search-1',
      utm_term: 'well pump',
    });
    const request = new Request('https://jobs.scwellservice.com/api/booking', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const record = await readInboundRecord(request);
    assert.equal(record.customer_name, 'Pat Example');
    assert.equal(record.gclid, 'click-from-form');
    assert.deepEqual(recordFromUrlEncoded('a=1&b=two'), { a: '1', b: 'two' });
  });

  it('rejects invalid JSON with a client error, not an empty throw', async () => {
    const request = new Request('https://jobs.scwellservice.com/api/booking', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    await assert.rejects(readInboundRecord(request), /Invalid JSON body/);
  });
});

describe('inbound ads fields', () => {
  it('sets google_ads, campaign, and keyword from a click id', () => {
    const fields = inboundAdsFields(
      { customer_name: 'Pat', phone: '7605551212' },
      null,
      'https://jobs.scwellservice.com/api/booking?gclid=abc&utm_source=google&utm_medium=cpc&utm_campaign=Search-1&utm_term=pump'
    );
    assert.equal(fields.lead_source, 'google_ads');
    assert.equal(fields.campaign, 'Search-1');
    assert.equal(fields.keyword, 'pump');
    assert.equal(fields.clickIds.gclid, 'abc');
    assert.equal(fields.body.lead_source, 'google_ads');
  });

  it('fills an empty form from the 90-day cookie', () => {
    const cookieValue = serializeAttributionCookie(
      mergeAttribution(null, {
        gclid: 'from-cookie',
        ga_client_id: '123.456',
        utm_medium: 'cpc',
        utm_campaign: 'Drilling',
        utm_term: 'drill',
      })
    );
    const fields = inboundAdsFields(
      { customer_name: 'Pat' },
      `${ADS_ATTRIBUTION_COOKIE}=${encodeURIComponent(cookieValue)}`,
      'https://jobs.scwellservice.com/api/booking'
    );
    assert.equal(fields.clickIds.gclid, 'from-cookie');
    assert.equal(fields.clickIds.ga_client_id, '123.456');
    assert.equal(fields.lead_source, 'google_ads');
    assert.equal(fields.campaign, 'Drilling');
    assert.equal(fields.keyword, 'drill');
  });

  it('does not tag organic traffic as google_ads', () => {
    const fields = inboundAdsFields(
      { utm_source: 'google', utm_medium: 'organic' },
      null,
      'https://jobs.scwellservice.com/api/booking'
    );
    assert.equal(fields.lead_source, null);
  });
});

describe('customer ads patch', () => {
  it('upgrades website_form and stores campaign and keyword once', () => {
    const patch = customerAdsPatch(
      { lead_source: 'website_form', gclid: null },
      {
        lead_source: 'google_ads',
        campaign: 'Search-1',
        keyword: 'pump',
        utms: {
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'Search-1',
          utm_term: 'pump',
          utm_content: null,
        },
        clickIds: {
          gclid: 'abc',
          gbraid: null,
          wbraid: null,
          ga_client_id: '1.2',
          ga_session_id: null,
        },
      }
    );
    assert.equal(patch.lead_source, 'google_ads');
    assert.equal(patch.gclid, 'abc');
    assert.equal(patch.utm_campaign, 'Search-1');
    assert.equal(patch.utm_term, 'pump');
    assert.match(patch.lead_source_detail, /campaign=Search-1/);
    assert.match(patch.lead_source_detail, /keyword=pump/);
  });

  it('does not overwrite a referral or an existing click id', () => {
    const patch = customerAdsPatch(
      { lead_source: 'referral', gclid: 'kept', utm_campaign: 'original' },
      {
        lead_source: 'google_ads',
        campaign: 'Search-1',
        keyword: 'pump',
        utms: {
          utm_source: 'google',
          utm_medium: 'cpc',
          utm_campaign: 'Search-1',
          utm_term: 'pump',
          utm_content: null,
        },
        clickIds: {
          gclid: 'new',
          gbraid: null,
          wbraid: null,
          ga_client_id: null,
          ga_session_id: null,
        },
      }
    );
    assert.equal(patch.lead_source, undefined);
    assert.equal(patch.gclid, undefined);
    assert.equal(patch.utm_campaign, undefined);
    assert.equal(patch.utm_term, 'pump');
  });
});

describe('optional columns', () => {
  it('strips the column PostgREST says is missing', () => {
    const column = missingColumnName({
      code: 'PGRST204',
      message: "Could not find the 'lead_source' column of 'booking_requests' in the schema cache",
    });
    assert.equal(column, 'lead_source');
    assert.deepEqual(withoutColumn({ lead_source: 'google_ads', phone: '1' }, 'lead_source'), {
      phone: '1',
    });
  });
});
