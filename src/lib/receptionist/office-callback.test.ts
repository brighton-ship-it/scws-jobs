import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callCustomerPhone, parseVapiServerTools, vapiCallId } from './vapi-tools.ts';
import {
  CALLBACK_SPOKEN_MESSAGE,
  EMERGENCY_SPOKEN_MESSAGE,
  OFFICE_ALERT_EMAILS,
  type BookingRequestInsert,
  type OfficeAlertPatch,
  type OfficeAlertRow,
  type OfficeRequestDeps,
  findMatchingOfficeAlert,
  isMissingOfficeDedupeColumnError,
  isSafeSarahMessage,
  officeRequestFromTool,
  resolveOfficeToolBatch,
} from './office-callback.ts';

const NOW = new Date('2026-10-07T13:55:00.000Z');

function memoryOfficeDeps() {
  const rows: OfficeAlertRow[] = [];
  const emails: Array<{ to: string; subject: string; text: string }> = [];
  let seq = 0;
  let now = NOW;

  const deps: OfficeRequestDeps = {
    now: () => now,
    loadCandidates: async () => rows.map((row) => ({ ...row })),
    insertBooking: async (row: BookingRequestInsert) => {
      seq += 1;
      const id = `booking-${seq}`;
      rows.push({
        id,
        serviceType: row.service_type,
        notes: row.notes,
        phone: row.phone,
        address: row.address,
        city: row.city,
        customerName: row.customer_name,
        email: row.email,
        vapiCallId: row.vapi_call_id ?? null,
        toolCallId: row.tool_call_id ?? null,
        createdAt: now.toISOString(),
      });
      return { id };
    },
    updateBooking: async (id: string, patch: OfficeAlertPatch) => {
      const row = rows.find((item) => item.id === id);
      if (!row) return { error: 'missing' };
      row.notes = patch.notes;
      row.serviceType = patch.serviceType;
      row.toolCallId = patch.toolCallId;
      row.vapiCallId = patch.vapiCallId;
      row.address = patch.address;
      row.city = patch.city;
      row.customerName = patch.customerName;
      row.email = patch.email;
      return {};
    },
    sendAlert: async (message) => {
      emails.push(message);
      return { success: true };
    },
  };

  return {
    rows,
    emails,
    deps,
    setNow(next: Date) {
      now = next;
    },
  };
}

const KAREN_CALL = '01a116a6-049d-7000-a1be-0d28cdd9ad3d';

function karenParallelBody() {
  return {
    message: {
      type: 'tool-calls',
      call: {
        id: KAREN_CALL,
        customer: { number: '+17605550199' },
      },
      toolCallList: [
        {
          id: 'call_W42R2brXsGfsub5mCl3sFdi6',
          type: 'function',
          function: {
            name: 'flagEmergency',
            arguments: JSON.stringify({
              callerName: 'Karen',
              details: 'No water',
            }),
          },
        },
        {
          id: 'call_Id7lTKQ0rwmTr2gB17Ehn7xT',
          type: 'function',
          function: {
            name: 'createCallback',
            arguments: JSON.stringify({
              name: 'Karen',
              isEmergency: true,
              message: 'Address: California 92225',
            }),
          },
        },
      ],
    },
  };
}

describe('Sarah office alert dedupe', () => {
  it('sends one email set and one row for parallel flagEmergency and createCallback', async () => {
    const body = karenParallelBody();
    const parsed = parseVapiServerTools(body);
    assert.equal(parsed.mode, 'tool-calls');
    if (parsed.mode !== 'tool-calls') return;
    assert.equal(vapiCallId(body), KAREN_CALL);
    assert.equal(parsed.calls.length, 2);

    const store = memoryOfficeDeps();
    const outcomes = await resolveOfficeToolBatch(parsed.calls, {
      callPhone: callCustomerPhone(body),
      vapiCallId: vapiCallId(body),
      deps: store.deps,
    });

    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].serviceType, 'Emergency');
    assert.equal(store.rows[0].vapiCallId, KAREN_CALL);
    assert.equal(store.rows[0].toolCallId, 'call_W42R2brXsGfsub5mCl3sFdi6|call_Id7lTKQ0rwmTr2gB17Ehn7xT');
    assert.match(store.rows[0].notes, /No water/);
    assert.match(store.rows[0].notes, /Address: California 92225/);

    assert.equal(store.emails.length, OFFICE_ALERT_EMAILS.length);
    assert.deepEqual(store.emails.map((message) => message.to), [...OFFICE_ALERT_EMAILS]);
    assert.match(store.emails[0].subject, /🚨 Mike EMERGENCY/);
    assert.match(store.emails[0].text, /No water/);
    assert.match(store.emails[0].text, /Address: California 92225/);
    assert.ok(store.emails.every((message) => message.subject === store.emails[0].subject));

    assert.equal(outcomes.length, 2);
    assert.ok(outcomes.every((outcome) => outcome.body.result.success));
    assert.ok(outcomes.every((outcome) => outcome.body.result.message === EMERGENCY_SPOKEN_MESSAGE));
    assert.ok(outcomes.every((outcome) => isSafeSarahMessage(outcome.body.result.message)));
  });

  it('skips an exact repeat of the same toolCallId', async () => {
    const store = memoryOfficeDeps();
    const call = {
      id: 'call_same_tool',
      name: 'flagEmergency',
      params: { name: 'Ana', phone: '7605550100', details: 'No water' },
    };
    const options = {
      callPhone: '+17605550100',
      vapiCallId: 'vapi-repeat',
      deps: store.deps,
    };

    const first = await resolveOfficeToolBatch([call], options);
    const second = await resolveOfficeToolBatch([call], options);

    assert.equal(store.rows.length, 1);
    assert.equal(store.emails.length, OFFICE_ALERT_EMAILS.length);
    assert.equal(first[0].body.result.success, true);
    assert.equal(second[0].body.result.success, true);
    assert.equal(second[0].body.result.message, EMERGENCY_SPOKEN_MESSAGE);
  });

  it('alerts again when a callback is upgraded to an emergency on the same call', async () => {
    const store = memoryOfficeDeps();
    const shared = { callPhone: '+17605550199', vapiCallId: KAREN_CALL, deps: store.deps };

    await resolveOfficeToolBatch([{
      id: 'tool-callback',
      name: 'createCallback',
      params: { name: 'Karen', phone: '7605550199', reason: 'Pump is noisy', address: '1 Main St' },
    }], shared);

    await resolveOfficeToolBatch([{
      id: 'tool-emergency',
      name: 'flagEmergency',
      params: { name: 'Karen', phone: '7605550199', details: 'No water at all' },
    }], shared);

    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].serviceType, 'Emergency');
    assert.match(store.rows[0].notes, /Pump is noisy/);
    assert.match(store.rows[0].notes, /No water at all/);
    assert.match(store.rows[0].notes, /upgraded this callback to an emergency/i);
    assert.equal(store.emails.length, OFFICE_ALERT_EMAILS.length * 2);
    assert.match(store.emails[0].subject, /Mike callback/);
    assert.match(store.emails[OFFICE_ALERT_EMAILS.length].subject, /Mike EMERGENCY/);
    assert.match(store.emails[OFFICE_ALERT_EMAILS.length].text, /No water at all/);
  });

  it('does not send a second email for a callback after an emergency on the same call', async () => {
    const store = memoryOfficeDeps();
    const shared = { callPhone: '+17605550199', vapiCallId: KAREN_CALL, deps: store.deps };

    await resolveOfficeToolBatch([{
      id: 'tool-emergency',
      name: 'flagEmergency',
      params: { name: 'Karen', details: 'No water', phone: '7605550199' },
    }], shared);
    const followUp = await resolveOfficeToolBatch([{
      id: 'tool-callback',
      name: 'createCallback',
      params: { name: 'Karen', reason: 'Gate code 1234', phone: '7605550199' },
    }], shared);

    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].serviceType, 'Emergency');
    assert.match(store.rows[0].notes, /Gate code 1234/);
    assert.equal(store.emails.length, OFFICE_ALERT_EMAILS.length);
    assert.equal(followUp[0].body.result.success, true);
    assert.equal(followUp[0].body.result.message, CALLBACK_SPOKEN_MESSAGE);
  });

  it('keeps message and details text in the alert', async () => {
    const callback = officeRequestFromTool('createCallback', {
      name: 'Karen',
      reason: 'No water',
      message: 'Address: California 92225',
    }, '+17605550199');
    assert.match(callback.reason, /No water/);
    assert.match(callback.reason, /Address: California 92225/);

    const emergency = officeRequestFromTool('flagEmergency', {
      callerName: 'Karen',
      description: 'Sewage backing up',
      details: 'Address: California 92225',
    }, '+17605550199');
    assert.equal(emergency.kind, 'emergency');
    assert.match(emergency.reason, /Sewage backing up/);
    assert.match(emergency.reason, /Address: California 92225/);

    const duplicated = officeRequestFromTool('createCallback', {
      reason: 'No water',
      message: 'No water',
      details: 'no water',
    });
    assert.equal(duplicated.reason, 'No water');

    const store = memoryOfficeDeps();
    await resolveOfficeToolBatch([{
      id: 'tool-details',
      name: 'flagEmergency',
      params: {
        callerName: 'Karen',
        description: 'Sewage backing up',
        details: 'Address: California 92225',
      },
    }], {
      callPhone: '+17605550199',
      vapiCallId: 'vapi-details',
      deps: store.deps,
    });

    assert.match(store.emails[0].text, /Sewage backing up/);
    assert.match(store.emails[0].text, /Address: California 92225/);
    assert.match(store.rows[0].notes, /Address: California 92225/);
  });

  it('dedupes by phone for 10 minutes when the call id is missing', async () => {
    const store = memoryOfficeDeps();
    const call = {
      id: null as string | null,
      name: 'createCallback',
      params: { name: 'Pat', phone: '+1 (760) 555-0199', reason: 'Quote' },
    };

    await resolveOfficeToolBatch([call], { callPhone: '', vapiCallId: null, deps: store.deps });
    await resolveOfficeToolBatch([{
      ...call,
      id: 'tool-second',
      params: { name: 'Pat', phone: '7605550199', reason: 'Quote', message: 'Call the shop line' },
    }], { callPhone: '', vapiCallId: null, deps: store.deps });

    assert.equal(store.rows.length, 1);
    assert.equal(store.emails.length, OFFICE_ALERT_EMAILS.length);
    assert.match(store.rows[0].notes, /Call the shop line/);
  });

  it('uses the phone window when the stored row has no call id yet', () => {
    const existing: OfficeAlertRow = {
      id: 'booking-1',
      serviceType: 'Callback',
      notes: 'Mike requested a callback.',
      phone: '17605550199',
      address: '',
      city: '',
      customerName: 'Karen',
      email: null,
      vapiCallId: null,
      toolCallId: null,
      createdAt: NOW.toISOString(),
    };
    const match = findMatchingOfficeAlert([existing], {
      toolCallId: 'tool-b',
      vapiCallId: 'call-b',
      phone: '7605550199',
      sinceMs: NOW.getTime() - 10 * 60 * 1000,
    });
    assert.equal(match?.matchedBy, 'phone');
    assert.equal(match?.row.id, 'booking-1');
  });

  it('still alerts a different Vapi call from the same phone', () => {
    const existing: OfficeAlertRow = {
      id: 'booking-1',
      serviceType: 'Emergency',
      notes: 'Mike flagged an emergency.',
      phone: '17605550199',
      address: '',
      city: '',
      customerName: 'Karen',
      email: null,
      vapiCallId: 'call-a',
      toolCallId: 'tool-a',
      createdAt: NOW.toISOString(),
    };
    const match = findMatchingOfficeAlert([existing], {
      toolCallId: 'tool-b',
      vapiCallId: 'call-b',
      phone: '7605550199',
      sinceMs: NOW.getTime() - 10 * 60 * 1000,
    });
    assert.equal(match, null);
  });

  it('treats Postgres 42703 and "does not exist" as a missing dedupe column', () => {
    assert.equal(isMissingOfficeDedupeColumnError({
      code: '42703',
      message: 'column booking_requests.vapi_call_id does not exist',
    }), true);
    assert.equal(isMissingOfficeDedupeColumnError({
      code: 42703,
      message: 'column "tool_call_id" does not exist',
    }), true);
    assert.equal(isMissingOfficeDedupeColumnError({
      message: 'column tool_call_id of relation booking_requests does not exist',
    }), true);
    assert.equal(isMissingOfficeDedupeColumnError({
      code: 'PGRST204',
      message: "Could not find the 'vapi_call_id' column of 'booking_requests' in the schema cache",
    }), true);

    assert.equal(isMissingOfficeDedupeColumnError(null), false);
    assert.equal(isMissingOfficeDedupeColumnError({
      code: '42703',
      message: 'column customers.gclid does not exist',
    }), false);
    assert.equal(isMissingOfficeDedupeColumnError({
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    }), false);
  });

  it('reads the call id from body.call when message.call is missing', () => {
    assert.equal(vapiCallId({ call: { id: 'from-root' } }), 'from-root');
    assert.equal(vapiCallId({
      message: { call: { id: 'from-message' } },
      call: { id: 'from-root' },
    }), 'from-message');
  });
});
