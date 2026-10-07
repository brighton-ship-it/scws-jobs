import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDurationLabel, resolveCallDurationSec } from './call-duration.ts';
import { isCallerUrgent } from './caller-urgency.ts';
import { BUSINESS_HOURS_SPOKEN, getBusinessHours } from './business-hours.ts';
import { checkServiceArea, serviceAreaLocationFromParams } from './service-area.ts';
import { parseVapiServerTools, vapiToolHttpBody } from './vapi-tools.ts';
import {
  CALLBACK_SPOKEN_MESSAGE,
  EMERGENCY_SPOKEN_MESSAGE,
  OFFICE_ALERT_EMAILS,
  alertSubject,
  bookingRowForOfficeRequest,
  isSafeSarahMessage,
  officeRequestFromTool,
  saveSarahOfficeRequest,
} from './office-callback.ts';

const END_OF_CALL_REPORT = {
  message: {
    type: 'end-of-call-report',
    durationSeconds: 118.54,
    durationMs: 118540,
    startedAt: '2026-10-06T17:00:00.000Z',
    endedAt: '2026-10-06T17:01:58.540Z',
    call: {
      id: 'call_end_1',
      status: 'ended',
      customer: { number: '+17605551212' },
    },
    artifact: {
      transcript: 'AI: Is this an emergency? Do you have no water?\nUser: No, I need a quote next month.',
      messages: [
        { role: 'bot', message: 'Is this an emergency? Do you have no water?' },
        { role: 'user', message: 'No, I need a quote next month.' },
      ],
    },
    analysis: {
      summary: 'Caller might have an emergency and no water.',
      structuredData: { urgency: 'normal' },
    },
  },
};

const TOOL_CALLS_PAYLOAD = {
  message: {
    type: 'tool-calls',
    call: {
      id: 'call_tools_1',
      customer: { number: '+17605550199' },
    },
    toolCallList: [
      {
        id: 'call_tool_hours',
        type: 'function',
        function: {
          name: 'getBusinessHours',
          arguments: '{}',
        },
      },
      {
        id: 'call_tool_area',
        type: 'function',
        function: {
          name: 'checkServiceArea',
          arguments: JSON.stringify({ city: 'Hemet' }),
        },
      },
    ],
    toolWithToolCallList: [
      {
        name: 'getBusinessHours',
        toolCall: {
          id: 'call_tool_hours',
          type: 'function',
          function: { name: 'getBusinessHours', arguments: {} },
        },
      },
      {
        name: 'checkServiceArea',
        toolCall: {
          id: 'call_tool_area',
          type: 'function',
          function: { name: 'checkServiceArea', arguments: { city: 'Hemet' } },
        },
      },
    ],
  },
};

describe('end-of-call duration', () => {
  it('rounds a fractional durationSeconds payload to an integer', () => {
    const seconds = resolveCallDurationSec(END_OF_CALL_REPORT);
    assert.equal(seconds, 119);
    assert.equal(Number.isInteger(seconds), true);
    assert.equal(formatDurationLabel(seconds), '1m 59s');
  });

  it('rounds a numeric string duration that Postgres would reject', () => {
    const seconds = resolveCallDurationSec({
      message: { type: 'end-of-call-report', durationSeconds: '118.54' },
    });
    assert.equal(seconds, 119);
    assert.equal(Number.isInteger(seconds), true);
  });

  it('uses durationMs when seconds are absent', () => {
    assert.equal(resolveCallDurationSec({
      message: { type: 'end-of-call-report', durationMs: 118540 },
    }), 119);
  });

  it('falls back to startedAt and endedAt', () => {
    assert.equal(resolveCallDurationSec({
      message: {
        type: 'end-of-call-report',
        startedAt: '2026-10-06T17:00:00.000Z',
        endedAt: '2026-10-06T17:01:58.540Z',
      },
    }), 119);
  });

  it('returns 0 when the report has no duration', () => {
    assert.equal(resolveCallDurationSec({ message: { type: 'end-of-call-report' } }), 0);
    assert.equal(formatDurationLabel(0), 'Unknown');
  });
});

describe('Vapi tool-calls and legacy function-call', () => {
  it('reads toolCallList, parses string arguments, and ignores the duplicate toolWithToolCallList', () => {
    const parsed = parseVapiServerTools(TOOL_CALLS_PAYLOAD);
    assert.equal(parsed.mode, 'tool-calls');
    if (parsed.mode !== 'tool-calls') return;
    assert.equal(parsed.calls.length, 2);
    assert.deepEqual(parsed.calls.map((call) => call.name), ['getBusinessHours', 'checkServiceArea']);
    assert.equal(parsed.calls[1].id, 'call_tool_area');
    assert.equal(parsed.calls[1].params.city, 'Hemet');
  });

  it('falls back to toolWithToolCallList when toolCallList is missing', () => {
    const parsed = parseVapiServerTools({
      message: {
        type: 'tool-calls',
        toolWithToolCallList: [
          {
            function: { name: 'getServiceInfo' },
            toolCall: {
              id: 'toolu_fallback',
              function: {
                name: 'getServiceInfo',
                arguments: { serviceType: 'pump repair' },
              },
            },
          },
        ],
      },
    });
    assert.equal(parsed.mode, 'tool-calls');
    if (parsed.mode !== 'tool-calls') return;
    assert.equal(parsed.calls.length, 1);
    assert.equal(parsed.calls[0].id, 'toolu_fallback');
    assert.equal(parsed.calls[0].params.serviceType, 'pump repair');
  });

  it('returns the current Vapi results envelope with a string result', () => {
    const parsed = parseVapiServerTools(TOOL_CALLS_PAYLOAD);
    const http = vapiToolHttpBody(parsed, [
      { id: 'call_tool_hours', body: getBusinessHours() },
      { id: 'call_tool_area', body: checkServiceArea('Hemet') },
    ]);
    const results = http.results as Array<{ toolCallId: string; result: string }>;
    assert.equal(results.length, 2);
    assert.equal(results[0].toolCallId, 'call_tool_hours');
    assert.equal(typeof results[0].result, 'string');
    const hours = JSON.parse(results[0].result);
    assert.match(hours.note, /7 AM–5 PM Pacific/);
    const area = JSON.parse(results[1].result);
    assert.equal(area.inServiceArea, true);
    assert.equal('result' in http, false);
  });

  it('keeps the legacy function-call path', () => {
    const parsed = parseVapiServerTools({
      message: {
        type: 'function-call',
        functionCall: {
          name: 'checkServiceArea',
          parameters: { location: 'Warner Springs' },
        },
        call: { customer: { number: '+17605551212' } },
      },
    });
    assert.equal(parsed.mode, 'function-call');
    if (parsed.mode !== 'function-call') return;
    assert.equal(parsed.call.name, 'checkServiceArea');
    assert.equal(parsed.call.params.location, 'Warner Springs');
    const http = vapiToolHttpBody(parsed, [
      { id: null, body: checkServiceArea(String(parsed.call.params.location)) },
    ]);
    const result = http.result as { inServiceArea: boolean };
    assert.equal(result.inServiceArea, true);
    assert.equal('results' in http, false);
  });
});

describe('getBusinessHours', () => {
  it('matches the website hours and does not promise a callback time', () => {
    const { result } = getBusinessHours();
    const blob = JSON.stringify(result);
    assert.equal(result.note, BUSINESS_HOURS_SPOKEN);
    assert.match(blob, /Monday–Friday 7 AM–5 PM Pacific/);
    assert.match(blob, /closed weekends/i);
    assert.match(blob, /after hours/i);
    assert.doesNotMatch(blob, /4\s*PM|7 AM to 4|within 15|15 minutes/i);
  });
});

describe('checkServiceArea', () => {
  const served = [
    'Hemet',
    'Aguanga',
    'Anza',
    'Sage',
    'Idyllwild',
    'Mountain Center',
    'Warner Springs',
    'Ranchita',
    'Poway',
    'Ramona',
    'Valley Center',
    'Temecula',
    'Yucaipa',
    'Big Bear Lake',
    'Joshua Tree',
    'La Mesa, CA',
  ];

  for (const town of served) {
    it(`accepts ${town}`, () => {
      const { result } = checkServiceArea(town);
      assert.equal(result.inServiceArea, true, result.message);
    });
  }

  it('reads city when the tool omits location', () => {
    const location = serviceAreaLocationFromParams({ city: 'Mountain Center' });
    assert.equal(checkServiceArea(location).result.inServiceArea, true);
  });

  it('asks the office to confirm unknown towns instead of rejecting them', () => {
    const { result } = checkServiceArea('Phoenix');
    assert.equal(result.inServiceArea, null);
    assert.equal(result.message, 'The office will confirm.');
    assert.doesNotMatch(result.message, /outside|out of area|can't help/i);
  });

  it('confirms county-wide coverage', () => {
    assert.equal(checkServiceArea('Riverside County').result.inServiceArea, true);
  });
});

describe('caller urgency', () => {
  it('does not treat Sarah\'s emergency question as urgent', () => {
    assert.equal(isCallerUrgent({
      structuredUrgency: END_OF_CALL_REPORT.message.analysis.structuredData.urgency,
      transcript: END_OF_CALL_REPORT.message.artifact.transcript,
      messages: END_OF_CALL_REPORT.message.artifact.messages,
    }), false);
  });

  it('flags urgency from the caller\'s own words', () => {
    assert.equal(isCallerUrgent({
      structuredUrgency: 'normal',
      transcript: 'AI: Is this an emergency?\nUser: Yes, we have no water and it is flooding.',
      messages: [
        { role: 'bot', message: 'Is this an emergency? Do you have no water?' },
        { role: 'user', message: 'Yes, we have no water and it is flooding.' },
      ],
    }), true);
  });
});

describe('createCallback and flagEmergency', () => {
  it('saves a callback, emails the office, and speaks no phone number or clock time', async () => {
    const request = officeRequestFromTool('createCallback', {
      name: 'Maria Lopez',
      phone: '7605550199',
      address: '12 Sage Rd',
      city: 'Sage',
      reason: 'Pump is noisy',
      email: 'maria@example.com',
      repeatCaller: true,
    }, '+17605550199');

    const inserts: unknown[] = [];
    const emails: Array<{ to: string; subject: string; text: string }> = [];
    const saved = await saveSarahOfficeRequest(request, {
      insertBooking: async (row) => {
        inserts.push(row);
        return { id: 'booking-1' };
      },
      sendAlert: async (message) => {
        emails.push(message);
        return { success: true };
      },
    });

    assert.equal(inserts.length, 1);
    const row = inserts[0] as ReturnType<typeof bookingRowForOfficeRequest>;
    assert.equal(row.source, 'phone');
    assert.equal(row.service_type, 'Callback');
    assert.equal(row.customer_name, 'Maria Lopez');
    assert.equal(row.phone, '7605550199');
    assert.equal(row.address, '12 Sage Rd');
    assert.equal(row.city, 'Sage');
    assert.equal(row.email, 'maria@example.com');
    assert.match(row.notes, /Emergency: no/);
    assert.match(row.notes, /Pump is noisy/);
    assert.match(row.notes, /Repeat caller: yes/);

    assert.deepEqual(emails.map((message) => message.to), [...OFFICE_ALERT_EMAILS]);
    assert.equal(emails[0].subject, '📞 Sarah callback: Maria Lopez / (760) 555-0199');
    assert.ok(emails.every((message) => message.subject === emails[0].subject));
    assert.match(emails[0].text, /12 Sage Rd/);
    assert.match(emails[0].text, /Do not text the customer/);

    assert.equal(saved.success, true);
    assert.equal(saved.message, CALLBACK_SPOKEN_MESSAGE);
    assert.equal(isSafeSarahMessage(saved.message), true);
    assert.doesNotMatch(saved.message, /760|555/);
  });

  it('flags an emergency with an urgent subject and the same spoken limits', async () => {
    const parsed = parseVapiServerTools({
      message: {
        type: 'tool-calls',
        call: { customer: { number: '+17605551212' } },
        toolCallList: [
          {
            id: 'call_tool_emergency',
            type: 'function',
            function: {
              name: 'flagEmergency',
              arguments: JSON.stringify({
                callerName: 'Jon Reed',
                address: '88 Warner Springs Rd',
                description: 'No water at the house',
              }),
            },
          },
        ],
      },
    });
    assert.equal(parsed.mode, 'tool-calls');
    if (parsed.mode !== 'tool-calls') return;

    const request = officeRequestFromTool(
      parsed.calls[0].name,
      parsed.calls[0].params,
      '+17605551212',
    );
    assert.equal(request.kind, 'emergency');
    assert.equal(request.phone, '+17605551212');

    const emails: Array<{ to: string; subject: string }> = [];
    const saved = await saveSarahOfficeRequest(request, {
      insertBooking: async () => ({ id: 'booking-9' }),
      sendAlert: async (message) => {
        emails.push(message);
        return { success: true };
      },
    });

    assert.deepEqual(emails.map((message) => message.to), [...OFFICE_ALERT_EMAILS]);
    assert.equal(emails[0].subject, '🚨 Sarah EMERGENCY: Jon Reed / (760) 555-1212 – No water at the house');
    assert.ok(emails.every((message) => message.subject === emails[0].subject));
    assert.equal(alertSubject(request), emails[0].subject);
    assert.equal(saved.message, EMERGENCY_SPOKEN_MESSAGE);
    assert.equal(isSafeSarahMessage(saved.message), true);

    const http = vapiToolHttpBody(parsed, [
      { id: parsed.calls[0].id, body: { result: { success: saved.success, message: saved.message } } },
    ]);
    const results = http.results as Array<{ toolCallId: string; result: string }>;
    assert.equal(results[0].toolCallId, 'call_tool_emergency');
    const spoken = JSON.parse(results[0].result) as { message: string };
    assert.equal(isSafeSarahMessage(spoken.message), true);
    assert.doesNotMatch(results[0].result, /7605551212|\(760\)/);
  });

  it('keeps the failure message free of phone numbers and clock times', async () => {
    const saved = await saveSarahOfficeRequest(
      officeRequestFromTool('flagEmergency', {
        name: 'Ana',
        phone: '7605550100',
        description: 'No water',
      }),
      {
        insertBooking: async () => { throw new Error('db down'); },
        sendAlert: async () => { throw new Error('email down'); },
      },
    );
    assert.equal(saved.success, false);
    assert.equal(saved.emailSent, false);
    assert.equal(isSafeSarahMessage(saved.message), true);
    assert.doesNotMatch(saved.message, /760|minute|pm|am/i);
  });

  it('still alerts by email when the booking insert fails', async () => {
    const saved = await saveSarahOfficeRequest(
      officeRequestFromTool('createCallback', { name: 'Pat', reason: 'callback' }),
      {
        insertBooking: async () => ({ error: 'relation missing' }),
        sendAlert: async () => ({ success: true }),
      },
    );
    assert.equal(saved.success, true);
    assert.equal(saved.emailSent, true);
    assert.equal(isSafeSarahMessage(saved.message), true);
  });
});
