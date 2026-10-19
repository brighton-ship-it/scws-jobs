import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCallFeed, markMikeHandoffs } from './call-feed.ts';

test('tracking-line call the office missed and Mike answered shows as Mike, with his summary', () => {
  const rows = mergeCallFeed({
    recordings: [{ started_at: '2026-10-17T00:12:11.976Z', caller_number: '+18582019456', tracking_number: '+17602791262', source: 'gbp_ramona', dial_status: 'no-answer', answered: false, duration_seconds: null, summary: null, caller_name: 'Adnan' }],
    log: [{ started_at: '2026-10-17T00:12:18.008Z', caller_phone: '+18582019456', called_number: '+17602763468', outcome: 'missed', client_name: 'Adnan Hasan' }],
    mike: [{ vapi_call_id: 'v-adnan', phone: '+18582019456', called_at: '2026-10-17T00:13:05Z', customer_name: 'Adnan', summary: 'Caller asked for an update on the HOA well.', duration_sec: 140 }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'Mike (AI)');
  assert.equal(rows[0].line, 'Mike · GBP Ramona');
  assert.equal(rows[0].summary, 'Caller asked for an update on the HOA well.');
  assert.equal(rows[0].durationSeconds, 140);
});

test('repeat caller keeps every call and the earlier Mike summary', () => {
  const rows = mergeCallFeed({
    recordings: [],
    log: [
      { started_at: '2026-10-16T22:13:07.896Z', caller_phone: '+19514914618', called_number: '+17604408520', outcome: 'missed', client_name: 'Diane Neale' },
      { started_at: '2026-10-16T22:13:04.239Z', caller_phone: '+19514914618', called_number: '+17604408520', outcome: 'missed', client_name: 'Diane Neale' },
      { started_at: '2026-10-16T22:11:55.418Z', caller_phone: '+19514914618', called_number: '+17604408520', outcome: 'forwarded_ai', receptionist_call_id: 'v-diane', duration_seconds: 64, client_name: 'Diane Neale' },
      { started_at: '2026-10-16T22:05:54.299Z', caller_phone: '+19514914618', called_number: '+17604408520', outcome: 'answered', answered_by: 'lizbeth@x', duration_seconds: 130, client_name: 'Diane Neale' },
    ],
    mike: [{ vapi_call_id: 'v-diane', phone: '+19514914618', called_at: '2026-10-16T22:12:00Z', customer_name: 'Diane', summary: 'Diane wants to pay invoice #5897.', duration_sec: 60 }],
  });
  // 3:13 (the two Voice rows 4 s apart are one call), 3:11 Mike, 3:05 answered
  assert.deepEqual(rows.map((r) => r.outcome), ['Missed', 'Mike (AI)', 'Answered']);
  assert.equal(rows[1].summary, 'Diane wants to pay invoice #5897.');
  assert.equal(rows[1].line, 'Mike · Main');
});

test('Mike call straight to the AI line keeps its own row', () => {
  const rows = mergeCallFeed({
    recordings: [], log: [{ started_at: '2026-10-16T20:00:00Z', caller_phone: '+17605551234', outcome: 'answered', answered_by: 'liz', duration_seconds: 90 }],
    mike: [{ vapi_call_id: 'v1', phone: '+17605551234', called_at: '2026-10-16T20:03:00Z', summary: 'Second call to Mike.' }],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].line, 'Mike');
});

test('markMikeHandoffs relabels a missed Voice leg Mike picked up', () => {
  const out = markMikeHandoffs(
    [{ started_at: '2026-10-17T00:12:18Z', caller_phone: '+18582019456', outcome: 'missed' }, { started_at: '2026-10-16T22:13:07Z', caller_phone: '+19514914618', outcome: 'missed' }],
    [{ vapi_call_id: 'v-adnan', phone: '+18582019456', called_at: '2026-10-17T00:13:05Z' }],
  );
  const adnan = out.find((r) => r.caller_phone === '+18582019456') as any;
  assert.equal(adnan.outcome, 'forwarded_ai');
  assert.equal(adnan.receptionist_call_id, 'v-adnan');
  assert.equal(out.find((r) => r.caller_phone === '+19514914618')!.outcome, 'missed');
});

test('tracking-line answered call takes the answerer from the matching Voice log row; Mike hand-offs say Mike', () => {
  const rows = mergeCallFeed({
    recordings: [
      { started_at: '2026-10-19T16:34:57.929Z', caller_number: '+16192004716', tracking_number: '+17603312502', source: 'google_ads', dial_status: 'completed', answered: true, duration_seconds: 203, outcome: 'quote_request' },
      { started_at: '2026-10-19T16:05:00Z', caller_number: '+17605550111', tracking_number: '+17602791262', source: 'gbp_ramona', dial_status: 'completed', answered: true, duration_seconds: 90, outcome: 'quote_request' },
    ],
    log: [
      { started_at: '2026-10-19T16:35:09.818Z', caller_phone: '+16192004716', called_number: '+17602763468', outcome: 'answered', answered_by: 'shanicey@scwellservice.com' },
      { started_at: '2026-10-19T16:05:10Z', caller_phone: '+17605550111', called_number: '+17602763468', outcome: 'forwarded_ai' },
    ],
    mike: [],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.phone === '(619) 200-4716')!.answeredBy, 'shanicey');
  assert.equal(rows.find((r) => r.phone === '(760) 555-0111')!.answeredBy, 'Mike (AI)');
});
