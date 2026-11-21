import Fastify from "fastify";
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueAccessToken } from "../auth/jwt.js";
import { deviceRoutes } from "./device.routes.js";

describe("Device API credential boundary", () => {
  it("allows STAFF metadata reads without exposing device credentials", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const token = await issueAccessToken(
      { accountId: "account-1", authVersion: 0 },
      {
        kid: "device-route-test",
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
    );
    const now = new Date("2026-11-13T00:00:00.000Z");
    const app = Fastify({ logger: false });
    app.decorate("prisma", {
      account: { findUnique: async () => ({ status: "ACTIVE", authVersion: 0, emailVerifiedAt: now }) },
      store: { findUnique: async () => ({ id: "store-1", isActive: true }) },
      storeMembership: {
        findFirst: async () => ({ accountId: "account-1", storeId: "store-1", role: "STAFF", status: "ACTIVE" }),
      },
      device: {
        findMany: async () => [{
          id: "pl-021122334455",
          deviceKey: "public-protocol-context",
          deviceSecretHash: "hashed-operational-token",
          name: "Front button",
          type: "CALL_BUTTON",
          status: "PENDING",
          provisioningState: "READY",
          enrollmentStatus: "ENROLLED",
          firmwareVersion: null,
          lastSeenAt: null,
          storeId: "store-1",
          createdAt: now,
          updatedAt: now,
        }],
      },
    } as never);
    await app.register(deviceRoutes, {
      prefix: "/v1/stores",
      verificationKeys: new Map([["device-route-test", publicKey]]),
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/stores/store-1/devices",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data[0]).not.toHaveProperty("deviceKey");
    expect(body.data[0]).not.toHaveProperty("deviceSecretHash");
    expect(body.data[0]).toMatchObject({ id: "pl-021122334455", storeId: "store-1" });
    await app.close();
  });
});
