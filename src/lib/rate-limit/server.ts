interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

export function checkRateLimit(
  key: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetTime) {
    store.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  entry.count += 1;
  if (entry.count > maxAttempts) {
    return false;
  }

  return true;
}
