import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isDemoAuthMode } from './demo-auth.ts';

describe('isDemoAuthMode', () => {
  it('is demo when Supabase URL is missing or the placeholder', () => {
    assert.equal(isDemoAuthMode({} as NodeJS.ProcessEnv), true);
    assert.equal(
      isDemoAuthMode({ NEXT_PUBLIC_SUPABASE_URL: 'your-supabase-url' } as NodeJS.ProcessEnv),
      true
    );
    assert.equal(
      isDemoAuthMode({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' } as NodeJS.ProcessEnv),
      false
    );
  });
});
