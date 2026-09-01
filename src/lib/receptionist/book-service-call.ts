/**
 * Create a real Jobber Service Call ($200) for Sarah after hours.
 *
 * Confirm-lock: canConfirm is true only when Jobber returned the visit.
 * Do not create duplicate clients. Do not credit the $200 toward later work.
 * Do not send customer SMS/email.
 */

import {
  decideSarahBooking,
  WEEKEND_EMERGENCY_SPOKEN,
  type WeekendNeedInput,
} from './after-hours.ts';
import {
  DEFAULT_JOBBER_GRAPHQL_VERSION,
  JOBBER_GRAPHQL_URL,
  LOOKUP_ERROR_CONFIRMATION_RULE,
  NO_VISIT_CONFIRMATION_RULE,
  formatPtDate,
  formatVisitTime,
  normalizePhone10,
} from './check-schedule.ts';
import {
  isWeekdayVisitStart,
  lookupOpenSlots,
  slotMatchesRequest,
  type OpenSlot,
  type OpenSlotsDeps,
} from './open-slots.ts';
import {
  allowedTechSpokenName,
  assignShopTech,
  isAllowlistedTechId,
  isBlockedAssignee,
} from './tech-assignment.ts';

const FORBIDDEN_SARAH_JOB = /\b(drill|drilling|pump|quote|estimate|rehab|rehabilitation|crew)\b/i;

export function isSarahServiceCallTitle(title: string | null | undefined): boolean {
  const value = String(title || '').trim();
  if (!value || FORBIDDEN_SARAH_JOB.test(value)) return false;
  return /^service call\b/i.test(value);
}

export const SERVICE_CALL_TITLE = 'Service Call';
export const SERVICE_CALL_PRICE_USD = 200;
export const OFFICE_FLAG_EMAILS = ['brighton@scwellservice.com', 'lizbeth@scwellservice.com'];

export type BookServiceCallInput = WeekendNeedInput & {
  phone?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  postalCode?: string | null;
  startAt?: string | null;
  title?: string | null;
  serviceType?: string | null;
};

export type BookedVisit = {
  id: string | null;
  jobId: string | null;
  startAt: string;
  endAt: string | null;
  date: string;
  time: string;
  technicians: string[];
  title: string;
};

export type BookServiceCallResult = {
  booked: boolean;
  canConfirm: boolean;
  mayBook: boolean;
  lookupStatus: 'ok' | 'error' | 'blocked';
  weekendEmergency: boolean;
  bookingBlockReason?: string;
  message: string;
  confirmationRule: string;
  visit?: BookedVisit;
  openSlots?: OpenSlot[];
  assignedTechName?: string;
  clientId?: string;
  clientCreated?: boolean;
  error?: string;
};

export type OfficeFlag = {
  kind: 'weekend_emergency' | 'book_failed';
  subject: string;
  text: string;
};

export type BookServiceCallDeps = OpenSlotsDeps & {
  notifyOffice?: (flag: OfficeFlag) => Promise<void> | void;
};

export type BookServiceCallResponse = {
  result: BookServiceCallResult;
};

const SEARCH_CLIENTS_QUERY = `
  query SearchClients($searchTerm: String!) {
    clients(searchTerm: $searchTerm, first: 10) {
      nodes {
        id
        name
        firstName
        lastName
        companyName
        phones { number }
        emails { address }
        properties(first: 10) {
          nodes {
            id
            address { street1 city postalCode }
          }
        }
      }
    }
  }
`;

const SEARCH_CLIENTS_BARE_QUERY = `
  query SearchClients($searchTerm: String!) {
    clients(searchTerm: $searchTerm, first: 10) {
      nodes {
        id
        name
        firstName
        lastName
        companyName
        phones { number }
        emails { address }
      }
    }
  }
`;

const CLIENT_CREATE = `
  mutation ClientCreate($input: ClientCreateInput!) {
    clientCreate(input: $input) {
      client {
        id
        name
        phones { number }
        emails { address }
      }
      userErrors { message path }
    }
  }
`;

const PROPERTY_CREATE = `
  mutation PropertyCreate($clientId: EncodedId!, $input: PropertyCreateInput!) {
    propertyCreate(clientId: $clientId, input: $input) {
      properties { id }
      userErrors { message path }
    }
  }
`;

const JOB_CREATE = `
  mutation JobCreate($input: JobCreateAttributes!) {
    jobCreate(input: $input) {
      job {
        id
        title
        jobNumber
        visits(first: 5) {
          nodes {
            id
            startAt
            endAt
            assignedUsers {
              nodes {
                id
                name { full }
              }
            }
          }
        }
      }
      userErrors { message path }
    }
  }
`;

export type JobberClientNode = {
  id: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  phones?: Array<{ number?: string | null } | null> | null;
  emails?: Array<{ address?: string | null } | null> | null;
  properties?: {
    nodes?: Array<{
      id: string;
      address?: { street1?: string | null; city?: string | null; postalCode?: string | null } | null;
    } | null> | null;
  } | null;
};

function jobberHeaders(token: string, version: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-JOBBER-GRAPHQL-VERSION': version,
  };
}

async function jobberGraphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchFn: typeof fetch,
  version: string
): Promise<{ data?: any; errors?: Array<{ message?: string }> }> {
  const response = await fetchFn(JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: jobberHeaders(token, version),
    body: JSON.stringify({ query, variables }),
  });

  let json: { data?: any; errors?: Array<{ message?: string }> };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    throw new Error(`Jobber GraphQL HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Jobber GraphQL HTTP ${response.status}`);
  }

  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || 'Jobber GraphQL error');
  }

  return json;
}

export function normalizeStreet(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[.#,]/g, ' ')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\broad\b/g, 'rd')
    .replace(/\bdrive\b/g, 'dr')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitCallerName(input: BookServiceCallInput): { firstName: string; lastName: string } {
  if (input.firstName || input.lastName) {
    return {
      firstName: String(input.firstName || 'Unknown').trim() || 'Unknown',
      lastName: String(input.lastName || 'Caller').trim() || 'Caller',
    };
  }
  const parts = String(input.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: 'Unknown', lastName: 'Caller' };
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Caller' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function clientDisplayName(client: JobberClientNode): string {
  return (
    client.name ||
    `${client.firstName || ''} ${client.lastName || ''}`.trim() ||
    client.companyName ||
    ''
  );
}

function phonesOf(client: JobberClientNode): string[] {
  return (client.phones || [])
    .map((phone) => normalizePhone10(phone?.number || ''))
    .filter((phone) => phone.length === 10);
}

function emailsOf(client: JobberClientNode): string[] {
  return (client.emails || [])
    .map((email) => String(email?.address || '').trim().toLowerCase())
    .filter(Boolean);
}

function clientMatches(
  client: JobberClientNode,
  input: {
    phone10?: string;
    email?: string;
    street?: string;
    city?: string;
    firstName?: string;
    lastName?: string;
  }
): 'phone' | 'email' | 'address' | 'name' | null {
  if (input.phone10 && phonesOf(client).includes(input.phone10)) return 'phone';
  if (input.email && emailsOf(client).includes(input.email)) return 'email';

  const street = input.street;
  if (street) {
    for (const property of client.properties?.nodes || []) {
      const propStreet = normalizeStreet(property?.address?.street1 || '');
      const propCity = String(property?.address?.city || '').toLowerCase().trim();
      if (propStreet && (propStreet === street || propStreet.includes(street) || street.includes(propStreet))) {
        if (!input.city || !propCity || propCity === input.city.toLowerCase()) return 'address';
      }
    }
  }

  const first = (input.firstName || '').toLowerCase();
  const last = (input.lastName || '').toLowerCase();
  if (first && last && last !== 'caller') {
    const name = clientDisplayName(client).toLowerCase();
    if (name.includes(first) && name.includes(last)) return 'name';
  }

  return null;
}

export function pickExistingClient(
  clients: JobberClientNode[],
  input: BookServiceCallInput
): { client: JobberClientNode; matchedBy: 'phone' | 'email' | 'address' | 'name' } | null {
  const phone10 = normalizePhone10(input.phone || '');
  const email = String(input.email || '').trim().toLowerCase();
  const street = normalizeStreet(input.address);
  const city = String(input.city || '').trim();
  const { firstName, lastName } = splitCallerName(input);
  const needle = { phone10: phone10.length === 10 ? phone10 : undefined, email, street, city, firstName, lastName };

  const rank = { phone: 0, email: 1, address: 2, name: 3 } as const;
  let best: { client: JobberClientNode; matchedBy: 'phone' | 'email' | 'address' | 'name' } | null = null;

  for (const client of clients) {
    const matchedBy = clientMatches(client, needle);
    if (!matchedBy) continue;
    if (!best || rank[matchedBy] < rank[best.matchedBy]) {
      best = { client, matchedBy };
    }
  }

  return best;
}

export function matchingPropertyId(client: JobberClientNode, address?: string | null, city?: string | null): string | null {
  const street = normalizeStreet(address);
  if (!street) return client.properties?.nodes?.[0]?.id || null;

  for (const property of client.properties?.nodes || []) {
    const propStreet = normalizeStreet(property?.address?.street1 || '');
    if (propStreet && (propStreet === street || propStreet.includes(street) || street.includes(propStreet))) {
      const propCity = String(property?.address?.city || '').toLowerCase().trim();
      if (!city || !propCity || propCity === city.toLowerCase()) return property!.id;
    }
  }

  return null;
}

function searchTermsFor(input: BookServiceCallInput): string[] {
  const terms: string[] = [];
  const phone10 = normalizePhone10(input.phone || '');
  if (phone10.length === 10) terms.push(phone10.slice(-7));
  if (input.email?.trim()) terms.push(input.email.trim());
  if (input.address?.trim()) terms.push(normalizeStreet(input.address).split(' ').slice(0, 3).join(' '));
  const { firstName, lastName } = splitCallerName(input);
  if (firstName !== 'Unknown' && lastName !== 'Caller') terms.push(`${firstName} ${lastName}`);
  return [...new Set(terms.filter(Boolean))];
}

function blockedResult(
  reason: string,
  spoken: string,
  confirmationRule: string,
  extra: Partial<BookServiceCallResult> = {}
): BookServiceCallResult {
  return {
    booked: false,
    canConfirm: false,
    mayBook: false,
    lookupStatus: 'blocked',
    weekendEmergency: extra.weekendEmergency ?? false,
    bookingBlockReason: reason,
    message: spoken,
    confirmationRule,
    ...extra,
  };
}

function errorResult(message: string, extra: Partial<BookServiceCallResult> = {}): BookServiceCallResult {
  return {
    booked: false,
    canConfirm: false,
    mayBook: false,
    lookupStatus: 'error',
    weekendEmergency: false,
    message:
      "I'm not able to confirm a time on the schedule right now. I'll have the office call you back.",
    confirmationRule: LOOKUP_ERROR_CONFIRMATION_RULE,
    error: message,
    ...extra,
  };
}

export function weekendEmergencyFlag(input: BookServiceCallInput): OfficeFlag {
  const phone = input.phone || 'unknown';
  const name = input.name || `${input.firstName || ''} ${input.lastName || ''}`.trim() || 'Unknown caller';
  const where = [input.address, input.city].filter(Boolean).join(', ');
  return {
    kind: 'weekend_emergency',
    subject: `Sarah: weekend emergency — do not book Monday — ${name}`,
    text: [
      'Sarah did NOT book a Monday $200 service call.',
      'Caller needs someone this weekend (emergency / STR / now). Surface for the shop — do not treat this as scheduled.',
      '',
      `Name: ${name}`,
      `Phone: ${phone}`,
      where ? `Address: ${where}` : '',
      input.urgency ? `Urgency: ${input.urgency}` : '',
      input.notes ? `Notes: ${input.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function visitFromJob(job: any, fallbackStart: string, fallbackEnd: string, techName: string): BookedVisit | null {
  const nodes = job?.visits?.nodes || [];
  const visit = nodes.find((node: any) => node?.startAt) || nodes[0];
  if (!visit?.startAt) return null;

  const assigned = visit.assignedUsers?.nodes || [];
  const technicians = assigned
    .map((user: { name?: { full?: string } }) => user?.name?.full)
    .filter(Boolean);

  return {
    id: visit.id || null,
    jobId: job.id || null,
    startAt: visit.startAt,
    endAt: visit.endAt || fallbackEnd || null,
    date: formatPtDate(new Date(visit.startAt)),
    time: formatVisitTime(visit.startAt, visit.endAt || fallbackEnd || null, false),
    technicians: technicians.length ? technicians : [techName],
    title: job.title || SERVICE_CALL_TITLE,
  };
}

function visitAssigneeIds(job: any): string[] {
  const visit = job?.visits?.nodes?.find((node: any) => node?.startAt) || job?.visits?.nodes?.[0];
  return (visit?.assignedUsers?.nodes || [])
    .map((user: { id?: string }) => user?.id)
    .filter(Boolean);
}

async function findOrCreateClient(
  input: BookServiceCallInput,
  token: string,
  fetchFn: typeof fetch,
  version: string
): Promise<{ client: JobberClientNode; created: boolean }> {
  const seen = new Map<string, JobberClientNode>();
  let searchQuery = SEARCH_CLIENTS_QUERY;
  for (const term of searchTermsFor(input)) {
    let data: { data?: any };
    try {
      data = await jobberGraphql(token, searchQuery, { searchTerm: term }, fetchFn, version);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (searchQuery === SEARCH_CLIENTS_QUERY && /propert/i.test(message)) {
        searchQuery = SEARCH_CLIENTS_BARE_QUERY;
        data = await jobberGraphql(token, searchQuery, { searchTerm: term }, fetchFn, version);
      } else {
        throw error;
      }
    }
    for (const node of data?.data?.clients?.nodes || []) {
      if (node?.id) seen.set(node.id, node);
    }
  }

  const existing = pickExistingClient([...seen.values()], input);
  if (existing) {
    return { client: existing.client, created: false };
  }

  const { firstName, lastName } = splitCallerName(input);
  const phone = input.phone ? normalizePhone10(input.phone) : '';
  const createData = await jobberGraphql(
    token,
    CLIENT_CREATE,
    {
      input: {
        firstName,
        lastName,
        ...(input.email
          ? { emails: [{ description: 'MAIN', primary: true, address: input.email }] }
          : {}),
        ...(phone.length === 10
          ? { phones: [{ description: 'MAIN', primary: true, number: phone }] }
          : {}),
        ...(input.address
          ? {
              billingAddress: {
                street1: input.address,
                city: input.city || '',
                province: 'CA',
                postalCode: input.zip || input.postalCode || '',
                country: 'US',
              },
            }
          : {}),
      },
    },
    fetchFn,
    version
  );

  const userErrors = createData?.data?.clientCreate?.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors[0].message || 'clientCreate failed');
  }

  const created = createData?.data?.clientCreate?.client;
  if (!created?.id) {
    throw new Error('clientCreate returned no client');
  }

  return { client: created, created: true };
}

async function findOrCreateProperty(
  client: JobberClientNode,
  input: BookServiceCallInput,
  token: string,
  fetchFn: typeof fetch,
  version: string
): Promise<string> {
  const existing = matchingPropertyId(client, input.address, input.city);
  if (existing) return existing;

  if (!input.address) {
    throw new Error('Address is required to create a Jobber visit');
  }

  const data = await jobberGraphql(
    token,
    PROPERTY_CREATE,
    {
      clientId: client.id,
      input: {
        address: {
          street1: input.address,
          city: input.city || '',
          province: 'CA',
          postalCode: input.zip || input.postalCode || '',
          country: 'US',
        },
      },
    },
    fetchFn,
    version
  );

  const userErrors = data?.data?.propertyCreate?.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors[0].message || 'propertyCreate failed');
  }

  const propertyId = data?.data?.propertyCreate?.properties?.[0]?.id;
  if (!propertyId) {
    throw new Error('propertyCreate returned no property');
  }
  return propertyId;
}

export async function bookServiceCall(
  input: BookServiceCallInput,
  deps: BookServiceCallDeps = {}
): Promise<BookServiceCallResult> {
  const now = deps.now ?? new Date();
  const booking = decideSarahBooking(now, input);

  if (!booking.mayBook) {
    if (booking.reason === 'weekend_emergency') {
      await deps.notifyOffice?.(weekendEmergencyFlag(input));
    }
    return blockedResult(booking.reason, booking.spoken, booking.confirmationRule, {
      weekendEmergency: booking.weekendEmergency,
    });
  }

  const token = deps.accessToken ?? process.env.JOBBER_ACCESS_TOKEN ?? null;
  if (!token) {
    return errorResult('JOBBER_ACCESS_TOKEN is not set');
  }

  const requestedTitle = input.title || input.serviceType;
  if (requestedTitle && !isSarahServiceCallTitle(requestedTitle)) {
    return blockedResult(
      'forbidden_job_type',
      "I can only book a $200 service call. I won't put a drill, pump, or quote visit on the calendar. I'll have the office call you back.",
      NO_VISIT_CONFIRMATION_RULE
    );
  }

  if (!input.startAt) {
    return blockedResult(
      'missing_slot',
      "I need a time from the open Jobber slots before I can book. I won't invent one.",
      NO_VISIT_CONFIRMATION_RULE
    );
  }

  if (!isWeekdayVisitStart(input.startAt)) {
    return blockedResult(
      'weekend_visit',
      "I can only schedule a service call Monday through Friday. I won't put a Saturday or Sunday visit on the calendar. I'll have the office call you back.",
      NO_VISIT_CONFIRMATION_RULE
    );
  }

  const slots = await lookupOpenSlots(
    { city: input.city || undefined, address: input.address || undefined, zip: input.zip || input.postalCode || undefined },
    deps
  );

  if (slots.lookupStatus === 'error') {
    return errorResult(slots.error || 'Failed to load Jobber open slots', {
      assignedTechName: slots.assignedTechName,
      openSlots: [],
    });
  }

  const location = {
    city: input.city,
    address: input.address,
    zip: input.zip || input.postalCode,
  };
  const spokenAllowed = slots.assignedTechName || allowedTechSpokenName(location);
  const allowlistedIds = slots.allowlistedTechIds?.length
    ? slots.allowlistedTechIds
    : slots.assignedTechId
      ? [slots.assignedTechId]
      : [];
  const chosen = slots.openSlots.find((slot) => slotMatchesRequest(slot, input.startAt || ''));
  if (chosen && !isAllowlistedTechId(chosen.technicianId, allowlistedIds)) {
    return blockedResult(
      'wrong_tech',
      `I don't have an open slot on ${spokenAllowed}. I won't book anyone else. I'll have the office call you back.`,
      NO_VISIT_CONFIRMATION_RULE,
      {
        openSlots: [],
        assignedTechName: slots.assignedTechName,
        canConfirm: false,
      }
    );
  }

  if (!chosen) {
    return blockedResult(
      'slot_not_open',
      "That time is not an open slot on the Jobber calendar. I can't confirm it. I'll have the office call you back.",
      NO_VISIT_CONFIRMATION_RULE,
      {
        openSlots: slots.openSlots,
        assignedTechName: slots.assignedTechName,
      }
    );
  }

  if (!isWeekdayVisitStart(chosen.startAt)) {
    return blockedResult(
      'weekend_visit',
      "I can only schedule a service call Monday through Friday. I won't put a Saturday or Sunday visit on the calendar. I'll have the office call you back.",
      NO_VISIT_CONFIRMATION_RULE,
      {
        openSlots: slots.openSlots.filter((slot) => isWeekdayVisitStart(slot.startAt)),
        assignedTechName: slots.assignedTechName,
      }
    );
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const version =
    deps.graphqlVersion ??
    process.env.JOBBER_GRAPHQL_VERSION?.trim() ??
    DEFAULT_JOBBER_GRAPHQL_VERSION;

  try {
    const { client, created } = await findOrCreateClient(input, token, fetchFn, version);
    const propertyId = await findOrCreateProperty(client, input, token, fetchFn, version);
    const tech = assignShopTech(location);

    const jobData = await jobberGraphql(
      token,
      JOB_CREATE,
      {
        input: {
          propertyId,
          title: SERVICE_CALL_TITLE,
          startAt: chosen.startAt,
          endAt: chosen.endAt,
          lineItems: [
            {
              name: SERVICE_CALL_TITLE,
              description: 'Service call',
              quantity: 1,
              unitPrice: SERVICE_CALL_PRICE_USD,
              saveToProductsAndServices: false,
            },
          ],
          invoicing: {
            invoicingType: 'FIXED_PRICE',
            invoicingSchedule: 'ON_COMPLETION',
          },
          scheduling: {
            createVisits: true,
            notifyTeam: false,
            assignedUserIds: [chosen.technicianId],
          },
        },
      },
      fetchFn,
      version
    );

    const userErrors = jobData?.data?.jobCreate?.userErrors || [];
    if (userErrors.length) {
      return errorResult(userErrors[0].message || 'jobCreate failed', {
        assignedTechName: chosen.technician,
        clientId: client.id,
        clientCreated: created,
      });
    }

    const job = jobData?.data?.jobCreate?.job;
    if (job?.title && !isSarahServiceCallTitle(job.title)) {
      return {
        booked: false,
        canConfirm: false,
        mayBook: false,
        lookupStatus: 'error',
        weekendEmergency: false,
        bookingBlockReason: 'forbidden_job_type',
        assignedTechName: chosen.technician,
        clientId: client.id,
        clientCreated: created,
        error: `Jobber returned title ${job.title}`,
        message:
          "I can only book a $200 service call. I'll have the office call you back.",
        confirmationRule: NO_VISIT_CONFIRMATION_RULE,
      };
    }

    const assigneeIds = visitAssigneeIds(job);
    const assignedSomeoneElse =
      assigneeIds.some((id) => !isAllowlistedTechId(id, allowlistedIds)) ||
      (job?.visits?.nodes || []).some((node: any) =>
        (node?.assignedUsers?.nodes || []).some((user: any) => isBlockedAssignee(user))
      );
    if (assignedSomeoneElse || (assigneeIds.length > 0 && !assigneeIds.includes(chosen.technicianId))) {
      return {
        booked: false,
        canConfirm: false,
        mayBook: false,
        lookupStatus: 'error',
        weekendEmergency: false,
        bookingBlockReason: 'wrong_tech',
        assignedTechName: chosen.technician,
        clientId: client.id,
        clientCreated: created,
        error: 'Jobber visit assigned to a non-service tech',
        message: `I won't confirm a visit that isn't on ${spokenAllowed}. I'll have the office call you back.`,
        confirmationRule: NO_VISIT_CONFIRMATION_RULE,
      };
    }

    const visit = visitFromJob(job, chosen.startAt, chosen.endAt, chosen.technician);
    if (!visit) {
      return {
        booked: false,
        canConfirm: false,
        mayBook: true,
        lookupStatus: 'error',
        weekendEmergency: false,
        assignedTechName: chosen.technician,
        clientId: client.id,
        clientCreated: created,
        error: 'jobCreate did not return a visit',
        message:
          "I'm not able to confirm a time on the schedule right now. I'll have the office call you back.",
        confirmationRule: LOOKUP_ERROR_CONFIRMATION_RULE,
      };
    }

    return {
      booked: true,
      canConfirm: true,
      mayBook: true,
      lookupStatus: 'ok',
      weekendEmergency: false,
      message: `You're scheduled for a ${SERVICE_CALL_TITLE} on ${visit.date}, ${visit.time}. ${visit.technicians.join(' and ')} will handle the visit.`,
      confirmationRule:
        'You may confirm only this visit (date, time, technician) from the book response. Do not invent another time.',
      visit,
      assignedTechName: chosen.technician || tech.name,
      clientId: client.id,
      clientCreated: created,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return errorResult(message);
  }
}

export async function handleBookServiceCall(
  input: BookServiceCallInput,
  deps: BookServiceCallDeps = {}
): Promise<BookServiceCallResponse> {
  try {
    return { result: await bookServiceCall(input, deps) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { result: errorResult(message) };
  }
}

export { WEEKEND_EMERGENCY_SPOKEN };
