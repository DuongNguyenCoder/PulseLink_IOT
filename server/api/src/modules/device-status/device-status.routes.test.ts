import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { hashDeviceToken } from "../provisioning/provisioning-crypto.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { deviceStatusRoutes } from "./device-status.routes.js";

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-status-1",
    deviceKey: "device-key-1",
    deviceSecretHash: hashDeviceToken("status-token"),
    storeId: "store-1",
    status: "OFFLINE" as const,
    provisioningState: "PROVISIONED" as const,
    enrollmentStatus: "ENROLLED" as const,
    enrollmentPublicKey: "spki",
    enrollmentKeyVersion: 1,
    ...overrides,
  };
}

async function build(deviceValue: ReturnType<typeof device> | null) {
  const app = Fastify();
  const fakePrisma = {
    device: {
      findFirst: async (args: { where?: { deviceSecretHash?: string } }) =>
        args.where?.deviceSecretHash === deviceValue?.deviceSecretHash
          ? deviceValue
          : null,
    },
  } as unknown as PrismaClient;
  app.decorate("prisma", fakePrisma);
  await app.register(deviceStatusRoutes, { prefix: "/v1" });
  return app;
}

describe("authenticated device status route", () => {
  it("returns minimal status for a valid operational credential", async () => {
    const app = await build(device());
    const response = await app.inject({
      method: "GET",
      url: "/v1/device-status",
      headers: { authorization: "Bearer status-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: {
        deviceId: "device-status-1",
        deviceKey: "device-key-1",
        status: "OFFLINE",
        provisioningState: "PROVISIONED",
        enrollmentStatus: "ENROLLED",
      },
    });
    expect(response.body).not.toContain("status-token");
    await app.close();
  });

  it.each([
    ["missing credential", undefined],
    ["wrong credential", "wrong-token"],
  ])("rejects %s without exposing secret material", async (_name, token) => {
    const app = await build(device());
    const response = await app.inject({
      method: "GET",
      url: "/v1/device-status",
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("status-token");
    await app.close();
  });

  it.each([
    ["disabled", { status: "DISABLED" as const }],
    ["enrollment revoked", { enrollmentStatus: "REVOKED" as const }],
    ["provisioning revoked", { provisioningState: "REVOKED" as const }],
  ])("rejects %s devices", async (_name, overrides) => {
    const app = await build(device(overrides));
    const response = await app.inject({
      method: "GET",
      url: "/v1/device-status",
      headers: { authorization: "Bearer status-token" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("does not expose a path or body selector for another device", async () => {
    const app = await build(device());
    const response = await app.inject({
      method: "GET",
      url: "/v1/device-status?deviceId=other-device",
      headers: { authorization: "Bearer status-token" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.deviceId).toBe("device-status-1");
    await app.close();
  });
});

