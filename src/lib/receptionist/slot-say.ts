/**
 * One spoken label per open slot: weekday and calendar date, plus the window.
 * Mike reads this verbatim. "Tomorrow" and a guessed weekday are how a Wednesday
 * 10–12 slot was offered as Tuesday (Clay Spiegel, Nov 9 2026).
 */

export const SLOT_SAY_INSTRUCTION =
  'Say each slot\'s say label verbatim. It already includes the weekday and the calendar date. Do not say today, tomorrow, or a different weekday than that label. If the caller asked for a day that is not listed, say that day is not open and read the earliest say label.';

export function slotSayLabel(date: string, time: string): string {
  const day = date.trim();
  const when = time.trim();
  if (day && when) return `${day}, ${when}`;
  return day || when;
}

export function appendSlotOffer(message: string, slots: Array<{ say?: string }>): string {
  const labels = slots.map((slot) => (slot.say || '').trim()).filter(Boolean);
  if (!labels.length) return message;
  return `${message} ${SLOT_SAY_INSTRUCTION} Labels: ${labels.join(' | ')}.`;
}
