import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { healthRoutes } from "./health.routes.js";
describe("health routes", () => {
    const apps = [];
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
        });
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
});
