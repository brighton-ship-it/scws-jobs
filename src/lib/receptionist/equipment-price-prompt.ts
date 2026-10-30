/**
 * Inbound Mike (Vapi assistant "SCWS Receptionist"): equipment-only sale prices.
 *
 * Source of truth for the pricing sentences pasted into that system prompt.
 * applyEquipmentSalePriceRule edits only those sentences. It does not touch
 * the greeting, voice, routing, after-hours booking, or the callback assistant.
 * Callbacks stay off (MIKE_CALLBACKS_ENABLED). This file does not call Vapi.
 */

export const EQUIPMENT_SALE_PRICE_HEADING = '## Equipment sale price (HARD RULE)';

export const MIKE_EQUIPMENT_SALE_PRICE = `## Equipment sale price (HARD RULE)
This overrides PRICE FIRST, DIAGNOSTIC VISIT PITCH, PRICE OBJECTION, the "no ballpark" list, and the "never invent prices" line when the caller wants to buy equipment.

When a caller asks the price of a pump, booster, tank, motor, filter, control, or other equipment they want to buy (direct sale, pickup, or shipping), give an equipment-only ballpark in that same turn. Do not require a service call first. Do not open with the two hundred dollar visit. Do not say you cannot give a number and then pitch a diagnostic.

- Say it is the equipment only, for pickup or shipping, not installed.
- Use a catalog street price or a known range already in this prompt or in a tool result. If getServiceInfo only says a technician will call back, ignore that and still give the equipment ballpark you have. Do not invent a precise model price you do not have.
- One known catalog street price, not a price for every unit: a half-horsepower single-phase Goulds J5S booster is about thirteen hundred twenty-nine dollars street. Use that when they ask for that model, or for a half-horse booster and they do not name a different model. Do not use thirteen twenty-nine for a different horsepower, a different brand, a tank, or any other piece of equipment.
- If the exact model is not one you know, give an honest ballpark range for that kind of equipment when you have one, and say the office can confirm the exact price. If you have no range, say you don't have that exact model in front of you and the office will confirm the price. Still do not make them book a service call to hear a number.
- The ranges under The $200 service call (pump repair, pump replacement, pressure tank, water testing, well rehabilitation, new well) are installed or service ranges. Do not quote those as the price of a unit they want to buy.
- Offer a paid visit only if they want someone on site to diagnose a problem, help size the equipment, or install it. Then say the standing rates: a one-man service call is two hundred dollars for the first hour, then two hundred an hour; a two-man crew is three hundred an hour. Do not offer that visit before they ask for diagnosis, sizing, or install.
- Do not call book_job for a pure equipment-price question. If they want the office to confirm the model or arrange pickup or shipping, call createCallback once with reason starting "Equipment price:" plus what they asked for.`;

const INSERT_BEFORE = '## NEVER GO SILENT (hard rule)';

const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  [
    'Say the two hundred dollar fee once per call, when you offer the slot, and never repeat it unless the caller asks.',
    'Say the two hundred dollar fee once per call, when you offer a service slot, and never repeat it unless the caller asks. If they are only asking the price of equipment they want to buy, do not say the fee (see Equipment sale price).',
  ],
  [
    'PRICE FIRST: if the caller\'s first question is the price, answer briefly in one sentence, then go straight to the problem: "It\'s a two hundred dollar service call, and that covers the first hour. What\'s going on with it?" Say it exactly that short; don\'t add "that\'s the service-call fee" or list other rates unless they ask.',
    'PRICE FIRST: if the caller\'s first question is the price of a service visit or a repair, answer briefly in one sentence, then go straight to the problem: "It\'s a two hundred dollar service call, and that covers the first hour. What\'s going on with it?" Say it exactly that short; don\'t add "that\'s the service-call fee" or list other rates unless they ask. If they ask the price of a pump, booster, tank, or other equipment they want to buy, follow Equipment sale price and do not answer with the service call.',
  ],
  [
    '## PRICE OBJECTION (hard rule)\nIf the caller says the price is too much or hesitates',
    '## PRICE OBJECTION (hard rule)\nThis push is only for the service-call fee. If they hesitate at an equipment ballpark, do not pivot them into a diagnostic visit; offer once to have the office confirm the equipment price.\nIf the caller says the service-call price is too much or hesitates',
  ],
  [
    'asks what a pump or repair would cost, or wants to talk about water test results',
    'asks what a repair would cost, or wants to talk about water test results',
  ],
  [
    'Pure new-well drilling quotes, billing/invoice questions, and sales calls are still callbacks.',
    'Pure new-well drilling quotes, billing/invoice questions, and vendor sales calls are still callbacks. A customer who only wants the price of a pump, booster, tank, or other equipment to buy is not this pitch: follow Equipment sale price, and do not require a diagnostic visit to hear that price.',
  ],
  [
    '- Never invent anything: no appointments, dates, times, technician names, prices, account details, or "I see your appointment." Only say what a tool result actually returned.',
    '- Never invent anything: no appointments, dates, times, technician names, account details, or "I see your appointment." Do not invent an installed repair price. Equipment-only ballparks in Equipment sale price, and the listed ranges under The $200 service call, are allowed. Any other price only if a tool result returned it.',
  ],
  [
    'answer their question (the two hundred dollar service call), and keep going.',
    'answer their question (the two hundred dollar service call, or the equipment ballpark if they asked to buy equipment), and keep going.',
  ],
  [
    'Never mention payment plans or financing. Never give exact quotes.',
    'Never mention payment plans or financing. Never give an exact installed repair quote. An equipment-only ballpark under Equipment sale price is allowed.',
  ],
  [
    'if the caller asks what an inspection (or any non-listed item) costs, don\'t ask extra questions about it; say "The office handles inspection pricing.',
    'if the caller asks what an inspection costs, don\'t ask extra questions about it; say "The office handles inspection pricing.',
  ],
  [
    'Repair or pump-replacement pricing questions and water test result questions DO get the diagnostic visit pitch first (see DIAGNOSTIC VISIT PITCH).',
    'Repair pricing questions and water test result questions DO get the diagnostic visit pitch first (see DIAGNOSTIC VISIT PITCH). A caller who wants to buy a pump, booster, tank, or other equipment is Equipment sale price, not this pitch.',
  ],
  [
    '  - Never invent other numbers. For anything not on this list (Pump Saver, booster pump, filters, water treatment, softeners, tank sizes, parts), give NO number and no ballpark, even if the caller pushes twice: "I don\'t want to guess and give you a wrong number. The office will give you a real quote." Then offer createCallback.',
    '  - Never invent a price that is not a catalog street price, a known range, or an equipment-only ballpark under Equipment sale price. A pump, booster, tank, or other equipment the caller wants to buy follows Equipment sale price: give that ballpark and do not withhold it. For a service that is not on this list and is not an equipment purchase, give no made-up number and offer to have the office confirm.',
  ],
];

export function applyEquipmentSalePriceRule(prompt: string): string {
  let next = prompt;
  for (const [from, to] of REPLACEMENTS) {
    if (next.includes(from)) {
      next = next.replace(from, to);
    } else if (!next.includes(to)) {
      throw new Error(`Mike prompt is missing a pricing line this rule has to change: ${from.slice(0, 90)}`);
    }
  }
  if (!next.includes(EQUIPMENT_SALE_PRICE_HEADING)) {
    if (!next.includes(INSERT_BEFORE)) {
      throw new Error('Mike prompt is missing the NEVER GO SILENT anchor');
    }
    next = next.replace(INSERT_BEFORE, `${MIKE_EQUIPMENT_SALE_PRICE}\n\n${INSERT_BEFORE}`);
  }
  return next;
}
