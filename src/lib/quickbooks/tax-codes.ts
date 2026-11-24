/**
 * QuickBooks tax code ids used by the old Jobber sync.
 *
 * Read from live invoices on 2026-11-19 (by TaxCode Id, not by Name):
 * - Id 3 is "CA-San Diego-San Diego" (TaxRateRefs 3 California State, 4 San Diego
 *   County, 5 San Diego County District). Invoice 5825 and Ramona invoice 5000
 *   (job 2503) use it. A query for Name = 'CA-San Diego-San Diego' returns nothing
 *   because the tax-code list stores a hash in Name.
 * - Id 30 is "CA-Riverside-Riverside-Menifee". Menifee invoice 5700 (job 3347) uses
 *   it. Sun City is the same city. The manual code "San Diego Tax" (54) is not
 *   what synced San Diego invoices used.
 * - Id 65 is the manual "Riverside county" code. Menifee stays on 30. The other
 *   Riverside County cities Jobber uses, including Hemet, were blocking invoices
 *   because they were not in this map. They use 65.
 * - Line TaxCodeRef stays TAX or NON. Only the header TxnTaxCodeRef changes by jobsite.
 *
 * Cities not in this map are resolved from the customer's last synced invoice, then
 * blocked one invoice at a time if that is missing too. Pass txnTaxCodeId or
 * taxCodeByCity to override a city, including when QBO's calculated tax must be
 * replaced with the Jobber tax amount.
 */
export const SAN_DIEGO_TAX_CODE_ID = '3';
export const MENIFEE_TAX_CODE_ID = '30';
export const RIVERSIDE_COUNTY_TAX_CODE_ID = '65';

const SAN_DIEGO_COUNTY = [
  'san diego', 'ramona', 'escondido', 'poway', 'lakeside', 'santee', 'el cajon', 'la mesa',
  'alpine', 'julian', 'santa ysabel', 'ranchita', 'warner springs', 'valley center', 'fallbrook',
  'bonsall', 'pala', 'pauma valley', 'oceanside', 'vista', 'san marcos', 'carlsbad', 'encinitas',
  'del mar', 'solana beach', 'rancho santa fe', 'la jolla', 'pacific beach', 'clairemont',
  'mira mesa', 'scripps ranch', 'tierrasanta', 'spring valley', 'lemon grove', 'national city',
  'chula vista', 'imperial beach', 'coronado', 'bonita', 'jamul', 'dulzura', 'campo',
  'pine valley', 'descanso', 'boulevard', 'jacumba', 'borrego springs', 'mount laguna',
  'guatay', 'potrero',
];

const RIVERSIDE_COUNTY = [
  'riverside', 'corona', 'norco', 'eastvale', 'jurupa valley', 'mira loma', 'pedley', 'rubidoux',
  'glen avon', 'moreno valley', 'perris', 'mead valley', 'good hope', 'hemet', 'san jacinto',
  'beaumont', 'banning', 'calimesa', 'cherry valley', 'cabazon', 'murrieta', 'temecula',
  'french valley', 'winchester', 'lake elsinore', 'wildomar', 'canyon lake', 'lakeview',
  'homeland', 'romoland', 'nuevo', 'anza', 'aguanga', 'idyllwild', 'mountain center',
  'gilman hot springs', 'sage', 'whitewater',
];

const MENIFEE_CITIES = ['menifee', 'sun city'];

export const TAX_CODE_ID_BY_CITY: Record<string, string> = {};
for (const city of SAN_DIEGO_COUNTY) TAX_CODE_ID_BY_CITY[city] = SAN_DIEGO_TAX_CODE_ID;
for (const city of RIVERSIDE_COUNTY) TAX_CODE_ID_BY_CITY[city] = RIVERSIDE_COUNTY_TAX_CODE_ID;
for (const city of MENIFEE_CITIES) TAX_CODE_ID_BY_CITY[city] = MENIFEE_TAX_CODE_ID;

export function normalizePlace(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function taxCodeIdForCity(city: string | null | undefined, overrides?: Record<string, string> | null): string | null {
  if (!city) return null;
  const key = normalizePlace(city);
  const map = overrides || {};
  for (const [name, id] of Object.entries(map)) {
    if (normalizePlace(name) === key && String(id).trim()) return String(id).trim();
  }
  return TAX_CODE_ID_BY_CITY[key] || null;
}

/** County for the 1% county rate. Menifee is Riverside County even though its tax code id is 30. */
export function countyNameForCity(city: string | null | undefined): 'San Diego' | 'Riverside' | null {
  if (!city) return null;
  const key = normalizePlace(city);
  if ((MENIFEE_CITIES as readonly string[]).includes(key) || (RIVERSIDE_COUNTY as readonly string[]).includes(key)) return 'Riverside';
  if ((SAN_DIEGO_COUNTY as readonly string[]).includes(key)) return 'San Diego';
  return null;
}

export function taxCodeMissingReason(city: string | null | undefined): string {
  const where = city ? `city "${city}"` : 'this invoice (no jobsite city)';
  return `No QuickBooks tax code id for ${where}. Pass txnTaxCodeId (an id such as 3) or taxCodeByCity. Synced examples: San Diego County id 3, Menifee id 30.`;
}
