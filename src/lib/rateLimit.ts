// Simple rate limiting utility
interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

const store: RateLimitStore = {};

/**
 * Check if an action is allowed based on rate limiting
 * @param identifier Unique identifier (e.g., email for login attempts)
 * @param maxAttempts Maximum attempts allowed
 * @param windowMs Time window in milliseconds
 * @returns true if action is allowed, false if rate limited
 */
export const rateLimit = (
  identifier: string,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000, // 15 minutes
): boolean => {
  const now = Date.now();
  const key = identifier;

  if (!store[key]) {
    store[key] = { count: 1, resetTime: now + windowMs };
    return true;
  }

  if (now > store[key].resetTime) {
    store[key] = { count: 1, resetTime: now + windowMs };
    return true;
  }

  store[key].count++;

  if (store[key].count > maxAttempts) {
    return false;
  }

  return true;
};

/**
 * Get remaining attempts for an identifier
 * @param identifier Unique identifier
 * @param maxAttempts Maximum attempts allowed
 * @returns Number of remaining attempts
 */
export const getRemainingAttempts = (
  identifier: string,
  maxAttempts: number = 5,
): number => {
  const key = identifier;
  if (!store[key]) return maxAttempts;
  return Math.max(0, maxAttempts - store[key].count);
};

/**
 * Reset rate limit for an identifier
 * @param identifier Unique identifier
 */
export const resetRateLimit = (identifier: string): void => {
  delete store[identifier];
};
