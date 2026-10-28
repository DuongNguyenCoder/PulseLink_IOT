import { Prisma } from "../../generated/prisma/client.js";
import {
  generateOperationalToken,
  hashDeviceToken,
} from "../provisioning/provisioning-crypto.js";
import { writeAuditEvent } from "../../shared/audit.js";

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
    create(args: unknown): Promise<DeviceMetadata>;
    findMany(args: unknown): Promise<DeviceMetadata[]>;
  };
  auditEvent: { create(args: unknown): Promise<unknown> };
  $transaction<T>(callback: (tx: DeviceDatabase) => Promise<T>): Promise<T>;
}

export interface DeviceMetadata {
  id: string;
  deviceKey: string;
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

export async function createDeviceForOwner(
  db: DeviceDatabase,
  accountId: string,
  storeId: string,
  input: { name: string; firmwareVersion?: string },
  requestId?: string,
): Promise<DeviceMetadata> {
  await requireOwner(db, accountId, storeId);
  try {
    return await db.$transaction(async (tx) => {
      await requireOwner(tx, accountId, storeId);
      const deviceKey = generateOperationalToken();
      const device = await tx.device.create({
        data: {
          deviceKey,
          deviceSecretHash: hashDeviceToken(generateOperationalToken()),
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
      return device;
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

export async function listDevicesForOwner(
  db: DeviceDatabase,
  accountId: string,
  storeId: string,
): Promise<DeviceMetadata[]> {
  await requireOwner(db, accountId, storeId);
  return db.device.findMany({
    where: { storeId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      deviceKey: true,
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
  });
}
