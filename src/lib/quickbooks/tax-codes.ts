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
 * - Id 23 is "CA-Riverside-Riverside" (TaxRateRefs 3 California State, 9 Riverside
 *   County District, 25 Riverside County; 7.75%, SYSTEM_GENERATED). The other
 *   Riverside County cities Jobber uses (Hemet, Anza, Aguanga, Murrieta, ...) use it;
 *   AST may still swap in a city code on save. Menifee stays on 30. Id 65 is the
 *   manual USER_DEFINED "Riverside county" code (one 7.75% rate 53, no county rate
 *   25), which the import's county-rate check cannot verify, so it is no longer the default.
 * - Line TaxCodeRef stays TAX or NON. Only the header TxnTaxCodeRef changes by jobsite.
 *
 * Cities not in this map are resolved from the customer's last synced invoice, then
 * blocked one invoice at a time if that is missing too. Pass txnTaxCodeId or
 * taxCodeByCity to override a city, including when QBO's calculated tax must be
 * replaced with the Jobber tax amount.
 */
export const SAN_DIEGO_TAX_CODE_ID = '3';
export const MENIFEE_TAX_CODE_ID = '30';
export const RIVERSIDE_COUNTY_TAX_CODE_ID = '23';
/** "CA-Riverside-Riverside-Murrieta" (TaxRateRefs 3, 9, 16 Murrieta city district, 25). */
export const MURRIETA_TAX_CODE_ID = '25';
/** Riverside County city codes (each carries county rate 25 plus a city district rate). */
export const LA_QUINTA_TAX_CODE_ID = '59';
export const DESERT_HOT_SPRINGS_TAX_CODE_ID = '34';
export const INDIO_TAX_CODE_ID = '35';
/**
 * San Bernardino County codes, read live 2026-11-24 by Id: 31 "CA-San Bernardino-San Bernardino"
 * (TaxRateRefs 3, 7, 26 San Bernardino County; 7.75%), 46 Yucaipa (3, 7, 26, 40),
 * 55 San Bernardino city (3, 7, 26, 46).
 */
export const SAN_BERNARDINO_COUNTY_TAX_CODE_ID = '31';
export const YUCAIPA_TAX_CODE_ID = '46';
export const SAN_BERNARDINO_CITY_TAX_CODE_ID = '55';

/** County TaxRate id each jobsite tax code must carry: 4 San Diego County, 25 Riverside County, 26 San Bernardino County. */
export const COUNTY_RATE_ID_BY_TAX_CODE: Record<string, string> = {
  [SAN_DIEGO_TAX_CODE_ID]: '4',
  [RIVERSIDE_COUNTY_TAX_CODE_ID]: '25',
  [MURRIETA_TAX_CODE_ID]: '25',
  [MENIFEE_TAX_CODE_ID]: '25',
  [LA_QUINTA_TAX_CODE_ID]: '25',
  [DESERT_HOT_SPRINGS_TAX_CODE_ID]: '25',
  [INDIO_TAX_CODE_ID]: '25',
  [SAN_BERNARDINO_COUNTY_TAX_CODE_ID]: '26',
  [YUCAIPA_TAX_CODE_ID]: '26',
  [SAN_BERNARDINO_CITY_TAX_CODE_ID]: '26',
};
export const COUNTY_RATE_IDS = ['4', '25', '26'];

/**
 * Exact TaxRate ids on a code that must not pick up an extra city rate.
 * Code 23 is unincorporated Riverside: 3 California, 9 Riverside County
 * district, 25 Riverside County. Temecula city adds rate 13; that set is
 * not accepted for a CDTFA-unincorporated Temecula mailing address.
 */
export const TAX_RATE_IDS_BY_TAX_CODE: Record<string, readonly string[]> = {
  [RIVERSIDE_COUNTY_TAX_CODE_ID]: ['3', '9', '25'],
};

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
  'homeland', 'romoland', 'nuevo', 'anza', 'aguanga', 'idyllwild', 'idyllwild pine cove', 'pine cove',
  'mountain center', 'gilman hot springs', 'sage', 'whitewater', 'la quinta', 'desert hot springs', 'indio',
];

/**
 * Riverside County cities whose default header code is their own city code instead of 23.
 * A jobsite outside city limits (CDTFA says unincorporated) needs taxCodeByCity {"<city>": "23"}.
 */
const RIVERSIDE_CITY_CODES: Record<string, string> = {
  'la quinta': LA_QUINTA_TAX_CODE_ID,
  'desert hot springs': DESERT_HOT_SPRINGS_TAX_CODE_ID,
  indio: INDIO_TAX_CODE_ID,
};

/** San Bernardino County places. Unincorporated mountain communities default to 31. */
const SAN_BERNARDINO_COUNTY = [
  'san bernardino', 'yucaipa', 'fawnskin', 'oak glen', 'lake arrowhead', 'running springs', 'crestline',
  'twin peaks', 'blue jay', 'cedar glen', 'big bear city', 'angelus oaks', 'forest falls', 'mentone',
];

const SAN_BERNARDINO_CITY_CODES: Record<string, string> = {
  'san bernardino': SAN_BERNARDINO_CITY_TAX_CODE_ID,
  yucaipa: YUCAIPA_TAX_CODE_ID,
};

const MENIFEE_CITIES = ['menifee', 'sun city'];

export const TAX_CODE_ID_BY_CITY: Record<string, string> = {};
for (const city of SAN_DIEGO_COUNTY) TAX_CODE_ID_BY_CITY[city] = SAN_DIEGO_TAX_CODE_ID;
for (const city of RIVERSIDE_COUNTY) TAX_CODE_ID_BY_CITY[city] = RIVERSIDE_COUNTY_TAX_CODE_ID;
for (const city of MENIFEE_CITIES) TAX_CODE_ID_BY_CITY[city] = MENIFEE_TAX_CODE_ID;
TAX_CODE_ID_BY_CITY.murrieta = MURRIETA_TAX_CODE_ID;
Object.assign(TAX_CODE_ID_BY_CITY, RIVERSIDE_CITY_CODES);
for (const city of SAN_BERNARDINO_COUNTY) TAX_CODE_ID_BY_CITY[city] = SAN_BERNARDINO_CITY_CODES[city] || SAN_BERNARDINO_COUNTY_TAX_CODE_ID;

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
export type CountyName = 'San Diego' | 'Riverside' | 'San Bernardino';

export function countyNameForCity(city: string | null | undefined): CountyName | null {
  if (!city) return null;
  const key = normalizePlace(city);
  if ((MENIFEE_CITIES as readonly string[]).includes(key) || (RIVERSIDE_COUNTY as readonly string[]).includes(key)) return 'Riverside';
  if ((SAN_DIEGO_COUNTY as readonly string[]).includes(key)) return 'San Diego';
  if ((SAN_BERNARDINO_COUNTY as readonly string[]).includes(key)) return 'San Bernardino';
  return null;
}

export function taxCodeMissingReason(city: string | null | undefined): string {
  const where = city ? `city "${city}"` : 'this invoice (no jobsite city)';
  return `No QuickBooks tax code id for ${where}. Pass txnTaxCodeId (an id such as 3) or taxCodeByCity. Synced examples: San Diego County id 3, Menifee id 30.`;
}
