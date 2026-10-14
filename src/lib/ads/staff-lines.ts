/**
 * Staff Google Voice lines used to attribute outbound calls.
 * Configurable because at least one person dials from a phone the Voice audit log does not record.
 *
 * VOICE_STAFF_LINES="Name:email:phone, ..."
 * Phone may be blank. When the variable is set it replaces the defaults.
 * Example: Liz:lizbeth@scwellservice.com:+16193208264,Shanicey:shanicey@scwellservice.com:+14422272898,Brighton:brighton@scwellservice.com:
 */
import { digits10 } from './call-dashboard.ts';

export interface StaffLine {
  name: string;
  email: string | null;
  /** 10-digit Voice number. Null when that person has no logged line. */
  phone: string | null;
}

/**
 * Numbers seen as the user-leg destination in the Voice audit log.
 * Liz's line (619-320-8264) only shows about 3 outbound calls in 7 days, so she
 * likely calls from a phone that is not in this log. Her callbacks stay missing
 * until that phone is a logged Voice or Twilio line and is added here.
 */
export const DEFAULT_STAFF_LINES: StaffLine[] = [
  { name: 'Liz', email: 'lizbeth@scwellservice.com', phone: '6193208264' },
  { name: 'Shanicey', email: 'shanicey@scwellservice.com', phone: '4422272898' },
  { name: 'Brighton', email: 'brighton@scwellservice.com', phone: null },
];

function cleanPhone(raw: string | null | undefined): string | null {
  const d = digits10(raw ?? '');
  return d;
}

/** Parse VOICE_STAFF_LINES. Empty or invalid input falls back to the defaults. */
export function staffLines(env: NodeJS.ProcessEnv = process.env): StaffLine[] {
  const raw = env.VOICE_STAFF_LINES?.trim();
  if (!raw) return DEFAULT_STAFF_LINES;
  const lines: StaffLine[] = [];
  for (const part of raw.split(',')) {
    const bits = part.split(':').map((s) => s.trim());
    const name = bits[0];
    if (!name) continue;
    let email: string | null = null;
    let phone: string | null = null;
    if (bits.length >= 3) {
      email = bits[1].includes('@') ? bits[1] : null;
      phone = cleanPhone(bits.slice(email ? 2 : 1).join(''));
    } else if (bits.length === 2) {
      if (bits[1].includes('@')) email = bits[1];
      else phone = cleanPhone(bits[1]);
    }
    lines.push({ name, email, phone });
  }
  return lines.length ? lines : DEFAULT_STAFF_LINES;
}

/** Display name for an outbound actor email or source number. */
export function staffLabel(
  email: string | null | undefined,
  phone: string | null | undefined,
  lines: StaffLine[] = staffLines(),
): string | null {
  const d = cleanPhone(phone);
  const local = (email ?? '').split('@')[0].toLowerCase();
  const byPhone = d ? lines.find((l) => l.phone === d) : undefined;
  if (byPhone) return byPhone.name;
  const byEmail = local
    ? lines.find((l) => (l.email ?? '').split('@')[0].toLowerCase() === local)
    : undefined;
  if (byEmail) return byEmail.name;
  if (local && local !== 'system') return local.charAt(0).toUpperCase() + local.slice(1);
  return null;
}
