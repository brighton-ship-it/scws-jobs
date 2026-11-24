/**
 * Sequential QuickBooks calls retry a 429 with exponential backoff.
 * Previews stay one request at a time so a limit does not fan out.
 */
export function isQboRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate limit|throttle|too many requests/i.test(message);
}

export async function withQboBackoff<T>(
  run: () => Promise<T>,
  options: { attempts?: number; sleep?: (ms: number) => Promise<void>; onRetry?: (waitMs: number) => void } = {}
): Promise<T> {
  const attempts = options.attempts && options.attempts > 0 ? options.attempts : 5;
  const sleep = options.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let wait = 400;
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!isQboRateLimit(error) || attempt === attempts - 1) throw error;
      options.onRetry?.(wait);
      await sleep(wait);
      wait = Math.min(wait * 2, 8000);
    }
  }
  throw last instanceof Error ? last : new Error('QuickBooks rate limit.');
}
