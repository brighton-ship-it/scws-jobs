/** Inbound call recording pipeline config. Inactive until a Twilio number's voice URL points at /api/calls/inbound. */
export const SHOP_NUMBER = '+17604408520';
export const RECORDING_NOTICE = 'This call may be recorded for quality and training purposes.';
export const TRACKING_SOURCES: Record<string, string> = {
  '+17604630493': 'seo',
  '+17603312502': 'google_ads',
  '+17602791262': 'gmb',
  '+17604937719': 'direct',
};
export function shopNumbers(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PHONE_CALL_SHOP_NUMBERS?.trim();
  const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [SHOP_NUMBER];
  return list.length ? list : [SHOP_NUMBER];
}
/** Absolute URL Twilio called (needed for signature validation behind the Vercel proxy). */
export function publicUrl(req: { url: string; headers: { get(n: string): string | null } }): string {
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return `${proto}://${host}${u.pathname}${u.search}`;
}
