import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { provisioningRoutes } from "./provisioning.routes.js";

describe("provisioning route boundaries", () => {
  async function createApp() {
    const app = Fastify();
    app.decorate("prisma", {} as never);
    await app.register(provisioningRoutes, {
      verificationKeys: new Map(),
      enrollmentAuthorizer: async () => ({
        actorId: "commissioning-tool",
        actorType: "SYSTEM",
      }),
    });
    return app;
  }

  it("does not expose unauthenticated Owner session routes", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "GET",
      url: "/stores/store-1/provisioning-sessions",
    });
    expect(response.statusCode).toBe(401);
    const claim = await app.inject({
      method: "POST",
      url: "/stores/store-1/device-claims",
      payload: { deviceId: "pl-0123456789ab", name: "Button" },
    });
    expect(claim.statusCode).toBe(401);
    await app.close();
  });

  it("does not expose self-service Owner enrollment; Device keys require operator proof", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/stores/store-1/devices/device-1/enrollment",
      payload: { publicKey: "not-a-key", keyVersion: 1 },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("validates enrollment and redeem payloads before service access", async () => {
    const app = await createApp();
    const enrollment = await app.inject({
      method: "POST",
      url: "/operator/devices/device-1/enrollment",
      payload: { publicKey: "not-a-key", keyVersion: 1 },
    });
    expect(enrollment.statusCode).toBe(400);

    const redeem = await app.inject({
      method: "POST",
      url: "/devices/device-1/provisioning-sessions/session-1/redeem",
      payload: {
        bootstrapSecret: "short",
        challenge: "short",
        signature: "short",
      },
    });
    expect(redeem.statusCode).toBe(400);
    await app.close();
  });

  it("does not register operator enrollment routes without an authorizer", async () => {
    const app = Fastify();
    app.decorate("prisma", {} as never);
    await app.register(provisioningRoutes, { verificationKeys: new Map() });

    const response = await app.inject({
      method: "POST",
      url: "/operator/devices/device-1/enrollment",
      payload: { publicKey: "not-a-key", keyVersion: 1 },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
