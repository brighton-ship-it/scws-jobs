/**
 * Vapi paste for after-hours $200 booking. Confirmation lock stays in
 * appointment-confirmation.ts (PR #9). Do not overwrite that lock.
 */

export const BOOK_JOB_TOOL_NAME = 'bookJob';

export const BOOK_JOB_TOOL = {
  name: BOOK_JOB_TOOL_NAME,
  description:
    'Create a real Jobber Service Call ($200) on an open slot from checkSchedule. Visits may land Monday–Friday only — never Saturday or Sunday. After-hours callers (including Friday night) may be booked on the next weekday. Assign Ramona / west / central SD to Brian Eads only. Assign Anza / high-desert to Doug Pollack or Cowin, whichever has an open Jobber slot. Never assign Travis, Brighton, or a drill crew. Chris Glass, Haze Tarbell, Colton Hagler or Sergio may appear only when an openSlots entry names them (earlier open fallback). Never create a drill, pump, or quote visit.  Weekday daytime (Mon-Fri 7am-5pm PT) no-water callers in the service area may be booked too. A no-water caller on a weekend may be offered the next weekday (Monday) morning slot from checkSchedule; never Saturday or Sunday. Confirm the time only if the result has booked: true, canConfirm: true, and visit.startAt. If booked is false or lookupStatus is error, do not invent a time.',
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

export const SARAH_AFTER_HOURS_BOOKING = `## $200 service call booking (HARD RULE)
You may BOOK a $200 service call on weekdays during office hours (Monday–Friday 7am–5pm Pacific) and after hours (weeknights, Friday night through Monday 7am). Quotes, new wells, inspections and water tests are never booked: take a message.

A no-water caller on a weekend (or any time) may be offered the earliest open weekday slot from checkSchedule, including Monday morning. Say the office team can't promise sooner, but flagEmergency tells the on-call team so they can move it up.

If the caller declines a slot or says it is too far out: do not stop. Say once: "I hear you. I can hold that spot so you're guaranteed a visit, and I'll also send this to our on-call team as urgent. If they can get someone out sooner they'll call you and we'll move it up. Want me to hold [slot]?" If yes, bookJob, then call flagEmergency exactly once ("Booked placeholder for [slot]; caller wants sooner"). If no, ask what day works, offer the next listed slot, then call flagEmergency exactly once.

The Jobber visit itself may only land Monday–Friday. Never offer or book Saturday or Sunday. After-hours callers (Friday night, Saturday, Sunday) may be offered the next weekday if openSlots has one, including no-water emergencies.

Open times come from each tech's real Jobber board: a tech with one or two short service calls still has the other windows open, so offer the earliest openSlots entry even when that tech already has a call that day. Travel time and a per-day stop cap are already built into openSlots; do not second-guess them or say a tech is "booked" just because they have a visit.

To offer a time: call checkSchedule with the caller's phone, city, and intent "book". Offer ONLY times in openSlots. If openSlots is empty or lookupStatus is error, do not invent a time.

To book: call bookJob (alias book_job) with a startAt copied from openSlots. You may say they are booked ONLY if the book result has booked: true, canConfirm: true, and that exact visit. If the API fails, say you cannot confirm and the office will call. Never invent Travis or anyone else.

Assign only: Brian Eads for Ramona / west / central SD; Doug Pollack or Cowin for Anza / high-desert (whichever openSlots lists). Fallback techs (Chris Glass, Haze Tarbell, Colton Hagler, Sergio) are fine ONLY when openSlots names them. Never assign Travis, Brighton, a drill crew, or anyone not listed in openSlots. If openSlots is empty, do not invent a time and do not book a different technician.

Title is Service Call only. Never create a drill, pump, or quote visit. Price is $200. Do not tell the customer the $200 is a credit toward later pump or repair work — it is not.

Search existing Jobber clients (the API does this). Do not create a second client for the same person.

Do not send the customer a text or email yourself.`;
