/**
 * Read Jobber tax rates for quote and invoice taxRateId.
 * Uses the same taxRates { id name description } selection drill quotes already send.
 * Rate percent is not a separate verified field on this selection; match "7.75"
 * when it appears in name or description.
 */

import { assertNoJobberErrors, jobberGraphql } from './client.ts';
import type { JobberDeps } from './quotes.ts';
import type { JobberTaxRate } from './tax.ts';

const TAX_RATES = `
  query McpTaxRates {
    taxRates {
      nodes { id name description }
    }
  }
`;

export type JobberTaxRateListItem = {
  id: string;
  name: string | null;
  description: string | null;
};

export function taxRateMatchesQuery(rate: JobberTaxRate, query: string | null | undefined): boolean {
  const needle = query?.trim().toLowerCase() || '';
  if (!needle) return true;
  return `${rate.name || ''} ${rate.description || ''}`.toLowerCase().includes(needle);
}

export function summarizeTaxRate(rate: JobberTaxRate): JobberTaxRateListItem {
  return {
    id: rate.id,
    name: rate.name?.trim() || null,
    description: rate.description?.trim() || null,
  };
}

export async function listJobberTaxRates(
  query: string | null | undefined,
  deps?: JobberDeps
): Promise<JobberTaxRateListItem[]> {
  const result = await jobberGraphql(TAX_RATES, {}, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
  assertNoJobberErrors(result, 'taxRates');
  const nodes = (result.data?.taxRates?.nodes || []) as JobberTaxRate[];
  return nodes
    .filter((rate) => rate?.id && taxRateMatchesQuery(rate, query))
    .map(summarizeTaxRate);
}
