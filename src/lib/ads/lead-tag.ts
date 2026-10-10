/**
 * What to write on customers when this submission is a Google Ads touch.
 * Fills empty click ids and campaign/keyword. Upgrades an empty, phone, or
 * website_form lead_source to google_ads. Leaves referral, organic, and
 * repeat tags alone.
 */

import type { AdsClickIds } from './click-ids.ts';
import type { BookingUtms } from '../booking-source.ts';

const UPGRADABLE = new Set(['', 'website_form', 'website', 'phone']);

export interface CustomerAdsState {
  lead_source?: string | null;
  lead_source_detail?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  ga_client_id?: string | null;
  ga_session_id?: string | null;
}

export function customerAdsPatch(
  current: CustomerAdsState | null | undefined,
  incoming: {
    lead_source: 'google_ads' | null;
    campaign: string | null;
    keyword: string | null;
    utms: BookingUtms;
    clickIds: AdsClickIds;
  }
): Record<string, string> {
  if (incoming.lead_source !== 'google_ads') return {};

  const row = current ?? {};
  const patch: Record<string, string> = {};
  const currentSource = (row.lead_source ?? '').trim().toLowerCase();
  if (!currentSource || UPGRADABLE.has(currentSource)) {
    patch.lead_source = 'google_ads';
  }

  const fill = (column: keyof CustomerAdsState, value: string | null | undefined) => {
    if (!value?.trim()) return;
    if (row[column]?.toString().trim()) return;
    patch[column] = value.trim();
  };

  fill('utm_source', incoming.utms.utm_source);
  fill('utm_medium', incoming.utms.utm_medium);
  fill('utm_campaign', incoming.campaign || incoming.utms.utm_campaign);
  fill('utm_term', incoming.keyword || incoming.utms.utm_term);
  fill('utm_content', incoming.utms.utm_content);
  fill('gclid', incoming.clickIds.gclid);
  fill('gbraid', incoming.clickIds.gbraid);
  fill('wbraid', incoming.clickIds.wbraid);
  fill('ga_client_id', incoming.clickIds.ga_client_id);
  fill('ga_session_id', incoming.clickIds.ga_session_id);

  if (!row.lead_source_detail?.trim() && (incoming.campaign || incoming.keyword)) {
    const bits = [
      incoming.campaign ? `campaign=${incoming.campaign}` : null,
      incoming.keyword ? `keyword=${incoming.keyword}` : null,
    ].filter(Boolean);
    if (bits.length) patch.lead_source_detail = bits.join('; ');
  }

  return patch;
}
