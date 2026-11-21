import { Prisma } from "../../generated/prisma/client.js";
import {
  generateDeviceKey,
  generateOperationalToken,
  hashDeviceToken,
} from "../provisioning/provisioning-crypto.js";
import { writeAuditEvent } from "../../shared/audit.js";
import { isMacDerivedDeviceId } from "./device-identity.js";

export interface DeviceDatabase {
  account: {
    findUnique(
      args: unknown,
    ): Promise<{
      status: "PENDING" | "ACTIVE" | "DISABLED";
      emailVerifiedAt: Date | null;
    } | null>;
  };
  store: {
    findUnique(
      args: unknown,
    ): Promise<{ id: string; isActive: boolean } | null>;
  };
  storeMembership: {
    findFirst(
      args: unknown,
    ): Promise<{
      accountId: string;
      storeId: string;
      role: "OWNER" | "STAFF";
      status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    } | null>;
  };
  device: {
    create(args: unknown): Promise<StoredDeviceRecord>;
    findMany(args: unknown): Promise<StoredDeviceRecord[]>;
  };
  auditEvent: { create(args: unknown): Promise<unknown> };
  $transaction<T>(callback: (tx: DeviceDatabase) => Promise<T>): Promise<T>;
}

export interface DeviceMetadata {
  id: string;
  name: string;
  type: "CALL_BUTTON";
  status: "PENDING" | "ONLINE" | "OFFLINE" | "DISABLED";
  provisioningState:
    "UNREGISTERED" | "READY" | "PROVISIONED" | "NEEDS_RECONNECTION" | "REVOKED";
  enrollmentStatus: "UNENROLLED" | "ENROLLED" | "REVOKED";
  firmwareVersion: string | null;
  lastSeenAt: Date | null;
  storeId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredDeviceRecord extends DeviceMetadata {
  /** Public provisioning transcript context; never a bearer credential. */
  deviceKey?: string;
  /** SHA-256 verifier for the operational bearer credential. */
  deviceSecretHash?: string;
}

function toDeviceMetadata(device: StoredDeviceRecord): DeviceMetadata {
  const {
    deviceKey: _deviceKey,
    deviceSecretHash: _deviceSecretHash,
    ...metadata
  } = device;
  return metadata;
}

export class DeviceAuthorizationError extends Error {
  readonly statusCode: 400 | 401 | 403 | 404 | 409 | 503;

  constructor(message: string, statusCode: 400 | 401 | 403 | 404 | 409 | 503) {
    super(message);
    this.name = "DeviceAuthorizationError";
    this.statusCode = statusCode;
  }
}

async function requireOwner(
  db: DeviceDatabase,
  accountId: string,
  storeId: string,
): Promise<void> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { status: true, emailVerifiedAt: true },
  });
  if (account === null || account.status === "DISABLED")
    throw new DeviceAuthorizationError("Authentication required", 401);
  if (account.status !== "ACTIVE" || account.emailVerifiedAt === null) {
    throw new DeviceAuthorizationError("Email verification required", 403);
  }
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: { id: true, isActive: true },
  });
  if (store === null || !store.isActive)
    throw new DeviceAuthorizationError("Resource not found", 404);
  const membership = await db.storeMembership.findFirst({
    where: { accountId, storeId, role: "OWNER", status: "ACTIVE" },
    select: { accountId: true, storeId: true, role: true, status: true },
  });
  if (membership === null)
    throw new DeviceAuthorizationError("Resource not found", 404);
}

async function requireDeviceReader(
  db: DeviceDatabase,
  accountId: string,
  storeId: string,
): Promise<void> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { status: true, emailVerifiedAt: true },
  });
  if (account === null || account.status === "DISABLED")
    throw new DeviceAuthorizationError("Authentication required", 401);
  if (account.status !== "ACTIVE" || account.emailVerifiedAt === null) {
    throw new DeviceAuthorizationError("Email verification required", 403);
  }
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: { id: true, isActive: true },
  });
  if (store === null || !store.isActive)
    throw new DeviceAuthorizationError("Resource not found", 404);
  const membership = await db.storeMembership.findFirst({
    where: { accountId, storeId, status: "ACTIVE", role: { in: ["OWNER", "STAFF"] } },
    select: { accountId: true, storeId: true, role: true, status: true },
  });
  if (membership === null)
    throw new DeviceAuthorizationError("Resource not found", 404);
}

export async function createDeviceForOwner(
  db: DeviceDatabase,
  accountId: string,
  storeId: string,
  input: { deviceId: string; name: string; firmwareVersion?: string },
  requestId?: string,
): Promise<DeviceMetadata> {
  if (!isMacDerivedDeviceId(input.deviceId)) {
    throw new DeviceAuthorizationError("Invalid MAC-derived Device ID", 400);
  }
  await requireOwner(db, accountId, storeId);
  try {
    return await db.$transaction(async (tx) => {
      await requireOwner(tx, accountId, storeId);
      const operationalToken = generateOperationalToken();
      const device = await tx.device.create({
        data: {
          id: input.deviceId,
          deviceKey: generateDeviceKey(),
          deviceSecretHash: hashDeviceToken(operationalToken),
          name: input.name,
          type: "CALL_BUTTON",
          status: "PENDING",
          provisioningState: "UNREGISTERED",
          enrollmentStatus: "UNENROLLED",
          firmwareVersion: input.firmwareVersion,
          storeId,
        },
      });
      await writeAuditEvent(tx, {
        actorType: "ACCOUNT",
        actorId: accountId,
        action: "DEVICE_REGISTERED",
        resourceType: "DEVICE",
        resourceId: device.id,
        storeId,
        requestId,
        metadata: { accountId, deviceId: device.id, outcome: "success" },
      });
      return toDeviceMetadata(device);
    });
  } catch (error: unknown) {
    if (error instanceof DeviceAuthorizationError) throw error;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DeviceAuthorizationError(
        "Device identity conflicts with current state",
        409,
      );
    }
    throw error;
  }
}

export async function listDevicesForMember(
  db: DeviceDatabase,
  accountId: string,
  storeId: string,
): Promise<DeviceMetadata[]> {
  await requireDeviceReader(db, accountId, storeId);
  return db.device.findMany({
    where: { storeId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      provisioningState: true,
      enrollmentStatus: true,
      firmwareVersion: true,
      lastSeenAt: true,
      storeId: true,
      createdAt: true,
      updatedAt: true,
    },
  }).then((devices) => devices.map(toDeviceMetadata));
}

/** @deprecated Keep the service name for integrations that still import it. */
export const listDevicesForOwner = listDevicesForMember;
