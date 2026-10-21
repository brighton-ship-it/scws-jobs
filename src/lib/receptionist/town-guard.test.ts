import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkServiceArea } from './service-area.ts';
import {
  TOWN_GUARD_MESSAGE,
  callerTownContext,
  rememberLookupCaller,
  townGuardResult,
  validateTownArg,
  withTownGuard,
} from './town-guard.ts';

test('rejects a surname and accepts a real town, ZIP, or property city', () => {
  const fowler = validateTownArg('Fowler', { callerName: 'Kristy Fowler' });
  assert.equal(fowler.ok, false);
  if (!fowler.ok) {
    assert.equal(fowler.reason, 'matches_caller_name');
    assert.equal(fowler.message, TOWN_GUARD_MESSAGE);
  }

  const scala = validateTownArg('scala', { callerName: 'Brighton Scala' });
  assert.equal(scala.ok, false);
  if (!scala.ok) assert.equal(scala.reason, 'matches_caller_name');

  assert.equal(validateTownArg('Ramona', { callerName: 'Kristy Fowler' }).ok, true);
  assert.equal(validateTownArg('92065', {}).ok, true);
  assert.equal(validateTownArg('Alpine', { callerName: 'Pat Alpine' }).ok, true);
  const file = validateTownArg('Santa Rosa', { addressOnFile: { city: 'Santa Rosa' } });
  assert.equal(file.ok, true);
  assert.equal(validateTownArg('', { callerName: 'Kristy Fowler' }).ok, false);
});

test('Lancaster passes checkServiceArea and is unknown on checkSchedule', () => {
  const area = townGuardResult('checkServiceArea', { city: 'Lancaster' }, { callerName: 'Kristy Fowler' });
  assert.equal(area, null);
  const schedule = validateTownArg('Lancaster', { callerName: 'Kristy Fowler' });
  assert.equal(schedule.ok, false);
  if (!schedule.ok) assert.equal(schedule.reason, 'unknown_place');
  const blocked = townGuardResult('checkSchedule', { city: 'Lancaster' }, { callerName: 'Kristy Fowler' });
  assert.equal(blocked?.result.error, 'invalid_town');
});

test('checkSchedule with a surname does not run the tool or fetch Jobber', async () => {
  let ran = 0;
  let fetches = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetches += 1;
    return new Response('{}');
  }) as typeof fetch;
  try {
    const result = await withTownGuard(
      'checkSchedule',
      { city: 'Fowler', phone: '7605550100' },
      { callerName: 'Kristy Fowler' },
      async () => {
        ran += 1;
        await fetch('https://api.getjobber.com/api/graphql');
        return { result: { openSlots: [] } };
      },
    );
    assert.equal(ran, 0);
    assert.equal(fetches, 0);
    const blocked = result as { result: { error?: string; message?: string } };
    assert.equal(blocked.result.error, 'invalid_town');
    assert.match(String(blocked.result.message), /What town is the well in/);
  } finally {
    globalThis.fetch = original;
  }
});

test('checkServiceArea still answers Lancaster, and a cached lookup name blocks Fowler', async () => {
  let ran = false;
  const passed = await withTownGuard('checkServiceArea', { city: 'Lancaster' }, { callerName: 'Kristy Fowler' }, () => {
    ran = true;
    return checkServiceArea('Lancaster');
  });
  assert.equal(ran, true);
  const area = passed as { result: { inServiceArea?: boolean | null } };
  assert.equal(area.result.inServiceArea, null);

  rememberLookupCaller('call-kristy', { customerName: 'Kristy Fowler', city: 'Ramona' });
  const ctx = callerTownContext('call-kristy', {});
  const blocked = townGuardResult('checkServiceArea', { city: 'Fowler' }, ctx);
  assert.equal(blocked?.result.error, 'invalid_town');
  const ramona = townGuardResult('checkSchedule', { city: 'Ramona' }, ctx);
  assert.equal(ramona, null);
});

test('the webhook guards checkServiceArea, checkSchedule and book_job before Jobber', () => {
  const route = readFileSync(new URL('../../app/api/receptionist/webhook/route.ts', import.meta.url), 'utf8');
  const schedule = route.slice(route.indexOf("case 'checkSchedule'"), route.indexOf("case 'bookJob'"));
  const book = route.slice(route.indexOf("case 'bookJob'"), route.indexOf("case 'getServiceInfo'"));
  const area = route.slice(route.indexOf("case 'checkServiceArea'"), route.indexOf("case 'getBusinessHours'"));
  assert.ok(schedule.indexOf('withTownGuard') < schedule.indexOf('handleCheckSchedule'));
  assert.ok(book.indexOf('withTownGuard') < book.indexOf('handleBookServiceCall'));
  assert.ok(area.indexOf('withTownGuard') < area.indexOf('checkServiceArea('));
});
