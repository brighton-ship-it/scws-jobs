import { getCountyByCity } from '../tax-rates.ts';
import { TRAVEL_MIN_HOURS } from './shop-book.ts';

export type ShopKey = 'ramona' | 'anza';
export type MotorBrand = 'Franklin' | 'CentriPro';

export const SHOP_COORDS: Record<ShopKey, { lat: number; lng: number; label: string }> = {
  ramona: { lat: 33.0414, lng: -116.8686, label: 'Ramona shop — 1077 Main St' },
  anza: { lat: 33.555, lng: -116.6739, label: 'Anza shop' },
};

const ANZA_CITIES = new Set([
  'anza',
  'aguanga',
  'garner valley',
  'mountain center',
  'idyllwild',
  'sage',
  'goulds',
]);

export function assignShop(city: string | null | undefined): ShopKey {
  const key = (city || '').trim().toLowerCase();
  if (ANZA_CITIES.has(key) || key.includes('goulds')) {
    return 'anza';
  }
  const county = getCountyByCity(city);
  if (county === 'Riverside') {
    return 'anza';
  }
  return 'ramona';
}

/** Sold book is CentriPro / Goulds CP (165 CP vs 14 Franklin FE). Anza is always CP. */
export function motorBrandForShop(_shop: ShopKey): MotorBrand {
  return 'CentriPro';
}

/** Franklin only when notes name Franklin/FE. Otherwise sold book is CentriPro. */
export function soldMotorBrand(notes: string | null | undefined, shop: ShopKey): MotorBrand {
  if (/\bfranklin\b|\bfranklin\s+electric\b|\bfe[\s-]?\d/i.test(notes || '')) {
    return 'Franklin';
  }
  return motorBrandForShop(shop);
}

export function isAllowedMotorBrand(brand: string | null | undefined): boolean {
  if (!brand) return false;
  const n = brand.trim().toLowerCase();
  return n === 'franklin' || n === 'centripro' || n === 'centri-pro' || n === 'centri pro';
}

export function assertAllowedMotorBrand(brand: string): MotorBrand {
  const n = brand.trim().toLowerCase();
  if (n === 'franklin') return 'Franklin';
  if (n === 'centripro' || n === 'centri-pro' || n === 'centri pro') return 'CentriPro';
  throw new Error('Only Franklin (Ramona) or CentriPro (Anza/Goulds) motors are allowed');
}

/**
 * West Escondido granite / hills are air-rotary country, not mud.
 * This pack always quotes air; the helper is here so mud is never selected.
 */
export function drillMethodForSite(city: string | null | undefined, lng?: number | null): 'air' | 'mud' {
  const name = (city || '').toLowerCase();
  if (name.includes('escondido') && lng != null && lng < -117.05) {
    return 'air';
  }
  return 'air';
}

export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Rural SoCal average used when Distance Matrix is unavailable. */
export const RURAL_DRIVE_MPH = 50;

export function estimateDriveHours(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mph = RURAL_DRIVE_MPH
): number {
  return haversineMiles(from, to) / mph;
}

export function travelDaysForHole(
  shop: ShopKey,
  hole: { lat: number; lng: number } | null | undefined,
  driveHours?: number | null
): number {
  if (!hole && driveHours == null) return 0;
  const hours =
    driveHours ??
    (hole ? estimateDriveHours(SHOP_COORDS[shop], hole) : 0);
  return hours > TRAVEL_MIN_HOURS ? 1 : 0;
}
