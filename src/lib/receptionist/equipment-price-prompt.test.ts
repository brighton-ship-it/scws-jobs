import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MIKE_EQUIPMENT_SALE_PRICE,
  applyEquipmentSalePriceRule,
} from './equipment-price-prompt.ts';

const BEFORE = `ONE QUESTION PER TURN (hard rule): every turn ends with exactly one question. Keep each turn to two short sentences, about ten seconds. Say the two hundred dollar fee once per call, when you offer the slot, and never repeat it unless the caller asks.
PRICE FIRST: if the caller's first question is the price, answer briefly in one sentence, then go straight to the problem: "It's a two hundred dollar service call, and that covers the first hour. What's going on with it?" Say it exactly that short; don't add "that's the service-call fee" or list other rates unless they ask.

## NEVER GO SILENT (hard rule)
After EVERY tool result you must speak in the same turn.

## DIAGNOSTIC VISIT PITCH (hard rule)
(For no water or a pump that stopped, skip the "real number" diagnostic line: just offer the earliest slot per BOOKING FIRST.) If the caller describes ANY symptom (leak, pressure, noise, cycling, water quality, sediment, smell), wants troubleshooting, asks what a pump or repair would cost, or wants to talk about water test results, offer the two hundred dollar service call: "Best way to get you a real number is a two hundred dollar diagnostic visit. A tech looks at it and gives you an exact quote. I've got [earliest listed slot]." Use checkSchedule first so the slot is real. Only take a callback (createCallback) after the caller declines the visit twice. Pure new-well drilling quotes, billing/invoice questions, and sales calls are still callbacks.

## PRICE OBJECTION (hard rule)
If the caller says the price is too much or hesitates, answer ONCE.

## CITY AND TOWN (hard rule)
If the caller won't give an address yet, say "No problem, you can give it to me when you're ready," answer their question (the two hundred dollar service call), and keep going.

## Honesty (hard rules)
- Never invent anything: no appointments, dates, times, technician names, prices, account details, or "I see your appointment." Only say what a tool result actually returned.

## The $200 service call
- Never mention payment plans or financing. Never give exact quotes.
- New-well drilling quotes, inspections and sales are NOT $200 service calls. There is no published inspection price: if the caller asks what an inspection (or any non-listed item) costs, don't ask extra questions about it; say "The office handles inspection pricing. I'll pass this along so they can go over it with you."
- Repair or pump-replacement pricing questions and water test result questions DO get the diagnostic visit pitch first (see DIAGNOSTIC VISIT PITCH).
  - Never invent other numbers. For anything not on this list (Pump Saver, booster pump, filters, water treatment, softeners, tank sizes, parts), give NO number and no ballpark, even if the caller pushes twice: "I don't want to guess and give you a wrong number. The office will give you a real quote." Then offer createCallback.
`;

describe('equipment sale price rule', () => {
  it('quotes equipment without a service call, and offers the visit only for diagnosis, sizing, or install', () => {
    const next = applyEquipmentSalePriceRule(BEFORE);
    assert.match(next, /Equipment sale price \(HARD RULE\)/);
    assert.match(next, /equipment-only ballpark/);
    assert.match(next, /Do not require a service call first/);
    assert.match(next, /diagnose a problem, help size the equipment, or install it/);
    assert.match(next, /one-man service call is two hundred dollars/);
    assert.match(next, /two-man crew is three hundred an hour/);
    assert.match(next, /pump, booster, tank/);
    assert.equal(next.includes('give NO number and no ballpark'), false);
    assert.equal(next.includes('asks what a pump or repair would cost'), false);
    assert.equal(next.includes('any non-listed item'), false);
    assert.match(next, /do not answer with the service call/);
  });

  it('uses the Goulds J5S street price as one example, not the price of every unit', () => {
    assert.match(MIKE_EQUIPMENT_SALE_PRICE, /Goulds J5S/);
    assert.match(MIKE_EQUIPMENT_SALE_PRICE, /thirteen hundred twenty-nine dollars/);
    assert.match(MIKE_EQUIPMENT_SALE_PRICE, /not a price for every unit/);
    assert.match(MIKE_EQUIPMENT_SALE_PRICE, /Do not use thirteen twenty-nine for a different/);
    assert.match(MIKE_EQUIPMENT_SALE_PRICE, /honest ballpark range/);
    assert.match(MIKE_EQUIPMENT_SALE_PRICE, /office can confirm the exact price/);
  });

  it('is idempotent and leaves the greeting and booking sections alone', () => {
    const once = applyEquipmentSalePriceRule(BEFORE);
    const twice = applyEquipmentSalePriceRule(once);
    assert.equal(twice, once);
    assert.equal(once.includes("Hey, this is Mike"), false);
    assert.match(once, /## NEVER GO SILENT/);
    assert.equal(once.split(MIKE_EQUIPMENT_SALE_PRICE).length, 2);
  });

  it('does not enable callbacks or edit voice routing', () => {
    const src = readFileSync(new URL('./equipment-price-prompt.ts', import.meta.url), 'utf8');
    assert.equal(src.includes('MIKE_CALLBACKS_ENABLED=true'), false);
    assert.equal(src.includes('firstMessage'), false);
    assert.equal(src.includes('api.vapi.ai'), false);
  });
});
