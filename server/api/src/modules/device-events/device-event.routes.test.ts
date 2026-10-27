import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { deviceEventRoutes } from "./device-event.routes.js";
import { hashDeviceToken } from "../provisioning/provisioning-crypto.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

describe("device event route", () => {
  it("requires the device bearer token and accepts a valid event", async () => {
    const app = Fastify();
    const fakePrisma = {
      device: {
        findFirst: async () => ({
          id: "device-a",
          deviceKey: "button-a",
          deviceSecretHash: hashDeviceToken("device-token"),
          storeId: "store-a",
          status: "ONLINE",
          provisioningState: "PROVISIONED",
          enrollmentStatus: "ENROLLED",
          enrollmentPublicKey: null,
          enrollmentKeyVersion: null,
        }),
      },
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>,
      ) =>
        callback({
          deviceEvent: {
            create: async () => ({
              id: "event-row-a",
              eventId: "0199aabb-ccdd-7eef-8123-456789abcdef",
              deviceId: "device-a",
              type: "BUTTON_PRESSED",
              status: "RECEIVED",
              occurredAt: new Date("2026-10-15T14:00:00.000Z"),
              receivedAt: new Date(),
              firmwareVersion: null,
              rssiDbm: null,
              payload: null,
            }),
          },
          staffPushToken: { findMany: async () => [] },
          deviceNotification: { createMany: async () => ({ count: 0 }) },
        }),
    } as unknown as PrismaClient;
    app.decorate("prisma", fakePrisma);
    await app.register(deviceEventRoutes, { prefix: "/v1" });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/v1/device-events",
      payload: {},
    });
    expect(unauthorized.statusCode).toBe(400);
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/device-events",
      headers: { authorization: "Bearer device-token" },
      payload: {
        eventId: "0199aabb-ccdd-7eef-8123-456789abcdef",
        type: "BUTTON_PRESSED",
        occurredAt: "2026-10-15T14:00:00.000Z",
      },
    });
    expect(accepted.statusCode).toBe(201);
    await app.close();
  });

  it("uses Account/Membership/AppInstallation recipients in account mode", async () => {
    let notificationData: unknown;
    const app = Fastify();
    const fakePrisma = {
      device: {
        findFirst: async () => ({
          id: "device-account-mode",
          deviceKey: "button-account-mode",
          deviceSecretHash: hashDeviceToken("device-token-account-mode"),
          storeId: "store-account-mode",
          status: "ONLINE",
          provisioningState: "PROVISIONED",
          enrollmentStatus: "ENROLLED",
          enrollmentPublicKey: null,
          enrollmentKeyVersion: null,
        }),
      },
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>,
      ) =>
        callback({
          deviceEvent: {
            create: async () => ({
              id: "event-row-account-mode",
              eventId: "0199aabb-ccdd-7eef-8123-456789abcdee",
              deviceId: "device-account-mode",
              type: "BUTTON_PRESSED",
              status: "RECEIVED",
              occurredAt: new Date("2026-10-15T14:00:00.000Z"),
              receivedAt: new Date(),
              firmwareVersion: null,
              rssiDbm: null,
              payload: null,
            }),
          },
          staffPushToken: { findMany: async () => [] },
          appInstallation: {
            findMany: async () => [{ id: "installation-account-mode" }],
          },
          deviceNotification: {
            createMany: async (args: { data: unknown }) => {
              notificationData = args.data;
              return { count: 1 };
            },
          },
        }),
    } as unknown as PrismaClient;
    app.decorate("prisma", fakePrisma);
    await app.register(deviceEventRoutes, {
      prefix: "/v1",
      recipientMode: "account",
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/device-events",
      headers: { authorization: "Bearer device-token-account-mode" },
      payload: {
        eventId: "0199aabb-ccdd-7eef-8123-456789abcdee",
        type: "BUTTON_PRESSED",
        occurredAt: "2026-10-15T14:00:00.000Z",
      },
    });
    expect(response.statusCode).toBe(201);
    expect(notificationData).toEqual([
      {
        eventId: "event-row-account-mode",
        appInstallationId: "installation-account-mode",
      },
    ]);
    await app.close();
  });
});
