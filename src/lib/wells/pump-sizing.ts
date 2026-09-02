/**
 * Office pump-sizing math. Hydraulic HP + common Franklin/CentriPro sizes.
 * Do not invent manufacturer model numbers from these outputs.
 */

export const COMMON_MOTOR_HP = [0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10] as const;
export const ALLOWED_MOTOR_BRANDS = ['Franklin', 'CentriPro'] as const;
export type AllowedMotorBrand = (typeof ALLOWED_MOTOR_BRANDS)[number];

const TANK_SIZES = [20, 32, 44, 62, 86, 119] as const;

/** PSI to feet of head. */
export function pressureHeadFt(psi: number): number {
  return psi * 2.31;
}

/** Rough PVC friction (ft / 100 ft) at 10 GPM, then scaled linearly with GPM. */
export function frictionLossPer100Ft(diameterIn: number): number {
  if (diameterIn <= 1) return 5.2;
  if (diameterIn <= 1.25) return 2.1;
  if (diameterIn <= 1.5) return 1.0;
  return 0.5;
}

export function frictionLossFt(pipeLengthFt: number, diameterIn: number, gpm: number): number {
  const per100 = frictionLossPer100Ft(diameterIn);
  return (pipeLengthFt / 100) * per100 * (gpm / 10);
}

export function calculateTotalDynamicHead(input: {
  pumpingLevelFt: number;
  pressurePsi: number;
  frictionLossFt: number;
  elevationChangeFt: number;
}): number {
  return (
    input.pumpingLevelFt +
    pressureHeadFt(input.pressurePsi) +
    input.frictionLossFt +
    input.elevationChangeFt
  );
}

/** Water HP at 60% overall efficiency. */
export function calculateRequiredHP(gpm: number, tdhFt: number, efficiency = 0.6): number {
  if (gpm <= 0 || tdhFt <= 0) return 0;
  return (gpm * tdhFt) / (3960 * efficiency);
}

export function nextCommonHp(requiredHp: number): number {
  const found = COMMON_MOTOR_HP.find((hp) => hp >= requiredHp);
  return found ?? COMMON_MOTOR_HP[COMMON_MOTOR_HP.length - 1];
}

/** Starting 230V 1-phase copper size. Confirm voltage drop on the curve. */
export function recommendedWireSize(hp: number, oneWayFt: number): string {
  if (hp <= 0.5) return oneWayFt > 300 ? '12 AWG' : '14 AWG';
  if (hp <= 1) return oneWayFt > 200 ? '10 AWG' : '12 AWG';
  if (hp <= 2) return oneWayFt > 150 ? '8 AWG' : '10 AWG';
  if (hp <= 3) return oneWayFt > 100 ? '6 AWG' : '8 AWG';
  if (hp <= 5) return oneWayFt > 100 ? '4 AWG' : '6 AWG';
  return oneWayFt > 100 ? '2 AWG' : '4 AWG';
}

/** ~1 minute drawdown at 25% (40/60). */
export function pressureTankSize(gpm: number): { gallons: number; drawdown: number } {
  const minDrawdown = Math.max(gpm, 0);
  const tankGallons = minDrawdown / 0.25;
  const recommended = TANK_SIZES.find((size) => size >= tankGallons) ?? TANK_SIZES[TANK_SIZES.length - 1];
  return { gallons: recommended, drawdown: Math.round(recommended * 0.25) };
}

export function pumpSettingFt(wellDepthFt: number | null, pumpingLevelFt: number): number | null {
  if (wellDepthFt == null || wellDepthFt <= 0) return null;
  return Math.min(wellDepthFt - 20, pumpingLevelFt + 50);
}

export function assertAllowedMotorBrand(brand: string): AllowedMotorBrand {
  const n = brand.trim().toLowerCase();
  if (n === 'franklin') return 'Franklin';
  if (n === 'centripro' || n === 'centri-pro' || n === 'centri pro') return 'CentriPro';
  throw new Error('Only Franklin or CentriPro motors are allowed');
}

export type PumpSizingInput = {
  wellDepthFt: number | null;
  staticLevelFt: number;
  drawdownFt: number;
  gpm: number;
  pressurePsi: number;
  pipeLengthFt: number;
  pipeDiameterIn: number;
  elevationChangeFt: number;
  motorBrand: AllowedMotorBrand;
};

export type PumpSizingResult = {
  pumpingLevelFt: number;
  pressureHeadFt: number;
  frictionLossFt: number;
  elevationChangeFt: number;
  tdhFt: number;
  requiredHp: number;
  recommendedHp: number;
  wireSize: string;
  tankGallons: number;
  tankDrawdown: number;
  pumpSettingFt: number | null;
  motorBrand: AllowedMotorBrand;
  notes: string[];
};

export function sizePump(input: PumpSizingInput): PumpSizingResult {
  if (!(input.staticLevelFt >= 0) || !Number.isFinite(input.staticLevelFt)) {
    throw new Error('Static water level is required');
  }
  if (!(input.gpm > 0) || !Number.isFinite(input.gpm)) {
    throw new Error('Desired flow (GPM) is required');
  }
  const brand = assertAllowedMotorBrand(input.motorBrand);
  const pumpingLevelFt = input.staticLevelFt + (input.drawdownFt || 0);
  const friction = frictionLossFt(input.pipeLengthFt || 0, input.pipeDiameterIn, input.gpm);
  const tdhFt = calculateTotalDynamicHead({
    pumpingLevelFt,
    pressurePsi: input.pressurePsi,
    frictionLossFt: friction,
    elevationChangeFt: input.elevationChangeFt || 0,
  });
  const requiredHp = calculateRequiredHP(input.gpm, tdhFt);
  const recommendedHp = nextCommonHp(requiredHp);
  const oneWayFt = (input.pipeLengthFt || 0) + pumpingLevelFt;
  const tank = pressureTankSize(input.gpm);
  return {
    pumpingLevelFt,
    pressureHeadFt: pressureHeadFt(input.pressurePsi),
    frictionLossFt: friction,
    elevationChangeFt: input.elevationChangeFt || 0,
    tdhFt,
    requiredHp,
    recommendedHp,
    wireSize: recommendedWireSize(recommendedHp, oneWayFt),
    tankGallons: tank.gallons,
    tankDrawdown: tank.drawdown,
    pumpSettingFt: pumpSettingFt(input.wellDepthFt, pumpingLevelFt),
    motorBrand: brand,
    notes: [
      'Hydraulic HP at 60% efficiency — confirm against Franklin or CentriPro curves.',
      'Sold book is CentriPro / Goulds CP. Use Franklin only when the job calls for Franklin/FE.',
      'Do not pick a catalog model number from this screen.',
      'Wire size is a 230V single-phase starting point. Confirm voltage drop.',
    ],
  };
}
