import { Prisma } from "../../generated/prisma/client.js";
import { writeAuditEvent } from "../../shared/audit.js";
import {
  generateChallenge,
  generateOperationalToken,
  hashChallenge,
  hashDeviceToken,
  verifyDeviceClaimProof,
  type DeviceClaimProof,
} from "./provisioning-crypto.js";
import { ProvisioningError, requireOwner } from "./provisioning.service.js";

export interface DeviceClaimSessionRecord {
  id: string;
  deviceId: string;
  storeId: string;
  actorAccountId: string;
  name: string;
  challengeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface ClaimedDeviceRecord {
  id: string;
  deviceKey: string;
  storeId: string;
  status: "PENDING" | "ONLINE" | "OFFLINE" | "DISABLED";
  provisioningState: "READY" | "PROVISIONED" | "NEEDS_RECONNECTION" | "REVOKED" | "UNREGISTERED";
  enrollmentStatus: "ENROLLED" | "UNENROLLED" | "REVOKED";
  enrollmentPublicKey: string | null;
  enrollmentKeyVersion: number | null;
  name: string;
  type: "CALL_BUTTON";
  firmwareVersion: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface DeviceClaimDatabase {
  account: { findUnique(args: unknown): Promise<{ id: string; status: "PENDING" | "ACTIVE" | "DISABLED"; emailVerifiedAt: Date | null } | null> };
  storeMembership: { findFirst(args: unknown): Promise<{ accountId: string; storeId: string; role: "OWNER" | "STAFF"; status: "ACTIVE" | "SUSPENDED" | "REVOKED" } | null> };
  device: {
    findUnique(args: unknown): Promise<ClaimedDeviceRecord | null>;
    create(args: unknown): Promise<ClaimedDeviceRecord>;
  };
  deviceClaimSession: {
    create(args: unknown): Promise<DeviceClaimSessionRecord>;
    findUnique(args: unknown): Promise<DeviceClaimSessionRecord | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  auditEvent: { create(args: unknown): Promise<unknown> };
  $transaction<T>(callback: (tx: DeviceClaimDatabase) => Promise<T>): Promise<T>;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function createDeviceClaimSession(
  db: DeviceClaimDatabase,
  accountId: string,
  storeId: string,
  deviceId: string,
  name: string,
  now = new Date(),
): Promise<{ session: DeviceClaimSessionRecord; challenge: string } | { alreadyClaimed: true; device: ClaimedDeviceRecord }> {
  await requireOwner(db as never, accountId, storeId);
  const existing = await db.device.findUnique({ where: { id: deviceId } });
  if (existing !== null) {
    if (existing.storeId === storeId && existing.enrollmentStatus === "ENROLLED" &&
        existing.provisioningState !== "REVOKED" && existing.status !== "DISABLED") {
      return { alreadyClaimed: true, device: existing };
    }
    throw new ProvisioningError("Device cannot be claimed", 409);
  }
  const challenge = generateChallenge();
  const session = await db.deviceClaimSession.create({
    data: {
      deviceId, storeId, actorAccountId: accountId,
      name,
      challengeHash: hashChallenge(challenge),
      expiresAt: new Date(now.getTime() + 5 * 60_000),
    },
  });
  return { session, challenge };
}

export async function completeDeviceClaim(
  db: DeviceClaimDatabase,
  accountId: string,
  storeId: string,
  claimSessionId: string,
  challenge: string,
  proof: DeviceClaimProof,
  requestId?: string,
  now = new Date(),
): Promise<ClaimedDeviceRecord> {
  await requireOwner(db as never, accountId, storeId);
  try {
    return await db.$transaction(async (tx) => {
      const session = await tx.deviceClaimSession.findUnique({ where: { id: claimSessionId } });
      if (session === null || session.storeId !== storeId || session.actorAccountId !== accountId ||
          hashChallenge(challenge) !== session.challengeHash) {
        throw new ProvisioningError("Device claim proof is invalid or expired", 401);
      }
      if (session.expiresAt <= now ||
          !verifyDeviceClaimProof({ deviceId: session.deviceId, storeId, claimSessionId, proof, now }) ||
          proof.challenge !== challenge || Math.floor(session.expiresAt.getTime() / 1000) !== proof.expiresAt) {
        throw new ProvisioningError("Device claim proof is invalid or expired", 401);
      }
      if (session.consumedAt !== null) {
        const existing = await tx.device.findUnique({ where: { id: session.deviceId } });
        if (existing?.storeId === storeId && existing.enrollmentPublicKey === proof.publicKeySpkiBase64 &&
            existing.enrollmentKeyVersion === proof.keyVersion) return existing;
        throw new ProvisioningError("Device cannot be claimed", 409);
      }
      if (await tx.device.findUnique({ where: { id: session.deviceId }, select: { id: true } })) {
        throw new ProvisioningError("Device cannot be claimed", 409);
      }
      const consumed = await tx.deviceClaimSession.updateMany({
        where: { id: claimSessionId, storeId, actorAccountId: accountId, challengeHash: session.challengeHash, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new ProvisioningError("Device claim session already used", 409);
      const operationalToken = generateOperationalToken();
      const device = await tx.device.create({
        data: {
          id: session.deviceId,
          deviceKey: operationalToken,
          deviceSecretHash: hashDeviceToken(operationalToken),
          name: session.name,
          type: "CALL_BUTTON",
          status: "PENDING",
          provisioningState: "READY",
          enrollmentStatus: "ENROLLED",
          enrollmentPublicKey: proof.publicKeySpkiBase64,
          enrollmentKeyVersion: proof.keyVersion,
          enrolledAt: now,
          storeId,
        },
      });
      await writeAuditEvent(tx, {
        actorType: "ACCOUNT", actorId: accountId,
        action: "DEVICE_CLAIMED", resourceType: "DEVICE", resourceId: device.id,
        storeId, requestId,
        metadata: { deviceId: device.id, keyVersion: proof.keyVersion, outcome: "success" },
        occurredAt: now,
      });
      return device;
    });
  } catch (error: unknown) {
    if (error instanceof ProvisioningError) throw error;
    if (isUniqueViolation(error)) throw new ProvisioningError("Device cannot be claimed", 409);
    throw error;
  }
}
