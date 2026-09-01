import { getCountyByCity } from '../tax-rates.ts';

export type JobberTaxRate = {
  id: string;
  name?: string | null;
  description?: string | null;
};

export type ResolvedJobberTax = {
  county: string;
  taxRateId: string | null;
  name: string | null;
  laborOnly: boolean;
};

const COUNTY_ENV: Record<string, string> = {
  'San Diego': 'JOBBER_TAX_RATE_ID_SAN_DIEGO',
  Riverside: 'JOBBER_TAX_RATE_ID_RIVERSIDE',
  'San Bernardino': 'JOBBER_TAX_RATE_ID_SAN_BERNARDINO',
};

export function countyForProperty(city: string | null | undefined): string {
  return getCountyByCity(city) || 'San Diego';
}

export function envTaxRateId(
  county: string,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const key = COUNTY_ENV[county];
  if (!key) return null;
  return env[key]?.trim() || null;
}

function rateText(rate: JobberTaxRate): string {
  return `${rate.name || ''} ${rate.description || ''}`.toLowerCase();
}

/**
 * Pick the Jobber tax rate for the property county.
 * Ramona / San Diego jobs must not inherit a San Bernardino rate
 * (labor-only pull-and-eval is non-taxable; a wrong county still poisons the draft).
 */
export function pickJobberTaxRate(
  county: string,
  rates: JobberTaxRate[],
  env: NodeJS.ProcessEnv = process.env
): JobberTaxRate | null {
  const fromEnv = envTaxRateId(county, env);
  if (fromEnv) {
    const matched = rates.find((rate) => rate.id === fromEnv);
    if (matched) return matched;
    return { id: fromEnv, name: county };
  }

  const needle = county.toLowerCase();
  const matches = rates.filter((rate) => rateText(rate).includes(needle));
  if (county === 'San Diego') {
    const notBernardino = matches.filter((rate) => !rateText(rate).includes('bernardino'));
    return notBernardino[0] || matches[0] || null;
  }
  return matches[0] || null;
}

export function resolveJobberTax(input: {
  city: string | null | undefined;
  rates: JobberTaxRate[];
  laborOnly?: boolean;
  env?: NodeJS.ProcessEnv;
}): ResolvedJobberTax {
  const county = countyForProperty(input.city);
  const picked = pickJobberTaxRate(county, input.rates, input.env ?? process.env);

  if (county === 'San Diego' && picked && /bernardino/i.test(rateText(picked))) {
    throw new Error('San Diego / Ramona jobs must not use a San Bernardino tax rate');
  }

  return {
    county,
    taxRateId: picked?.id ?? null,
    name: picked?.name ?? county,
    laborOnly: Boolean(input.laborOnly),
  };
}
