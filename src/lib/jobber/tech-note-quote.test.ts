import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VILLAGRANDO_CLIENT_NAME,
  VILLAGRANDO_CORRECT_QUOTE,
  VILLAGRANDO_JOB_NUMBER,
  VILLAGRANDO_PINHOLE_NOTES,
  VILLAGRANDO_SITE_NAME,
} from './fixtures/villagrando-pinhole.ts';
import {
  createTechNoteQuote,
  TechNoteDoNotQuoteError,
  UnclearTechNoteIntentError,
} from './tech-note-quote.ts';
import {
  PLUMBING_PACKAGE_PRICE,
  PROMAX_PM260_PRICE,
  TANK_SWAP_LABOR_PRICE,
} from './shop-book.ts';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jobberFetch(job: Record<string, unknown>) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = String(init?.body || '');
    bodies.push(body);
    const parsed = JSON.parse(body || '{}') as { query?: string };
    const q = parsed.query || '';
    if (q.includes('JobsSearch') || q.includes('JobById')) {
      return jsonResponse({ data: { jobs: { nodes: [job] }, job } });
    }
    if (q.includes('JobberTaxRates')) {
      return jsonResponse({
        data: { taxRates: { nodes: [{ id: 'sd-tax', name: 'San Diego County' }] } },
      });
    }
    if (q.includes('JobberUsers')) {
      return jsonResponse({
        data: {
          users: { nodes: [{ id: 'user-brighton', name: 'Brighton Scala', email: 'brighton@scwellservice.com' }] },
        },
      });
    }
    if (q.includes('mutation') && q.includes('QuoteCreate') && !q.includes('LineItems')) {
      return jsonResponse({
        data: {
          quoteCreate: {
            quote: {
              id: 'quote-new',
              quoteNumber: 4302,
              title: job.title || 'Draft',
              sentAt: null,
              quoteStatus: 'draft',
            },
            userErrors: [],
          },
        },
      });
    }
    if (q.includes('QuoteCreateLineItems')) {
      return jsonResponse({
        data: { quoteCreateLineItems: { createdLineItems: [{ id: 'li-1' }], userErrors: [] } },
      });
    }
    return jsonResponse({ data: {} });
  };
  return { fetchImpl, bodies };
}

const ramonaJob = {
  id: 'job-1',
  jobNumber: 8801,
  title: 'Well service',
  client: { id: 'client-1', name: 'Pat Example' },
  property: { id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona' } },
  quotes: { nodes: [] },
};

const villagrandoJob = {
  id: 'job-3266',
  jobNumber: VILLAGRANDO_JOB_NUMBER,
  title: `${VILLAGRANDO_CLIENT_NAME} / ${VILLAGRANDO_SITE_NAME}`,
  client: { id: 'client-villagrando', name: VILLAGRANDO_CLIENT_NAME },
  property: { id: 'prop-pollack', address: { street1: 'Doug Pollack site', city: 'Ramona' } },
  quotes: { nodes: [] },
};

describe('createTechNoteQuote', () => {
  it('quotes the Villagrando/Doug pinhole note as PM260 + plumbing + tank labor, no hoist, no pump', async () => {
    const { fetchImpl, bodies } = jobberFetch(villagrandoJob);
    const result = await createTechNoteQuote(
      { jobNumber: VILLAGRANDO_JOB_NUMBER, techNotes: VILLAGRANDO_PINHOLE_NOTES },
      { fetchImpl, token: 'test', env: { JOBBER_TAX_RATE_ID_SAN_DIEGO: 'sd-tax' } }
    );

    assert.equal(result.success, true);
    assert.equal(result.draft, true);
    assert.equal(result.sentAt, null);
    assert.equal(result.intent, 'pressure_tank');
    assert.equal(result.equipment.ampsNormal, true);
    assert.equal(result.equipment.hp, 2);

    const tank = result.lineItems.find((line) => line.name.includes('PM260'));
    const plumbing = result.lineItems.find((line) => line.name.includes('Plumbing'));
    const labor = result.lineItems.find((line) => line.name.includes('Tank swap'));
    assert.equal(tank?.unitPrice, PROMAX_PM260_PRICE);
    assert.equal(tank?.unitPrice, VILLAGRANDO_CORRECT_QUOTE.tankPrice);
    assert.equal(plumbing?.unitPrice, PLUMBING_PACKAGE_PRICE);
    assert.equal(labor?.unitPrice, TANK_SWAP_LABOR_PRICE);
    assert.equal(labor?.taxable, false);
    assert.ok(!result.lineItems.some((line) => /hoist/i.test(line.name)));
    assert.ok(!result.lineItems.some((line) => /BT2|pump|motor/i.test(line.name)));
    assert.equal(result.customerMessage.toLowerCase().includes('service call'), false);
    assert.equal(result.customerMessage.toLowerCase().includes('credit'), false);
    assert.equal(result.customerMessage.includes('FLAG'), false);
    assert.equal(result.customerMessage.includes('55%'), false);
    assert.equal(result.customerMessage.includes('$1541'), false);
    assert.ok(!result.lineItems.some((line) => line.unitPrice === 1541));
    const pmFlag = result.gpFlags.find((flag) => flag.sku === 'PM260');
    assert.ok(pmFlag);
    assert.equal(Math.round((pmFlag.gp || 0) * 100), 55);
    assert.match(pmFlag.text, /FLAG PM260 street \$1370 vs cost \$616\.50 = 55% GP/);
    assert.match(result.internalNote || '', /not applied/);
    const createBody = bodies.find((body) => body.includes('QuoteCreate') && !body.includes('LineItems'));
    assert.ok(createBody);
    const createVars = JSON.parse(createBody).variables as {
      attributes?: { title?: string; message?: string };
      quote?: { title?: string; message?: string };
    };
    const attrs = createVars.attributes || createVars.quote || {};
    assert.match(attrs.title || '', /FLAG under 60% GP/);
    assert.equal((attrs.message || '').includes('FLAG'), false);
    assert.ok(bodies.some((body) => body.includes('quoteCreateNote') && body.includes('FLAG PM260')));
    assert.ok(bodies.every((body) => !body.includes('transitionQuoteTo')));
    assert.ok(bodies.some((body) => body.includes('quoteCreate')));
  });

  it('quotes an unspecified house tank at street $5998 and flags 28% vs book — not $4295 or $10738', async () => {
    const { fetchImpl, bodies } = jobberFetch(ramonaJob);
    const result = await createTechNoteQuote(
      { jobNumber: 8801, techNotes: 'unspecified house tank' },
      { fetchImpl, token: 'test', env: { JOBBER_TAX_RATE_ID_SAN_DIEGO: 'sd-tax' } }
    );
    assert.equal(result.intent, 'house_tank');
    assert.equal(result.lineItems[0]?.unitPrice, 5998);
    assert.ok(result.lineItems[0]?.name.includes('42043'));
    assert.ok(!result.lineItems.some((line) => line.unitPrice === 4295));
    assert.ok(!result.lineItems.some((line) => line.unitPrice === 10738));
    const flag = result.gpFlags.find((row) => row.sku === '42043');
    assert.ok(flag);
    assert.equal(flag.cost, 4295);
    assert.equal(Math.round((flag.gp || 0) * 100), 28);
    assert.match(flag.text, /60% would be \$10738 — not applied/);
    assert.equal(result.customerMessage.includes('FLAG'), false);
    assert.equal(result.customerMessage.includes('$200'), false);
    assert.equal(result.customerMessage.toLowerCase().includes('payment plan'), false);
    assert.ok(bodies.every((body) => !body.includes('transitionQuoteTo')));
    for (const body of bodies) {
      if (body.includes('quoteCreateNote') || body.includes('NoteCreate')) continue;
      assert.equal(body.includes('10738'), false);
      assert.equal(body.includes('"unitPrice":4295'), false);
    }
  });

  it('creates a BT2 pull-and-eval only when notes actually say pull/eval', async () => {
    const { fetchImpl } = jobberFetch(ramonaJob);
    const result = await createTechNoteQuote(
      { jobNumber: 8801, techNotes: 'pump noisy, pull and eval' },
      { fetchImpl, token: 'test', env: { JOBBER_TAX_RATE_ID_SAN_DIEGO: 'sd-tax' } }
    );
    assert.equal(result.intent, 'pull_and_eval');
    assert.equal(result.lineItems[0]?.name, 'BT2');
    assert.equal(result.lineItems[0]?.unitPrice, 600);
    assert.equal(result.customerMessage.toLowerCase().includes('service call'), false);
  });

  it('does not default unclear notes to a $600 pull — returns a guess list', async () => {
    const { fetchImpl, bodies } = jobberFetch(ramonaJob);
    await assert.rejects(
      () => createTechNoteQuote({ jobNumber: 8801, techNotes: '2hp 230 volt single phase 11.7 amps' }, { fetchImpl, token: 'test' }),
      (error: unknown) => {
        assert.ok(error instanceof UnclearTechNoteIntentError);
        assert.ok(error.guesses.length >= 1);
        assert.equal(error.equipment.hp, 2);
        assert.equal(error.equipment.ampsNormal, true);
        return true;
      }
    );
    assert.ok(!bodies.some((body) => body.includes('mutation') && body.includes('QuoteCreate')));
  });

  it('reuses a live quote instead of creating a second one', async () => {
    const { fetchImpl } = jobberFetch({
      ...ramonaJob,
      quotes: {
        nodes: [
          {
            id: 'quote-existing',
            title: 'Replace pressure tank (job 8801)',
            quoteStatus: 'draft',
            sentAt: null,
          },
        ],
      },
    });
    const result = await createTechNoteQuote({ jobNumber: 8801 }, { fetchImpl, token: 'test' });
    assert.equal(result.reused, true);
    assert.equal(result.quote.id, 'quote-existing');
  });

  it('uses Goulds GS + CentriPro on a set-only replace; Anza stays CentriPro', async () => {
    const ramona = jobberFetch(ramonaJob);
    const ramonaResult = await createTechNoteQuote(
      {
        jobNumber: 8801,
        techNotes: 'pump already out of the well, set 2hp 10 gpm 300 ft 230 volt single phase',
      },
      { fetchImpl: ramona.fetchImpl, token: 'test' }
    );
    assert.equal(ramonaResult.intent, 'pump_replace');
    assert.equal(ramonaResult.motorBrand, 'CentriPro');
    assert.equal(ramonaResult.equipment.hp, 2);
    assert.ok(ramonaResult.lineItems.some((line) => /Goulds 10GS 2HP end/.test(line.name)));
    assert.ok(ramonaResult.lineItems.some((line) => /CentriPro 2 HP 230V 1-phase/.test(line.name)));
    assert.ok(!ramonaResult.lineItems.some((line) => /Franklin/.test(line.name)));
    assert.ok(!ramonaResult.lineItems.some((line) => line.name === 'BT2'));

    const anza = jobberFetch({
      ...ramonaJob,
      property: { id: 'prop-2', address: { city: 'Anza' } },
    });
    const anzaResult = await createTechNoteQuote(
      { jobNumber: 8801, kind: 'replace', techNotes: 'replace motor' },
      { fetchImpl: anza.fetchImpl, token: 'test' }
    );
    assert.equal(anzaResult.shop, 'anza');
    assert.equal(anzaResult.motorBrand, 'CentriPro');
  });

  it('does not emit BT2 for good-to-go notes', async () => {
    const { fetchImpl, bodies } = jobberFetch(ramonaJob);
    await assert.rejects(
      () =>
        createTechNoteQuote(
          { jobNumber: 8801, techNotes: 'replaced cap, 40/60, and gauge — good to go' },
          { fetchImpl, token: 'test' }
        ),
      (error: unknown) => {
        assert.ok(error instanceof TechNoteDoNotQuoteError);
        assert.equal(error.reason, 'service_call_ticket');
        return true;
      }
    );
    assert.ok(!bodies.some((body) => body.includes('mutation') && body.includes('QuoteCreate')));
    assert.ok(!bodies.some((body) => body.includes('"name":"BT2"')));
  });

  it('quotes Ramona short-to-ground as BT2 $600 and Lakeside / El Cajon as $800', async () => {
    const ramona = jobberFetch(ramonaJob);
    const ramonaResult = await createTechNoteQuote(
      { jobNumber: 8801, techNotes: 'short to ground, needs pull and eval' },
      { fetchImpl: ramona.fetchImpl, token: 'test' }
    );
    assert.equal(ramonaResult.intent, 'pull_and_eval');
    assert.equal(ramonaResult.lineItems[0]?.name, 'BT2');
    assert.equal(ramonaResult.lineItems[0]?.quantity, 1);
    assert.equal(ramonaResult.lineItems[0]?.unitPrice, 600);

    const lakeside = jobberFetch({
      ...ramonaJob,
      jobNumber: 4191,
      property: { id: 'prop-lakeside', address: { city: 'Lakeside' } },
    });
    const lakesideResult = await createTechNoteQuote(
      { jobNumber: 4191, techNotes: 'short to ground, pull and eval' },
      { fetchImpl: lakeside.fetchImpl, token: 'test' }
    );
    assert.equal(lakesideResult.lineItems[0]?.name, 'BT2');
    assert.equal(lakesideResult.lineItems[0]?.quantity, 1);
    assert.equal(lakesideResult.lineItems[0]?.unitPrice, 800);

    const elCajon = jobberFetch({
      ...ramonaJob,
      property: { id: 'prop-ec', address: { city: 'El Cajon' } },
    });
    const elCajonResult = await createTechNoteQuote(
      { jobNumber: 8801, techNotes: 'high amps, needs pull' },
      { fetchImpl: elCajon.fetchImpl, token: 'test' }
    );
    assert.equal(elCajonResult.lineItems[0]?.unitPrice, 800);
  });
});
