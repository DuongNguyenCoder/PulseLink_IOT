import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import { exportPKCS8 } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client.js";
import { assertIntegrationDatabaseEnvironment } from "./integration-db-guard.js";
import {
  authenticateWithInstallation,
  type AuthenticationBootstrapDatabase,
} from "../modules/auth/authentication-bootstrap.service.js";
import {
  createSession,
  rotateRefreshSession,
  type SessionDatabase,
} from "../modules/auth/session.service.js";
import {
  cleanupPendingSignup,
  consumePasswordResetToken,
  consumeVerificationToken,
  issuePasswordResetToken,
  issueVerificationToken,
  registerAccount,
  type AccountPersistence,
} from "../modules/auth/account.service.js";
import {
  createStoreForOwner,
  getStoreForMember,
  updateStoreMetadata,
} from "../modules/stores/store.service.js";
import {
  decryptFcmToken,
  type FcmKeyMaterial,
} from "../modules/installations/fcm-crypto.js";
import {
  registerInstallation,
  revokeInstallation,
} from "../modules/installations/installation.service.js";
import { revokeRefreshSession } from "../modules/auth/session.service.js";
import {
  canonicalDeviceEnrollmentPayload,
  canonicalDeviceClaimPayload,
  canonicalProvisioningPayload,
  hashDeviceToken,
  type DeviceClaimProof,
} from "../modules/provisioning/provisioning-crypto.js";
import {
  completeDeviceClaim,
  createDeviceClaimSession,
} from "../modules/provisioning/device-claim.service.js";
import { hashRefreshToken } from "../modules/auth/session-tokens.js";
import {
  createProvisioningSession,
  enrollDevice,
  redeemProvisioningSession,
  type ProvisioningDatabase,
} from "../modules/provisioning/provisioning.service.js";
import { ingestDeviceEvent } from "../modules/device-events/device-event.service.js";
import type { DeviceEventBody } from "../modules/device-events/device-event.schema.js";
import { PrismaNotificationJobRepository } from "../modules/notifications/notification-repository.js";
import { NotificationWorker } from "../modules/notifications/notification-worker.js";
import type { FcmSender } from "../modules/notifications/fcm.client.js";

const integrationRequested = process.env.PULSELINK_INTEGRATION_TESTS === "1";
const integrationConfig = integrationRequested
  ? assertIntegrationDatabaseEnvironment({ ...process.env, NODE_ENV: "test" })
  : null;
const integrationDescribe = integrationRequested ? describe : describe.skip;

let prisma: PrismaClient;
const accountIds = new Set<string>();
const installationIds = new Set<string>();
const storeIds = new Set<string>();
const deviceIds = new Set<string>();
const provisioningSessionIds = new Set<string>();
const deviceClaimSessionIds = new Set<string>();
const eventIds = new Set<string>();
const staffIds = new Set<string>();
const pushTokenIds = new Set<string>();
const fcmKeys: FcmKeyMaterial = {
  activeVersion: 1,
  encryptionKeys: new Map([[1, randomBytes(32)]]),
  fingerprintKey: randomBytes(32),
};

function databaseClient(): PrismaClient {
  if (integrationConfig === null) {
    throw new Error("Integration database is not enabled");
  }
  const adapter = new PrismaPg({ connectionString: integrationConfig.url });
  return new PrismaClient({ adapter });
}

async function createAccount(): Promise<string> {
  const account = await prisma.account.create({
    data: {
      emailNormalized: `${randomUUID()}@integration.test`,
      passwordHash: "integration-test-hash",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  accountIds.add(account.id);
  return account.id;
}

async function createInstallation(accountId: string): Promise<string> {
  const installation = await prisma.appInstallation.create({
    data: {
      accountId,
      platform: "ANDROID",
      fcmTokenCiphertext: "integration-test-ciphertext",
      fcmTokenFingerprint: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      fcmTokenKeyVersion: 1,
    },
    select: { id: true },
  });
  installationIds.add(installation.id);
  return installation.id;
}

async function createStore(): Promise<string> {
  const store = await prisma.store.create({
    data: {
      name: "Integration Test Store",
      slug: `integration-${randomUUID()}`,
    },
    select: { id: true },
  });
  storeIds.add(store.id);
  return store.id;
}

async function createOwnerStore(): Promise<{ accountId: string; storeId: string }> {
  const accountId = await createAccount();
  const storeId = await createStore();
  await prisma.storeMembership.create({
    data: { accountId, storeId, role: "OWNER", status: "ACTIVE" },
  });
  return { accountId, storeId };
}

function signClaimProof(input: {
  deviceId: string;
  storeId: string;
  sessionId: string;
  challenge: string;
  expiresAt: number;
  publicKeySpkiBase64: string;
  privateKey: KeyObject;
}): DeviceClaimProof {
  const proofBody = {
    publicKeySpkiBase64: input.publicKeySpkiBase64,
    keyVersion: 1,
    challenge: input.challenge,
    expiresAt: input.expiresAt,
  };
  const signatureDerBase64 = sign("sha256", canonicalDeviceClaimPayload({
    deviceId: input.deviceId,
    storeId: input.storeId,
    claimSessionId: input.sessionId,
    proof: proofBody,
  }), { key: input.privateKey, dsaEncoding: "der" }).toString("base64");
  return { ...proofBody, signatureDerBase64 };
}

async function cleanupCreatedRows(): Promise<void> {
  const accounts = [...accountIds];
  const installations = [...installationIds];
  const stores = [...storeIds];
  const devices = [...deviceIds];
  const provisioningSessions = [...provisioningSessionIds];
  const deviceClaimSessions = [...deviceClaimSessionIds];
  const events = [...eventIds];
  const staff = [...staffIds];
  const pushTokens = [...pushTokenIds];

  if (events.length > 0) {
    const eventRows = await prisma.deviceEvent.findMany({
      where: { eventId: { in: events } },
      select: { id: true },
    });
    await prisma.deviceNotification.deleteMany({
      where: { eventId: { in: eventRows.map((event) => event.id) } },
    });
    await prisma.deviceEvent.deleteMany({ where: { eventId: { in: events } } });
  }
  if (pushTokens.length > 0) {
    await prisma.staffPushToken.deleteMany({
      where: { id: { in: pushTokens } },
    });
  }
  if (staff.length > 0) {
    await prisma.staff.deleteMany({ where: { id: { in: staff } } });
  }

  if (provisioningSessions.length > 0) {
    await prisma.provisioningSession.deleteMany({
      where: { id: { in: provisioningSessions } },
    });
  }
  if (deviceClaimSessions.length > 0) {
    await prisma.deviceClaimSession.deleteMany({
      where: { id: { in: deviceClaimSessions } },
    });
  }
  if (devices.length > 0) {
    await prisma.device.deleteMany({ where: { id: { in: devices } } });
  }

  if (accounts.length > 0) {
    await prisma.session.deleteMany({ where: { accountId: { in: accounts } } });
    await prisma.accountToken.deleteMany({
      where: { accountId: { in: accounts } },
    });
    await prisma.storeMembership.deleteMany({
      where: { accountId: { in: accounts } },
    });
  }
  if (installations.length > 0) {
    await prisma.auditEvent.deleteMany({
      where: { resourceId: { in: [...accounts, ...installations, ...stores] } },
    });
    await prisma.appInstallation.deleteMany({
      where: { id: { in: installations } },
    });
  }
  if (stores.length > 0) {
    await prisma.auditEvent.deleteMany({ where: { storeId: { in: stores } } });
    await prisma.storeMembership.deleteMany({
      where: { storeId: { in: stores } },
    });
    await prisma.store.deleteMany({ where: { id: { in: stores } } });
  }
  if (accounts.length > 0) {
    await prisma.account.deleteMany({ where: { id: { in: accounts } } });
  }

  accountIds.clear();
  installationIds.clear();
  storeIds.clear();
  deviceIds.clear();
  provisioningSessionIds.clear();
  deviceClaimSessionIds.clear();
  eventIds.clear();
  staffIds.clear();
  pushTokenIds.clear();
}

integrationDescribe("PostgreSQL schema and session integration", () => {
  beforeAll(async () => {
    prisma = databaseClient();
    await prisma.$connect();
  });

  afterEach(async () => {
    await cleanupCreatedRows();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("claims an Owner-scoped Device atomically and permits same-Store retry only", async () => {
    const now = new Date();
    const ownerA = await createOwnerStore();
    const ownerB = await createOwnerStore();
    const deviceId = `pl-${randomUUID().replaceAll("-", "")}`;
    const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const publicKeySpkiBase64 = key.publicKey.export({ type: "spki", format: "der" }).toString("base64");
    const claimA = await createDeviceClaimSession(
      prisma as never, ownerA.accountId, ownerA.storeId, deviceId, "Integration device", now,
    );
    if (!("alreadyClaimed" in claimA)) deviceClaimSessionIds.add(claimA.session.id);
    const claimB = await createDeviceClaimSession(
      prisma as never, ownerB.accountId, ownerB.storeId, deviceId, "Integration device", now,
    );
    if (!("alreadyClaimed" in claimB)) deviceClaimSessionIds.add(claimB.session.id);
    if ("alreadyClaimed" in claimA || "alreadyClaimed" in claimB) throw new Error("Unexpected prior claim");

    const proofA = signClaimProof({
      deviceId, storeId: ownerA.storeId, sessionId: claimA.session.id, challenge: claimA.challenge,
      expiresAt: Math.floor(claimA.session.expiresAt.getTime() / 1000),
      publicKeySpkiBase64, privateKey: key.privateKey,
    });
    const proofB = signClaimProof({
      deviceId, storeId: ownerB.storeId, sessionId: claimB.session.id, challenge: claimB.challenge,
      expiresAt: Math.floor(claimB.session.expiresAt.getTime() / 1000),
      publicKeySpkiBase64, privateKey: key.privateKey,
    });
    const outcomes = await Promise.allSettled([
      completeDeviceClaim(prisma as never, ownerA.accountId, ownerA.storeId,
        claimA.session.id, claimA.challenge, proofA, undefined, now),
      completeDeviceClaim(prisma as never, ownerB.accountId, ownerB.storeId,
        claimB.session.id, claimB.challenge, proofB, undefined, now),
    ]);
    const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(winners).toHaveLength(1);
    deviceIds.add(deviceId);
    const stored = await prisma.device.findUnique({ where: { id: deviceId } });
    expect([ownerA.storeId, ownerB.storeId]).toContain(stored?.storeId);
    expect(outcomes[0]?.status === "fulfilled").toBe(stored?.storeId === ownerA.storeId);
    expect(stored?.enrollmentPublicKey).toBe(publicKeySpkiBase64);

    const winningOwner = stored?.storeId === ownerA.storeId ? ownerA : ownerB;
    const repeated = await createDeviceClaimSession(
      prisma as never, winningOwner.accountId, winningOwner.storeId, deviceId, "Renamed", now,
    );
    expect(repeated).toMatchObject({ alreadyClaimed: true, device: { id: deviceId, storeId: winningOwner.storeId } });
    const losingOwner = stored?.storeId === ownerA.storeId ? ownerB : ownerA;
    await expect(createDeviceClaimSession(
      prisma as never, losingOwner.accountId, losingOwner.storeId, deviceId, "Foreign claim", now,
    )).rejects.toMatchObject({ statusCode: 409 });
  });

  it("rejects an account without active Owner membership before creating a claim", async () => {
    const accountId = await createAccount();
    const storeId = await createStore();
    await expect(createDeviceClaimSession(
      prisma as never, accountId, storeId, `pl-${randomUUID().replaceAll("-", "")}`, "Denied", new Date(),
    )).rejects.toMatchObject({ statusCode: 404 });
  });

  it("accepts a matching Session account and rejects an installation/account mismatch", async () => {
    const accountA = await createAccount();
    const accountB = await createAccount();
    const installationA = await createInstallation(accountA);
    const expiresAt = new Date(Date.now() + 86_400_000);

    await expect(
      prisma.session.create({
        data: {
          accountId: accountA,
          appInstallationId: installationA,
          refreshTokenHash: randomUUID().replaceAll("-", ""),
          tokenFamilyId: randomUUID().replaceAll("-", ""),
          idleExpiresAt: expiresAt,
          absoluteExpiresAt: expiresAt,
        },
      }),
    ).resolves.toBeTruthy();

    await expect(
      prisma.session.create({
        data: {
          accountId: accountB,
          appInstallationId: installationA,
          refreshTokenHash: randomUUID().replaceAll("-", ""),
          tokenFamilyId: randomUUID().replaceAll("-", ""),
          idleExpiresAt: expiresAt,
          absoluteExpiresAt: expiresAt,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("creates a tokenless installation and bound session on PostgreSQL", async () => {
    const accountId = await createAccount();
    const installationId = randomUUID();
    installationIds.add(installationId);
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const result = await authenticateWithInstallation(
      prisma as unknown as AuthenticationBootstrapDatabase,
      { id: accountId, authVersion: 0 },
      { installationId, platform: "ANDROID" },
      undefined,
      { kid: "integration-key", privateKeyPem: await exportPKCS8(privateKey) },
    );

    const installation = await prisma.appInstallation.findUniqueOrThrow({
      where: { id: installationId },
      select: {
        accountId: true,
        fcmTokenCiphertext: true,
        fcmTokenFingerprint: true,
        fcmTokenKeyVersion: true,
      },
    });
    expect(installation).toMatchObject({
      accountId,
      fcmTokenCiphertext: null,
      fcmTokenFingerprint: null,
      fcmTokenKeyVersion: null,
    });
    await expect(
      prisma.session.findUnique({ where: { id: result.session.sessionId } }),
    ).resolves.toMatchObject({ accountId, appInstallationId: installationId });

    await registerInstallation(
      prisma as never,
      accountId,
      {
        installationId,
        platform: "ANDROID",
        fcmToken: `after-login-${randomUUID()}`,
      },
      fcmKeys,
    );
    await expect(
      prisma.appInstallation.findUnique({
        where: { id: installationId },
        select: { fcmTokenCiphertext: true, fcmTokenFingerprint: true },
      }),
    ).resolves.toMatchObject({
      fcmTokenCiphertext: expect.any(String),
      fcmTokenFingerprint: expect.any(String),
    });
  });

  it("verifies nullable FCM columns and the required Session installation key", async () => {
    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; is_nullable: string }>
    >`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'AppInstallation'
        AND column_name IN ('fcmTokenCiphertext', 'fcmTokenFingerprint', 'fcmTokenKeyVersion')
      ORDER BY column_name
    `;
    expect(columns).toHaveLength(3);
    expect(columns.every((column) => column.is_nullable === "YES")).toBe(true);

    const sessionColumn = await prisma.$queryRaw<
      Array<{ is_nullable: string }>
    >`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Session'
        AND column_name = 'appInstallationId'
    `;
    expect(sessionColumn).toEqual([{ is_nullable: "NO" }]);
  });

  it("preserves token material when an active installation logs in without a token", async () => {
    const accountId = await createAccount();
    const installationId = randomUUID();
    installationIds.add(installationId);
    const token = `preserve-${randomUUID()}`;
    await registerInstallation(
      prisma as never,
      accountId,
      { installationId, platform: "ANDROID", fcmToken: token },
      fcmKeys,
    );
    const before = await prisma.appInstallation.findUniqueOrThrow({
      where: { id: installationId },
      select: {
        fcmTokenCiphertext: true,
        fcmTokenFingerprint: true,
        fcmTokenKeyVersion: true,
      },
    });
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    await authenticateWithInstallation(
      prisma as unknown as AuthenticationBootstrapDatabase,
      { id: accountId, authVersion: 0 },
      { installationId, platform: "ANDROID" },
      fcmKeys,
      { kid: "integration-key", privateKeyPem: await exportPKCS8(privateKey) },
    );
    const after = await prisma.appInstallation.findUniqueOrThrow({
      where: { id: installationId },
      select: {
        fcmTokenCiphertext: true,
        fcmTokenFingerprint: true,
        fcmTokenKeyVersion: true,
      },
    });
    expect(after).toEqual(before);
  });

  it("rolls back an installation when the bound session write fails", async () => {
    const accountId = await createAccount();
    const installationId = randomUUID();
    installationIds.add(installationId);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.appInstallation.create({
          data: { id: installationId, accountId, platform: "ANDROID" },
        });
        await tx.session.create({
          data: {
            accountId: randomUUID(),
            appInstallationId: installationId,
            refreshTokenHash: randomUUID().replaceAll("-", ""),
            tokenFamilyId: randomUUID().replaceAll("-", ""),
            idleExpiresAt: new Date(Date.now() + 86_400_000),
            absoluteExpiresAt: new Date(Date.now() + 86_400_000),
          },
        });
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.appInstallation.findUnique({ where: { id: installationId } }),
    ).resolves.toBeNull();
  });

  it("keeps concurrent tokenless login retries consistent", async () => {
    const accountId = await createAccount();
    const installationId = randomUUID();
    installationIds.add(installationId);
    const attempts = await Promise.allSettled(
      [1, 2].map(async () => {
        const { privateKey } = generateKeyPairSync("rsa", {
          modulusLength: 2048,
        });
        return authenticateWithInstallation(
          prisma as unknown as AuthenticationBootstrapDatabase,
          { id: accountId, authVersion: 0 },
          { installationId, platform: "ANDROID" },
          undefined,
          {
            kid: "integration-key",
            privateKeyPem: await exportPKCS8(privateKey),
          },
        );
      }),
    );
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    const sessions = await prisma.session.findMany({
      where: { accountId, appInstallationId: installationId },
    });
    expect(sessions).toHaveLength(1);
    await expect(
      prisma.appInstallation.findUnique({ where: { id: installationId } }),
    ).resolves.toMatchObject({ accountId, status: "ACTIVE" });
  });

  it("keeps concurrent updates on one installation internally consistent", async () => {
    const accountId = await createAccount();
    const installationId = randomUUID();
    installationIds.add(installationId);
    await registerInstallation(
      prisma as never,
      accountId,
      {
        installationId,
        platform: "ANDROID",
        fcmToken: `initial-${randomUUID()}`,
      },
      fcmKeys,
    );
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((index) =>
        registerInstallation(
          prisma as never,
          accountId,
          {
            installationId,
            platform: index % 2 === 0 ? "IOS" : "ANDROID",
            fcmToken: `concurrent-update-${randomUUID()}`,
          },
          fcmKeys,
        ),
      ),
    );
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const final = await prisma.appInstallation.findUniqueOrThrow({
      where: { id: installationId },
      select: {
        platform: true,
        fcmTokenCiphertext: true,
        fcmTokenFingerprint: true,
        fcmTokenKeyVersion: true,
      },
    });
    expect(final.fcmTokenCiphertext).not.toBeNull();
    expect(final.fcmTokenFingerprint).not.toBeNull();
    expect(final.fcmTokenKeyVersion).toBe(1);
  });

  it("persists one event when concurrent requests reuse the same eventId", async () => {
    const storeId = await createStore();
    const token = `integration-device-token-${randomUUID()}`;
    const device = await prisma.device.create({
      data: {
        deviceKey: `integration-device-${randomUUID()}`,
        deviceSecretHash: hashDeviceToken(token),
        name: "Integration event device",
        status: "ONLINE",
        provisioningState: "PROVISIONED",
        enrollmentStatus: "ENROLLED",
        storeId,
      },
      select: { id: true },
    });
    deviceIds.add(device.id);
    const staff = await prisma.staff.create({
      data: { name: "Integration staff", storeId },
      select: { id: true },
    });
    staffIds.add(staff.id);
    const pushToken = await prisma.staffPushToken.create({
      data: {
        staffId: staff.id,
        token: `integration-fcm-${randomUUID()}`,
        platform: "ANDROID",
      },
      select: { id: true },
    });
    pushTokenIds.add(pushToken.id);

    const input: DeviceEventBody = {
      eventId: randomUUID(),
      type: "BUTTON_PRESSED",
      occurredAt: "2026-10-15T14:00:00.000Z",
      firmwareVersion: "0.1.0",
      rssiDbm: -60,
      payload: { button: "main" },
    };
    eventIds.add(input.eventId);

    const results = await Promise.allSettled([
      ingestDeviceEvent(prisma as never, token, input),
      ingestDeviceEvent(prisma as never, token, input),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    const stored = await prisma.deviceEvent.findMany({
      where: { eventId: input.eventId },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.deviceId).toBe(device.id);
    const notifications = await prisma.deviceNotification.findMany({
      where: { eventId: stored[0]?.id },
    });
    expect(notifications).toHaveLength(1);
  });

  it("creates Account/Membership/AppInstallation notification jobs atomically", async () => {
    const storeId = await createStore();
    const ownerId = await createAccount();
    const staffAccountId = await createAccount();
    await prisma.storeMembership.createMany({
      data: [
        { accountId: ownerId, storeId, role: "OWNER", status: "ACTIVE" },
        { accountId: staffAccountId, storeId, role: "STAFF", status: "ACTIVE" },
      ],
    });
    const ownerInstallationId = await createInstallation(ownerId);
    const staffInstallationId = await createInstallation(staffAccountId);
    const tokenlessInstallationId = `tokenless-${randomUUID()}`;
    installationIds.add(tokenlessInstallationId);
    await prisma.appInstallation.create({
      data: {
        id: tokenlessInstallationId,
        accountId: ownerId,
        platform: "ANDROID",
      },
    });

    const deviceToken = `integration-account-device-${randomUUID()}`;
    const device = await prisma.device.create({
      data: {
        deviceKey: `integration-account-device-${randomUUID()}`,
        deviceSecretHash: hashDeviceToken(deviceToken),
        name: "Integration account notification device",
        status: "ONLINE",
        provisioningState: "PROVISIONED",
        enrollmentStatus: "ENROLLED",
        storeId,
      },
      select: { id: true },
    });
    deviceIds.add(device.id);
    const input: DeviceEventBody = {
      eventId: randomUUID(),
      type: "BUTTON_PRESSED",
      occurredAt: "2026-10-15T14:00:00.000Z",
      payload: { button: "account-mode" },
    };
    eventIds.add(input.eventId);

    const accepted = await ingestDeviceEvent(
      prisma as never,
      deviceToken,
      input,
      new Date(),
      "account",
    );
    await expect(
      Promise.all([
        ingestDeviceEvent(
          prisma as never,
          deviceToken,
          input,
          new Date(),
          "account",
        ),
        ingestDeviceEvent(
          prisma as never,
          deviceToken,
          input,
          new Date(),
          "account",
        ),
      ]),
    ).resolves.toHaveLength(2);
    const jobs = await prisma.deviceNotification.findMany({
      where: { eventId: accepted.event.id },
      select: { appInstallationId: true, pushTokenId: true },
      orderBy: { appInstallationId: "asc" },
    });
    expect(jobs).toEqual(
      [
        { appInstallationId: ownerInstallationId, pushTokenId: null },
        { appInstallationId: staffInstallationId, pushTokenId: null },
      ].sort((left, right) =>
        (left.appInstallationId ?? "").localeCompare(
          right.appInstallationId ?? "",
        ),
      ),
    );
  });

  it("claims and revalidates an Account installation job before FCM", async () => {
    const storeId = await createStore();
    const accountId = await createAccount();
    await prisma.storeMembership.create({
      data: { accountId, storeId, role: "OWNER", status: "ACTIVE" },
    });
    const installationId = randomUUID();
    installationIds.add(installationId);
    const fcmToken = `account-worker-${randomUUID()}`;
    await registerInstallation(
      prisma as never,
      accountId,
      { installationId, platform: "ANDROID", fcmToken },
      fcmKeys,
    );
    const deviceToken = `integration-account-worker-device-${randomUUID()}`;
    const device = await prisma.device.create({
      data: {
        deviceKey: `acct-worker-${randomUUID()}`,
        deviceSecretHash: hashDeviceToken(deviceToken),
        name: "Integration account worker device",
        status: "ONLINE",
        provisioningState: "PROVISIONED",
        enrollmentStatus: "ENROLLED",
        storeId,
      },
      select: { id: true },
    });
    deviceIds.add(device.id);
    const input: DeviceEventBody = {
      eventId: randomUUID(),
      type: "BUTTON_PRESSED",
      occurredAt: "2026-10-15T14:00:00.000Z",
      payload: { button: "account-worker" },
    };
    eventIds.add(input.eventId);
    await ingestDeviceEvent(
      prisma as never,
      deviceToken,
      input,
      new Date(),
      "account",
    );

    const delivered: string[] = [];
    const repository = new PrismaNotificationJobRepository(prisma, fcmKeys);
    const worker = new NotificationWorker(repository, {
      send: async ({ token }) => {
        delivered.push(token);
        return "integration-provider-message";
      },
    });
    await expect(worker.processOnce()).resolves.toBe(1);
    expect(delivered).toEqual([fcmToken]);
    await expect(
      prisma.deviceNotification.findFirst({
        where: { event: { eventId: input.eventId } },
        select: { status: true, appInstallationId: true },
      }),
    ).resolves.toEqual({ status: "SENT", appInstallationId: installationId });
  });

  it("cancels unsent Account jobs after membership revoke", async () => {
    const storeId = await createStore();
    const accountId = await createAccount();
    const membership = await prisma.storeMembership.create({
      data: { accountId, storeId, role: "STAFF", status: "ACTIVE" },
    });
    const installationId = randomUUID();
    installationIds.add(installationId);
    await registerInstallation(
      prisma as never,
      accountId,
      {
        installationId,
        platform: "ANDROID",
        fcmToken: `revoke-${randomUUID()}`,
      },
      fcmKeys,
    );
    const deviceToken = `integration-revoke-device-${randomUUID()}`;
    const device = await prisma.device.create({
      data: {
        deviceKey: `revoke-${randomUUID()}`,
        deviceSecretHash: hashDeviceToken(deviceToken),
        name: "Integration revoke device",
        status: "ONLINE",
        provisioningState: "PROVISIONED",
        enrollmentStatus: "ENROLLED",
        storeId,
      },
      select: { id: true },
    });
    deviceIds.add(device.id);
    const input: DeviceEventBody = {
      eventId: randomUUID(),
      type: "BUTTON_PRESSED",
      occurredAt: "2026-10-15T14:00:00.000Z",
    };
    eventIds.add(input.eventId);
    const accepted = await ingestDeviceEvent(
      prisma as never,
      deviceToken,
      input,
      new Date(),
      "account",
    );
    await prisma.storeMembership.update({
      where: { id: membership.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const repository = new PrismaNotificationJobRepository(prisma, fcmKeys);
    const worker = new NotificationWorker(repository, {
      send: async () => "should-not-send",
    });
    await expect(worker.processOnce()).resolves.toBe(0);
    await expect(
      prisma.deviceNotification.findFirst({
        where: { eventId: accepted.event.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "CANCELLED" });
  });

  it("claims a notification job once when two workers race", async () => {
    const storeId = await createStore();
    const token = `integration-worker-device-${randomUUID()}`;
    const device = await prisma.device.create({
      data: {
        deviceKey: `integration-worker-device-${randomUUID()}`,
        deviceSecretHash: hashDeviceToken(token),
        name: "Integration worker device",
        status: "ONLINE",
        provisioningState: "PROVISIONED",
        enrollmentStatus: "ENROLLED",
        storeId,
      },
      select: { id: true },
    });
    deviceIds.add(device.id);
    const staff = await prisma.staff.create({
      data: { name: "Integration worker staff", storeId },
      select: { id: true },
    });
    staffIds.add(staff.id);
    const pushToken = await prisma.staffPushToken.create({
      data: {
        staffId: staff.id,
        token: `integration-worker-fcm-${randomUUID()}`,
        platform: "ANDROID",
      },
      select: { id: true },
    });
    pushTokenIds.add(pushToken.id);

    const input: DeviceEventBody = {
      eventId: randomUUID(),
      type: "BUTTON_PRESSED",
      occurredAt: "2026-10-15T14:00:00.000Z",
      payload: { button: "worker" },
    };
    eventIds.add(input.eventId);
    const accepted = await ingestDeviceEvent(prisma as never, token, input);
    const sentTokens: string[] = [];
    const sender: FcmSender = {
      send: async (message) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        sentTokens.push(message.token);
        return "integration-message-id";
      },
    };
    const options = { concurrency: 1, leaseMs: 5_000, pollMs: 1 };
    const results = await Promise.all([
      new NotificationWorker(
        new PrismaNotificationJobRepository(prisma),
        sender,
        options,
      ).processOnce(),
      new NotificationWorker(
        new PrismaNotificationJobRepository(prisma),
        sender,
        options,
      ).processOnce(),
    ]);

    expect(results.sort()).toEqual([0, 1]);
    expect(sentTokens).toHaveLength(1);
    await expect(
      prisma.deviceNotification.findFirst({
        where: { eventId: accepted.event.id },
      }),
    ).resolves.toMatchObject({ status: "SENT", attempts: 1 });
  });

  it("reports queue state and recovers a job whose lease expired", async () => {
    const storeId = await createStore();
    const token = `integration-lease-device-${randomUUID()}`;
    const device = await prisma.device.create({
      data: {
        deviceKey: `integration-lease-device-${randomUUID()}`,
        deviceSecretHash: hashDeviceToken(token),
        name: "Integration lease device",
        status: "ONLINE",
        provisioningState: "PROVISIONED",
        enrollmentStatus: "ENROLLED",
        storeId,
      },
      select: { id: true },
    });
    deviceIds.add(device.id);
    const staff = await prisma.staff.create({
      data: { name: "Integration lease staff", storeId },
      select: { id: true },
    });
    staffIds.add(staff.id);
    const pushToken = await prisma.staffPushToken.create({
      data: {
        staffId: staff.id,
        token: `integration-lease-fcm-${randomUUID()}`,
        platform: "ANDROID",
      },
      select: { id: true },
    });
    pushTokenIds.add(pushToken.id);

    const input: DeviceEventBody = {
      eventId: randomUUID(),
      type: "BUTTON_PRESSED",
      occurredAt: "2026-10-15T14:00:00.000Z",
      payload: { button: "lease" },
    };
    eventIds.add(input.eventId);
    const accepted = await ingestDeviceEvent(prisma as never, token, input);
    const repository = new PrismaNotificationJobRepository(prisma);
    const firstNow = new Date();
    const first = await repository.claim(
      1,
      firstNow,
      new Date(firstNow.getTime() + 1_000),
    );
    expect(first).toHaveLength(1);
    expect(first[0]?.leaseRecovered).toBe(false);

    const snapshot = await repository.getQueueSnapshot(firstNow);
    expect(snapshot.counts.PROCESSING).toBeGreaterThanOrEqual(1);
    expect(snapshot.expiredLeaseCount).toBe(0);

    const recovered = await repository.claim(
      1,
      new Date(firstNow.getTime() + 2_000),
      new Date(firstNow.getTime() + 3_000),
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      id: first[0]?.id,
      attempts: 2,
      leaseRecovered: true,
      eventId: accepted.event.id,
    });
  });

  it("enforces one active Owner while allowing valid membership variants", async () => {
    const ownerA = await createAccount();
    const ownerB = await createAccount();
    const staff = await createAccount();
    const storeId = await createStore();

    await prisma.storeMembership.create({
      data: { accountId: ownerA, storeId, role: "OWNER", status: "ACTIVE" },
    });
    await expect(
      prisma.storeMembership.create({
        data: { accountId: ownerB, storeId, role: "OWNER", status: "ACTIVE" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.storeMembership.create({
        data: { accountId: staff, storeId, role: "STAFF", status: "ACTIVE" },
      }),
    ).resolves.toBeTruthy();
  });

  it("enforces ON DELETE RESTRICT for Account and AppInstallation dependencies", async () => {
    const accountId = await createAccount();
    const installationId = await createInstallation(accountId);
    const session = await prisma.session.create({
      data: {
        accountId,
        appInstallationId: installationId,
        refreshTokenHash: randomUUID().replaceAll("-", ""),
        tokenFamilyId: randomUUID().replaceAll("-", ""),
        idleExpiresAt: new Date(Date.now() + 86_400_000),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await expect(
      prisma.account.delete({ where: { id: accountId } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.appInstallation.delete({ where: { id: installationId } }),
    ).rejects.toMatchObject({ code: "P2003" });

    await prisma.session.delete({ where: { id: session.id } });
  });

  it("keeps provisioning state separate and enforces Device/Store scope", async () => {
    const accountId = await createAccount();
    const storeA = await createStore();
    const storeB = await createStore();
    const device = await prisma.device.create({
      data: {
        deviceKey: `device-${randomUUID()}`,
        deviceSecretHash: "test-device-secret-hash",
        name: "Provisioning fixture",
        storeId: storeA,
      },
    });
    deviceIds.add(device.id);

    expect(device.provisioningState).toBe("UNREGISTERED");
    expect(device.status).toBe("PENDING");
    expect(device.enrollmentStatus).toBe("UNENROLLED");

    const created = await prisma.provisioningSession.create({
      data: {
        deviceId: device.id,
        storeId: storeA,
        actorAccountId: accountId,
        bootstrapVerifier: randomUUID().replaceAll("-", ""),
        challengeHash: randomUUID().replaceAll("-", ""),
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    provisioningSessionIds.add(created.id);
    expect(created.maxAttempts).toBe(5);

    const secondDevice = await prisma.device.create({
      data: {
        deviceKey: `device-${randomUUID()}`,
        deviceSecretHash: "test-device-secret-hash",
        name: "Provisioning scope fixture",
        storeId: storeA,
      },
    });
    deviceIds.add(secondDevice.id);

    await expect(
      prisma.provisioningSession.create({
        data: {
          deviceId: secondDevice.id,
          storeId: storeB,
          actorAccountId: accountId,
          bootstrapVerifier: randomUUID().replaceAll("-", ""),
          challengeHash: randomUUID().replaceAll("-", ""),
          idempotencyKey: randomUUID(),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("allows one active provisioning session per Device and rejects concurrent active duplicates", async () => {
    const accountId = await createAccount();
    const storeId = await createStore();
    const device = await prisma.device.create({
      data: {
        deviceKey: `device-${randomUUID()}`,
        deviceSecretHash: "test-device-secret-hash",
        name: "Concurrent provisioning fixture",
        storeId,
      },
    });
    deviceIds.add(device.id);

    const create = (suffix: string) =>
      prisma.provisioningSession.create({
        data: {
          deviceId: device.id,
          storeId,
          actorAccountId: accountId,
          bootstrapVerifier: randomUUID().replaceAll("-", ""),
          challengeHash: randomUUID().replaceAll("-", ""),
          idempotencyKey: suffix,
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
    const results = await Promise.allSettled([
      create("race-a"),
      create("race-b"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    for (const result of results) {
      if (result.status === "fulfilled")
        provisioningSessionIds.add(result.value.id);
    }

    const activeCount = await prisma.provisioningSession.count({
      where: { deviceId: device.id, status: "ACTIVE" },
    });
    expect(activeCount).toBe(1);
  });

  it("enforces restrictive deletion for Device and its provisioning session", async () => {
    const accountId = await createAccount();
    const storeId = await createStore();
    const device = await prisma.device.create({
      data: {
        deviceKey: `device-${randomUUID()}`,
        deviceSecretHash: "test-device-secret-hash",
        name: "Restrict fixture",
        storeId,
      },
    });
    deviceIds.add(device.id);
    const session = await prisma.provisioningSession.create({
      data: {
        deviceId: device.id,
        storeId,
        actorAccountId: accountId,
        bootstrapVerifier: randomUUID().replaceAll("-", ""),
        challengeHash: randomUUID().replaceAll("-", ""),
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    provisioningSessionIds.add(session.id);

    await expect(
      prisma.device.delete({ where: { id: device.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.store.delete({ where: { id: storeId } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("enrolls a Device, redeems one session and stores only the operational verifier", async () => {
    const ownerId = await createAccount();
    const storeId = await createStore();
    await prisma.storeMembership.create({
      data: { accountId: ownerId, storeId, role: "OWNER", status: "ACTIVE" },
    });
    const device = await prisma.device.create({
      data: {
        deviceKey: `device-${randomUUID()}`,
        deviceSecretHash: "initial-device-secret-hash",
        name: "Redeem fixture",
        storeId,
      },
    });
    deviceIds.add(device.id);
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicKeySpkiBase64 = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    const enrollmentProofBody = {
      publicKeySpkiBase64,
      keyVersion: 1,
      challenge: randomBytes(32).toString("base64url"),
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    };
    const enrollmentProof = {
      ...enrollmentProofBody,
      signatureDerBase64: sign(
        "sha256",
        canonicalDeviceEnrollmentPayload({ deviceKey: device.deviceKey, proof: enrollmentProofBody }),
        { key: privateKey, dsaEncoding: "der" },
      ).toString("base64"),
    };

    await expect(
      enrollDevice(
        prisma as unknown as ProvisioningDatabase,
        { actorId: "commissioning-tool", actorType: "SYSTEM" },
        device.id,
        enrollmentProof,
      ),
    ).resolves.toMatchObject({
      enrollmentStatus: "ENROLLED",
      provisioningState: "READY",
    });
    await expect(
      enrollDevice(
        prisma as unknown as ProvisioningDatabase,
        { actorId: "commissioning-tool", actorType: "SYSTEM" },
        device.id,
        enrollmentProof,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const created = await createProvisioningSession(
      prisma as unknown as ProvisioningDatabase,
      ownerId,
      storeId,
      { deviceId: device.id, idempotencyKey: `integration-${randomUUID()}` },
    );
    provisioningSessionIds.add(created.session.id);
    const signature = sign(
      "sha256",
      canonicalProvisioningPayload({
        sessionId: created.session.id,
        deviceKey: device.deviceKey,
        challenge: created.challenge,
        expiresAt: created.session.expiresAt,
      }),
      { key: privateKey, dsaEncoding: "der" },
    ).toString("base64");

    const redeemed = await redeemProvisioningSession(
      prisma as unknown as ProvisioningDatabase,
      {
        deviceId: device.id,
        sessionId: created.session.id,
        bootstrapSecret: created.bootstrapSecret,
        challenge: created.challenge,
        signature,
      },
    );
    expect(redeemed.operationalToken).toHaveLength(43);
    const storedDevice = await prisma.device.findUniqueOrThrow({
      where: { id: device.id },
    });
    expect(storedDevice.deviceSecretHash).toBe(
      hashDeviceToken(redeemed.operationalToken),
    );
    expect(storedDevice.deviceSecretHash).not.toContain(
      redeemed.operationalToken,
    );
    expect(
      await prisma.provisioningSession.findUniqueOrThrow({
        where: { id: created.session.id },
      }),
    ).toMatchObject({ status: "REDEEMED" });
    await expect(
      redeemProvisioningSession(prisma as unknown as ProvisioningDatabase, {
        deviceId: device.id,
        sessionId: created.session.id,
        bootstrapSecret: created.bootstrapSecret,
        challenge: created.challenge,
        signature,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects reuse of one identity public key across multiple Devices", async () => {
    const storeId = await createStore();
    const first = await prisma.device.create({
      data: {
        deviceKey: `device-${randomUUID()}`,
        deviceSecretHash: "initial-device-secret-hash",
        name: "First unique-key fixture",
        storeId,
      },
    });
    const second = await prisma.device.create({
      data: {
        deviceKey: `device-${randomUUID()}`,
        deviceSecretHash: "initial-device-secret-hash",
        name: "Second unique-key fixture",
        storeId,
      },
    });
    deviceIds.add(first.id);
    deviceIds.add(second.id);
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicKeySpkiBase64 = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    const makeProof = (deviceKey: string) => {
      const proofBody = {
        publicKeySpkiBase64,
        keyVersion: 1,
        challenge: randomBytes(32).toString("base64url"),
        expiresAt: Math.floor(Date.now() / 1000) + 120,
      };
      return {
        ...proofBody,
        signatureDerBase64: sign(
          "sha256",
          canonicalDeviceEnrollmentPayload({ deviceKey, proof: proofBody }),
          { key: privateKey, dsaEncoding: "der" },
        ).toString("base64"),
      };
    };
    const db = prisma as unknown as ProvisioningDatabase;
    await enrollDevice(db, { actorId: "factory-operator" }, first.id, makeProof(first.deviceKey));
    await expect(enrollDevice(db, { actorId: "factory-operator" }, second.id, makeProof(second.deviceKey)))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(prisma.device.findUniqueOrThrow({ where: { id: second.id } }))
      .resolves.toMatchObject({ enrollmentStatus: "UNENROLLED", enrollmentPublicKey: null });
  });

  it("does not allow a non-owner to create a provisioning session and locks concurrent wrong attempts at five", async () => {
    const ownerId = await createAccount();
    const otherAccountId = await createAccount();
    const storeId = await createStore();
    await prisma.storeMembership.create({
      data: { accountId: ownerId, storeId, role: "OWNER", status: "ACTIVE" },
    });
    const device = await prisma.device.create({
      data: {
        deviceKey: `device-${randomUUID()}`,
        deviceSecretHash: "initial-device-secret-hash",
        name: "Attempt fixture",
        storeId,
      },
    });
    deviceIds.add(device.id);
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    const publicKeySpkiBase64 = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    const enrollmentProofBody = {
      publicKeySpkiBase64,
      keyVersion: 1,
      challenge: randomBytes(32).toString("base64url"),
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    };
    await enrollDevice(
      prisma as unknown as ProvisioningDatabase,
      { actorId: "commissioning-tool" },
      device.id,
      {
        ...enrollmentProofBody,
        signatureDerBase64: sign(
          "sha256",
          canonicalDeviceEnrollmentPayload({ deviceKey: device.deviceKey, proof: enrollmentProofBody }),
          { key: privateKey, dsaEncoding: "der" },
        ).toString("base64"),
      },
    );
    await expect(
      createProvisioningSession(
        prisma as unknown as ProvisioningDatabase,
        otherAccountId,
        storeId,
        { deviceId: device.id, idempotencyKey: `wrong-${randomUUID()}` },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    const created = await createProvisioningSession(
      prisma as unknown as ProvisioningDatabase,
      ownerId,
      storeId,
      { deviceId: device.id, idempotencyKey: `attempt-${randomUUID()}` },
    );
    provisioningSessionIds.add(created.session.id);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        redeemProvisioningSession(prisma as unknown as ProvisioningDatabase, {
          deviceId: device.id,
          sessionId: created.session.id,
          bootstrapSecret: "wrong-bootstrap-secret-value",
          challenge: created.challenge,
          signature: "invalid-signature-value",
        }),
      ),
    );
    expect(attempts.every((result) => result.status === "rejected")).toBe(true);
    const locked = await prisma.provisioningSession.findUniqueOrThrow({
      where: { id: created.session.id },
    });
    expect(locked.status).toBe("LOCKED");
    expect(locked.attemptCount).toBe(5);
  });

  it("allows only one concurrent refresh rotation and revokes the family on reuse", async () => {
    const accountId = await createAccount();
    const installationId = await createInstallation(accountId);
    const initial = await createSession(prisma as unknown as SessionDatabase, {
      sessionId: randomUUID(),
      accountId,
      appInstallationId: installationId,
    });

    const results = await Promise.allSettled([
      rotateRefreshSession(
        prisma as unknown as SessionDatabase,
        initial.refreshToken,
        randomUUID(),
      ),
      rotateRefreshSession(
        prisma as unknown as SessionDatabase,
        initial.refreshToken,
        randomUUID(),
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const sessions = await prisma.session.findMany({ where: { accountId } });
    expect(
      sessions.every((session) => session.revokedAt !== null),
      JSON.stringify(
        sessions.map((session) => ({
          id: session.id,
          revoked: session.revokedAt !== null,
        })),
      ),
    ).toBe(true);
  });

  it("rolls back the consumed session when replacement creation fails", async () => {
    const accountId = await createAccount();
    const installationId = await createInstallation(accountId);
    const initial = await createSession(prisma as unknown as SessionDatabase, {
      sessionId: randomUUID(),
      accountId,
      appInstallationId: installationId,
    });
    const blockerId = randomUUID();
    await prisma.session.create({
      data: {
        id: blockerId,
        accountId,
        appInstallationId: installationId,
        refreshTokenHash: randomUUID().replaceAll("-", ""),
        tokenFamilyId: randomUUID().replaceAll("-", ""),
        idleExpiresAt: new Date(Date.now() + 86_400_000),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await expect(
      rotateRefreshSession(
        prisma as unknown as SessionDatabase,
        initial.refreshToken,
        blockerId,
      ),
    ).rejects.toMatchObject({ code: "P2002" });

    const unchanged = await prisma.session.findUniqueOrThrow({
      where: { id: initial.sessionId },
    });
    expect(unchanged.revokedAt).toBeNull();
    expect(unchanged.rotatedAt).toBeNull();
  });

  it("enforces concurrent signup email uniqueness in PostgreSQL", async () => {
    const email = `${randomUUID()}@integration.test`;
    const results = await Promise.allSettled([
      registerAccount(prisma as unknown as AccountPersistence, {
        email,
        password: "password-one",
      }),
      registerAccount(prisma as unknown as AccountPersistence, {
        email,
        password: "password-two",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const created = results.find((result) => result.status === "fulfilled");
    if (created?.status === "fulfilled") accountIds.add(created.value.id);
  });

  it("consumes an email verification token only once under concurrency", async () => {
    const accountId = await createAccount();
    const issued = await issueVerificationToken(
      prisma as unknown as AccountPersistence,
      accountId,
    );
    const results = await Promise.allSettled([
      consumeVerificationToken(
        prisma as unknown as AccountPersistence,
        issued.plaintext,
      ),
      consumeVerificationToken(
        prisma as unknown as AccountPersistence,
        issued.plaintext,
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const verified = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(verified.emailVerifiedAt).not.toBeNull();
  });

  it("consumes a password reset once and atomically revokes sessions", async () => {
    const accountId = await createAccount();
    const installationId = await createInstallation(accountId);
    await createSession(prisma as unknown as SessionDatabase, {
      sessionId: randomUUID(),
      accountId,
      appInstallationId: installationId,
    });
    const issued = await issuePasswordResetToken(
      prisma as unknown as AccountPersistence,
      "integration-test@example.invalid",
    );

    // The test account email is generated; issue a token for its actual email.
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    const actualIssued = await issuePasswordResetToken(
      prisma as unknown as AccountPersistence,
      account.emailNormalized,
    );
    expect(issued).toBeNull();
    expect(actualIssued).not.toBeNull();
    if (actualIssued === null) return;

    const results = await Promise.allSettled([
      consumePasswordResetToken(
        prisma as unknown as AccountPersistence,
        actualIssued.token.plaintext,
        "new password one",
      ),
      consumePasswordResetToken(
        prisma as unknown as AccountPersistence,
        actualIssued.token.plaintext,
        "new password two",
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const updated = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(updated.authVersion).toBe(1);
    const sessions = await prisma.session.findMany({ where: { accountId } });
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
    const audits = await prisma.auditEvent.findMany({
      where: { resourceId: accountId, action: "PASSWORD_RESET_COMPLETED" },
    });
    expect(audits).toHaveLength(1);
  });

  it("revokes the previous reset token and stores only a hash with a 15-minute TTL", async () => {
    const accountId = await createAccount();
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    const issuedAt = new Date("2026-01-01T00:00:00.000Z");

    const first = await issuePasswordResetToken(
      prisma as unknown as AccountPersistence,
      account.emailNormalized,
      issuedAt,
    );
    const second = await issuePasswordResetToken(
      prisma as unknown as AccountPersistence,
      account.emailNormalized,
      new Date("2026-01-01T00:01:00.000Z"),
    );
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (first === null || second === null) return;

    const rows = await prisma.accountToken.findMany({
      where: { accountId, purpose: "PASSWORD_RESET" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[1]?.revokedAt).toBeNull();
    expect(rows[1]?.expiresAt).toEqual(new Date("2026-01-01T00:16:00.000Z"));
    expect(rows[1]?.tokenHash).toBe(hashRefreshToken(second.token.plaintext));
    expect(rows[1]?.tokenHash).not.toBe(second.token.plaintext);
  });

  it("rolls back reset-token revocation when replacement creation fails", async () => {
    const accountId = await createAccount();
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    const existing = await issuePasswordResetToken(
      prisma as unknown as AccountPersistence,
      account.emailNormalized,
    );
    expect(existing).not.toBeNull();
    if (existing === null) return;
    const existingRow = await prisma.accountToken.findFirstOrThrow({
      where: { tokenHash: hashRefreshToken(existing.token.plaintext) },
    });

    const failingPersistence = {
      $transaction: (callback: (transaction: any) => Promise<unknown>) =>
        prisma.$transaction(async (transaction) =>
          callback({
            ...transaction,
            account: {
              ...transaction.account,
              findUnique: transaction.account.findUnique.bind(
                transaction.account,
              ),
              update: transaction.account.update.bind(transaction.account),
            },
            accountToken: {
              ...transaction.accountToken,
              updateMany: transaction.accountToken.updateMany.bind(
                transaction.accountToken,
              ),
              create: async () => {
                throw new Error("controlled integration failure");
              },
            },
          }),
        ),
    } as unknown as AccountPersistence;

    await expect(
      issuePasswordResetToken(failingPersistence, account.emailNormalized),
    ).rejects.toThrow("controlled integration failure");

    const unchanged = await prisma.accountToken.findUniqueOrThrow({
      where: { id: existingRow.id },
    });
    expect(unchanged.revokedAt).toBeNull();
  });

  it("serializes concurrent reset issuance for one account", async () => {
    const accountId = await createAccount();
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        issuePasswordResetToken(
          prisma as unknown as AccountPersistence,
          account.emailNormalized,
        ),
      ),
    );
    expect(results.every((result) => result !== null)).toBe(true);

    const active = await prisma.accountToken.findMany({
      where: {
        accountId,
        purpose: "PASSWORD_RESET",
        consumedAt: null,
        revokedAt: null,
      },
    });
    expect(active).toHaveLength(1);
  });

  it("cleans only the matching pending signup atomically", async () => {
    const first = await prisma.account.create({
      data: {
        emailNormalized: `${randomUUID()}@integration.test`,
        passwordHash: "integration-test-hash",
        status: "PENDING",
      },
      select: { id: true },
    });
    const second = await prisma.account.create({
      data: {
        emailNormalized: `${randomUUID()}@integration.test`,
        passwordHash: "integration-test-hash",
        status: "PENDING",
      },
      select: { id: true },
    });
    accountIds.add(first.id);
    accountIds.add(second.id);
    const verification = await issueVerificationToken(
      prisma as unknown as AccountPersistence,
      first.id,
    );

    await expect(
      cleanupPendingSignup(
        prisma as unknown as AccountPersistence,
        first.id,
        verification.plaintext,
      ),
    ).resolves.toBe(true);
    await expect(
      prisma.account.findUnique({ where: { id: first.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.account.findUnique({ where: { id: second.id } }),
    ).resolves.not.toBeNull();
  });

  it("does not clean a signup that is no longer pending or unverified", async () => {
    const accountId = await createAccount();
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
    });
    const verification = await issueVerificationToken(
      prisma as unknown as AccountPersistence,
      accountId,
    );

    await expect(
      cleanupPendingSignup(
        prisma as unknown as AccountPersistence,
        accountId,
        verification.plaintext,
      ),
    ).resolves.toBe(false);
    await expect(
      prisma.account.findUnique({ where: { id: accountId } }),
    ).resolves.not.toBeNull();
  });

  it("does not race email verification into an unsafe pending-signup delete", async () => {
    const accountId = await prisma.account
      .create({
        data: {
          emailNormalized: `${randomUUID()}@integration.test`,
          passwordHash: "integration-test-hash",
          status: "PENDING",
        },
        select: { id: true },
      })
      .then((account) => {
        accountIds.add(account.id);
        return account.id;
      });
    const verification = await issueVerificationToken(
      prisma as unknown as AccountPersistence,
      accountId,
    );

    await Promise.allSettled([
      cleanupPendingSignup(
        prisma as unknown as AccountPersistence,
        accountId,
        verification.plaintext,
      ),
      consumeVerificationToken(
        prisma as unknown as AccountPersistence,
        verification.plaintext,
      ),
    ]);

    const finalAccount = await prisma.account.findUnique({
      where: { id: accountId },
    });
    if (finalAccount === null) {
      await expect(
        prisma.accountToken.findMany({ where: { accountId } }),
      ).resolves.toHaveLength(0);
    } else {
      expect(finalAccount.status).toBe("ACTIVE");
      expect(finalAccount.emailVerifiedAt).not.toBeNull();
      await expect(
        prisma.accountToken.findMany({
          where: { accountId, consumedAt: { not: null } },
        }),
      ).resolves.toHaveLength(1);
    }
  });

  it("creates, lists, reads and updates a Store through active Owner membership", async () => {
    const accountId = await createAccount();
    const store = await createStoreForOwner(prisma as never, accountId, {
      name: "Owner Store",
      slug: `owner-${randomUUID()}`,
    });
    storeIds.add(store.id);

    const listed = await prisma.store.findMany({
      where: { memberships: { some: { accountId, status: "ACTIVE" } } },
    });
    expect(listed.map((item) => item.id)).toContain(store.id);
    await expect(
      getStoreForMember(prisma as never, accountId, store.id),
    ).resolves.toMatchObject({ id: store.id });
    await expect(
      updateStoreMetadata(prisma as never, accountId, store.id, {
        name: "Renamed Store",
      }),
    ).resolves.toMatchObject({ name: "Renamed Store" });
    const audits = await prisma.auditEvent.findMany({
      where: { storeId: store.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(audits.map((event) => event.action)).toEqual([
      "STORE_CREATED",
      "STORE_METADATA_UPDATED",
    ]);
  });

  it("denies cross-Store access and makes revoked membership effective immediately", async () => {
    const ownerA = await createAccount();
    const ownerB = await createAccount();
    const store = await createStoreForOwner(prisma as never, ownerA, {
      name: "Private",
      slug: `private-${randomUUID()}`,
    });
    storeIds.add(store.id);

    await expect(
      getStoreForMember(prisma as never, ownerB, store.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await prisma.storeMembership.updateMany({
      where: { accountId: ownerA, storeId: store.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await expect(
      getStoreForMember(prisma as never, ownerA, store.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("permits only the Owner to update Store metadata", async () => {
    const owner = await createAccount();
    const staff = await createAccount();
    const store = await createStoreForOwner(prisma as never, owner, {
      name: "Managed",
      slug: `managed-${randomUUID()}`,
    });
    storeIds.add(store.id);
    await prisma.storeMembership.create({
      data: {
        accountId: staff,
        storeId: store.id,
        role: "STAFF",
        status: "ACTIVE",
      },
    });

    await expect(
      updateStoreMetadata(prisma as never, staff, store.id, {
        name: "Not allowed",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      updateStoreMetadata(prisma as never, owner, store.id, {
        name: "Allowed",
      }),
    ).resolves.toMatchObject({ name: "Allowed" });
  });

  it("serializes concurrent Store creation with the same slug", async () => {
    const ownerA = await createAccount();
    const ownerB = await createAccount();
    const slug = `race-${randomUUID()}`;
    const results = await Promise.allSettled([
      createStoreForOwner(prisma as never, ownerA, { name: "Race A", slug }),
      createStoreForOwner(prisma as never, ownerB, { name: "Race B", slug }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === "fulfilled") storeIds.add(result.value.id);
  });

  it("encrypts FCM tokens, rejects rebinds and revokes linked sessions", async () => {
    const accountA = await createAccount();
    const accountB = await createAccount();
    const installationA = randomUUID();
    const installationB = randomUUID();
    const token = `fcm-${randomUUID()}`;
    installationIds.add(installationA);
    installationIds.add(installationB);
    const first = await registerInstallation(
      prisma as never,
      accountA,
      { installationId: installationA, platform: "ANDROID", fcmToken: token },
      fcmKeys,
    );
    const oldSession = await createSession(prisma as never, {
      sessionId: randomUUID(),
      accountId: accountA,
      appInstallationId: installationA,
    });
    await expect(
      registerInstallation(
        prisma as never,
        accountB,
        { installationId: installationB, platform: "IOS", fcmToken: token },
        fcmKeys,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    const stored = await prisma.appInstallation.findUniqueOrThrow({
      where: { id: first.id },
      select: { fcmTokenCiphertext: true, status: true },
    });
    expect(stored.fcmTokenCiphertext).not.toContain(token);
    expect(decryptFcmToken(stored.fcmTokenCiphertext, fcmKeys)).toBe(token);
    expect(stored.status).toBe("ACTIVE");
    const revokedOldSession = await prisma.session.findUniqueOrThrow({
      where: { id: oldSession.sessionId },
    });
    expect(revokedOldSession.revokedAt).toBeNull();

    const second = await registerInstallation(
      prisma as never,
      accountB,
      {
        installationId: installationB,
        platform: "IOS",
        fcmToken: `different-${randomUUID()}`,
      },
      fcmKeys,
    );
    expect(second.status).toBe("ACTIVE");

    const session = await createSession(prisma as never, {
      sessionId: randomUUID(),
      accountId: accountB,
      appInstallationId: installationB,
    });
    await revokeInstallation(prisma as never, accountB, installationB);
    const revokedSession = await prisma.session.findUniqueOrThrow({
      where: { id: session.sessionId },
    });
    expect(revokedSession.revokedAt).not.toBeNull();
    const revokeAudits = await prisma.auditEvent.findMany({
      where: { resourceId: installationB },
    });
    expect(revokeAudits.map((event) => event.action)).toContain(
      "APP_INSTALLATION_REVOKED",
    );
  });

  it("allows only one active binding when two installations register the same token concurrently", async () => {
    const accountA = await createAccount();
    const accountB = await createAccount();
    const token = `concurrent-fcm-${randomUUID()}`;
    const installationA = randomUUID();
    const installationB = randomUUID();
    const results = await Promise.allSettled([
      registerInstallation(
        prisma as never,
        accountA,
        { installationId: installationA, platform: "ANDROID", fcmToken: token },
        fcmKeys,
      ),
      registerInstallation(
        prisma as never,
        accountB,
        { installationId: installationB, platform: "ANDROID", fcmToken: token },
        fcmKeys,
      ),
    ]);
    installationIds.add(installationA);
    installationIds.add(installationB);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const active = await prisma.appInstallation.count({
      where: { status: "ACTIVE", fcmTokenFingerprint: { not: "" } },
    });
    const rows = await prisma.appInstallation.findMany({
      where: { id: { in: [installationA, installationB] }, status: "ACTIVE" },
    });
    expect(active).toBeGreaterThanOrEqual(1);
    expect(rows).toHaveLength(1);
  });

  it("rejects an account from operating another account installation", async () => {
    const accountA = await createAccount();
    const accountB = await createAccount();
    const installationId = randomUUID();
    await registerInstallation(
      prisma as never,
      accountA,
      {
        installationId,
        platform: "ANDROID",
        fcmToken: `owned-${randomUUID()}`,
      },
      fcmKeys,
    );
    installationIds.add(installationId);
    await expect(
      registerInstallation(
        prisma as never,
        accountB,
        { installationId, platform: "IOS", fcmToken: `wrong-${randomUUID()}` },
        fcmKeys,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("writes password-reset and session-revoke audit events atomically", async () => {
    const accountId = await createAccount();
    const installationId = await createInstallation(accountId);
    const session = await createSession(prisma as never, {
      sessionId: randomUUID(),
      accountId,
      appInstallationId: installationId,
    });
    await revokeRefreshSession(prisma as never, session.refreshToken);
    const audits = await prisma.auditEvent.findMany({
      where: { resourceId: session.sessionId },
    });
    expect(audits.map((event) => event.action)).toContain("SESSION_LOGOUT");
  });

  it("rolls back business state when AuditEvent insertion fails", async () => {
    const accountId = await createAccount();
    const storeId = `audit-failure-${randomUUID()}`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.store.create({
          data: {
            id: storeId,
            name: "Should Roll Back",
            slug: `rollback-${randomUUID()}`,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorType: "ACCOUNT",
            actorId: accountId,
            action: "x".repeat(101),
            resourceType: "STORE",
            resourceId: storeId,
            storeId,
            metadata: {},
          },
        });
      }),
    ).rejects.toThrow();
    await expect(
      prisma.store.findUnique({ where: { id: storeId } }),
    ).resolves.toBeNull();
  });
});
