"use client";

import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker";

const breakers = new Map<string, CircuitBreaker>();

/**
 * Get (or lazily create) a named circuit breaker. Breakers are shared across
 * the client so multiple call sites see a single open/closed state per
 * upstream.
 */
export function getBreaker(
  name: string,
  opts?: CircuitBreakerOptions,
): CircuitBreaker {
  let cb = breakers.get(name);
  if (!cb) {
    cb = new CircuitBreaker(name, opts);
    breakers.set(name, cb);
  }
  return cb;
}

export function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage unavailable; drop silently.
  }
}

export function clearCache(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}
