import { describe, expect, it } from "vitest";
import {
  RATE_LIMIT_SCRIPT,
  RedisRateLimiter,
  createRateLimitKey,
  type RedisRateLimiterClient,
} from "./redis-rate-limiter.js";

describe("RedisRateLimiter", () => {
  it("uses a privacy-preserving namespaced key and atomic script", async () => {
    let receivedKey = "";
    let receivedScript = "";
    const client: RedisRateLimiterClient = {
      eval: async (script, options) => {
        receivedScript = script;
        receivedKey = options.keys[0] ?? "";
        return [1, 60_000];
      },
    };
    const limiter = new RedisRateLimiter(
      client,
      "pulselink:test",
      "local-test-key-that-is-at-least-32-bytes",
      60_000,
      5,
    );

    await expect(
      limiter.allow({
        source: "127.0.0.1",
        key: "account@example.com",
      }),
    ).resolves.toBe(true);

    expect(receivedKey).toMatch(/^pulselink:test:login:[a-f0-9]{64}$/);
    expect(receivedKey).not.toContain("account@example.com");
    expect(receivedKey).not.toContain("127.0.0.1");
    expect(receivedScript).toBe(RATE_LIMIT_SCRIPT);
    expect(receivedScript).toContain('redis.call("INCR"');
    expect(receivedScript).toContain('redis.call("PEXPIRE"');
  });

  it("returns the Redis decision without a local fallback", async () => {
    let calls = 0;
    const client: RedisRateLimiterClient = {
      eval: async () => {
        calls += 1;
        return [calls <= 2 ? 1 : 0, 1000];
      },
    };
    const limiter = new RedisRateLimiter(
      client,
      "pulselink:test",
      "local-test-key-that-is-at-least-32-bytes",
      1000,
      2,
    );

    await expect(limiter.allow({ source: "source", key: "key" })).resolves.toBe(
      true,
    );
    await expect(limiter.allow({ source: "source", key: "key" })).resolves.toBe(
      true,
    );
    await expect(limiter.allow({ source: "source", key: "key" })).resolves.toBe(
      false,
    );
    expect(calls).toBe(3);
  });

  it("propagates Redis errors for the timeout boundary to handle", async () => {
    const client: RedisRateLimiterClient = {
      eval: async () => {
        throw new Error("redis connection details");
      },
    };
    const limiter = new RedisRateLimiter(
      client,
      "pulselink:test",
      "local-test-key-that-is-at-least-32-bytes",
      1000,
      2,
    );

    await expect(
      limiter.allow({ source: "source", key: "key" }),
    ).rejects.toThrow("redis connection details");
  });

  it("derives different keys for different normalized inputs", () => {
    const first = createRateLimitKey("pulselink:test", "local-test-key", {
      source: "127.0.0.1",
      key: "account@example.com",
    });
    const second = createRateLimitKey("pulselink:test", "local-test-key", {
      source: "127.0.0.2",
      key: "account@example.com",
    });

    expect(first).not.toBe(second);
  });
});
