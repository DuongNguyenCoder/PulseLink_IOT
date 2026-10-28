import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalProvisioningPayload,
  generateChallenge,
  generateBootstrapValue,
  hashBootstrapValue,
  hashChallenge,
} from "./provisioning-crypto.js";
import {
  ProvisioningError,
  redeemProvisioningSession,
  type DeviceRecord,
  type ProvisioningDatabase,
  type ProvisioningSessionRecord,
} from "./provisioning.service.js";

describe("provisioning service safety", () => {
  it("rejects a provisioning session whose Store does not match the Device", async () => {
    const device: DeviceRecord = {
      id: "device-1",
      deviceKey: "device-key-1",
      deviceSecretHash: "device-secret-verifier",
      storeId: "store-device",
      status: "ONLINE",
      provisioningState: "READY",
      enrollmentStatus: "ENROLLED",
      enrollmentPublicKey: null,
      enrollmentKeyVersion: 1,
    };
    const session: ProvisioningSessionRecord = {
      id: "session-1",
      deviceId: device.id,
      storeId: "store-session",
      actorAccountId: "account-1",
      bootstrapVerifier: "bootstrap-verifier",
      challengeHash: "challenge-hash",
      idempotencyKey: "idempotency-1",
      status: "ACTIVE",
      attemptCount: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
      lockedAt: null,
      consumedAt: null,
      revokedAt: null,
      lastAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      account: { findUnique: async () => null },
      storeMembership: { findFirst: async () => null },
      device: {
        findUnique: async () => device,
        findFirst: async () => device,
        update: async () => device,
        updateMany: async () => ({ count: 1 }),
      },
      provisioningSession: {
        create: async () => session,
        findUnique: async () => session,
        findMany: async () => [session],
        update: async () => session,
        updateMany: async () => ({ count: 1 }),
      },
      auditEvent: { create: async () => undefined },
      $transaction: async <T>(
        callback: (tx: ProvisioningDatabase) => Promise<T>,
      ) => callback(db as unknown as ProvisioningDatabase),
    } as unknown as ProvisioningDatabase;

    await expect(
      redeemProvisioningSession(db, {
        deviceId: device.id,
        sessionId: session.id,
        bootstrapSecret: "not-a-secret",
        challenge: "not-a-challenge",
        signature: "not-a-signature",
      }),
    ).rejects.toMatchObject<Partial<ProvisioningError>>({ statusCode: 401 });
  });

  it("does not issue an operational credential when the device is revoked during redemption", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const sessionId = "session-1";
    const deviceId = "device-1";
    const deviceKey = "device-key-1";
    const bootstrapSecret = generateBootstrapValue();
    const challenge = generateChallenge();
    const expiresAt = new Date(Date.now() + 60_000);
    const publicKeySpkiBase64 = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    const signature = sign(
      "sha256",
      canonicalProvisioningPayload({
        sessionId,
        deviceKey,
        challenge,
        expiresAt,
      }),
      { key: privateKey, dsaEncoding: "der" },
    ).toString("base64");
    const device: DeviceRecord = {
      id: deviceId,
      deviceKey,
      deviceSecretHash: "old-verifier",
      storeId: "store-1",
      status: "ONLINE",
      provisioningState: "READY",
      enrollmentStatus: "ENROLLED",
      enrollmentPublicKey: publicKeySpkiBase64,
      enrollmentKeyVersion: 1,
    };
    const session: ProvisioningSessionRecord = {
      id: sessionId,
      deviceId,
      storeId: "store-1",
      actorAccountId: "account-1",
      bootstrapVerifier: hashBootstrapValue(bootstrapSecret),
      challengeHash: hashChallenge(challenge),
      idempotencyKey: "idempotency-1",
      status: "ACTIVE",
      attemptCount: 0,
      maxAttempts: 5,
      expiresAt,
      lockedAt: null,
      consumedAt: null,
      revokedAt: null,
      lastAttemptAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      account: { findUnique: async () => null },
      storeMembership: { findFirst: async () => null },
      device: {
        findUnique: async () => device,
        findFirst: async () => device,
        update: async () => device,
        updateMany: async () => ({ count: 0 }),
      },
      provisioningSession: {
        create: async () => session,
        findUnique: async () => session,
        findMany: async () => [session],
        update: async () => session,
        updateMany: async () => ({ count: 1 }),
      },
      auditEvent: { create: async () => undefined },
      $transaction: async <T>(
        callback: (tx: ProvisioningDatabase) => Promise<T>,
      ) => callback(db as unknown as ProvisioningDatabase),
    } as unknown as ProvisioningDatabase;

    await expect(
      redeemProvisioningSession(db, {
        deviceId,
        sessionId,
        bootstrapSecret,
        challenge,
        signature,
      }),
    ).rejects.toMatchObject<Partial<ProvisioningError>>({
      statusCode: 409,
    });
  });
});
