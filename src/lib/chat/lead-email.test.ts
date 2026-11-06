import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeadEmail,
  hasContactInfo,
  isUrgentMessage,
  leadSubjectLabel,
  priorHistory,
  sanitizeHistory,
  shouldSendLeadEmail,
} from './lead-email.ts';

describe('isUrgentMessage', () => {
  it('matches the live-site urgent keywords', () => {
    assert.equal(isUrgentMessage('we have no water'), true);
    assert.equal(isUrgentMessage('This is an emergency'), true);
    assert.equal(isUrgentMessage('pipe flood in the basement'), true);
    assert.equal(isUrgentMessage('URGENT callback please'), true);
    assert.equal(isUrgentMessage('hello there'), false);
  });
});

describe('hasContactInfo', () => {
  it('detects phone numbers and any @ (existing chat heuristic)', () => {
    assert.equal(hasContactInfo('call me at 760-440-8520'), true);
    assert.equal(hasContactInfo('760.555.1212'), true);
    assert.equal(hasContactInfo('me@ranch.com'), true);
    assert.equal(hasContactInfo('hello'), false);
  });
});

describe('sanitizeHistory / priorHistory', () => {
  it('keeps the last 20 user/assistant turns and drops junk', () => {
    const history = [
      { role: 'system', content: 'ignore me' },
      { role: 'user', content: '  hi  ' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: '' },
      { role: 'tool', content: 'nope' },
      null,
    ];
    assert.deepEqual(sanitizeHistory(history), [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    assert.deepEqual(sanitizeHistory(undefined), []);
  });

  it('drops a trailing current-message duplicate', () => {
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: '760-555-1212' },
    ];
    assert.deepEqual(priorHistory(history, '760-555-1212'), [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });
});

describe('shouldSendLeadEmail', () => {
  it('does not email a lone hello', () => {
    assert.equal(shouldSendLeadEmail([], 'hello'), false);
    assert.equal(shouldSendLeadEmail([], '  '), false);
  });

  it('emails when the current message has a phone or email', () => {
    assert.equal(shouldSendLeadEmail([], 'please call 760-555-1212'), true);
    assert.equal(shouldSendLeadEmail([], 'email me@ranch.com'), true);
  });

  it('emails when the current message is urgent', () => {
    assert.equal(shouldSendLeadEmail([], 'no water since last night'), true);
  });

  it('emails on the 3rd user turn even without contact', () => {
    const history = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'how can I help' },
      { role: 'user' as const, content: 'how much for a pump' },
      { role: 'assistant' as const, content: 'typically 2 to 5k' },
    ];
    assert.equal(shouldSendLeadEmail(history, 'I need a quote'), true);
    assert.equal(
      shouldSendLeadEmail(history.slice(0, 2), 'how much for a pump'),
      false
    );
  });

  it('does not re-email after a phone/email hit unless this turn is newly urgent', () => {
    const history = [
      { role: 'user' as const, content: 'hi my number is 760-555-1212' },
      { role: 'assistant' as const, content: 'thanks' },
    ];
    assert.equal(shouldSendLeadEmail(history, 'also I live in Ramona'), false);
    assert.equal(shouldSendLeadEmail(history, 'this is an emergency'), true);
  });

  it('does not re-email after an earlier urgent hit', () => {
    const history = [
      { role: 'user' as const, content: 'emergency no water' },
      { role: 'assistant' as const, content: 'we can help' },
    ];
    assert.equal(shouldSendLeadEmail(history, '760-555-1212'), false);
    assert.equal(shouldSendLeadEmail(history, 'still urgent'), false);
  });

  it('does not re-email after the 3rd-turn lead unless newly urgent', () => {
    const history = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
      { role: 'user' as const, content: 'pump quote' },
      { role: 'assistant' as const, content: 'sure' },
      { role: 'user' as const, content: 'in ramona' },
      { role: 'assistant' as const, content: 'got it' },
    ];
    assert.equal(shouldSendLeadEmail(history, '760-555-1212'), false);
    assert.equal(shouldSendLeadEmail(history, 'flood in the pump house'), true);
  });
});

describe('leadSubjectLabel / buildLeadEmail', () => {
  it('prefers typed name, then phone, then page host', () => {
    assert.equal(
      leadSubjectLabel({ name: 'Pat' }, ['hi']),
      'Pat'
    );
    assert.equal(
      leadSubjectLabel({ pageUrl: 'https://www.scwellservice.com/pumps' }, [
        'call 760-555-1212',
      ]),
      '760-555-1212'
    );
    assert.equal(
      leadSubjectLabel({ pageUrl: 'https://www.scwellservice.com/pumps' }, ['hi']),
      'scwellservice.com'
    );
    assert.equal(leadSubjectLabel({}, ['my name is Jordan']), 'Jordan');
  });

  it('builds a transcript email without inventing last names', () => {
    const { subject, text } = buildLeadEmail({
      sessionId: 'chat_1',
      visitorInfo: { pageUrl: 'https://scwellservice.com/contact' },
      history: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'Hi!' }],
      userMessage: 'no water — 760-555-1212',
      assistantReply: 'We can send a tech. Call (760) 440-8520 if needed.',
      urgent: true,
      now: new Date('2026-08-21T18:00:00.000Z'),
    });

    assert.equal(subject, 'Sarah chat: 760-555-1212 ⚠️ URGENT');
    assert.match(text, /Page: https:\/\/scwellservice.com\/contact/);
    assert.match(text, /Session: chat_1/);
    assert.match(text, /PT/);
    assert.match(text, /User: hello/);
    assert.match(text, /Sarah: Hi!/);
    assert.match(text, /User: no water/);
    assert.match(text, /Sarah: We can send a tech/);
    assert.doesNotMatch(text, /Scala|OPENAI|RESEND|api[_-]?key/i);
  });
});
