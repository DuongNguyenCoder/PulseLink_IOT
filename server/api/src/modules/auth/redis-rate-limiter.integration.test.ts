import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RedisRateLimiter } from "./redis-rate-limiter.js";

const enabled = process.env.PULSELINK_REDIS_INTEGRATION_TESTS === "1";
const redisUrl = process.env.REDIS_TEST_URL ?? "redis://127.0.0.1:6380";

describe.skipIf(!enabled)("RedisRateLimiter with isolated Redis", () => {
  const clients = [
    createClient({ url: redisUrl }),
    createClient({ url: redisUrl }),
  ];
  const namespace = `pulselink:test:${Date.now()}`;
  const secret = "isolated-redis-test-secret-at-least-32-bytes";
  let first: RedisRateLimiter;
  let second: RedisRateLimiter;

  beforeAll(async () => {
    if (!redisUrl.startsWith("redis://127.0.0.1:")) {
      throw new Error(
        "Redis integration tests require an isolated loopback Redis URL",
      );
    }
    await Promise.all(clients.map((client) => client.connect()));
    first = new RedisRateLimiter(clients[0], namespace, secret, 150, 5);
    second = new RedisRateLimiter(clients[1], namespace, secret, 150, 5);
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.quit()));
  });

  it("shares the limit across independent clients", async () => {
    const input = { source: "127.0.0.1", key: "integration@example.com" };
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        (index % 2 === 0 ? first : second).allow(input),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.filter((value) => !value)).toHaveLength(1);
  });

  it("resets after the bounded window", async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    await expect(
      first.allow({ source: "127.0.0.1", key: "integration@example.com" }),
    ).resolves.toBe(true);
  });
});
