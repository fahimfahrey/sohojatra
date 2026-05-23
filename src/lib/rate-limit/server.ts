import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const PUBLIC_API_LIMIT = 100;
export const AUTH_API_LIMIT = 1000;
export const API_WINDOW_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix ms when the current window resets
  retryAfter: number; // seconds
}

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

function memoryConsume(
  key: string,
  maxAttempts: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetTime) {
    const reset = now + windowMs;
    memoryStore.set(key, { count: 1, resetTime: reset });
    return {
      allowed: true,
      limit: maxAttempts,
      remaining: Math.max(0, maxAttempts - 1),
      reset,
      retryAfter: 0,
    };
  }

  entry.count += 1;
  const allowed = entry.count <= maxAttempts;
  const remaining = Math.max(0, maxAttempts - entry.count);
  const retryAfter = allowed ? 0 : Math.max(1, Math.ceil((entry.resetTime - now) / 1000));
  return { allowed, limit: maxAttempts, remaining, reset: entry.resetTime, retryAfter };
}

export async function consumeRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const limiter = getLimiter(maxAttempts, windowMs);
  if (limiter) {
    try {
      const { success, remaining, reset } = await limiter.limit(key);
      const now = Date.now();
      const retryAfter = success ? 0 : Math.max(1, Math.ceil((reset - now) / 1000));
      return {
        allowed: success,
        limit: maxAttempts,
        remaining: Math.max(0, remaining),
        reset,
        retryAfter,
      };
    } catch {
      return memoryConsume(key, maxAttempts, windowMs);
    }
  }
  return memoryConsume(key, maxAttempts, windowMs);
}

export async function checkRateLimit(
  key: string,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
): Promise<boolean> {
  const { allowed } = await consumeRateLimit(key, maxAttempts, windowMs);
  return allowed;
}

function resolveClientIp(headers: Headers): string {
  const fwd = headers.get("x-client-ip") ?? headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export interface ApiRateLimitInput {
  headers: Headers;
  userId?: string | null;
}

export async function applyApiRateLimit(
  input: ApiRateLimitInput,
): Promise<RateLimitResult> {
  const { headers, userId } = input;
  if (userId) {
    return consumeRateLimit(`api:user:${userId}`, AUTH_API_LIMIT, API_WINDOW_MS);
  }
  const ip = resolveClientIp(headers);
  return consumeRateLimit(`api:ip:${ip}`, PUBLIC_API_LIMIT, API_WINDOW_MS);
}
