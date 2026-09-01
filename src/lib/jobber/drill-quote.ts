import { estimateFootageFromWcrs, queryNearbyWcrs, type WcrSample } from './dwr.ts';
import { resolveSiteLocation } from './geocode.ts';
import {
  createUnsentQuote,
  fetchTaxRates,
  findBrightonSalespersonId,
  findExistingClient,
  findExistingPropertyId,
  isLiveQuote,
  searchClients,
  type JobberDeps,
  type JobberQuoteSummary,
} from './quotes.ts';
import {
  AIR_ROTARY_TITLE,
  assertShopBookLines,
  buildAirRotaryLines,
  customerMessageForAirRotary,
  type QuoteLineDraft,
} from './shop-book.ts';
import { assignShop, drillMethodForSite, travelDaysForHole } from './shops.ts';
import { resolveJobberTax } from './tax.ts';

export type DrillQuoteInput = {
  apn?: string | null;
  address?: string | null;
  notes?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  phone?: string | null;
  email?: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
};

export type DrillQuoteSuccess = {
  success: true;
  draft: true;
  sentAt: null;
  reused: boolean;
  quote: JobberQuoteSummary;
  client: { id: string; name: string | null };
  tax: { county: string; taxRateId: string | null; name: string | null };
  shop: 'ramona' | 'anza';
  method: 'air';
  footageFt: number;
  travelDays: number;
  lineItems: QuoteLineDraft[];
  customerMessage: string;
  wcrSample: WcrSample[];
};

export type DrillQuoteClosed = {
  success: false;
  error: 'no_dwr_rows' | 'no_domestic_depth';
  message: string;
  wcrSample: WcrSample[];
};

export async function createDrillQuote(
  input: DrillQuoteInput,
  deps?: JobberDeps
): Promise<DrillQuoteSuccess | DrillQuoteClosed> {
  if (!input.apn && !input.address && !(input.lat && input.lng)) {
    throw new Error('apn and/or address is required');
  }

  const fetchImpl = deps?.fetchImpl ?? fetch;
  const site = await resolveSiteLocation({
    apn: input.apn,
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    city: input.city,
    fetchImpl,
  });

  const wells = await queryNearbyWcrs(site.lat, site.lng, { fetchImpl });
  const estimate = estimateFootageFromWcrs(wells);
  if (!estimate.ok) {
    return {
      success: false,
      error: estimate.reason,
      message:
        estimate.reason === 'no_dwr_rows'
          ? 'DWR returned no nearby Well Completion Reports; footage was not invented.'
          : 'DWR returned no nearby domestic well depths; footage was not invented.',
      wcrSample: estimate.wells,
    };
  }

  const city = input.city || site.city || null;
  const shop = assignShop(city);
  const method = drillMethodForSite(city, site.lng);
  if (method !== 'air') {
    throw new Error('This pack only writes air-rotary new-well drafts');
  }

  const travelDays = travelDaysForHole(shop, { lat: site.lat, lng: site.lng });
  const countyGuess = site.county || (shop === 'ramona' ? 'San Diego' : 'Riverside');
  const lineItems = buildAirRotaryLines({
    footageFt: estimate.footageFt,
    includeWaterDelivery: countyGuess === 'San Diego',
    travelDays,
  });
  assertShopBookLines(lineItems);

  const street = site.street || input.address || null;
  const searchTerms = [input.clientId, input.phone, input.email, input.clientName, street, site.ownerName]
    .filter(Boolean)
    .map(String);

  let client = null as Awaited<ReturnType<typeof searchClients>>[number] | null;
  if (input.clientId) {
    const byId = await searchClients(input.clientId, deps);
    client = byId.find((row) => row.id === input.clientId) || byId[0] || null;
  }
  for (const term of searchTerms) {
    if (client) break;
    const found = await searchClients(term, deps);
    client = findExistingClient(found, {
      phone: input.phone,
      email: input.email,
      street,
      name: input.clientName || site.ownerName,
    });
  }
  if (!client) {
    throw new Error(
      'No existing Jobber client matched APN/address — refusing to create a duplicate client. Pass clientId.'
    );
  }

  const live = (client.quotes?.nodes || []).find((quote) => {
    return isLiveQuote(quote) && /air rotary|new well/i.test(quote?.title || '');
  });
  if (live) {
    return {
      success: true,
      draft: true,
      sentAt: null,
      reused: true,
      quote: live,
      client: { id: client.id, name: client.name ?? null },
      tax: { county: countyGuess, taxRateId: null, name: null },
      shop,
      method: 'air',
      footageFt: estimate.footageFt,
      travelDays,
      lineItems,
      customerMessage: customerMessageForAirRotary(estimate.footageFt),
      wcrSample: wells.slice(0, 12),
    };
  }

  const [rates, salespersonId] = await Promise.all([
    fetchTaxRates(deps),
    findBrightonSalespersonId(deps),
  ]);
  const tax = resolveJobberTax({ city, rates, env: deps?.env });
  const message = customerMessageForAirRotary(estimate.footageFt);
  const propertyId = findExistingPropertyId(client, street);

  const quote = await createUnsentQuote(
    {
      clientId: client.id,
      propertyId,
      title: AIR_ROTARY_TITLE,
      message,
      salespersonId,
      taxRateId: tax.taxRateId,
      lineItems,
    },
    deps
  );

  return {
    success: true,
    draft: true,
    sentAt: null,
    reused: false,
    quote,
    client: { id: client.id, name: client.name ?? null },
    tax: { county: tax.county, taxRateId: tax.taxRateId, name: tax.name },
    shop,
    method: 'air',
    footageFt: estimate.footageFt,
    travelDays,
    lineItems,
    customerMessage: message,
    wcrSample: wells.slice(0, 12),
  };
}
