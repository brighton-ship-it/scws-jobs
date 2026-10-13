/** Inbound call recording pipeline config. Inactive until a Twilio number's voice URL points at /api/calls/inbound. */
export const SHOP_NUMBER = '+17604408520';
export const RECORDING_NOTICE = 'This call may be recorded for quality and training purposes.';
export const TRACKING_SOURCES: Record<string, string> = {
  '+17604630493': 'seo',
  '+17603312502': 'google_ads',
  '+17602791262': 'gbp_ramona',
  '+19516510957': 'gbp_anza',
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

/** Ported Google Voice lines (main + Ransom). Each forwards to a NEW Google Voice number set by env. Inactive until ported. */
export const PORTED_LINES: Record<string, { number: string; source: string; label: string; forwardEnv: string }> = {
  main: { number: '+17604408520', source: 'main_line', label: 'Main', forwardEnv: 'PHONE_CALL_FORWARD_MAIN' },
  ransom: { number: '+17607895955', source: 'ransom_line', label: 'Ransom', forwardEnv: 'PHONE_CALL_FORWARD_RANSOM' },
};
/** Which ported line a call belongs to: by the dialed number (after port) or ?line= (test number). */
export function lineFor(to: string, lineParam?: string | null) {
  const byNum = Object.entries(PORTED_LINES).find(([, l]) => l.number === to)?.[0];
  const key = byNum ?? (lineParam && PORTED_LINES[lineParam] ? lineParam : null);
  return key ? { key, ...PORTED_LINES[key] } : null;
}
export function forwardTargets(line: { forwardEnv: string }, env: NodeJS.ProcessEnv = process.env): string[] {
  return (env[line.forwardEnv] ?? '').split(',').map((s) => s.trim()).filter((x) => /^\+\d{10,15}$/.test(x));
}
