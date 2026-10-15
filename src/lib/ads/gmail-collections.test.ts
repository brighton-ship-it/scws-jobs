import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCollectionText, collectionEmailEvents, delegationClaims, gmailAfterDay, gmailFederationConfig, gmailSearchTargets,
  gmailSentQueries, invoiceNumbersIn, isCourtesySubject, loadGmailCollection, SHOP_GMAIL_MAILBOXES, workloadIdentityAudience,
} from './gmail-collections.ts';

test('shop Gmail counts invoice mail and skips review requests', () => {
  assert.deepEqual(invoiceNumbersIn('Invoice #5818 from SCWS and #5621 ($200.00)'), ['5818', '5621']);
  assert.deepEqual(invoiceNumbersIn('invoice number 5504 needs to get closed'), ['5504']);
  const events = collectionEmailEvents([
    {
      id: 'm1',
      internalDate: String(Date.parse('2026-10-05T18:25:18Z')),
      from: 'Brighton Scala <brighton@scwellservice.com>',
      to: 'Nancy Cooper <nancy@pacificaglass.net>',
      subject: 'Invoice #5818 from SCWS',
      snippet: 'Please pay this invoice.',
    },
    {
      id: 'm2',
      internalDate: String(Date.parse('2026-10-01T17:00:00Z')),
      from: 'brighton@scwellservice.com',
      to: 'nancy@pacificaglass.net',
      subject: "How'd we do, Nancy?",
      snippet: 'Leave us a Google review.',
    },
    {
      id: 'm3',
      internalDate: String(Date.parse('2026-10-14T23:35:10Z')),
      from: 'brighton@scwellservice.com',
      to: 'NConner@hometownamerica.net',
      subject: 'Re: Invoice from Southern California Well Service - Yearly Service',
      snippet: 'Invoice #5621 ($200.00) is still open.',
    },
    {
      id: 'm4',
      internalDate: String(Date.parse('2026-10-13T18:41:26Z')),
      from: 'brighton@scwellservice.com',
      to: 'pwrobinson33@yahoo.com',
      subject: 'Paul — invoice #5504 needs to get closed',
      snippet: 'Balance is still open.',
    },
    {
      id: 'm5',
      internalDate: String(Date.parse('2026-10-10T18:00:00Z')),
      from: 'brighton@scwellservice.com',
      to: 'lawyer@example.com',
      subject: 'Account balance',
      snippet: 'The balance of $15,276.37 is with counsel.',
    },
  ], 'brighton@scwellservice.com');
  assert.deepEqual(events.map((event) => event.invoiceNumbers), [['5818'], ['5621'], ['5504']]);
  assert.equal(events[0].by, 'Brighton');
  assert.equal(events[0].channel, 'email');
  assert.equal(events[0].source, 'gmail');
  assert.equal(events[0].subject, 'Invoice #5818 from SCWS');
  assert.equal(events[0].paymentRequest, true);
  assert.deepEqual(events[0].toEmails, ['nancy@pacificaglass.net']);
  assert.deepEqual(events[2].toEmails, ['pwrobinson33@yahoo.com']);
  assert.equal(events.some((event) => event.toEmails?.[0] === 'lawyer@example.com'), false);
  assert.equal(events.some((event) => /review/i.test(event.invoiceNumbers?.join('') ?? '')), false);
  assert.equal(JSON.stringify(events).includes('Please pay'), false);
});

test('quotes, scheduling, and ordinary replies are not collection emails', () => {
  assert.equal(classifyCollectionText('Quote #4501 for the new pump. We can schedule Thursday.'), null);
  assert.equal(classifyCollectionText('See you Tuesday at the well.'), null);
  assert.equal(classifyCollectionText('The balance of $15,276.37 is with counsel.'), null);
  assert.equal(classifyCollectionText("How'd we do, Nancy? Leave us a Google review."), null);
  assert.equal(isCourtesySubject('Thanks!'), true);
  assert.equal(isCourtesySubject('Re: Invoice #5785 from SCWS'), false);
  const events = collectionEmailEvents([
    {
      id: 'q1',
      internalDate: String(Date.parse('2026-10-02T18:00:00Z')),
      from: 'brighton@scwellservice.com',
      to: 'kareneddy48@gmail.com',
      subject: 'Quote for the new pump',
      snippet: 'Estimate attached. We can schedule next week.',
    },
    {
      id: 's1',
      internalDate: String(Date.parse('2026-10-03T18:00:00Z')),
      from: 'brighton@scwellservice.com',
      to: 'oaktreeranch@gmail.com',
      subject: 'See you Tuesday',
      snippet: 'Confirming the appointment for the yearly service.',
    },
    {
      id: 'r1',
      internalDate: String(Date.parse('2026-10-04T18:00:00Z')),
      from: 'brighton@scwellservice.com',
      to: 'kareneddy48@gmail.com',
      subject: 'Thanks',
      snippet: 'Invoice #5785 is in the thread below.',
    },
    {
      id: 'oak',
      internalDate: String(Date.parse('2026-10-14T23:35:10Z')),
      from: 'brighton@scwellservice.com',
      to: 'NConner@hometownamerica.net',
      subject: 'Re: Invoice from Southern California Well Service - Yearly Service',
      snippet: 'Invoice #5621 ($200.00) covers the yearly inspection.',
    },
    {
      id: 'pay',
      internalDate: String(Date.parse('2026-10-11T18:00:00Z')),
      from: 'brighton@scwellservice.com',
      to: 'pwrobinson33@yahoo.com',
      subject: 'Paul — your balance is due',
      snippet: 'The remaining balance of $432.73 is past due.',
    },
  ], 'brighton@scwellservice.com');
  assert.deepEqual(events.map((event) => event.subject), [
    'Re: Invoice from Southern California Well Service - Yearly Service',
    'Paul — your balance is due',
  ]);
  assert.deepEqual(events[0].invoiceNumbers, ['5621']);
  assert.deepEqual(events[0].amounts, [200]);
  assert.equal(events[1].paymentRequest, true);
  assert.deepEqual(events[1].amounts, [432.73]);
  assert.deepEqual(events[1].invoiceNumbers, []);
});

test('domain-wide claims are read-only and name the mailbox', () => {
  const claims = delegationClaims({
    serviceAccountEmail: 'scws-gmail-readonly@scws-ads.iam.gserviceaccount.com',
    mailbox: 'lizbeth@scwellservice.com',
    nowSeconds: 1_700_000_000,
  });
  assert.equal(claims.iss, 'scws-gmail-readonly@scws-ads.iam.gserviceaccount.com');
  assert.equal(claims.sub, 'lizbeth@scwellservice.com');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(JSON.stringify(claims).includes('gmail.send'), false);
  const config = gmailFederationConfig({ GCP_PROJECT_NUMBER: '123456789012' } as NodeJS.ProcessEnv);
  assert.equal(config?.projectId, 'scws-ads');
  assert.equal(config?.poolId, 'vercel');
  assert.equal(config?.providerId, 'vercel');
  assert.equal(config?.serviceAccountEmail, 'scws-gmail-readonly@scws-ads.iam.gserviceaccount.com');
  assert.equal(workloadIdentityAudience(config!), '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel');
  assert.equal(gmailFederationConfig({} as NodeJS.ProcessEnv)?.projectNumber, '950015473137');
  assert.equal(gmailFederationConfig({ GCP_PROJECT_NUMBER: 'nope' } as NodeJS.ProcessEnv), null);
});

test('one mailbox can fail without zeroing mail from the others', async () => {
  const signed: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string'
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : '';
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
    if (url.includes('/gmail/v1/users/me/messages/send') || url.includes('gmail.send')) {
      return json({ error: 'send is not allowed' }, 500);
    }
    if (url.startsWith('https://sts.googleapis.com/')) {
      const fields = new URLSearchParams(body);
      assert.equal(fields.get('subject_token'), 'oidc-token');
      assert.equal(fields.get('audience'), '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel');
      return json({ access_token: 'federated' });
    }
    if (url.includes(':generateAccessToken')) {
      assert.equal(auth, 'Bearer federated');
      return json({ accessToken: 'service-account' });
    }
    if (url.includes(':signJwt')) {
      assert.equal(auth, 'Bearer service-account');
      const claims = JSON.parse(JSON.parse(body).payload) as Record<string, unknown>;
      signed.push(claims);
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/gmail.readonly');
      return json({ signedJwt: `signed-${claims.sub}` });
    }
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const fields = new URLSearchParams(body);
      return json({ access_token: `gmail-${fields.get('assertion')}` });
    }
    if (url.endsWith('/profile')) {
      if (auth.includes('lizbeth@')) return json({ error: { message: 'forbidden' } }, 403);
      const email = auth.includes('shanicey@') ? 'shanicey@scwellservice.com' : 'brighton@scwellservice.com';
      return json({ emailAddress: email });
    }
    if (url.includes('/messages/')) {
      return json({
        id: 'b1',
        internalDate: String(Date.parse('2026-10-05T18:25:18Z')),
        snippet: 'Please pay this invoice.',
        payload: {
          headers: [
            { name: 'Subject', value: 'Invoice #5818 from SCWS' },
            { name: 'From', value: 'Brighton Scala <brighton@scwellservice.com>' },
            { name: 'To', value: 'nancy@pacificaglass.net' },
          ],
        },
      });
    }
    if (url.includes('/messages?')) {
      const q = new URL(url).searchParams.get('q') ?? '';
      assert.match(q, /in:sent/);
      assert.match(q, /to:nancy@pacificaglass.net/);
      assert.match(q, /after:2026\/09\/29/);
      assert.equal(q.includes('newer_than'), false);
      if (auth.includes('shanicey@')) return json({ messages: [] });
      return json({ messages: [{ id: 'b1' }] });
    }
    return json({ error: `unexpected ${url}` }, 500);
  };
  const result = await loadGmailCollection({
    GCP_PROJECT_NUMBER: '123456789012',
  } as NodeJS.ProcessEnv, fetchImpl, 'oidc-token', 1_700_000_000, [
    { email: 'nancy@pacificaglass.net', afterIso: '2026-09-30T20:54:50Z' },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unavailable, ['Liz']);
  assert.equal(result.mailbox, 'brighton@scwellservice.com, shanicey@scwellservice.com');
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0].invoiceNumbers, ['5818']);
  assert.equal(result.events[0].by, 'Brighton');
  assert.equal(result.events[0].source, 'gmail');
  assert.match(result.note ?? '', /Liz Gmail unavailable/);
  assert.deepEqual(signed.map((claims) => claims.sub).sort(), SHOP_GMAIL_MAILBOXES.map((box) => box.email).sort());
  const missing = await loadGmailCollection({} as NodeJS.ProcessEnv, fetchImpl, null);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.events, []);
  assert.deepEqual(missing.unavailable, ['Brighton', 'Liz', 'Shanicey']);
  assert.match(missing.note ?? '', /OIDC token/);
});

test('sent search uses the customer address and pages back past the newest mail', async () => {
  const targets = gmailSearchTargets([
    { emails: ['kareneddy48@gmail.com', 'keddy48@gmail.com'], issuedAt: '2026-09-24T13:57:11Z' },
    { emails: ['kareneddy48@gmail.com'], issuedAt: '2026-10-01T17:00:00Z' },
  ]);
  assert.deepEqual(targets.map((target) => target.email), ['kareneddy48@gmail.com', 'keddy48@gmail.com']);
  assert.equal(gmailAfterDay('2026-09-24T13:57:11Z'), '2026/09/23');
  const queries = gmailSentQueries(targets);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /in:sent after:2026\/09\/23/);
  assert.match(queries[0], /to:kareneddy48@gmail.com/);
  assert.equal(queries[0].includes('newer_than'), false);

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : '';
    const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://sts.googleapis.com/')) return json({ access_token: 'federated' });
    if (url.includes(':generateAccessToken')) return json({ accessToken: 'service-account' });
    if (url.includes(':signJwt')) {
      const claims = JSON.parse(JSON.parse(body).payload) as { sub: string };
      return json({ signedJwt: `signed-${claims.sub}` });
    }
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const fields = new URLSearchParams(body);
      return json({ access_token: `gmail-${fields.get('assertion')}` });
    }
    if (url.endsWith('/profile')) {
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      const email = auth.includes('lizbeth@') ? 'lizbeth@scwellservice.com' : auth.includes('shanicey@') ? 'shanicey@scwellservice.com' : 'brighton@scwellservice.com';
      return json({ emailAddress: email });
    }
    if (url.includes('/messages/')) {
      const id = decodeURIComponent(url.split('/messages/')[1]?.split('?')[0] ?? '');
      const oct8 = id.endsWith('oct8');
      return json({
        id,
        internalDate: String(Date.parse(oct8 ? '2026-10-08T19:39:52Z' : '2026-10-14T18:29:46Z')),
        snippet: 'Invoice balance is still open.',
        payload: {
          headers: [
            { name: 'Subject', value: oct8 ? 'Invoices #5785 and #5829 from SCWS' : 'Invoice #5785 from SCWS' },
            { name: 'From', value: 'brighton@scwellservice.com' },
            { name: 'To', value: 'kareneddy48@gmail.com' },
          ],
        },
      });
    }
    if (url.includes('/messages?')) {
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      if (!auth.includes('brighton@')) return json({ messages: [] });
      const page = new URL(url).searchParams.get('pageToken');
      if (page === 'older') return json({ messages: [{ id: 'oct8' }] });
      return json({ messages: [{ id: 'oct14' }], nextPageToken: 'older' });
    }
    return json({ error: `unexpected ${url}` }, 500);
  };
  const result = await loadGmailCollection({ GCP_PROJECT_NUMBER: '950015473137' } as NodeJS.ProcessEnv, fetchImpl, 'oidc-token', 1_700_000_000, [
    { email: 'kareneddy48@gmail.com', afterIso: '2026-09-24T13:57:11Z' },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.unavailable, []);
  const brighton = result.events.filter((event) => event.invoiceNumbers?.includes('5785'));
  assert.deepEqual(brighton.map((event) => event.at).sort(), [
    '2026-10-08T19:39:52.000Z',
    '2026-10-14T18:29:46.000Z',
  ]);
  assert.equal((result.note ?? '').includes('300'), false);
});
