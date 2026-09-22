import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleJobberOauthHealthRequest,
  jobberOauthHealthHttpStatus,
} from './oauth-health.ts';

describe('jobber oauth-health', () => {
  it('401s without cron or MCP auth', async () => {
    const response = await handleJobberOauthHealthRequest(
      new Request('https://scws-jobs.vercel.app/api/jobber/oauth-health'),
      {}
    );
    assert.equal(response.status, 401);
    assert.match(await response.text(), /Unauthorized/);
  });

  it('reports an unconfigured store without leaking secrets', async () => {
    const env = {
      JOBBER_MCP_API_KEYS: '{"travis":"trav-secret"}',
      JOBBER_CLIENT_SECRET: 'client-secret-must-not-leak',
      JOBBER_REFRESH_TOKEN: 'refresh-1-must-not-leak',
    } as NodeJS.ProcessEnv;

    const response = await handleJobberOauthHealthRequest(
      new Request('https://scws-jobs.vercel.app/api/jobber/oauth-health', {
        headers: { authorization: 'Bearer trav-secret' },
      }),
      env
    );

    assert.equal(response.status, 503);
    const body = (await response.json()) as {
      ok: boolean;
      encryptionKeyConfigured: boolean;
      supabaseConfigured: boolean;
      source: string;
    };
    assert.equal(body.ok, false);
    assert.equal(body.encryptionKeyConfigured, false);
    assert.equal(body.supabaseConfigured, false);
    assert.equal(body.source, 'env_bootstrap');
    const raw = JSON.stringify(body);
    assert.equal(raw.includes('trav-secret'), false);
    assert.equal(raw.includes('must-not-leak'), false);
  });

  it('is 200 only when the dedicated key is set and Supabase is not known-down', () => {
    assert.equal(
      jobberOauthHealthHttpStatus({
        ready: true,
        encryptionKeyConfigured: true,
        encryptionKeySource: 'JOBBER_TOKEN_ENCRYPTION_KEY',
        supabaseConfigured: true,
        reachable: true,
        storedRow: false,
        hasStoredTokens: false,
        source: 'env_bootstrap',
        authMode: 'env_bootstrap',
        expiresAt: null,
        settingsTable: 'present',
        lockReady: true,
        loadError: null,
      }),
      200
    );
    assert.equal(
      jobberOauthHealthHttpStatus({
        ready: true,
        encryptionKeyConfigured: true,
        encryptionKeySource: 'JOBBER_TOKEN_ENCRYPTION_KEY',
        supabaseConfigured: true,
        reachable: false,
        storedRow: null,
        hasStoredTokens: null,
        source: 'unconfigured',
        authMode: 'unconfigured',
        expiresAt: null,
        settingsTable: 'unknown',
        lockReady: null,
        loadError: null,
      }),
      503
    );
    assert.equal(
      jobberOauthHealthHttpStatus({
        ready: true,
        encryptionKeyConfigured: true,
        encryptionKeySource: 'JOBBER_TOKEN_ENCRYPTION_KEY',
        supabaseConfigured: true,
        reachable: true,
        storedRow: null,
        hasStoredTokens: null,
        source: 'unconfigured',
        authMode: 'unconfigured',
        expiresAt: null,
        settingsTable: 'missing',
        lockReady: false,
        loadError: 'Jobber durable token load failed: public.settings is missing',
      }),
      503
    );
  });
});
