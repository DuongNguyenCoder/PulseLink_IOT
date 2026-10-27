import { Prisma } from "../../generated/prisma/client.js";
import {
  authenticateDevice,
  type DeviceRecord,
  type ProvisioningDatabase,
} from "../provisioning/provisioning.service.js";
import type { DeviceEventBody } from "./device-event.schema.js";

export interface DeviceEventRecord {
  id: string;
  eventId: string;
  deviceId: string;
  type: "BUTTON_PRESSED";
  status: "RECEIVED" | "PROCESSED" | "FAILED";
  occurredAt: Date;
  receivedAt: Date;
  firmwareVersion: string | null;
  rssiDbm: number | null;
  payload: unknown;
}

export interface DeviceEventTransactionDatabase {
  deviceEvent: {
    create(args: unknown): Promise<DeviceEventRecord>;
  };
  staffPushToken: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
  appInstallation: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
  deviceNotification: {
    createMany(args: unknown): Promise<{ count: number }>;
  };
}

export type NotificationRecipientMode = "legacy" | "account";

export interface DeviceEventDatabase {
  device: ProvisioningDatabase["device"];
  deviceEvent: {
    findUnique(args: unknown): Promise<DeviceEventRecord | null>;
  };
  $transaction<T>(
    callback: (transaction: DeviceEventTransactionDatabase) => Promise<T>,
  ): Promise<T>;
}

export class DeviceEventError extends Error {
  readonly statusCode: 400 | 401 | 409 | 503;

  constructor(message: string, statusCode: 400 | 401 | 409 | 503) {
    super(message);
    this.name = "DeviceEventError";
    this.statusCode = statusCode;
  }
}

export interface AcceptedDeviceEvent {
  event: DeviceEventRecord;
  duplicate: boolean;
}

function isEventIdUniqueViolation(error: unknown): boolean {
  const candidate =
    error instanceof Prisma.PrismaClientKnownRequestError ||
    (typeof error === "object" && error !== null)
      ? (error as {
          code?: unknown;
          meta?: { target?: unknown };
          message?: unknown;
        })
      : null;
  if (candidate?.code !== "P2002") {
    return false;
  }

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.includes("eventId");
  if (
    typeof target === "string" &&
    (target === "eventId" || target.includes("DeviceEvent_eventId_key"))
  )
    return true;
  return (
    typeof candidate.message === "string" &&
    candidate.message.includes("DeviceEvent_eventId_key")
  );
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeValue(nested)]),
    );
  }
  return value;
}

function eventMeaning(event: DeviceEventBody, deviceId: string): string {
  return JSON.stringify(
    normalizeValue({
      deviceId,
      eventId: event.eventId.toLowerCase(),
      type: event.type,
      occurredAt: new Date(event.occurredAt).toISOString(),
      firmwareVersion: event.firmwareVersion,
      rssiDbm: event.rssiDbm,
      payload: event.payload,
    }),
  );
}

function storedEventMeaning(event: DeviceEventRecord): string {
  return JSON.stringify(
    normalizeValue({
      deviceId: event.deviceId,
      eventId: event.eventId.toLowerCase(),
      type: event.type,
      occurredAt: event.occurredAt.toISOString(),
      firmwareVersion: event.firmwareVersion ?? undefined,
      rssiDbm: event.rssiDbm ?? undefined,
      payload: event.payload ?? undefined,
    }),
  );
}

function assertEquivalent(
  existing: DeviceEventRecord,
  incoming: DeviceEventBody,
  deviceId: string,
): void {
  if (existing.deviceId !== deviceId) {
    throw new DeviceEventError("Event idempotency conflict", 409);
  }
  if (storedEventMeaning(existing) !== eventMeaning(incoming, deviceId)) {
    throw new DeviceEventError("Event idempotency conflict", 409);
  }
}

export async function ingestDeviceEvent(
  db: DeviceEventDatabase,
  token: string,
  input: DeviceEventBody,
  receivedAt = new Date(),
  recipientMode: NotificationRecipientMode = "legacy",
): Promise<AcceptedDeviceEvent> {
  const device = await authenticateDevice(
    db as unknown as ProvisioningDatabase,
    token,
  );
  const createData = {
    eventId: input.eventId.toLowerCase(),
    deviceId: device.id,
    type: input.type,
    status: "RECEIVED" as const,
    occurredAt: new Date(input.occurredAt),
    receivedAt,
    firmwareVersion: input.firmwareVersion,
    rssiDbm: input.rssiDbm,
    payload: input.payload,
  };

  try {
    const event = await db.$transaction(async (transaction) => {
      const created = await transaction.deviceEvent.create({
        data: createData,
      });
      const recipients =
        recipientMode === "account"
          ? await transaction.appInstallation.findMany({
              where: {
                status: "ACTIVE",
                fcmTokenCiphertext: { not: null },
                fcmTokenFingerprint: { not: null },
                account: {
                  status: "ACTIVE",
                  memberships: {
                    some: {
                      storeId: device.storeId,
                      status: "ACTIVE",
                      role: { in: ["OWNER", "STAFF"] },
                    },
                  },
                },
              },
              select: { id: true },
            })
          : await transaction.staffPushToken.findMany({
              where: {
                isActive: true,
                staff: { isActive: true, storeId: device.storeId },
              },
              select: { id: true },
            });

      if (recipients.length > 0) {
        await transaction.deviceNotification.createMany({
          data:
            recipientMode === "account"
              ? recipients.map((recipient) => ({
                  eventId: created.id,
                  appInstallationId: recipient.id,
                }))
              : recipients.map((recipient) => ({
                  eventId: created.id,
                  pushTokenId: recipient.id,
                })),
          skipDuplicates: true,
        });
      }
      return created;
    });
    return { event, duplicate: false };
  } catch (error: unknown) {
    if (!isEventIdUniqueViolation(error)) throw error;

    const existing = await db.deviceEvent.findUnique({
      where: { eventId: createData.eventId },
    });
    if (existing === null)
      throw new DeviceEventError(
        "Event persistence could not be verified",
        503,
      );
    assertEquivalent(existing, input, device.id);
    return { event: existing, duplicate: true };
  }
}
