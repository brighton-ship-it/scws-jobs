import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePhoneCallLog, enrichPhoneLog } from './phone-call-log.ts';

const ev = (time: string, name: string, p: Record<string, string>, email?: string) => ({
  id: { time }, actor: email ? { email } : { key: 'System' },
  events: [{ name, parameters: Object.entries(p).map(([k, v]) => ({ name: k, value: v })) }],
});
const rg = (t: string, id: string, src: string, dur: string) =>
  ev(t, 'RING_GROUP_INCOMING_CALL_RECEIVED', { PARAM_DESTINATION: '+17604408520', PARAM_SOURCE: src, PARAM_DURATION: dur, PARAM_RING_DURATION: dur, PARAM_DISTRIBUTION_ID: id, PARAM_RING_GROUP_NAME: 'Sc and Ransom' });

test('classifies answered, missed, forwarded to AI', () => {
  const rows = parsePhoneCallLog({ items: [
    rg('2026-10-10T16:00:20.500Z', 'A', '+17602712106', '1000'),
    ev('2026-10-10T16:00:20.442Z', 'RING_GROUP_OUTGOING_CALL_MADE', { PARAM_DESTINATION: '+17604915348', PARAM_SOURCE: '+17602712106' }),
    rg('2026-10-09T22:19:25.122Z', 'B', '+16196540952', '155000'),
    ev('2026-10-09T22:19:25.0Z', 'INCOMING_CALL_RECEIVED', { PARAM_DISTRIBUTION_ID: 'B', PARAM_DURATION: '155000', PARAM_RING_DURATION: '6693', PARAM_DESTINATION: '+16193208264' }, 'lizbeth@scwellservice.com'),
    ev('2026-10-09T22:19:25.0Z', 'INCOMING_CALL_RECEIVED', { PARAM_DISTRIBUTION_ID: 'B', PARAM_DURATION: '0', PARAM_RING_DURATION: '0', PARAM_DESTINATION: '+14422272898' }, 'shanicey@scwellservice.com'),
    rg('2026-10-09T23:05:00.134Z', 'C', '+17609177792', '0'),
    rg('2026-10-09T23:06:03.018Z', 'D', '+17609177792', '93000'),
  ] });
  const by = Object.fromEntries(rows.map((r) => [r.voice_call_key, r]));
  assert.equal(by.A.outcome, 'forwarded_ai');
  assert.equal(by.B.outcome, 'answered');
  assert.equal(by.B.answered_by, 'lizbeth@scwellservice.com');
  assert.equal(by.B.duration_seconds, 155);
  assert.equal(by.C.outcome, 'missed');
  assert.equal(by.D.outcome, 'answered_unknown');
});

test('enrich matches ads, Mike and client by phone', () => {
  const rows = parsePhoneCallLog({ items: [rg('2026-10-10T16:00:20.500Z', 'A', '+17602712106', '1000'),
    ev('2026-10-10T16:00:20.442Z', 'RING_GROUP_OUTGOING_CALL_MADE', { PARAM_DESTINATION: '+17604915348', PARAM_SOURCE: '+17602712106' })] });
  const [r] = enrichPhoneLog(rows,
    [{ caller_phone: '7602712106', started_at: '2026-10-10T16:01:00Z', campaign_name: 'Search', keyword: null, call_view_resource: 'x' }],
    [{ vapi_call_id: 'v1', phone: '+17602712106', called_at: '2026-10-10T16:00:25Z' }],
    [{ phone: '(760) 271-2106', customer_id: 'c1', jobber_client_id: null, name: 'Ryan' }]);
  assert.equal(r.campaign_name, 'Search');
  assert.equal(r.receptionist_call_id, 'v1');
  assert.equal(r.customer_id, 'c1');
});

import { buildCallLogView } from './call-dashboard.ts';
test('call log view counts today and keeps newest first', () => {
  const v = buildCallLogView([
    { started_at: '2026-10-10T16:00:00Z', caller_phone: '+17602712106', outcome: 'missed', synced_at: 's1' },
    { started_at: '2026-10-10T15:00:00Z', caller_phone: '+17609177792', outcome: 'answered', answered_by: 'lizbeth@scwellservice.com' },
    { started_at: '2026-10-09T15:00:00Z', caller_phone: '+17609177793', outcome: 'missed' },
  ], new Date('2026-10-10T18:00:00Z'));
  assert.equal(v.rows[0].outcome, 'missed');
  assert.equal(v.rows[1].answeredBy, 'lizbeth');
  assert.deepEqual(v.today, { total: 2, answered: 1, missed: 1, forwardedAi: 0 });
});
