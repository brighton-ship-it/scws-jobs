/** Inbound call recording pipeline config. Inactive until a Twilio number's voice URL points at /api/calls/inbound. */
export const SHOP_NUMBER = '+17604408520';
export const RECORDING_NOTICE = 'This call may be recorded for quality and training purposes.';
export const TRACKING_SOURCES: Record<string, string> = {
  '+17604630493': 'seo',
  '+17608914264': 'yelp',
  '+17604540365': 'apple_maps',
  '+17603312502': 'google_ads',
  '+17608250520': 'google_ads_drilling', // Leads-Search-Drilling call asset + site swap
  '+17608256285': 'google_ads_weekend', // Weekend-Emergency-Search call asset + site swap
  '+17602791262': 'gbp_ramona',
  '+19516510957': 'gbp_anza',
  '+17604937719': 'direct',
  '+17608238910': 'direct_mail',
  '+18773863995': 'toll_free',
  '+17608237963': 'line_7963',
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

/** Our own Twilio numbers: calls FROM these are test traffic (never real customers). Excluded from dashboards + Jobber. */
export const TEST_CALLERS = ['+17608237963', '+18773863995'];
export const isTestCall = (from: string | null | undefined, testParam?: string | null) => testParam === '1' || TEST_CALLERS.includes(from ?? '');

/** AI receptionist (Vapi "SCWS Receptionist", +1 760-491-5348). Calls the shop leg doesn't answer roll here when the
 * voice URL carries ?ai=1 (or PHONE_CALL_AI_FALLBACK=1). Override the number with PHONE_CALL_AI_NUMBER. */
export const AI_RECEPTIONIST = '+17604915348';
export function aiFallbackNumber(q: URLSearchParams, env: NodeJS.ProcessEnv = process.env): string | null {
  const on = q.get('ai') === '1' || env.PHONE_CALL_AI_FALLBACK === '1';
  if (!on) return null;
  const n = (env.PHONE_CALL_AI_NUMBER || AI_RECEPTIONIST).trim();
  return /^\+\d{10,15}$/.test(n) ? n : null;
}

/** Office hours for the Twilio lines. Outside them, calls skip the ring group and go straight to Mike.
 * Defaults: Mon-Fri 07:00-17:00 America/Los_Angeles (DST handled by Intl). Holidays are normal days.
 * Env overrides: PHONE_CALL_HOURS_DAYS ("1-5" or "1,2,3,4,5"; 0=Sun..6=Sat), PHONE_CALL_HOURS_OPEN ("07:00"),
 * PHONE_CALL_HOURS_CLOSE ("17:00", exclusive), PHONE_CALL_HOURS_TZ, PHONE_CALL_AFTER_HOURS_AI ("0" turns it off). */
export type BusinessHours = { days: number[]; openMin: number; closeMin: number; tz: string; enabled: boolean };
const hm = (v: string | undefined, d: number) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? '').trim());
  if (!m) return d;
  const n = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return n >= 0 && n <= 24 * 60 ? n : d;
};
function parseDays(v: string | undefined): number[] {
  const raw = (v ?? '').trim();
  if (!raw) return [1, 2, 3, 4, 5];
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const r = /^(\d)\s*-\s*(\d)$/.exec(part.trim());
    if (r) { for (let i = +r[1]; i <= +r[2]; i++) if (i >= 0 && i <= 6) out.add(i); }
    else if (/^\d$/.test(part.trim()) && +part.trim() <= 6) out.add(+part.trim());
  }
  return out.size ? Array.from(out).sort() : [1, 2, 3, 4, 5];
}
export function businessHours(env: NodeJS.ProcessEnv = process.env): BusinessHours {
  let tz = env.PHONE_CALL_HOURS_TZ?.trim() || 'America/Los_Angeles';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'America/Los_Angeles'; }
  return {
    days: parseDays(env.PHONE_CALL_HOURS_DAYS),
    openMin: hm(env.PHONE_CALL_HOURS_OPEN, 7 * 60),
    closeMin: hm(env.PHONE_CALL_HOURS_CLOSE, 17 * 60),
    tz,
    enabled: env.PHONE_CALL_AFTER_HOURS_AI?.trim() !== '0',
  };
}
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Wall-clock day/minute in the office time zone (DST-safe via Intl). */
export function localDayMinute(now: Date, tz: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: DOW[get('weekday')] ?? 0, minute: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10) };
}
export function isOfficeHours(now: Date, h: BusinessHours = businessHours()): boolean {
  const { day, minute } = localDayMinute(now, h.tz);
  return h.days.includes(day) && minute >= h.openMin && minute < h.closeMin;
}
/** Skip the ring group and go straight to Mike? Only when the AI fallback is on for this number and it's after hours. */
export function directToAi(now: Date, aiNumber: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const h = businessHours(env);
  return !!aiNumber && h.enabled && !isOfficeHours(now, h);
}
