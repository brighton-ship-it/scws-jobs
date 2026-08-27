import {
  assertNoForbiddenAdsLabels,
  BOOK_JOB_EVENT_NAME,
  DEFAULT_GA4_MEASUREMENT_ID,
  type BookJobMeasurementPayload,
} from './book-job';

const MP_COLLECT_URL = 'https://www.google-analytics.com/mp/collect';

export function getGa4MeasurementId(): string {
  return process.env.GA4_MEASUREMENT_ID?.trim() || DEFAULT_GA4_MEASUREMENT_ID;
}

export function getGa4MpApiSecret(): string | null {
  const secret = process.env.GA4_MP_API_SECRET?.trim();
  return secret || null;
}

export async function sendBookJobEvent(
  payload: BookJobMeasurementPayload,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status: number; skipped?: 'missing_secret' }> {
  assertNoForbiddenAdsLabels(payload);

  const apiSecret = getGa4MpApiSecret();
  if (!apiSecret) {
    console.warn('[book_job] GA4_MP_API_SECRET is not set; skipping Measurement Protocol send');
    return { ok: false, status: 0, skipped: 'missing_secret' };
  }

  const measurementId = getGa4MeasurementId();
  const url = `${MP_COLLECT_URL}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.error('[book_job] Measurement Protocol rejected event', {
      status: response.status,
      event: BOOK_JOB_EVENT_NAME,
      measurement_id: measurementId,
    });
  }

  return { ok: response.ok, status: response.status };
}
