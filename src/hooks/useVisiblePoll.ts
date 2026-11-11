'use client';

import { useEffect } from 'react';
import { pollDelayMs } from '@/lib/db-backoff';

/**
 * Poll while the tab is visible. A hidden tab does not keep hitting the API.
 * `load` resolves false on failure; the next wait then backs off.
 */
export function useVisiblePoll(load: () => Promise<boolean>, intervalMs: number | null) {
  useEffect(() => {
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const arm = (ms: number) => {
      if (stopped || intervalMs == null) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void run(); }, ms);
    };

    const run = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const ok = await load();
      if (stopped) return;
      failures = ok ? 0 : Math.min(failures + 1, 8);
      arm(pollDelayMs(failures, intervalMs ?? 30_000));
    };

    const onVisible = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      void run();
    };

    void run();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [load, intervalMs]);
}
