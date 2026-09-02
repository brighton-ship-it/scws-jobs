import type { County } from '../types.ts';
import { riversideAdapter } from './riverside.ts';
import { sanBernardinoAdapter } from './san-bernardino.ts';
import { sanDiegoAdapter } from './san-diego.ts';
import type { CountyAdapter } from './types.ts';

export type { CountyAdapter, ParcelQuery } from './types.ts';

const ADAPTERS: Record<County, CountyAdapter> = {
  san_diego: sanDiegoAdapter,
  riverside: riversideAdapter,
  san_bernardino: sanBernardinoAdapter,
};

export function getCountyAdapter(county: County): CountyAdapter {
  return ADAPTERS[county];
}

export const SUPPORTED_COUNTIES: County[] = ['san_diego', 'riverside', 'san_bernardino'];
