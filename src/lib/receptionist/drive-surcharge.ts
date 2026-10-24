/**
 * Initial-service drive surcharge.
 *
 * Drive time is the straight-line haversine at RURAL_DRIVE_MPH (50), the same
 * estimate drill travel uses, measured to both shops. The nearer shop wins:
 * Ramona (1077 Main St) or Anza. The first hour is included. Each hour past
 * that is $100 on the initial service. A longer drive never refuses the booking.
 */

import { estimateDriveHours, SHOP_COORDS, type ShopKey } from '../jobber/shops.ts';

export const DRIVE_INCLUDED_HOURS = 1;
export const DRIVE_SURCHARGE_PER_HOUR_USD = 100;
export const DRIVE_SURCHARGE_LINE_NAME = 'Drive time';

export type DriveSurcharge = {
  nearerShop: ShopKey;
  nearerShopLabel: 'Ramona' | 'Anza';
  driveHours: number;
  excessHours: number;
  amountUsd: number;
  ramonaHours: number;
  anzaHours: number;
};

export type DriveLine = {
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  saveToProductsAndServices: false;
};

export function roundDriveHours(hours: number): number {
  return Math.round((hours + Number.EPSILON) * 100) / 100;
}

/** $100 per hour past the included hour. At or under 1 hour the charge is $0. */
export function driveSurchargeFromHours(driveHours: number): {
  driveHours: number;
  excessHours: number;
  amountUsd: number;
} {
  const hours = roundDriveHours(driveHours);
  if (!Number.isFinite(hours) || hours <= DRIVE_INCLUDED_HOURS) {
    return { driveHours: Number.isFinite(hours) ? hours : 0, excessHours: 0, amountUsd: 0 };
  }
  const excessHours = roundDriveHours(hours - DRIVE_INCLUDED_HOURS);
  const amountUsd = Math.round(excessHours * DRIVE_SURCHARGE_PER_HOUR_USD);
  return { driveHours: hours, excessHours, amountUsd };
}

export function nearerShopDrive(point: { lat: number; lng: number }): DriveSurcharge {
  const ramonaHours = estimateDriveHours(SHOP_COORDS.ramona, point);
  const anzaHours = estimateDriveHours(SHOP_COORDS.anza, point);
  const nearerShop: ShopKey = ramonaHours <= anzaHours ? 'ramona' : 'anza';
  const nearerShopLabel = nearerShop === 'ramona' ? 'Ramona' : 'Anza';
  const fee = driveSurchargeFromHours(nearerShop === 'ramona' ? ramonaHours : anzaHours);
  return {
    nearerShop,
    nearerShopLabel,
    driveHours: fee.driveHours,
    excessHours: fee.excessHours,
    amountUsd: fee.amountUsd,
    ramonaHours: roundDriveHours(ramonaHours),
    anzaHours: roundDriveHours(anzaHours),
  };
}

export function formatDriveHours(hours: number): string {
  const rounded = roundDriveHours(hours);
  const text = rounded.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
  const n = Number(text);
  return `${text} ${n === 1 ? 'hour' : 'hours'}`;
}

export function driveSurchargeSpoken(surcharge: DriveSurcharge): string {
  if (surcharge.amountUsd <= 0) return '';
  return `The drive from our ${surcharge.nearerShopLabel} shop is about ${formatDriveHours(surcharge.driveHours)}, so this first visit adds $${surcharge.amountUsd} ($100 per hour of drive time beyond 1 hour).`;
}

/** Jobber job/visit instructions (the note the tech sees). */
export function driveSurchargeInstructions(surcharge: DriveSurcharge): string {
  return `Initial service drive surcharge: $${surcharge.amountUsd} (${formatDriveHours(surcharge.driveHours)} from the ${surcharge.nearerShopLabel} shop, $100 per hour past 1 hour).`;
}

/** Jobber line on the initial service call. Quantity 1 so the dollar amount is the charge. */
export function driveSurchargeLine(surcharge: DriveSurcharge): DriveLine | null {
  if (surcharge.amountUsd <= 0) return null;
  return {
    name: DRIVE_SURCHARGE_LINE_NAME,
    description: `Initial service only. ${formatDriveHours(surcharge.excessHours)} beyond 1 hour from the ${surcharge.nearerShopLabel} shop ($100 per hour).`,
    quantity: 1,
    unitPrice: surcharge.amountUsd,
    saveToProductsAndServices: false,
  };
}

function normalizeDrivePlace(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function placeContained(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const pattern = new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
  return pattern.test(haystack);
}

/** Approximate community points so the nearer-shop drive can be computed without a network geocode. */
const PLACE_DRIVE_POINTS: Record<string, { lat: number; lng: number }> = {
  ramona: { lat: 33.0414, lng: -116.8686 },
  'valley center': { lat: 33.2184, lng: -117.0342 },
  escondido: { lat: 33.1192, lng: -117.0864 },
  julian: { lat: 33.0784, lng: -116.6019 },
  alpine: { lat: 32.8351, lng: -116.7664 },
  poway: { lat: 32.9628, lng: -117.0359 },
  'san diego': { lat: 32.7157, lng: -117.1611 },
  fallbrook: { lat: 33.3764, lng: -117.2511 },
  lakeside: { lat: 32.8573, lng: -116.9222 },
  santee: { lat: 32.8384, lng: -116.9739 },
  'el cajon': { lat: 32.7948, lng: -116.9625 },
  'la mesa': { lat: 32.7678, lng: -117.0231 },
  encinitas: { lat: 33.037, lng: -117.292 },
  carlsbad: { lat: 33.1581, lng: -117.3506 },
  oceanside: { lat: 33.1959, lng: -117.3795 },
  vista: { lat: 33.2, lng: -117.2425 },
  'san marcos': { lat: 33.1434, lng: -117.1661 },
  bonsall: { lat: 33.2889, lng: -117.2253 },
  'borrego springs': { lat: 33.2559, lng: -116.3753 },
  borrego: { lat: 33.2559, lng: -116.3753 },
  boulevard: { lat: 32.6639, lng: -116.2753 },
  campo: { lat: 32.6064, lng: -116.4686 },
  descanso: { lat: 32.8528, lng: -116.6156 },
  dulzura: { lat: 32.6442, lng: -116.7778 },
  guatay: { lat: 32.8489, lng: -116.5906 },
  jacumba: { lat: 32.617, lng: -116.1881 },
  jamul: { lat: 32.717, lng: -116.8761 },
  'mount laguna': { lat: 32.8731, lng: -116.4236 },
  'pauma valley': { lat: 33.3042, lng: -116.9806 },
  'pine valley': { lat: 32.8214, lng: -116.5286 },
  potrero: { lat: 32.6037, lng: -116.6125 },
  ranchita: { lat: 33.2106, lng: -116.5203 },
  'rancho santa fe': { lat: 33.0203, lng: -117.2028 },
  'santa ysabel': { lat: 33.1092, lng: -116.6722 },
  'quail springs': { lat: 33.105, lng: -116.705 },
  'quail spring': { lat: 33.105, lng: -116.705 },
  'mesa grande': { lat: 33.12, lng: -116.7 },
  tecate: { lat: 32.5773, lng: -116.6286 },
  'warner springs': { lat: 33.2767, lng: -116.6331 },
  wynola: { lat: 33.0973, lng: -116.6503 },
  'palomar mountain': { lat: 33.3139, lng: -116.8447 },
  palomar: { lat: 33.3139, lng: -116.8447 },
  coronado: { lat: 32.6859, lng: -117.1831 },
  'national city': { lat: 32.6781, lng: -117.0992 },
  'chula vista': { lat: 32.6401, lng: -117.0842 },
  'spring valley': { lat: 32.7448, lng: -116.9989 },
  'lemon grove': { lat: 32.7426, lng: -117.0314 },
  'del mar': { lat: 32.9595, lng: -117.2653 },
  'solana beach': { lat: 32.9912, lng: -117.2711 },
  'rancho bernardo': { lat: 33.0192, lng: -117.0712 },
  pala: { lat: 33.3653, lng: -117.0753 },
  rainbow: { lat: 33.4106, lng: -117.1489 },
  cuyamaca: { lat: 32.95, lng: -116.57 },
  'ocotillo wells': { lat: 33.145, lng: -116.132 },
  'shelter valley': { lat: 33.09, lng: -116.4 },
  'la jolla': { lat: 32.8328, lng: -117.2713 },
  'mira mesa': { lat: 32.9156, lng: -117.1439 },
  'scripps ranch': { lat: 32.9028, lng: -117.0992 },
  'rancho penasquitos': { lat: 32.9595, lng: -117.1153 },
  'imperial beach': { lat: 32.5839, lng: -117.1131 },
  bonita: { lat: 32.6578, lng: -117.0303 },
  temecula: { lat: 33.4936, lng: -117.1484 },
  murrieta: { lat: 33.5539, lng: -117.2139 },
  winchester: { lat: 33.7078, lng: -117.0845 },
  hemet: { lat: 33.7475, lng: -116.9719 },
  'san jacinto': { lat: 33.7839, lng: -116.9586 },
  anza: { lat: 33.555, lng: -116.6739 },
  aguanga: { lat: 33.4428, lng: -116.8647 },
  idyllwild: { lat: 33.7406, lng: -116.7164 },
  'pine cove': { lat: 33.755, lng: -116.745 },
  'palm desert': { lat: 33.7222, lng: -116.3745 },
  'palm springs': { lat: 33.8303, lng: -116.5453 },
  riverside: { lat: 33.9806, lng: -117.3755 },
  corona: { lat: 33.8753, lng: -117.5664 },
  perris: { lat: 33.7825, lng: -117.2286 },
  menifee: { lat: 33.6971, lng: -117.1853 },
  'lake elsinore': { lat: 33.6681, lng: -117.3273 },
  wildomar: { lat: 33.5989, lng: -117.28 },
  'garner valley': { lat: 33.6167, lng: -116.6167 },
  'mountain center': { lat: 33.7042, lng: -116.7256 },
  sage: { lat: 33.5906, lng: -116.9256 },
  banning: { lat: 33.9256, lng: -116.8764 },
  beaumont: { lat: 33.9295, lng: -116.9772 },
  indio: { lat: 33.7206, lng: -116.2156 },
  'la quinta': { lat: 33.6634, lng: -116.31 },
  coachella: { lat: 33.6803, lng: -116.1739 },
  'desert hot springs': { lat: 33.9611, lng: -116.5017 },
  'cathedral city': { lat: 33.7806, lng: -116.4668 },
  'rancho mirage': { lat: 33.7397, lng: -116.4128 },
  'indian wells': { lat: 33.7178, lng: -116.3406 },
  thermal: { lat: 33.6403, lng: -116.1392 },
  mecca: { lat: 33.5717, lng: -116.0767 },
  nuevo: { lat: 33.8014, lng: -117.1456 },
  'french valley': { lat: 33.6, lng: -117.1 },
  'sun city': { lat: 33.7086, lng: -117.1967 },
  'valle vista': { lat: 33.7478, lng: -116.8892 },
  'east hemet': { lat: 33.7392, lng: -116.9428 },
  'de luz': { lat: 33.435, lng: -117.3236 },
  blythe: { lat: 33.6178, lng: -114.5883 },
  'desert center': { lat: 33.712, lng: -115.4 },
  'moreno valley': { lat: 33.9425, lng: -117.2297 },
  norco: { lat: 33.9311, lng: -117.5487 },
  eastvale: { lat: 33.9525, lng: -117.5642 },
  calimesa: { lat: 33.9886, lng: -117.0617 },
  'cherry valley': { lat: 33.9756, lng: -116.9692 },
  cabazon: { lat: 33.9175, lng: -116.7872 },
  homeland: { lat: 33.7417, lng: -117.1125 },
  'canyon lake': { lat: 33.685, lng: -117.2728 },
  lakeview: { lat: 33.836, lng: -117.123 },
  romoland: { lat: 33.745, lng: -117.175 },
  'quail valley': { lat: 33.7064, lng: -117.2364 },
  'thousand palms': { lat: 33.82, lng: -116.39 },
  victorville: { lat: 34.5361, lng: -117.2928 },
  'apple valley': { lat: 34.5008, lng: -117.1859 },
  hesperia: { lat: 34.4264, lng: -117.3009 },
  'lake arrowhead': { lat: 34.2483, lng: -117.1892 },
  'big bear': { lat: 34.2439, lng: -116.9114 },
  'big bear lake': { lat: 34.2439, lng: -116.9114 },
  yucaipa: { lat: 34.0336, lng: -117.0431 },
  'yucca valley': { lat: 34.1142, lng: -116.4322 },
  'joshua tree': { lat: 34.1347, lng: -116.3131 },
  'twentynine palms': { lat: 34.1356, lng: -116.0542 },
  'twenty nine palms': { lat: 34.1356, lng: -116.0542 },
  'lucerne valley': { lat: 34.4439, lng: -116.9314 },
  phelan: { lat: 34.4264, lng: -117.5481 },
  wrightwood: { lat: 34.3608, lng: -117.6337 },
  'running springs': { lat: 34.2078, lng: -117.1098 },
  crestline: { lat: 34.242, lng: -117.2856 },
  'cedar glen': { lat: 34.2531, lng: -117.1714 },
  rimforest: { lat: 34.2339, lng: -117.2264 },
  'san bernardino': { lat: 34.1083, lng: -117.2898 },
  redlands: { lat: 34.0556, lng: -117.1825 },
  highland: { lat: 34.1283, lng: -117.2087 },
  'loma linda': { lat: 34.0483, lng: -117.2611 },
  fontana: { lat: 34.0922, lng: -117.435 },
  rialto: { lat: 34.1064, lng: -117.3703 },
  ontario: { lat: 34.0633, lng: -117.6509 },
  'rancho cucamonga': { lat: 34.1064, lng: -117.5931 },
  upland: { lat: 34.0975, lng: -117.6484 },
  'oak hills': { lat: 34.3911, lng: -117.4031 },
  'pinon hills': { lat: 34.4333, lng: -117.6506 },
  pioneertown: { lat: 34.1572, lng: -116.4964 },
  'morongo valley': { lat: 34.0469, lng: -116.5756 },
  landers: { lat: 34.27, lng: -116.39 },
  barstow: { lat: 34.8958, lng: -117.0173 },
  needles: { lat: 34.8481, lng: -114.6141 },
  baker: { lat: 35.2652, lng: -116.0745 },
  yermo: { lat: 34.905, lng: -116.821 },
  helendale: { lat: 34.743, lng: -117.324 },
  hinkley: { lat: 34.93, lng: -117.19 },
  trona: { lat: 35.76, lng: -117.37 },
  'fort irwin': { lat: 35.262, lng: -116.684 },
  chino: { lat: 34.0122, lng: -117.6889 },
  'chino hills': { lat: 33.9898, lng: -117.7326 },
  'grand terrace': { lat: 34.0339, lng: -117.3137 },
  bloomington: { lat: 34.0703, lng: -117.3959 },
  colton: { lat: 34.0739, lng: -117.3137 },
  adelanto: { lat: 34.5828, lng: -117.4092 },
};

export function placeDrivePoint(name: string | null | undefined): { lat: number; lng: number } | null {
  const key = normalizeDrivePlace(name);
  if (!key) return null;
  if (PLACE_DRIVE_POINTS[key]) return PLACE_DRIVE_POINTS[key];
  let bestKey = '';
  let best: { lat: number; lng: number } | null = null;
  for (const [place, point] of Object.entries(PLACE_DRIVE_POINTS)) {
    if (!placeContained(key, place)) continue;
    if (place.length > bestKey.length) {
      bestKey = place;
      best = point;
    }
  }
  return best;
}

export function driveSurchargeForPlace(name: string | null | undefined): DriveSurcharge | null {
  const point = placeDrivePoint(name);
  if (!point) return null;
  return nearerShopDrive(point);
}
