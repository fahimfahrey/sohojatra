/**
 * Circuit breaker for protecting calls to flaky upstreams (Supabase, Ably).
 *
 * States:
 *   - closed:    calls pass through. Failures increment a counter.
 *   - open:      calls short-circuit and throw immediately.
 *   - half_open: a single probe call is allowed. Success → closed, failure → open.
 *
 * Trips open after `failureThreshold` consecutive failures.
 * Stays open for `resetTimeoutMs`, then moves to half_open on next call.
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  now?: () => number;
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private nextAttemptAt = 0;
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;
  private listeners = new Set<(state: CircuitState) => void>();

  constructor(
    public readonly name: string,
    opts: CircuitBreakerOptions = {},
  ) {
    this.threshold = opts.failureThreshold ?? 3;
    this.resetMs = opts.resetTimeoutMs ?? 30_000;
    this.now = opts.now ?? (() => Date.now());
  }

  getState(): CircuitState {
    if (this.state === "open" && this.now() >= this.nextAttemptAt) {
      this.transition("half_open");
    }
    return this.state;
  }

  isOpen(): boolean {
    return this.getState() === "open";
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === "open") {
      throw new CircuitOpenError(this.name);
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    if (this.state !== "closed") {
      this.transition("closed");
    }
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === "half_open" || this.failures >= this.threshold) {
      this.nextAttemptAt = this.now() + this.resetMs;
      this.transition("open");
    }
  }

  reset(): void {
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.transition("closed");
  }

  onStateChange(listener: (state: CircuitState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private transition(next: CircuitState): void {
    if (this.state === next) return;
    this.state = next;
    for (const l of this.listeners) l(next);
  }
}
