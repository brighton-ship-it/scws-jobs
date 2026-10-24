/**
 * Where Southern California Well Service will book.
 *
 * San Diego, Riverside, and San Bernardino counties are bookable. A place we
 * can put in one of those counties is not handed off, soft-rejected, or
 * treated as referral-only. Unknown places stay on "the office will confirm."
 *
 * Drive time past 1 hour from the nearer shop (Ramona or Anza) still books.
 * The initial service adds $100 per hour past that threshold. See drive-surcharge.ts.
 */

import { countyFromCoords } from '../permits/county.ts';
import { CITY_TO_COUNTY, getCountyByCity } from '../tax-rates.ts';
import {
  nearerShopDrive,
  driveSurchargeInstructions,
  driveSurchargeLine,
  driveSurchargeSpoken,
  placeDrivePoint,
  type DriveLine,
  type DriveSurcharge,
} from './drive-surcharge.ts';

const SERVICE_TOWNS = [
  // San Diego County (scwellservice.com)
  'San Diego',
  'Ramona',
  'Valley Center',
  'Escondido',
  'Fallbrook',
  'Alpine',
  'Jamul',
  'Lakeside',
  'El Cajon',
  'Julian',
  'Poway',
  'Santee',
  'San Marcos',
  'Vista',
  'Oceanside',
  'Carlsbad',
  'Encinitas',
  'La Mesa',
  'Spring Valley',
  'Rancho Santa Fe',
  'Pauma Valley',
  'Rainbow',
  'Bonsall',
  'De Luz',
  'Descanso',
  'Pine Valley',
  'Santa Ysabel',
  'Warner Springs',
  'Borrego Springs',
  'Campo',
  'Potrero',
  'Pala',
  'Palomar Mountain',
  'Jacumba',
  'Boulevard',
  'Cuyamaca',
  'Ranchita',
  'Dulzura',
  'Guatay',
  'Mount Laguna',
  'Tecate',
  'Wynola',
  'Coronado',
  'National City',
  'Chula Vista',
  'Lemon Grove',
  'Del Mar',
  'Solana Beach',
  'Rancho Bernardo',

  // Riverside County (scwellservice.com/pages/locations/riverside.html)
  'Riverside',
  'Temecula',
  'Murrieta',
  'Wildomar',
  'Lake Elsinore',
  'Menifee',
  'Winchester',
  'French Valley',
  'Hemet',
  'East Hemet',
  'San Jacinto',
  'Valle Vista',
  'Idyllwild',
  'Mountain Center',
  'Pine Cove',
  'Garner Valley',
  'Anza',
  'Aguanga',
  'Sage',
  'Perris',
  'Nuevo',
  'Lakeview',
  'Romoland',
  'Beaumont',
  'Banning',
  'Sun City',
  'Palm Springs',
  'Palm Desert',
  'Cathedral City',
  'Rancho Mirage',
  'Desert Hot Springs',
  'Indian Wells',
  'La Quinta',
  'Indio',
  'Coachella',
  'Thermal',
  'Mecca',
  'Corona',

  // San Bernardino County (scwellservice.com)
  'San Bernardino',
  'Yucaipa',
  'Redlands',
  'Highland',
  'Oak Hills',
  'Apple Valley',
  'Hesperia',
  'Victorville',
  'Big Bear',
  'Big Bear Lake',
  'Lake Arrowhead',
  'Crestline',
  'Running Springs',
  'Wrightwood',
  'Landers',
  'Joshua Tree',
  'Yucca Valley',
  'Twentynine Palms',
  'Twenty Nine Palms',
  'Morongo Valley',
  'Lucerne Valley',
  'Barstow',
  'Colton',
  'Fontana',
  'Loma Linda',
  'Ontario',
  'Rancho Cucamonga',
  'Rialto',
  'Upland',
  'Adelanto',
  'Cedar Glen',
  'Rimforest',
  'Phelan',
  'Pinon Hills',
  'Pioneertown',

  // Communities in the three counties that are easy to miss as a "town"
  // (Quail Springs / Mesa Grande are Santa Ysabel, San Diego County).
  'Quail Springs',
  'Quail Spring',
  'Mesa Grande',
  'Rainbow',
  'Pine Cove',
  'Blythe',
  'Needles',
  'Moreno Valley',
  'Chino',
  'Chino Hills',
  'Calimesa',
  'Cabazon',
  'Homeland',
  'Canyon Lake',
  'Quail Valley',
  'Thousand Palms',
  'Ocotillo Wells',
  'Shelter Valley',
  'La Jolla',
  'Mira Mesa',
  'Scripps Ranch',
  'Rancho Penasquitos',
  'Imperial Beach',
  'Bonita',
  'Baker',
  'Yermo',
  'Helendale',
  'Hinkley',
  'Trona',
  'Fort Irwin',
];

const COUNTY_PHRASES = [
  'san diego county',
  'riverside county',
  'san bernardino county',
];

const CONFIRM_MESSAGE = 'The office will confirm.';

export const BOOKABLE_COUNTIES = ['San Diego', 'Riverside', 'San Bernardino'] as const;
export type BookableCounty = (typeof BOOKABLE_COUNTIES)[number];

const OUTSIDE_COUNTY_PHRASES = ['los angeles county', 'orange county', 'imperial county'];

/**
 * Places in the three counties that are not on the tax city map.
 * County membership, not a street allowlist.
 */
const EXTRA_COUNTY: Record<string, BookableCounty> = {
  'quail springs': 'San Diego',
  'quail spring': 'San Diego',
  'mesa grande': 'San Diego',
  rainbow: 'San Diego',
  cuyamaca: 'San Diego',
  'ocotillo wells': 'San Diego',
  'shelter valley': 'San Diego',
  'la jolla': 'San Diego',
  'mira mesa': 'San Diego',
  'scripps ranch': 'San Diego',
  'rancho penasquitos': 'San Diego',
  'imperial beach': 'San Diego',
  bonita: 'San Diego',
  'pine cove': 'Riverside',
  blythe: 'Riverside',
  'desert center': 'Riverside',
  'moreno valley': 'Riverside',
  norco: 'Riverside',
  eastvale: 'Riverside',
  calimesa: 'Riverside',
  'cherry valley': 'Riverside',
  cabazon: 'Riverside',
  homeland: 'Riverside',
  'canyon lake': 'Riverside',
  'quail valley': 'Riverside',
  'thousand palms': 'Riverside',
  needles: 'San Bernardino',
  baker: 'San Bernardino',
  yermo: 'San Bernardino',
  helendale: 'San Bernardino',
  hinkley: 'San Bernardino',
  trona: 'San Bernardino',
  'fort irwin': 'San Bernardino',
  chino: 'San Bernardino',
  'chino hills': 'San Bernardino',
  'grand terrace': 'San Bernardino',
  bloomington: 'San Bernardino',
  landers: 'San Bernardino',
  'twenty nine palms': 'San Bernardino',
  barstow: 'San Bernardino',
  colton: 'San Bernardino',
  adelanto: 'San Bernardino',
  lakeview: 'Riverside',
  romoland: 'Riverside',
};

/** 922xx is shared by Riverside, San Bernardino, San Diego, and Imperial. */
const ZIP_922: Record<string, BookableCounty> = {
  '92201': 'Riverside',
  '92202': 'Riverside',
  '92203': 'Riverside',
  '92210': 'Riverside',
  '92211': 'Riverside',
  '92220': 'Riverside',
  '92223': 'Riverside',
  '92225': 'Riverside',
  '92226': 'Riverside',
  '92230': 'Riverside',
  '92234': 'Riverside',
  '92236': 'Riverside',
  '92239': 'Riverside',
  '92240': 'Riverside',
  '92241': 'Riverside',
  '92253': 'Riverside',
  '92254': 'Riverside',
  '92258': 'Riverside',
  '92260': 'Riverside',
  '92261': 'Riverside',
  '92262': 'Riverside',
  '92263': 'Riverside',
  '92264': 'Riverside',
  '92270': 'Riverside',
  '92274': 'Riverside',
  '92276': 'Riverside',
  '92282': 'Riverside',
  '92242': 'San Bernardino',
  '92252': 'San Bernardino',
  '92256': 'San Bernardino',
  '92268': 'San Bernardino',
  '92277': 'San Bernardino',
  '92278': 'San Bernardino',
  '92284': 'San Bernardino',
  '92285': 'San Bernardino',
  '92286': 'San Bernardino',
  '92259': 'San Diego',
};

export type ServiceAreaResult = {
  inServiceArea: boolean | null;
  message: string;
  bookable: boolean;
  outOfArea: boolean;
  referralOnly: boolean;
  handoff: boolean;
  county: BookableCounty | null;
  nearerShop: 'ramona' | 'anza' | null;
  nearerShopLabel: 'Ramona' | 'Anza' | null;
  driveHours: number | null;
  excessHours: number;
  driveSurchargeUsd: number;
  /** Caller-facing sentence for the drive charge. Empty when there is no charge. */
  driveSpoken: string;
  /** Jobber instructions for the initial-service drive charge. */
  driveInstructions: string | null;
  /** Jobber line for the initial-service drive charge. */
  driveLine: DriveLine | null;
  bookingRule: string;
};

export function normalizeServicePlace(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePlace(value: string): string {
  return normalizeServicePlace(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function placeContains(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:\\s|$)`);
  return pattern.test(haystack);
}

const NORMALIZED_TOWNS = SERVICE_TOWNS.map((town) => ({
  town,
  key: normalizePlace(town),
})).filter((entry) => entry.key);

/** Exact town name, such as "Alpine" or "Ramona". Not a county phrase or ZIP. */
export function isKnownTown(value: string | null | undefined): boolean {
  const key = normalizePlace(value || '');
  return Boolean(key) && NORMALIZED_TOWNS.some((entry) => entry.key === key);
}

export function isCountyPhrase(value: string | null | undefined): boolean {
  const key = normalizePlace(value || '');
  return Boolean(key) && COUNTY_PHRASES.some((phrase) => phrase === key || placeContains(key, phrase));
}

/** Longest known town contained in the text, or null. "Ramona, CA" → "Ramona". */
export function matchedTownName(value: string | null | undefined): string | null {
  const loc = normalizePlace(value || '');
  if (!loc) return null;
  const exact = NORMALIZED_TOWNS.find((entry) => entry.key === loc);
  if (exact) return exact.town;
  const contained = NORMALIZED_TOWNS
    .filter((entry) => placeContains(loc, entry.key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  return contained?.town ?? null;
}

export function serviceAreaLocationFromParams(params: Record<string, unknown> | null | undefined): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const key of ['location', 'city', 'town', 'area', 'address', 'community', 'zip', 'postalCode']) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
    else if (typeof value === 'number' && Number.isFinite(value)) parts.push(String(value));
  }
  return parts.join(', ');
}

export function isBookableCounty(value: string | null | undefined): value is BookableCounty {
  return value === 'San Diego' || value === 'Riverside' || value === 'San Bernardino';
}

/** ZIP in San Diego, Riverside, or San Bernardino County, or null when it is not one of those. */
export function countyFromZip(zip: string | null | undefined): BookableCounty | null {
  const digits = String(zip || '').match(/\b(\d{5})\b/)?.[1];
  if (!digits) return null;
  const prefix = digits.slice(0, 3);
  if (prefix === '919' || prefix === '920' || prefix === '921') return 'San Diego';
  if (prefix === '925') return 'Riverside';
  if (prefix === '923' || prefix === '924') return 'San Bernardino';
  if (prefix === '922') return ZIP_922[digits] ?? null;
  return null;
}

function countyForPlaceName(name: string): BookableCounty | null {
  const fromCity = getCountyByCity(name);
  if (isBookableCounty(fromCity)) return fromCity;
  return EXTRA_COUNTY[normalizePlace(name)] ?? null;
}

type PlaceHit = { name: string; key: string; county: BookableCounty | null };

let placeIndexCache: PlaceHit[] | null = null;

/** Town list, tax-map cities, and extra communities in the three counties. */
function placeIndex(): PlaceHit[] {
  if (placeIndexCache) return placeIndexCache;
  const byKey = new Map<string, PlaceHit>();
  const add = (name: string, county: BookableCounty | null) => {
    const key = normalizePlace(name);
    if (!key) return;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { name, key, county });
      return;
    }
    if (!prev.county && county) prev.county = county;
  };
  for (const town of SERVICE_TOWNS) add(town, countyForPlaceName(town));
  for (const [name, county] of Object.entries(CITY_TO_COUNTY)) {
    if (isBookableCounty(county)) add(name, county);
  }
  for (const [key, county] of Object.entries(EXTRA_COUNTY)) add(key, county);
  placeIndexCache = [...byKey.values()];
  return placeIndexCache;
}

function bestPlace(text: string): PlaceHit | null {
  const loc = normalizePlace(text);
  if (!loc) return null;
  const places = placeIndex();
  const exact = places.find((entry) => entry.key === loc);
  if (exact) return exact;
  const contained = places
    .filter((entry) => placeContains(loc, entry.key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  return contained ?? null;
}

function countyPhrase(text: string): BookableCounty | null {
  const loc = normalizePlace(text);
  if (!loc) return null;
  if (placeContains(loc, 'san diego county')) return 'San Diego';
  if (placeContains(loc, 'san bernardino county')) return 'San Bernardino';
  if (placeContains(loc, 'riverside county')) return 'Riverside';
  return null;
}

function outsideCountyPhrase(text: string): boolean {
  const loc = normalizePlace(text);
  return Boolean(loc) && OUTSIDE_COUNTY_PHRASES.some((phrase) => placeContains(loc, phrase));
}

function extractZipCode(value: string | null | undefined): string | null {
  const match = String(value || '').match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

export type BookingAreaInput = {
  location?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
};

function unresolved(outOfArea: boolean): ServiceAreaResult {
  return {
    inServiceArea: null,
    message: CONFIRM_MESSAGE,
    bookable: false,
    outOfArea,
    referralOnly: false,
    handoff: false,
    county: null,
    nearerShop: null,
    nearerShopLabel: null,
    driveHours: null,
    excessHours: 0,
    driveSurchargeUsd: 0,
    driveSpoken: '',
    driveInstructions: null,
    driveLine: null,
    bookingRule: 'The office will confirm this place.',
  };
}

function bookableResult(input: {
  county: BookableCounty | null;
  matchedName: string | null;
  drive: DriveSurcharge | null;
}): ServiceAreaResult {
  const drive = input.drive;
  const driveSpoken = drive ? driveSurchargeSpoken(drive) : '';
  const where = input.matchedName
    ? `Yes, we service ${input.matchedName}! We'd be happy to help you.`
    : 'Yes, we service that area! We cover San Diego, Riverside, and San Bernardino counties.';
  const bookingRule = driveSpoken
    ? `Book this address. It is in ${input.county ? `${input.county} County` : 'San Diego, Riverside, or San Bernardino County'}. Do not hand off, soft-reject, or treat it as referral-only. ${driveSpoken} Drive time does not refuse the booking.`
    : `Book this address. It is in ${input.county ? `${input.county} County` : 'San Diego, Riverside, or San Bernardino County'}. Do not hand off, soft-reject, or treat it as referral-only. Drive time does not refuse the booking.`;
  return {
    inServiceArea: true,
    message: driveSpoken ? `${where} ${driveSpoken}` : where,
    bookable: true,
    outOfArea: false,
    referralOnly: false,
    handoff: false,
    county: input.county,
    nearerShop: drive?.nearerShop ?? null,
    nearerShopLabel: drive?.nearerShopLabel ?? null,
    driveHours: drive?.driveHours ?? null,
    excessHours: drive?.excessHours ?? 0,
    driveSurchargeUsd: drive?.amountUsd ?? 0,
    driveSpoken,
    driveInstructions: drive && drive.amountUsd > 0 ? driveSurchargeInstructions(drive) : null,
    driveLine: drive ? driveSurchargeLine(drive) : null,
    bookingRule,
  };
}

/**
 * Booking decision for an address. In-county places are bookable.
 * Drive past 1 hour from the nearer shop adds the initial-service surcharge
 * and does not refuse the job.
 */
export function decideBookingArea(input: BookingAreaInput | string | null | undefined): ServiceAreaResult {
  const fields: BookingAreaInput = typeof input === 'string' || input == null ? { location: input } : input;
  const full = [fields.location, fields.address, fields.city, fields.zip].filter(Boolean).join(', ');
  const loc = normalizePlace(full);
  if (!loc && (fields.lat == null || fields.lng == null)) return unresolved(false);

  const fromCity = fields.city ? bestPlace(fields.city) : null;
  const fromFull = bestPlace(full);
  const place = fromCity || fromFull;
  const zip = extractZipCode(fields.zip) || extractZipCode(full);
  const zipCounty = countyFromZip(zip);
  const phrase = countyPhrase(full);
  let county: BookableCounty | null = place?.county ?? zipCounty ?? phrase;
  let matchedName = place?.name ?? null;

  if (!county && fields.lat != null && fields.lng != null) {
    const fromCoords = countyFromCoords(fields.lat, fields.lng);
    if (fromCoords === 'san_diego') county = 'San Diego';
    else if (fromCoords === 'riverside') county = 'Riverside';
    else if (fromCoords === 'san_bernardino') county = 'San Bernardino';
  }

  const knownTown = Boolean(place) || Boolean(matchedTownName(fields.city || full));
  if (!matchedName) matchedName = matchedTownName(fields.city || full);

  if (!county && !knownTown) {
    return unresolved(outsideCountyPhrase(full));
  }

  const point =
    fields.lat != null && fields.lng != null && Number.isFinite(fields.lat) && Number.isFinite(fields.lng)
      ? { lat: fields.lat, lng: fields.lng }
      : placeDrivePoint(matchedName) || placeDrivePoint(fields.city) || placeDrivePoint(full);
  const drive = point ? nearerShopDrive(point) : null;
  return bookableResult({ county, matchedName, drive });
}

export function isBookablePlace(value: string | null | undefined): boolean {
  if (!normalizePlace(value || '')) return false;
  return decideBookingArea(value).bookable;
}

/** Town label to keep on a job when the text is a bookable place. */
export function bookableTownName(value: string | null | undefined): string | null {
  const decision = decideBookingArea(value);
  if (!decision.bookable) return null;
  return matchedTownName(value) || decision.county;
}

export function checkServiceArea(location: string | null | undefined): { result: ServiceAreaResult } {
  return { result: decideBookingArea(location) };
}
