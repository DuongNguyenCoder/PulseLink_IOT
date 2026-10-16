import { Prisma } from "../../generated/prisma/client.js";
import { hashDeviceToken } from "../provisioning/provisioning-crypto.js";
import { describe, expect, it } from "vitest";
import {
  ingestDeviceEvent,
  type DeviceEventDatabase,
  type DeviceEventRecord,
  type DeviceEventTransactionDatabase,
} from "./device-event.service.js";
import type { DeviceEventBody } from "./device-event.schema.js";

const device = {
  id: "device-a",
  deviceKey: "button-a",
  deviceSecretHash: hashDeviceToken("device-token"),
  storeId: "store-a",
  status: "ONLINE" as const,
  provisioningState: "PROVISIONED" as const,
  enrollmentStatus: "ENROLLED" as const,
  enrollmentPublicKey: null,
  enrollmentKeyVersion: null,
};

const input: DeviceEventBody = {
  eventId: "0199aabb-ccdd-7eef-8123-456789abcdef",
  type: "BUTTON_PRESSED",
  occurredAt: "2026-10-15T14:00:00.000Z",
  firmwareVersion: "0.1.0",
  rssiDbm: -60,
  payload: { button: "main", nested: { count: 1 } },
};

function record(overrides: Partial<DeviceEventRecord> = {}): DeviceEventRecord {
  return {
    id: "event-row-a",
    eventId: input.eventId,
    deviceId: device.id,
    type: input.type,
    status: "RECEIVED",
    occurredAt: new Date(input.occurredAt),
    receivedAt: new Date("2026-10-15T14:00:01.000Z"),
    firmwareVersion: input.firmwareVersion ?? null,
    rssiDbm: input.rssiDbm ?? null,
    payload: input.payload,
    ...overrides,
  };
}

function database(
  overrides: Partial<{
    create: (args: unknown) => Promise<DeviceEventRecord>;
    findUnique: (args: unknown) => Promise<DeviceEventRecord | null>;
  }> = {},
): DeviceEventDatabase {
  return {
    device: { findFirst: async () => device },
    deviceEvent: {
      findUnique: overrides.findUnique ?? (async () => record()),
    },
    $transaction: async (
      callback: (
        transaction: DeviceEventTransactionDatabase,
      ) => Promise<unknown>,
    ) =>
      callback({
        deviceEvent: { create: overrides.create ?? (async () => record()) },
        staffPushToken: { findMany: async () => [] },
        deviceNotification: { createMany: async () => ({ count: 0 }) },
      }),
  } as unknown as DeviceEventDatabase;
}

function uniqueEventError(
  target: unknown = ["eventId"],
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.10.0",
    meta: { target },
  });
}

describe("device event ingestion", () => {
  it("writes a new event with server receivedAt and preserves occurredAt", async () => {
    const receivedAt = new Date("2026-10-15T14:00:02.000Z");
    let args: unknown;
    const result = await ingestDeviceEvent(
      database({
        create: async (value) => {
          args = value;
          return record({ receivedAt });
        },
      }),
      "device-token",
      input,
      receivedAt,
    );

    expect(result.duplicate).toBe(false);
    expect(args).toMatchObject({
      data: { occurredAt: new Date(input.occurredAt), receivedAt },
    });
  });

  it("returns an equivalent duplicate without creating another event", async () => {
    let creates = 0;
    const result = await ingestDeviceEvent(
      database({
        create: async () => {
          creates += 1;
          throw uniqueEventError();
        },
      }),
      "device-token",
      input,
    );

    expect(result.duplicate).toBe(true);
    expect(creates).toBe(1);
  });

  it("rejects conflicting reuse of an event ID", async () => {
    await expect(
      ingestDeviceEvent(
        database({
          create: async () => {
            throw uniqueEventError();
          },
          findUnique: async () => record({ payload: { button: "other" } }),
        }),
        "device-token",
        input,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("does not map an unrelated unique constraint to a duplicate", async () => {
    await expect(
      ingestDeviceEvent(
        database({
          create: async () => {
            throw uniqueEventError(["deviceId"]);
          },
        }),
        "device-token",
        input,
      ),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("propagates an unknown database failure without accepting the event", async () => {
    await expect(
      ingestDeviceEvent(
        database({
          create: async () => {
            throw new Error("database unavailable");
          },
        }),
        "device-token",
        input,
      ),
    ).rejects.toThrow("database unavailable");
  });

  it("fails authentication for an unknown or disabled device", async () => {
    const db = database();
    db.device.findFirst = async () => null;
    await expect(
      ingestDeviceEvent(db, "wrong-token", input),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
