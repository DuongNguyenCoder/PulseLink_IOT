import { Prisma } from "../../generated/prisma/client.js";
import { writeAuditEvent } from "../../shared/audit.js";
import {
  generateBootstrapValue,
  generateChallenge,
  generateOperationalToken,
  hashBootstrapValue,
  hashChallenge,
  hashDeviceToken,
  isSupportedEnrollmentPublicKey,
  verifyDeviceEnrollmentProof,
  verifyEnrollmentSignature,
  type DeviceEnrollmentProof,
} from "./provisioning-crypto.js";

type AccountStatus = "PENDING" | "ACTIVE" | "DISABLED";
type ProvisioningState =
  "UNREGISTERED" | "READY" | "PROVISIONED" | "NEEDS_RECONNECTION" | "REVOKED";
type EnrollmentStatus = "UNENROLLED" | "ENROLLED" | "REVOKED";
type SessionStatus = "ACTIVE" | "REDEEMED" | "EXPIRED" | "LOCKED" | "REVOKED";

export interface ProvisioningDatabase {
  account: {
    findUnique(args: unknown): Promise<{
      id: string;
      status: AccountStatus;
      emailVerifiedAt: Date | null;
    } | null>;
  };
  storeMembership: {
    findFirst(args: unknown): Promise<{
      accountId: string;
      storeId: string;
      role: "OWNER" | "STAFF";
      status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    } | null>;
  };
  device: {
    findUnique(args: unknown): Promise<DeviceRecord | null>;
    findFirst(args: unknown): Promise<DeviceRecord | null>;
    update(args: unknown): Promise<DeviceRecord>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  provisioningSession: {
    create(args: unknown): Promise<ProvisioningSessionRecord>;
    findUnique(args: unknown): Promise<ProvisioningSessionRecord | null>;
    findMany(args: unknown): Promise<ProvisioningSessionRecord[]>;
    update(args: unknown): Promise<ProvisioningSessionRecord>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  auditEvent: { create(args: unknown): Promise<unknown> };
  $transaction<T>(
    callback: (tx: ProvisioningDatabase) => Promise<T>,
  ): Promise<T>;
}

export interface DeviceRecord {
  id: string;
  deviceKey: string;
  deviceSecretHash: string;
  storeId: string;
  status: "PENDING" | "ONLINE" | "OFFLINE" | "DISABLED";
  provisioningState: ProvisioningState;
  enrollmentStatus: EnrollmentStatus;
  enrollmentPublicKey: string | null;
  enrollmentKeyVersion: number | null;
}

export interface ProvisioningSessionRecord {
  id: string;
  deviceId: string;
  storeId: string;
  actorAccountId: string;
  bootstrapVerifier: string;
  challengeHash: string;
  idempotencyKey: string;
  status: SessionStatus;
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date;
  lockedAt: Date | null;
  consumedAt: Date | null;
  revokedAt: Date | null;
  lastAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ProvisioningError extends Error {
  readonly statusCode: 400 | 401 | 403 | 404 | 409 | 503;

  constructor(message: string, statusCode: 400 | 401 | 403 | 404 | 409 | 503) {
    super(message);
    this.name = "ProvisioningError";
    this.statusCode = statusCode;
  }
}

export interface SafeProvisioningSession {
  id: string;
  deviceId: string;
  storeId: string;
  status: SessionStatus;
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date;
  lockedAt: Date | null;
  consumedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function safeSession(
  record: ProvisioningSessionRecord,
): SafeProvisioningSession {
  return {
    id: record.id,
    deviceId: record.deviceId,
    storeId: record.storeId,
    status: record.status,
    attemptCount: record.attemptCount,
    maxAttempts: record.maxAttempts,
    expiresAt: record.expiresAt,
    lockedAt: record.lockedAt,
    consumedAt: record.consumedAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}

export async function requireOwner(
  db: ProvisioningDatabase,
  accountId: string,
  storeId: string,
): Promise<void> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { id: true, status: true, emailVerifiedAt: true },
  });
  if (account === null || account.status === "DISABLED")
    throw new ProvisioningError("Authentication required", 401);
  if (account.status !== "ACTIVE" || account.emailVerifiedAt === null) {
    throw new ProvisioningError("Email verification required", 403);
  }
  const membership = await db.storeMembership.findFirst({
    where: { accountId, storeId, role: "OWNER", status: "ACTIVE" },
    select: { accountId: true, storeId: true, role: true, status: true },
  });
  if (membership === null)
    throw new ProvisioningError("Resource not found", 404);
}

export interface EnrollmentActor {
  actorId: string;
  actorType?: "ACCOUNT" | "SYSTEM";
}

export async function enrollDevice(
  db: ProvisioningDatabase,
  actor: EnrollmentActor,
  deviceId: string,
  proof: DeviceEnrollmentProof,
  requestId?: string,
  now = new Date(),
): Promise<DeviceRecord> {
  if (!isSupportedEnrollmentPublicKey(proof.publicKeySpkiBase64)) {
    throw new ProvisioningError("Unsupported enrollment public key", 400);
  }
  try {
    return await db.$transaction(async (tx) => {
      const device = await tx.device.findUnique({ where: { id: deviceId } });
      if (device === null)
        throw new ProvisioningError("Resource not found", 404);
      if (!verifyDeviceEnrollmentProof({ deviceKey: device.deviceKey, proof, now })) {
        throw new ProvisioningError("Device enrollment proof is invalid", 401);
      }
      if (
        device.status === "DISABLED" ||
        device.enrollmentStatus !== "UNENROLLED" ||
        device.provisioningState === "REVOKED"
      ) {
        throw new ProvisioningError("Device is already enrolled", 409);
      }
      const claimed = await tx.device.updateMany({
        where: {
          id: deviceId,
          deviceKey: device.deviceKey,
          status: { not: "DISABLED" },
          enrollmentStatus: "UNENROLLED",
          provisioningState: { not: "REVOKED" },
        },
        data: {
          enrollmentPublicKey: proof.publicKeySpkiBase64,
          enrollmentKeyVersion: proof.keyVersion,
          enrollmentStatus: "ENROLLED",
          provisioningState: "READY",
          enrolledAt: now,
          enrollmentRevokedAt: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ProvisioningError("Device enrollment conflicts with current state", 409);
      }
      const updated = await tx.device.findUnique({ where: { id: deviceId } });
      if (updated === null) throw new ProvisioningError("Resource not found", 404);
      await writeAuditEvent(tx, {
        actorType: actor.actorType ?? "SYSTEM",
        actorId: actor.actorId,
        action: "DEVICE_ENROLLED",
        resourceType: "DEVICE",
        resourceId: deviceId,
        storeId: device.storeId,
        requestId,
        metadata: {
          deviceId,
          keyVersion: proof.keyVersion,
          outcome: "success",
        },
        occurredAt: now,
      });
      return updated;
    });
  } catch (error: unknown) {
    if (error instanceof ProvisioningError) throw error;
    if (isUniqueViolation(error))
      throw new ProvisioningError(
        "Device enrollment conflicts with current state",
        409,
      );
    throw error;
  }
}

export async function revokeDeviceEnrollment(
  db: ProvisioningDatabase,
  actor: EnrollmentActor,
  deviceId: string,
  requestId?: string,
  now = new Date(),
): Promise<void> {
  await db.$transaction(async (tx) => {
    const device = await tx.device.findUnique({ where: { id: deviceId } });
    if (device === null) throw new ProvisioningError("Resource not found", 404);
    await tx.provisioningSession.updateMany({
      where: { deviceId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: now },
    });
    await tx.device.update({
      where: { id: deviceId },
      data: {
        enrollmentStatus: "REVOKED",
        provisioningState: "REVOKED",
        enrollmentRevokedAt: now,
      },
    });
    await writeAuditEvent(tx, {
      actorType: actor.actorType ?? "SYSTEM",
      actorId: actor.actorId,
      action: "DEVICE_ENROLLMENT_REVOKED",
      resourceType: "DEVICE",
      resourceId: deviceId,
      storeId: device.storeId,
      requestId,
      metadata: { deviceId, outcome: "success" },
      occurredAt: now,
    });
  });
}

export async function createProvisioningSession(
  db: ProvisioningDatabase,
  accountId: string,
  storeId: string,
  input: { deviceId: string; idempotencyKey: string },
  requestId?: string,
  now = new Date(),
): Promise<{
  session: SafeProvisioningSession;
  bootstrapSecret: string;
  challenge: string;
  deviceEnrollmentPublicKey: string;
}> {
  await requireOwner(db, accountId, storeId);
  const bootstrapSecret = generateBootstrapValue();
  const challenge = generateChallenge();
  const expiresAt = new Date(now.getTime() + 30 * 60_000);

  try {
    const result = await db.$transaction(async (tx) => {
      await requireOwner(tx, accountId, storeId);
      const device = await tx.device.findUnique({
        where: { id: input.deviceId },
      });
      if (device === null || device.storeId !== storeId)
        throw new ProvisioningError("Resource not found", 404);
      if (
        device.enrollmentStatus !== "ENROLLED" ||
        device.provisioningState === "REVOKED"
      ) {
        throw new ProvisioningError(
          "Device is not available for provisioning",
          409,
        );
      }
      if (device.enrollmentPublicKey === null) {
        throw new ProvisioningError(
          "Device identity is not available for provisioning",
          409,
        );
      }
      const session = await tx.provisioningSession.create({
        data: {
          deviceId: input.deviceId,
          storeId,
          actorAccountId: accountId,
          bootstrapVerifier: hashBootstrapValue(bootstrapSecret),
          challengeHash: hashChallenge(challenge),
          idempotencyKey: input.idempotencyKey,
          status: "ACTIVE",
          expiresAt,
        },
      });
      await writeAuditEvent(tx, {
        actorType: "ACCOUNT",
        actorId: accountId,
        action: "PROVISIONING_SESSION_CREATED",
        resourceType: "PROVISIONING_SESSION",
        resourceId: session.id,
        storeId,
        requestId,
        metadata: { accountId, deviceId: input.deviceId, outcome: "success" },
        occurredAt: now,
      });
      return { session, deviceEnrollmentPublicKey: device.enrollmentPublicKey };
    });
    return {
      session: safeSession(result.session),
      bootstrapSecret,
      challenge,
      deviceEnrollmentPublicKey: result.deviceEnrollmentPublicKey,
    };
  } catch (error: unknown) {
    if (error instanceof ProvisioningError) throw error;
    if (isUniqueViolation(error))
      throw new ProvisioningError(
        "Provisioning session conflicts with current state",
        409,
      );
    throw error;
  }
}

export async function listProvisioningSessions(
  db: ProvisioningDatabase,
  accountId: string,
  storeId: string,
): Promise<SafeProvisioningSession[]> {
  await requireOwner(db, accountId, storeId);
  const sessions = await db.provisioningSession.findMany({
    where: { actorAccountId: accountId, storeId },
    orderBy: { createdAt: "desc" },
  });
  return sessions.map(safeSession);
}

export async function getProvisioningSession(
  db: ProvisioningDatabase,
  accountId: string,
  storeId: string,
  sessionId: string,
): Promise<SafeProvisioningSession> {
  await requireOwner(db, accountId, storeId);
  const session = await db.provisioningSession.findUnique({
    where: { id: sessionId },
  });
  if (
    session === null ||
    session.storeId !== storeId ||
    session.actorAccountId !== accountId
  ) {
    throw new ProvisioningError("Resource not found", 404);
  }
  return safeSession(session);
}

export async function cancelProvisioningSession(
  db: ProvisioningDatabase,
  accountId: string,
  storeId: string,
  sessionId: string,
  requestId?: string,
  now = new Date(),
): Promise<void> {
  await requireOwner(db, accountId, storeId);
  await db.$transaction(async (tx) => {
    const session = await tx.provisioningSession.findUnique({
      where: { id: sessionId },
    });
    if (
      session === null ||
      session.storeId !== storeId ||
      session.actorAccountId !== accountId
    ) {
      throw new ProvisioningError("Resource not found", 404);
    }
    if (session.status !== "ACTIVE")
      throw new ProvisioningError("Provisioning session is not active", 409);
    await tx.provisioningSession.update({
      where: { id: sessionId },
      data: { status: "REVOKED", revokedAt: now },
    });
    await writeAuditEvent(tx, {
      actorType: "ACCOUNT",
      actorId: accountId,
      action: "PROVISIONING_SESSION_REVOKED",
      resourceType: "PROVISIONING_SESSION",
      resourceId: sessionId,
      storeId,
      requestId,
      metadata: { accountId, deviceId: session.deviceId, outcome: "success" },
      occurredAt: now,
    });
  });
}

async function recordFailedAttempt(
  db: ProvisioningDatabase,
  sessionId: string,
  now: Date,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const update = await tx.provisioningSession.updateMany({
      where: {
        id: sessionId,
        status: "ACTIVE",
        expiresAt: { gt: now },
        attemptCount: { lt: 5 },
      },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    if (update.count !== 1) return;
    const current = await tx.provisioningSession.findUnique({
      where: { id: sessionId },
    });
    if (current !== null && current.attemptCount >= current.maxAttempts) {
      await tx.provisioningSession.update({
        where: { id: sessionId },
        data: { status: "LOCKED", lockedAt: now },
      });
      await writeAuditEvent(tx, {
        actorType: "SYSTEM",
        actorId: null,
        action: "PROVISIONING_SESSION_LOCKED",
        resourceType: "PROVISIONING_SESSION",
        resourceId: sessionId,
        storeId: current.storeId,
        metadata: {
          deviceId: current.deviceId,
          status: "LOCKED",
          outcome: "locked",
        },
        occurredAt: now,
      });
    }
  });
}

export async function redeemProvisioningSession(
  db: ProvisioningDatabase,
  input: {
    deviceId: string;
    sessionId: string;
    bootstrapSecret: string;
    challenge: string;
    signature: string;
  },
  requestId?: string,
  now = new Date(),
): Promise<{ operationalToken: string; sessionId: string; deviceId: string }> {
  const session = await db.provisioningSession.findUnique({
    where: { id: input.sessionId },
  });
  const device = await db.device.findUnique({ where: { id: input.deviceId } });
  if (
    session === null ||
    session.deviceId !== input.deviceId ||
    session.storeId !== device?.storeId ||
    session.status !== "ACTIVE" ||
    device === null
  ) {
    throw new ProvisioningError("Invalid provisioning credentials", 401);
  }

  const validSecret =
    hashBootstrapValue(input.bootstrapSecret) === session.bootstrapVerifier;
  const validChallenge =
    hashChallenge(input.challenge) === session.challengeHash;
  const validSignature =
    device.enrollmentPublicKey !== null &&
    verifyEnrollmentSignature({
      publicKeySpkiBase64: device.enrollmentPublicKey,
      signatureDerBase64: input.signature,
      sessionId: session.id,
      deviceKey: device.deviceKey,
      challenge: input.challenge,
      expiresAt: session.expiresAt,
    });
  if (!validSecret || !validChallenge || !validSignature) {
    await recordFailedAttempt(db, session.id, now);
    throw new ProvisioningError("Invalid provisioning credentials", 401);
  }

  const operationalToken = generateOperationalToken();
  const result = await db.$transaction(async (tx) => {
    const consumed = await tx.provisioningSession.updateMany({
      where: {
        id: session.id,
        deviceId: input.deviceId,
        status: "ACTIVE",
        expiresAt: { gt: now },
        attemptCount: { lt: 5 },
      },
      data: { status: "REDEEMED", consumedAt: now, lastAttemptAt: now },
    });
    if (consumed.count !== 1)
      throw new ProvisioningError(
        "Provisioning session is no longer active",
        409,
      );

    const deviceUpdate = await tx.device.updateMany({
      where: {
        id: input.deviceId,
        status: { not: "DISABLED" },
        enrollmentStatus: "ENROLLED",
        provisioningState: { not: "REVOKED" },
      },
      data: {
        deviceSecretHash: hashDeviceToken(operationalToken),
        provisioningState: "PROVISIONED",
      },
    });
    if (deviceUpdate.count !== 1) {
      throw new ProvisioningError(
        "Device is not available for provisioning",
        409,
      );
    }
    const updatedDevice = await tx.device.findUnique({
      where: { id: input.deviceId },
    });
    if (updatedDevice === null) {
      throw new ProvisioningError(
        "Device is not available for provisioning",
        409,
      );
    }
    await writeAuditEvent(tx, {
      actorType: "DEVICE",
      actorId: updatedDevice.id,
      action:
        device.provisioningState === "PROVISIONED"
          ? "DEVICE_CREDENTIAL_ROTATED"
          : "DEVICE_PROVISIONED",
      resourceType: "DEVICE",
      resourceId: updatedDevice.id,
      storeId: updatedDevice.storeId,
      requestId,
      metadata: { deviceId: updatedDevice.id, outcome: "success" },
      occurredAt: now,
    });
    return updatedDevice;
  });
  return { operationalToken, sessionId: session.id, deviceId: result.id };
}

export async function authenticateDevice(
  db: ProvisioningDatabase,
  token: string,
): Promise<DeviceRecord> {
  const verifier = hashDeviceToken(token);
  const device = await db.device.findFirst({
    where: { deviceSecretHash: verifier },
  });
  if (
    device === null ||
    device.status === "DISABLED" ||
    device.enrollmentStatus !== "ENROLLED" ||
    device.provisioningState !== "PROVISIONED"
  ) {
    throw new ProvisioningError("Device authentication failed", 401);
  }
  return device;
}
