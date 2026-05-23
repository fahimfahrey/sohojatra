import { describe, it, expect } from "vitest";
import {
  CircuitBreaker,
  CircuitOpenError,
} from "../src/lib/circuit-breaker";

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("CircuitBreaker", () => {
  it("passes calls through when closed", async () => {
    const cb = new CircuitBreaker("test");
    const result = await cb.execute(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("opens after threshold consecutive failures", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("test", {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      now: clock.now,
    });

    for (let i = 0; i < 3; i++) {
      await expect(
        cb.execute(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    }
    expect(cb.getState()).toBe("open");
  });

  it("short-circuits when open", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: clock.now,
    });

    await expect(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();

    await expect(cb.execute(async () => "ok")).rejects.toThrow(
      CircuitOpenError,
    );
  });

  it("moves to half_open after reset timeout", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: clock.now,
    });

    await expect(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    expect(cb.getState()).toBe("open");

    clock.advance(1001);
    expect(cb.getState()).toBe("half_open");
  });

  it("closes after successful probe in half_open", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      now: clock.now,
    });

    await expect(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    clock.advance(1001);

    const result = await cb.execute(async () => "ok");
    expect(result).toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("reopens immediately on failed probe in half_open", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("test", {
      failureThreshold: 2,
      resetTimeoutMs: 1000,
      now: clock.now,
    });

    for (let i = 0; i < 2; i++) {
      await expect(
        cb.execute(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow();
    }
    clock.advance(1001);
    expect(cb.getState()).toBe("half_open");

    await expect(
      cb.execute(async () => {
        throw new Error("still down");
      }),
    ).rejects.toThrow("still down");
    expect(cb.getState()).toBe("open");
  });

  it("notifies state listeners on transitions", async () => {
    const clock = makeClock();
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 500,
      now: clock.now,
    });

    const events: string[] = [];
    cb.onStateChange((s) => events.push(s));

    await expect(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    clock.advance(501);
    cb.getState();
    await cb.execute(async () => "ok");

    expect(events).toEqual(["open", "half_open", "closed"]);
  });

  it("resets failure count on success while closed", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 });
    await expect(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    await expect(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    await cb.execute(async () => "ok");
    await expect(
      cb.execute(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();
    expect(cb.getState()).toBe("closed");
  });
});
