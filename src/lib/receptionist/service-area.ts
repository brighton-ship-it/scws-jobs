/**
 * Towns Southern California Well Service covers.
 * Union of the towns listed on scwellservice.com (home, contact, Riverside
 * county page) and towns this app already treated as in-area.
 * Unknown towns are not "out of area" — the office confirms.
 */

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
];

const COUNTY_PHRASES = [
  'san diego county',
  'riverside county',
  'san bernardino county',
];

const CONFIRM_MESSAGE = 'The office will confirm.';

export type ServiceAreaResult = {
  inServiceArea: boolean | null;
  message: string;
};

function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function serviceAreaLocationFromParams(params: Record<string, unknown> | null | undefined): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const key of ['location', 'city', 'town', 'area', 'address', 'community']) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  }
  return parts.join(', ');
}

export function checkServiceArea(location: string | null | undefined): { result: ServiceAreaResult } {
  const loc = normalizePlace(location || '');
  if (!loc) {
    return { result: { inServiceArea: null, message: CONFIRM_MESSAGE } };
  }

  const matched = NORMALIZED_TOWNS
    .filter((entry) => placeContains(loc, entry.key))
    .sort((a, b) => b.key.length - a.key.length)[0];

  if (matched) {
    return {
      result: {
        inServiceArea: true,
        message: `Yes, we service ${matched.town}! We'd be happy to help you.`,
      },
    };
  }

  if (COUNTY_PHRASES.some((phrase) => placeContains(loc, phrase))) {
    return {
      result: {
        inServiceArea: true,
        message: 'Yes, we service that area! We cover San Diego, Riverside, and San Bernardino counties.',
      },
    };
  }

  return { result: { inServiceArea: null, message: CONFIRM_MESSAGE } };
}
