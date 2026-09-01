/**
 * Live miss: Jobber job 3266 — Gonzalo Villagrando / Doug Pollack.
 * First tech-note draft wrongly defaulted to a $600 BT2 pull.
 * Correct unsent draft (later sent as #4247) is a tank swap, not a pull.
 */
export const VILLAGRANDO_JOB_NUMBER = 3266;
export const VILLAGRANDO_CLIENT_NAME = 'Gonzalo Villagrando';
export const VILLAGRANDO_SITE_NAME = 'Doug Pollack';
export const VILLAGRANDO_PINHOLE_NOTES =
  '2hp 230 volt single phase 11.7 amps pressure tank has a pinhole in it needs a new pressure tank';

export const VILLAGRANDO_CORRECT_QUOTE = {
  quoteNumberSent: 4247,
  tankName: '86-gal Promax PM260',
  tankPrice: 1370,
  plumbingPrice: 125,
  laborPrice: 200,
  hoist: false,
  newPump: false,
  pullAndEval: false,
} as const;
