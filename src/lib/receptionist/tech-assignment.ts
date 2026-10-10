/**
 * Shop assignment for Sarah's $200 service call.
 *
 * Territories (Brighton, authoritative):
 *   Ramona / west / central SD → Brian Eads only
 *   Anza / high-desert         → Doug Pollack or Cowin (whoever has an open slot)
 *   Borrego / Anza-side desert → Doug, Cowin AND Brian (earliest open slot across all three)
 *
 * Brian and Cowin are identified from this repo's team roster emails
 * (scripts/seed-team.ts). Doug Pollack is not in that seed file; this repo
 * also has no Jobber user GIDs. His identity is Brighton's exact name,
 * then the Jobber users query id for that person. Never guess Travis.
 *
 * Fallback service techs (Oct 10 2026, Brighton): Chris Glass, Haze Tarbell, Colton
 * Hagler, Sergio Valdovinos Mendez. They are offered only when their Jobber calendar is
 * empty for the window AND the slot is strictly earlier than the primary pool's first
 * slot (or the primary pool has none). They apply to every territory.
 *
 * Never assign Travis, Brighton, a drill crew, or anyone else outside the primary pool
 * and the fallback roster above.
 */

export const TECH_COWIN = 'Cowin';
export const TECH_BRIAN_EADS = 'Brian Eads';
export const TECH_DOUG_POLLACK = 'Doug Pollack';

export type ShopTerritory = 'ramona' | 'anza' | 'desert';

/** Exact identities — roster emails where this repo has them; Doug by Brighton’s name. */
export const SERVICE_TECH_ROSTER = {
  brian: {
    key: 'brian' as const,
    name: TECH_BRIAN_EADS,
    email: 'brian@scwellservice.com',
    altNames: [] as string[],
    envIdKey: 'JOBBER_TECH_BRIAN_EADS_ID' as const,
  },
  cowin: {
    key: 'cowin' as const,
    name: TECH_COWIN,
    email: 'cowin@scwellservice.com',
    altNames: [] as string[],
    envIdKey: 'JOBBER_TECH_COWIN_ID' as const,
  },
  doug: {
    key: 'doug' as const,
    name: TECH_DOUG_POLLACK,
    email: '',
    altNames: ['Douglas Pollack'],
    envIdKey: 'JOBBER_TECH_DOUG_POLLACK_ID' as const,
  },
};

/** Everyone else on the roster Sarah must never assign. */
export const BLOCKED_SERVICE_EMAILS = new Set([
  'brighton@scwellservice.com',
  'travis@scwellservice.com',
  'bschroeder@scwellservice.com',
  'lizbeth@scwellservice.com',
  'roger@scwellservice.com',
  'shanicey@scwellservice.com',
  'austin@scwellservice.com',
  'dakota@scwellservice.com',
  'damian@scwellservice.com',
  'dylan@scwellservice.com',
  'jeff@scwellservice.com',
  'marshall@scwellservice.com',
]);

const BLOCKED_NAME_EXACT = new Set([
  'travis c sego',
  'travis sego',
  'travis',
  'brighton scala',
  'brighton',
  'haze',
  'chris',
  'colton',
  'sergio',
  'brian schroeder',
  'brian schroder',
]);

/**
 * Fallback service techs. Jobber users (list_users, Oct 10 2026):
 *   Chris Glass (christopher@), Haze Tarbell (hazemtarbell@gmail.com),
 *   Colton Hagler (colton@), Sergio Valdovinos Mendez (sergio@).
 * Matched by exact email (or exact full name when Jobber returns no email).
 */
export const FALLBACK_TECH_ROSTER = {
  chris: {
    key: 'chris' as const,
    name: 'Chris Glass',
    email: 'christopher@scwellservice.com',
    altNames: ['Christopher Glass'] as string[],
    envIdKey: 'JOBBER_TECH_CHRIS_GLASS_ID' as const,
  },
  haze: {
    key: 'haze' as const,
    name: 'Haze Tarbell',
    email: 'hazemtarbell@gmail.com',
    altNames: [] as string[],
    envIdKey: 'JOBBER_TECH_HAZE_TARBELL_ID' as const,
  },
  colton: {
    key: 'colton' as const,
    name: 'Colton Hagler',
    email: 'colton@scwellservice.com',
    altNames: [] as string[],
    envIdKey: 'JOBBER_TECH_COLTON_HAGLER_ID' as const,
  },
  sergio: {
    key: 'sergio' as const,
    name: 'Sergio Valdovinos Mendez',
    email: 'sergio@scwellservice.com',
    altNames: ['Sergio Valdovinos'] as string[],
    envIdKey: 'JOBBER_TECH_SERGIO_VALDOVINOS_ID' as const,
  },
};

export type ShopTech = {
  key: 'cowin' | 'brian' | 'doug' | 'chris' | 'haze' | 'colton' | 'sergio';
  name: string;
  email: string;
  altNames: string[];
  envIdKey: string;
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

/**
 * Anza-side desert towns (Oct 10 2026): far from every shop, so the earliest slot
 * across Brian AND the Anza techs wins instead of Brian's calendar alone.
 */
const DESERT_CITIES = [
  'borrego springs',
  'borrego',
  'anza borrego',
  'anza-borrego',
  'ocotillo wells',
  'shelter valley',
  'salton city',
];

const DESERT_ZIPS = new Set([
  '92004', // Borrego Springs
  '92259', // Ocotillo Wells
  '92275', // Salton City
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

export function assignShopTerritory(input: {
  city?: string | null;
  address?: string | null;
  zip?: string | null;
}): ShopTerritory {
  const zip = extractZip(input.zip) || extractZip(input.address) || extractZip(input.city);
  if (zip && DESERT_ZIPS.has(zip)) return 'desert';
  const desertPlace = normalizePlace([input.city, input.address].filter(Boolean).join(' '));
  if (cityMatches(desertPlace, DESERT_CITIES)) return 'desert';
  if (zip && COWIN_ZIPS.has(zip)) return 'anza';
  if (zip && BRIAN_ZIPS.has(zip)) return 'ramona';

  const place = normalizePlace([input.city, input.address].filter(Boolean).join(' '));
  if (cityMatches(place, COWIN_CITIES)) return 'anza';
  if (cityMatches(place, BRIAN_CITIES)) return 'ramona';

  // Default to the Ramona / west-central shop, not Anza.
  return 'ramona';
}

/** Allowed Sarah assignees for this job location. */
export function allowedTechsForLocation(input: {
  city?: string | null;
  address?: string | null;
  zip?: string | null;
}): ShopTech[] {
  const territory = assignShopTerritory(input);
  if (territory === 'desert') {
    // Anza techs first so ties go to them; Brian is merged in so the earliest slot wins.
    return [
      { ...SERVICE_TECH_ROSTER.doug },
      { ...SERVICE_TECH_ROSTER.cowin },
      { ...SERVICE_TECH_ROSTER.brian },
    ];
  }
  if (territory === 'anza') {
    return [{ ...SERVICE_TECH_ROSTER.doug }, { ...SERVICE_TECH_ROSTER.cowin }];
  }
  return [{ ...SERVICE_TECH_ROSTER.brian }];
}

/** Fallback techs: same for every territory. Order is the tie-break order. */
export function fallbackTechs(): ShopTech[] {
  return [
    { ...FALLBACK_TECH_ROSTER.chris },
    { ...FALLBACK_TECH_ROSTER.haze },
    { ...FALLBACK_TECH_ROSTER.colton },
    { ...FALLBACK_TECH_ROSTER.sergio },
  ];
}

export function assignShopTech(input: {
  city?: string | null;
  address?: string | null;
  zip?: string | null;
}): ShopTech {
  return allowedTechsForLocation(input)[0];
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

export function userEmail(user: JobberUser): string {
  const raw = typeof user.email === 'string' ? user.email : user.email?.raw || '';
  return raw.trim().toLowerCase();
}

export function isBlockedAssignee(user: JobberUser): boolean {
  const email = userEmail(user);
  if (email && BLOCKED_SERVICE_EMAILS.has(email)) return true;
  const name = userDisplayName(user).toLowerCase();
  if (BLOCKED_NAME_EXACT.has(name)) return true;
  return false;
}

/**
 * Identity check against this repo's roster, then the Jobber user id.
 * Exact email wins. Exact full name is allowed only when Jobber has no email.
 * Fuzzy "Brian" / "Chris" / first-name-only matches are rejected.
 */
export function userMatchesTech(user: JobberUser, tech: ShopTech): boolean {
  if (!user?.id || isBlockedAssignee(user)) return false;

  const email = userEmail(user);
  const name = userDisplayName(user).toLowerCase();
  const expectedEmail = tech.email.toLowerCase();
  const names = [tech.name, ...(tech.altNames || [])].map((value) => value.toLowerCase());

  if (expectedEmail && email && email === expectedEmail) return true;
  if (names.includes(name)) return true;
  return false;
}

export function resolveTechUserId(
  tech: ShopTech,
  users: JobberUser[],
  env: NodeJS.ProcessEnv = process.env
): { id: string; name: string } | null {
  const matches = users.filter((user) => userMatchesTech(user, tech));
  if (matches.length !== 1 || !matches[0].id) return null;

  const resolved = matches[0];
  if (isBlockedAssignee(resolved)) return null;

  const fromEnv = env[tech.envIdKey]?.trim();
  // Env may pin the known Jobber id, but it must be THIS person — never Travis.
  if (fromEnv && fromEnv !== resolved.id) return null;

  return { id: resolved.id, name: userDisplayName(resolved) || tech.name };
}

export function isAllowlistedTechId(
  technicianId: string | null | undefined,
  allowlistedIds: string | string[] | null | undefined
): boolean {
  if (!technicianId) return false;
  const ids = Array.isArray(allowlistedIds)
    ? allowlistedIds
    : allowlistedIds
      ? [allowlistedIds]
      : [];
  return ids.includes(technicianId);
}

export function resolveTechsForLocation(
  location: { city?: string | null; address?: string | null; zip?: string | null },
  users: JobberUser[],
  env: NodeJS.ProcessEnv = process.env
): { id: string; name: string }[] {
  const resolved: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const tech of allowedTechsForLocation(location)) {
    const match = resolveTechUserId(tech, users, env);
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    resolved.push(match);
  }
  return resolved;
}

export function resolveFallbackTechs(
  users: JobberUser[],
  env: NodeJS.ProcessEnv = process.env
): { id: string; name: string }[] {
  const resolved: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const tech of fallbackTechs()) {
    const match = resolveTechUserId(tech, users, env);
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    resolved.push(match);
  }
  return resolved;
}

/** Spoken list: "Brian Eads" or "Doug Pollack or Cowin". */
export function formatTechNames(names: string[]): string {
  const unique = names.map((name) => name.trim()).filter(Boolean);
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} or ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')}, or ${unique[unique.length - 1]}`;
}

export function allowedTechSpokenName(input: {
  city?: string | null;
  address?: string | null;
  zip?: string | null;
}): string {
  return formatTechNames(allowedTechsForLocation(input).map((tech) => tech.name));
}
