import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalProvisioningPayload,
  canonicalDeviceEnrollmentPayload,
  generateChallenge,
  generateBootstrapValue,
  hashBootstrapValue,
  hashChallenge,
} from "./provisioning-crypto.js";
import {
  ProvisioningError,
  createProvisioningSession,
  redeemProvisioningSession,
  enrollDevice,
  type DeviceRecord,
  type ProvisioningDatabase,
  type ProvisioningSessionRecord,
} from "./provisioning.service.js";

describe("provisioning service safety", () => {
  it("enrolls only the one-time Device-bound key proof and rejects replay/races", async () => {
    const now = new Date("2026-10-28T10:00:00.000Z");
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKeySpkiBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const device: DeviceRecord = {
      id: "device-enrollment-1",
      deviceKey: "device-key-enrollment-1",
      deviceSecretHash: "unused-verifier",
      storeId: "store-enrollment-1",
      status: "PENDING",
      provisioningState: "UNREGISTERED",
      enrollmentStatus: "UNENROLLED",
      enrollmentPublicKey: null,
      enrollmentKeyVersion: null,
    };
    const proofBody = {
      publicKeySpkiBase64,
      keyVersion: 1,
      challenge: randomBytes(32).toString("base64url"),
      expiresAt: Math.floor(now.getTime() / 1000) + 120,
    };
    const proof = {
      ...proofBody,
      signatureDerBase64: sign(
        "sha256",
        canonicalDeviceEnrollmentPayload({ deviceKey: device.deviceKey, proof: proofBody }),
        { key: privateKey, dsaEncoding: "der" },
      ).toString("base64"),
    };
    let stored: DeviceRecord = device;
    let claimCount = 0;
    const db = {
      account: { findUnique: async () => null },
      storeMembership: { findFirst: async () => null },
      device: {
        findUnique: async () => stored,
        findFirst: async () => stored,
        update: async () => stored,
        updateMany: async (args: { where: { enrollmentStatus: string }; data: Partial<DeviceRecord> }) => {
          claimCount++;
          if (stored.enrollmentStatus !== args.where.enrollmentStatus) return { count: 0 };
          stored = { ...stored, ...args.data };
          return { count: 1 };
        },
      },
      provisioningSession: {
        create: async () => { throw new Error("not used"); },
        findUnique: async () => null,
        findMany: async () => [],
        update: async () => { throw new Error("not used"); },
        updateMany: async () => ({ count: 0 }),
      },
      auditEvent: { create: async () => undefined },
      $transaction: async <T>(callback: (tx: ProvisioningDatabase) => Promise<T>) =>
        callback(db as unknown as ProvisioningDatabase),
    } as unknown as ProvisioningDatabase;

    const enrolled = await enrollDevice(db, { actorId: "factory-operator", actorType: "SYSTEM" }, device.id, proof, undefined, now);
    expect(enrolled.enrollmentStatus).toBe("ENROLLED");
    expect(enrolled.enrollmentPublicKey).toBe(publicKeySpkiBase64);
    await expect(enrollDevice(db, { actorId: "factory-operator", actorType: "SYSTEM" }, device.id, proof, undefined, now))
      .rejects.toMatchObject<Partial<ProvisioningError>>({ statusCode: 409 });
    expect(claimCount).toBe(1);

    const raceDb = {
      ...db,
      device: { ...db.device, findUnique: async () => device, updateMany: async () => ({ count: 0 }) },
      $transaction: async <T>(callback: (tx: ProvisioningDatabase) => Promise<T>) =>
        callback(raceDb as unknown as ProvisioningDatabase),
    } as unknown as ProvisioningDatabase;
    await expect(enrollDevice(raceDb, { actorId: "factory-operator", actorType: "SYSTEM" }, device.id, proof, undefined, now))
      .rejects.toMatchObject<Partial<ProvisioningError>>({ statusCode: 409 });
  });

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

  it("returns the enrolled public key and fails closed when identity is missing", async () => {
    const now = new Date("2026-10-28T00:00:00.000Z");
    const publicKey = "enrolled-spki-base64";
    const device: DeviceRecord = {
      id: "device-1",
      deviceKey: "device-key-1",
      deviceSecretHash: "device-secret-verifier",
      storeId: "store-1",
      status: "ONLINE",
      provisioningState: "READY",
      enrollmentStatus: "ENROLLED",
      enrollmentPublicKey: publicKey,
      enrollmentKeyVersion: 1,
    };
    const session: ProvisioningSessionRecord = {
      id: "session-1",
      deviceId: device.id,
      storeId: device.storeId,
      actorAccountId: "account-1",
      bootstrapVerifier: "bootstrap-verifier",
      challengeHash: "challenge-hash",
      idempotencyKey: "idempotency-1",
      status: "ACTIVE",
      attemptCount: 0,
      maxAttempts: 5,
      expiresAt: new Date(now.getTime() + 30 * 60_000),
      lockedAt: null,
      consumedAt: null,
      revokedAt: null,
      lastAttemptAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const db = {
      account: {
        findUnique: async () => ({
          id: "account-1",
          status: "ACTIVE" as const,
          emailVerifiedAt: now,
        }),
      },
      storeMembership: {
        findFirst: async () => ({
          accountId: "account-1",
          storeId: "store-1",
          role: "OWNER" as const,
          status: "ACTIVE" as const,
        }),
      },
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

    const created = await createProvisioningSession(
      db,
      "account-1",
      "store-1",
      { deviceId: device.id, idempotencyKey: "idempotency-1" },
      undefined,
      now,
    );
    expect(created.deviceEnrollmentPublicKey).toBe(publicKey);
    expect(created).not.toHaveProperty("privateKey");

    const missingIdentityDb = {
      ...db,
      device: {
        ...db.device,
        findUnique: async () => ({ ...device, enrollmentPublicKey: null }),
      },
      $transaction: async <T>(
        callback: (tx: ProvisioningDatabase) => Promise<T>,
      ) => callback(missingIdentityDb as unknown as ProvisioningDatabase),
    } as unknown as ProvisioningDatabase;
    await expect(
      createProvisioningSession(
        missingIdentityDb,
        "account-1",
        "store-1",
        { deviceId: device.id, idempotencyKey: "idempotency-2" },
        undefined,
        now,
      ),
    ).rejects.toMatchObject<Partial<ProvisioningError>>({ statusCode: 409 });
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
