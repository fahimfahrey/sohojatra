import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

interface MemoryEntry {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, MemoryEntry>();
const limiterCache = new Map<string, Ratelimit>();

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getLimiter(maxAttempts: number, windowMs: number): Ratelimit | null {
  const client = getRedis();
  if (!client) return null;
  const key = `${maxAttempts}:${windowMs}`;
  let limiter = limiterCache.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(maxAttempts, `${windowMs} ms`),
      prefix: "rl",
      analytics: false,
    });
    limiterCache.set(key, limiter);
  }
  return limiter;
}

function memoryCheck(key: string, maxAttempts: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetTime) {
    memoryStore.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }

  entry.count += 1;
  if (entry.count > maxAttempts) {
    return false;
  }

  return true;
}

export async function checkRateLimit(
  key: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
): Promise<boolean> {
  const limiter = getLimiter(maxAttempts, windowMs);
  if (limiter) {
    try {
      const { success } = await limiter.limit(key);
      return success;
    } catch {
      return memoryCheck(key, maxAttempts, windowMs);
    }
  }
  return memoryCheck(key, maxAttempts, windowMs);
}
