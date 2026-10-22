import { describe, expect, it, vi } from "vitest";
import {
  InMemoryRateLimiter,
  RateLimiterUnavailableError,
  allowWithTimeout,
} from "./in-memory-rate-limiter.js";

describe("InMemoryRateLimiter", () => {
  it("limits a normalized source/key bucket without permanent lockout", () => {
    const limiter = new InMemoryRateLimiter(60_000, 2);

    expect(
      limiter.check({ source: "127.0.0.1", key: "account@example.com" })
        .allowed,
    ).toBe(true);
    expect(
      limiter.check({ source: "127.0.0.1", key: "account@example.com" })
        .allowed,
    ).toBe(true);
    const blocked = limiter.check({
      source: "127.0.0.1",
      key: "account@example.com",
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(
      limiter.check({ source: "192.0.2.10", key: "account@example.com" })
        .allowed,
    ).toBe(true);
  });

  it("expires a bucket and allows a new window", () => {
    vi.useFakeTimers();
    try {
      const limiter = new InMemoryRateLimiter(10, 1);
      const input = { source: "127.0.0.1", key: "account@example.com" };

      expect(limiter.check(input).allowed).toBe(true);
      expect(limiter.check(input).allowed).toBe(false);
      vi.advanceTimersByTime(11);
      expect(limiter.check(input).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not share state between instances", () => {
    const input = { source: "127.0.0.1", key: "account@example.com" };
    const first = new InMemoryRateLimiter(60_000, 1);
    const second = new InMemoryRateLimiter(60_000, 1);

    expect(first.check(input).allowed).toBe(true);
    expect(first.check(input).allowed).toBe(false);
    expect(second.check(input).allowed).toBe(true);
  });

  it("fails closed when a limiter exceeds its finite timeout", async () => {
    const hangingLimiter = {
      allow: () => new Promise<boolean>(() => undefined),
    };

    await expect(
      allowWithTimeout(
        hangingLimiter,
        {
          source: "127.0.0.1",
          key: "account@example.com",
        },
        5,
      ),
    ).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it("normalizes backend errors to an unavailable limiter failure", async () => {
    const failingLimiter = {
      allow: async () => {
        throw new Error("backend connection details must not escape");
      },
    };

    await expect(
      allowWithTimeout(
        failingLimiter,
        {
          source: "127.0.0.1",
          key: "account@example.com",
        },
        50,
      ),
    ).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });
});
