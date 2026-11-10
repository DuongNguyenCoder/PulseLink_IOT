import Fastify from "fastify";
import { generateKeyPairSync } from "node:crypto";
import { issueAccessToken } from "../auth/jwt.js";
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

  it("returns the Android claim-start envelope and does not link before board proof", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = await issueAccessToken(
      { accountId: "owner-1", authVersion: 0 },
      {
        kid: "claim-test",
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
    );
    const now = new Date("2026-11-03T08:00:00.000Z");
    let createdSession: Record<string, unknown> | null = null;
    let deviceCreated = false;
    const prisma = {
      account: {
        findUnique: async () => ({
          id: "owner-1", status: "ACTIVE", emailVerifiedAt: now, authVersion: 0,
        }),
      },
      storeMembership: {
        findFirst: async () => ({
          accountId: "owner-1", storeId: "store-1", role: "OWNER", status: "ACTIVE",
        }),
      },
      device: {
        findUnique: async () => null,
        create: async () => { deviceCreated = true; throw new Error("claim-start must not create Device"); },
      },
      deviceClaimSession: {
        create: async (args: unknown) => {
          const data = (args as { data: Record<string, unknown> }).data;
          createdSession = { id: "claim-session-1", ...data };
          return createdSession;
        },
      },
    };
    const app = Fastify({ logger: false });
    app.decorate("prisma", prisma as never);
    await app.register(provisioningRoutes, {
      verificationKeys: new Map([["claim-test", publicKey]]),
      enrollmentAuthorizer: async () => ({ actorId: "commissioning-tool", actorType: "SYSTEM" }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/stores/store-1/device-claims",
      headers: { authorization: `Bearer ${token}` },
      payload: { deviceId: "pl-98c377b427f4", name: "Front button" },
    });
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body).toMatchObject({
      data: {
        session: {
          id: "claim-session-1",
          deviceId: "pl-98c377b427f4",
          storeId: "store-1",
          expiresAt: expect.any(String),
        },
        challenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      },
      meta: { requestId: expect.any(String) },
    });
    expect(createdSession).not.toBeNull();
    expect(deviceCreated).toBe(false);
    await app.close();
  });
});
