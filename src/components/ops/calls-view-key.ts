import { CALLS_VIEW_KEY_QUERY, CALLS_VIEW_KEY_STORAGE } from '@/lib/calls-view-auth';

/** Calls-only key from ?ckey= (saved for next time) or localStorage. Only read on /ops/calls-live. */
export function callsViewKeyFromPage(): string | null {
  try {
    if (!window.location.pathname.startsWith('/ops/calls-live')) return null;
    const q = new URL(window.location.href).searchParams.get(CALLS_VIEW_KEY_QUERY);
    if (q) { localStorage.setItem(CALLS_VIEW_KEY_STORAGE, q); return q; }
    return localStorage.getItem(CALLS_VIEW_KEY_STORAGE);
  } catch { return null; }
}
