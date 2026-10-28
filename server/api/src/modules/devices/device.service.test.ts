import { describe, expect, it } from "vitest";
import {
  createDeviceForOwner,
  listDevicesForOwner,
  type DeviceDatabase,
} from "./device.service.js";

const device = {
  id: "device-1",
  deviceKey: "generated-device-key",
  name: "Front button",
  type: "CALL_BUTTON" as const,
  status: "PENDING" as const,
  provisioningState: "UNREGISTERED" as const,
  enrollmentStatus: "UNENROLLED" as const,
  firmwareVersion: null,
  lastSeenAt: null,
  storeId: "store-1",
  createdAt: new Date("2026-10-27T00:00:00.000Z"),
  updatedAt: new Date("2026-10-27T00:00:00.000Z"),
};

function database(): DeviceDatabase {
  const store = {
    findUnique: async () => ({ id: "store-1", isActive: true }),
  };
  const membership = {
    findFirst: async () => ({
      accountId: "account-1",
      storeId: "store-1",
      role: "OWNER" as const,
      status: "ACTIVE" as const,
    }),
  };
  const account = {
    findUnique: async () => ({
      status: "ACTIVE" as const,
      emailVerifiedAt: new Date(),
    }),
  };
  return {
    account,
    store,
    storeMembership: membership,
    device: {
      create: async () => device,
      findMany: async () => [device],
    },
    auditEvent: { create: async () => ({}) },
    $transaction: async (callback) =>
      callback({
        account,
        store,
        storeMembership: membership,
        device: {
          create: async () => device,
          findMany: async () => [device],
        },
        auditEvent: { create: async () => ({}) },
        $transaction: async (nested) => nested({} as never),
      }),
  };
}

describe("Owner device lifecycle", () => {
  it("creates a Store-bound device without exposing a credential", async () => {
    const created = await createDeviceForOwner(
      database(),
      "account-1",
      "store-1",
      { name: "Front button" },
    );
    expect(created).toMatchObject({
      id: "device-1",
      storeId: "store-1",
      status: "PENDING",
    });
    expect(created).not.toHaveProperty("deviceSecretHash");
  });

  it("lists only the authorized Store's device metadata", async () => {
    await expect(
      listDevicesForOwner(database(), "account-1", "store-1"),
    ).resolves.toEqual([device]);
  });
});
