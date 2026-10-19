/**
 * Test calls into Mike from our own test lines (TEST_CALLERS: 760-823-7963, 877-386-3995).
 * Read-only tools (lookupCustomer, checkSchedule, checkServiceArea, getBusinessHours, getServiceInfo)
 * run for real so the flow is realistic. Anything with a side effect is simulated: no Jobber
 * client/job/visit, no booking_requests row, no office email or fallback page, no pay link.
 * A real callback bridge (mike_callback_attempts match) is never treated as a test call.
 */
import { TEST_CALLERS } from '../phone-calls/config.ts';
import { CALLBACK_SPOKEN_MESSAGE, EMERGENCY_SPOKEN_MESSAGE } from './office-callback.ts';

const d10 = (p: unknown): string => {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
};
const TEST_SET = new Set(TEST_CALLERS.map(d10));

export function isReceptionistTestCaller(phone: unknown): boolean {
  const d = d10(phone);
  return d.length === 10 && TEST_SET.has(d);
}

const BOOK_TOOLS = new Set(['book_job', 'bookJob', 'bookServiceCall']);
const BLOCKED_TOOLS = new Set(['sendPayLink', 'sendPayEmail']);

/** Simulated result for a side-effect tool on a test call; null = run the real (read-only) tool. */
export function testToolResult(name: string, params: Record<string, unknown> = {}): { result: unknown } | null {
  if (name === 'createCallback') return { result: { success: true, testMode: true, message: CALLBACK_SPOKEN_MESSAGE } };
  if (name === 'flagEmergency') return { result: { success: true, testMode: true, message: EMERGENCY_SPOKEN_MESSAGE } };
  if (BOOK_TOOLS.has(name)) {
    const startAt = typeof params.startAt === 'string' ? params.startAt : typeof params.slotId === 'string' ? params.slotId : '';
    return {
      result: {
        booked: true,
        canConfirm: true,
        mayBook: true,
        lookupStatus: 'ok',
        testMode: true,
        weekendEmergency: false,
        visit: { startAt },
        message: "You're scheduled for the service call you picked.",
        confirmationRule: 'You may confirm only the slot the caller picked from checkSchedule (same day, window and technician).',
      },
    };
  }
  if (BLOCKED_TOOLS.has(name)) return { result: { success: false, testMode: true, message: 'Not available on this call.' } };
  return null;
}
