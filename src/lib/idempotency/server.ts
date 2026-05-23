// import { Redis } from "@upstash/redis";
import type { ActionResult } from "@/lib/validation/schemas";

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const RESULT_TTL_SECONDS = 24 * 60 * 60;
const PENDING_TTL_SECONDS = 60;
const PENDING_SENTINEL = "__pending__";

export type AcquireOutcome<T> =
  | { state: "hit"; result: ActionResult<T> }
  | { state: "pending" }
  | { state: "acquired" };

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryEntry>();

// let redis: Redis | null = null;
// function getRedis(): Redis | null {
//   if (redis) return redis;
//   const url = process.env.UPSTASH_REDIS_REST_URL;
//   const token = process.env.UPSTASH_REDIS_REST_TOKEN;
//   if (!url || !token) return null;
//   redis = new Redis({ url, token });
//   return redis;
// }

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === "string" && KEY_PATTERN.test(key);
}

function storageKey(scope: string, userId: string, key: string): string {
  return `idem:${scope}:${userId}:${key}`;
}

function memoryGet(k: string): string | null {
  const entry = memoryStore.get(k);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(k);
    return null;
  }
  return entry.value;
}

function memorySetNx(k: string, value: string, ttlSeconds: number): boolean {
  const existing = memoryGet(k);
  if (existing !== null) return false;
  memoryStore.set(k, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  return true;
}

function memorySet(k: string, value: string, ttlSeconds: number): void {
  memoryStore.set(k, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memoryDel(k: string): void {
  memoryStore.delete(k);
}

export async function tryAcquireIdempotency<T>(
  scope: string,
  userId: string,
  key: string,
): Promise<AcquireOutcome<T>> {
  const k = storageKey(scope, userId, key);
  // const client = getRedis();

  // if (client) {
  //   try {
  //     const acquired = await client.set(k, PENDING_SENTINEL, {
  //       nx: true,
  //       ex: PENDING_TTL_SECONDS,
  //     });
  //     if (acquired === "OK") return { state: "acquired" };
  //     const existing = await client.get<string>(k);
  //     if (existing === null) {
  //       const retry = await client.set(k, PENDING_SENTINEL, {
  //         nx: true,
  //         ex: PENDING_TTL_SECONDS,
  //       });
  //       if (retry === "OK") return { state: "acquired" };
  //       return { state: "pending" };
  //     }
  //     if (existing === PENDING_SENTINEL) return { state: "pending" };
  //     return { state: "hit", result: parseResult<T>(existing) };
  //   } catch {
  //     // fall through to memory
  //   }
  // }

  if (memorySetNx(k, PENDING_SENTINEL, PENDING_TTL_SECONDS)) {
    return { state: "acquired" };
  }
  const existing = memoryGet(k);
  if (existing === null || existing === PENDING_SENTINEL) {
    return { state: "pending" };
  }
  return { state: "hit", result: parseResult<T>(existing) };
}

export async function storeIdempotencyResult<T>(
  scope: string,
  userId: string,
  key: string,
  result: ActionResult<T>,
): Promise<void> {
  const k = storageKey(scope, userId, key);
  const serialized = JSON.stringify(result);
  // const client = getRedis();
  // if (client) {
  //   try {
  //     await client.set(k, serialized, { ex: RESULT_TTL_SECONDS });
  //     return;
  //   } catch {
  //     // fall through
  //   }
  // }
  memorySet(k, serialized, RESULT_TTL_SECONDS);
}

export async function releaseIdempotencyLock(
  scope: string,
  userId: string,
  key: string,
): Promise<void> {
  const k = storageKey(scope, userId, key);
  // const client = getRedis();
  // if (client) {
  //   try {
  //     const existing = await client.get<string>(k);
  //     if (existing === PENDING_SENTINEL) {
  //       await client.del(k);
  //     }
  //     return;
  //   } catch {
  //     // fall through
  //   }
  // }
  if (memoryGet(k) === PENDING_SENTINEL) memoryDel(k);
}

function parseResult<T>(serialized: unknown): ActionResult<T> {
  if (typeof serialized === "string") {
    try {
      return JSON.parse(serialized) as ActionResult<T>;
    } catch {
      return { success: false, error: "Corrupted idempotency record" };
    }
  }
  if (serialized && typeof serialized === "object") {
    return serialized as ActionResult<T>;
  }
  return { success: false, error: "Corrupted idempotency record" };
}

export function __resetIdempotencyMemoryStoreForTests(): void {
  memoryStore.clear();
}

export const IDEMPOTENCY_RESULT_TTL_SECONDS = RESULT_TTL_SECONDS;
export const IDEMPOTENCY_PENDING_TTL_SECONDS = PENDING_TTL_SECONDS;
