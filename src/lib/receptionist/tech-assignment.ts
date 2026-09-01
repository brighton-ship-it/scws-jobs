/**
 * Shop assignment for Sarah's $200 service call.
 * Anza / high-desert → Cowin
 * West/central San Diego (Ramona, Escondido, Poway, …) → Brian Eads
 */

export const TECH_COWIN = 'Cowin';
export const TECH_BRIAN_EADS = 'Brian Eads';

export type ShopTech = {
  key: 'cowin' | 'brian';
  name: string;
  envIdKey: 'JOBBER_TECH_COWIN_ID' | 'JOBBER_TECH_BRIAN_EADS_ID';
};

const COWIN_CITIES = [
  'anza',
  'aguanga',
  'idyllwild',
  'idyllwild-pine cove',
  'mountain center',
  'sage',
  'hemet',
  'east hemet',
  'san jacinto',
  'winchester',
  'homeland',
  'valle vista',
  'garner valley',
  'pinyon',
  'pinyon pines',
  'anahza',
];

const COWIN_ZIPS = new Set([
  '92539', // Anza
  '92536', // Aguanga
  '92549', // Idyllwild
  '92561', // Mountain Center
  '92544',
  '92545',
  '92543',
  '92583',
]);

const BRIAN_CITIES = [
  'ramona',
  'escondido',
  'poway',
  'valley center',
  'san diego',
  'julian',
  'fallbrook',
  'bonsall',
  'alpine',
  'lakeside',
  'el cajon',
  'santee',
  'jamul',
  'san marcos',
  'vista',
  'oceanside',
  'rancho bernardo',
  'santa ysabel',
  'pauma valley',
  'descanso',
  'pine valley',
  'campo',
  'lakeside',
  'scripps ranch',
  'mira mesa',
  'rancho penasquitos',
];

const BRIAN_ZIPS = new Set([
  '92065', // Ramona
  '92025',
  '92026',
  '92027',
  '92029',
  '92064', // Poway
  '92082', // Valley Center
  '92036', // Julian
  '92028',
  '92003',
  '91901',
  '92040',
  '92021',
  '92020',
  '92071',
]);

export function normalizePlace(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractZip(value: string | null | undefined): string | null {
  const match = String(value || '').match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

function cityMatches(haystack: string, cities: string[]): boolean {
  return cities.some((city) => haystack.includes(city));
}

export function assignShopTech(input: {
  city?: string | null;
  address?: string | null;
  zip?: string | null;
}): ShopTech {
  const zip = extractZip(input.zip) || extractZip(input.address) || extractZip(input.city);
  if (zip && COWIN_ZIPS.has(zip)) {
    return { key: 'cowin', name: TECH_COWIN, envIdKey: 'JOBBER_TECH_COWIN_ID' };
  }
  if (zip && BRIAN_ZIPS.has(zip)) {
    return { key: 'brian', name: TECH_BRIAN_EADS, envIdKey: 'JOBBER_TECH_BRIAN_EADS_ID' };
  }

  const place = normalizePlace([input.city, input.address].filter(Boolean).join(' '));
  if (cityMatches(place, COWIN_CITIES)) {
    return { key: 'cowin', name: TECH_COWIN, envIdKey: 'JOBBER_TECH_COWIN_ID' };
  }
  if (cityMatches(place, BRIAN_CITIES)) {
    return { key: 'brian', name: TECH_BRIAN_EADS, envIdKey: 'JOBBER_TECH_BRIAN_EADS_ID' };
  }

  // Default to the Ramona / west-central shop, not Anza.
  return { key: 'brian', name: TECH_BRIAN_EADS, envIdKey: 'JOBBER_TECH_BRIAN_EADS_ID' };
}

export type JobberUser = {
  id: string;
  name?: string | { full?: string | null; first?: string | null; last?: string | null } | null;
  email?: string | { raw?: string | null } | null;
};

export function userDisplayName(user: JobberUser): string {
  if (typeof user.name === 'string') return user.name.trim();
  const full = user.name?.full?.trim();
  if (full) return full;
  const first = user.name?.first?.trim() || '';
  const last = user.name?.last?.trim() || '';
  return `${first} ${last}`.trim();
}

export function userMatchesTech(user: JobberUser, tech: ShopTech): boolean {
  const name = userDisplayName(user).toLowerCase();
  const email =
    (typeof user.email === 'string' ? user.email : user.email?.raw || '').toLowerCase();

  if (tech.key === 'cowin') {
    return name.includes('cowin') || email.startsWith('cowin@');
  }

  return (
    (name.includes('brian') && name.includes('eads')) ||
    name === 'brian eads' ||
    email.startsWith('brian@')
  );
}

export function resolveTechUserId(
  tech: ShopTech,
  users: JobberUser[],
  env: NodeJS.ProcessEnv = process.env
): { id: string; name: string } | null {
  const fromEnv = env[tech.envIdKey]?.trim();
  if (fromEnv) {
    const matched = users.find((user) => user.id === fromEnv);
    return { id: fromEnv, name: matched ? userDisplayName(matched) || tech.name : tech.name };
  }

  const matched = users.find((user) => userMatchesTech(user, tech));
  if (!matched?.id) return null;
  return { id: matched.id, name: userDisplayName(matched) || tech.name };
}
