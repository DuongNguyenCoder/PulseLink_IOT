import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { healthRoutes } from "./health.routes.js";

describe("health routes", () => {
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("serves liveness through Fastify injection without opening a port", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(healthRoutes, { prefix: "/health" });

    const response = await app.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "pulselink-api",
    });
  });

  it("checks readiness through an explicit Prisma test double", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.decorate("prisma", {
      $queryRaw: async () => [{ ok: 1 }],
    } as unknown as PrismaClient);
    await app.register(healthRoutes, { prefix: "/health" });

    const response = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      dependencies: { database: "ok" },
    });
  });

  it("protects notification diagnostics when a token is configured", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(healthRoutes, {
      prefix: "/health",
      diagnosticsToken: "a".repeat(32),
    });

    const response = await app.inject({
      method: "GET",
      url: "/health/notifications",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      status: "error",
      error: "Unauthorized",
    });
  });
});
