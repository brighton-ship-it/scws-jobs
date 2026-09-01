/**
 * Vapi paste for after-hours $200 booking. Confirmation lock stays in
 * appointment-confirmation.ts (PR #9). Do not overwrite that lock.
 */

export const BOOK_JOB_TOOL_NAME = 'bookJob';

export const BOOK_JOB_TOOL = {
  name: BOOK_JOB_TOOL_NAME,
  description:
    'Create a real Jobber Service Call ($200) on an open slot from checkSchedule. Visits may land Monday–Friday only — never Saturday or Sunday. After-hours callers (including Friday night) may be booked on the next weekday. Assign Ramona / west / central SD to Brian Eads only. Assign Anza / high-desert to Doug Pollack or Cowin, whichever has an open Jobber slot. Never assign Travis, Brighton, Haze, Chris, or a drill crew. Never create a drill, pump, or quote visit. Call only after hours. Never book a daytime weekday visit (Liz). Never auto-book Monday for a weekend emergency. Confirm the time only if the result has booked: true, canConfirm: true, and visit.startAt. If booked is false or lookupStatus is error, do not invent a time.',
  parameters: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: "The caller's phone number" },
      name: { type: 'string', description: "The caller's name" },
      email: { type: 'string', description: "The caller's email if they give one" },
      address: { type: 'string', description: 'Service street address' },
      city: { type: 'string', description: 'City (Ramona, Anza, Escondido, …)' },
      zip: { type: 'string', description: 'ZIP if known' },
      startAt: {
        type: 'string',
        description: 'Exact startAt from checkSchedule.openSlots. Do not invent a time.',
      },
      urgency: { type: 'string', description: 'normal, urgent, or emergency' },
      needNow: {
        type: 'boolean',
        description: 'True if they need someone now / this weekend / STR guests',
      },
      thisWeekend: { type: 'boolean', description: 'True if they need service this weekend' },
      notes: { type: 'string', description: 'Short problem description' },
    },
    required: ['phone', 'name', 'address', 'city', 'startAt'],
  },
} as const;

export const SARAH_AFTER_HOURS_BOOKING = `## After-hours $200 service call (HARD RULE)
You may BOOK only after hours: weeknights Monday–Thursday after 5pm Pacific, plus Friday 5pm through Monday 7am Pacific.

Daytime weekday service calls stay with Liz. Do not book those. Take a message and say the office will call back.

A caller who needs someone NOW this weekend (emergency, no water, Airbnb/STR guests) is NOT a yes to a Monday $200 visit. Do not book Monday. Flag the shop and say the office will call.

The Jobber visit itself may only land Monday–Friday. Never offer or book Saturday or Sunday. After-hours callers (Friday night, Saturday, Sunday) may be offered the next weekday if openSlots has one — unless this is a weekend emergency.

To offer a time: call checkSchedule with the caller's phone, city, and intent "book". Offer ONLY times in openSlots. If openSlots is empty or lookupStatus is error, do not invent a time.

To book: call bookJob (alias book_job) with a startAt copied from openSlots. You may say they are booked ONLY if the book result has booked: true, canConfirm: true, and that exact visit. If the API fails, say you cannot confirm and the office will call. Never invent Travis or anyone else.

Assign only: Brian Eads for Ramona / west / central SD; Doug Pollack or Cowin for Anza / high-desert (whichever openSlots lists). Never assign Travis, Brighton, Haze, Chris, a drill crew, or anyone else. If openSlots is empty, do not invent a time and do not book a different technician.

Title is Service Call only. Never create a drill, pump, or quote visit. Price is $200. Do not tell the customer the $200 is a credit toward later pump or repair work — it is not.

Search existing Jobber clients (the API does this). Do not create a second client for the same person.

Do not send the customer a text or email yourself.`;
