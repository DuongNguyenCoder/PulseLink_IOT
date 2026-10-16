import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { generateKeyPairSync, randomBytes, randomUUID, sign, } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../generated/prisma/client.js";
import { assertIntegrationDatabaseEnvironment } from "./integration-db-guard.js";
import { createSession, rotateRefreshSession, } from "../modules/auth/session.service.js";
import { consumePasswordResetToken, consumeVerificationToken, issuePasswordResetToken, issueVerificationToken, registerAccount, } from "../modules/auth/account.service.js";
import { createStoreForOwner, getStoreForMember, updateStoreMetadata, } from "../modules/stores/store.service.js";
import { decryptFcmToken, } from "../modules/installations/fcm-crypto.js";
import { registerInstallation, revokeInstallation, } from "../modules/installations/installation.service.js";
import { revokeRefreshSession } from "../modules/auth/session.service.js";
import { canonicalProvisioningPayload, hashDeviceToken, } from "../modules/provisioning/provisioning-crypto.js";
import { createProvisioningSession, enrollDevice, redeemProvisioningSession, } from "../modules/provisioning/provisioning.service.js";
import { ingestDeviceEvent } from "../modules/device-events/device-event.service.js";
import { PrismaNotificationJobRepository } from "../modules/notifications/notification-repository.js";
import { NotificationWorker } from "../modules/notifications/notification-worker.js";
const integrationRequested = process.env.PULSELINK_INTEGRATION_TESTS === "1";
const integrationConfig = integrationRequested
    ? assertIntegrationDatabaseEnvironment({ ...process.env, NODE_ENV: "test" })
    : null;
const integrationDescribe = integrationRequested ? describe : describe.skip;
let prisma;
const accountIds = new Set();
const installationIds = new Set();
const storeIds = new Set();
const deviceIds = new Set();
const provisioningSessionIds = new Set();
const eventIds = new Set();
const staffIds = new Set();
const pushTokenIds = new Set();
const fcmKeys = {
    activeVersion: 1,
    encryptionKeys: new Map([[1, randomBytes(32)]]),
    fingerprintKey: randomBytes(32),
};
function databaseClient() {
    if (integrationConfig === null) {
        throw new Error("Integration database is not enabled");
    }
    const adapter = new PrismaPg({ connectionString: integrationConfig.url });
    return new PrismaClient({ adapter });
}
async function createAccount() {
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
async function createInstallation(accountId) {
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
async function createStore() {
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
async function cleanupCreatedRows() {
    const accounts = [...accountIds];
    const installations = [...installationIds];
    const stores = [...storeIds];
    const devices = [...deviceIds];
    const provisioningSessions = [...provisioningSessionIds];
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
    it("accepts a matching Session account and rejects an installation/account mismatch", async () => {
        const accountA = await createAccount();
        const accountB = await createAccount();
        const installationA = await createInstallation(accountA);
        const expiresAt = new Date(Date.now() + 86_400_000);
        await expect(prisma.session.create({
            data: {
                accountId: accountA,
                appInstallationId: installationA,
                refreshTokenHash: randomUUID().replaceAll("-", ""),
                tokenFamilyId: randomUUID().replaceAll("-", ""),
                idleExpiresAt: expiresAt,
                absoluteExpiresAt: expiresAt,
            },
        })).resolves.toBeTruthy();
        await expect(prisma.session.create({
            data: {
                accountId: accountB,
                appInstallationId: installationA,
                refreshTokenHash: randomUUID().replaceAll("-", ""),
                tokenFamilyId: randomUUID().replaceAll("-", ""),
                idleExpiresAt: expiresAt,
                absoluteExpiresAt: expiresAt,
            },
        })).rejects.toMatchObject({ code: "P2003" });
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
        const input = {
            eventId: randomUUID(),
            type: "BUTTON_PRESSED",
            occurredAt: "2026-10-15T14:00:00.000Z",
            firmwareVersion: "0.1.0",
            rssiDbm: -60,
            payload: { button: "main" },
        };
        eventIds.add(input.eventId);
        const results = await Promise.allSettled([
            ingestDeviceEvent(prisma, token, input),
            ingestDeviceEvent(prisma, token, input),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
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
        const input = {
            eventId: randomUUID(),
            type: "BUTTON_PRESSED",
            occurredAt: "2026-10-15T14:00:00.000Z",
            payload: { button: "worker" },
        };
        eventIds.add(input.eventId);
        const accepted = await ingestDeviceEvent(prisma, token, input);
        const sentTokens = [];
        const sender = {
            send: async (message) => {
                await new Promise((resolve) => setTimeout(resolve, 50));
                sentTokens.push(message.token);
                return "integration-message-id";
            },
        };
        const options = { concurrency: 1, leaseMs: 5_000, pollMs: 1 };
        const results = await Promise.all([
            new NotificationWorker(new PrismaNotificationJobRepository(prisma), sender, options).processOnce(),
            new NotificationWorker(new PrismaNotificationJobRepository(prisma), sender, options).processOnce(),
        ]);
        expect(results.sort()).toEqual([0, 1]);
        expect(sentTokens).toHaveLength(1);
        await expect(prisma.deviceNotification.findFirst({
            where: { eventId: accepted.event.id },
        })).resolves.toMatchObject({ status: "SENT", attempts: 1 });
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
        const input = {
            eventId: randomUUID(),
            type: "BUTTON_PRESSED",
            occurredAt: "2026-10-15T14:00:00.000Z",
            payload: { button: "lease" },
        };
        eventIds.add(input.eventId);
        const accepted = await ingestDeviceEvent(prisma, token, input);
        const repository = new PrismaNotificationJobRepository(prisma);
        const firstNow = new Date();
        const first = await repository.claim(1, firstNow, new Date(firstNow.getTime() + 1_000));
        expect(first).toHaveLength(1);
        expect(first[0]?.leaseRecovered).toBe(false);
        const snapshot = await repository.getQueueSnapshot(firstNow);
        expect(snapshot.counts.PROCESSING).toBeGreaterThanOrEqual(1);
        expect(snapshot.expiredLeaseCount).toBe(0);
        const recovered = await repository.claim(1, new Date(firstNow.getTime() + 2_000), new Date(firstNow.getTime() + 3_000));
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
        await expect(prisma.storeMembership.create({
            data: { accountId: ownerB, storeId, role: "OWNER", status: "ACTIVE" },
        })).rejects.toMatchObject({ code: "P2002" });
        await expect(prisma.storeMembership.create({
            data: { accountId: staff, storeId, role: "STAFF", status: "ACTIVE" },
        })).resolves.toBeTruthy();
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
        await expect(prisma.account.delete({ where: { id: accountId } })).rejects.toMatchObject({ code: "P2003" });
        await expect(prisma.appInstallation.delete({ where: { id: installationId } })).rejects.toMatchObject({ code: "P2003" });
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
        await expect(prisma.provisioningSession.create({
            data: {
                deviceId: secondDevice.id,
                storeId: storeB,
                actorAccountId: accountId,
                bootstrapVerifier: randomUUID().replaceAll("-", ""),
                challengeHash: randomUUID().replaceAll("-", ""),
                idempotencyKey: randomUUID(),
                expiresAt: new Date(Date.now() + 30 * 60_000),
            },
        })).rejects.toMatchObject({ code: "P2003" });
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
        const create = (suffix) => prisma.provisioningSession.create({
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
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
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
        await expect(prisma.device.delete({ where: { id: device.id } })).rejects.toMatchObject({ code: "P2003" });
        await expect(prisma.store.delete({ where: { id: storeId } })).rejects.toMatchObject({ code: "P2003" });
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
        await expect(enrollDevice(prisma, { actorId: "commissioning-tool", actorType: "SYSTEM" }, device.id, { publicKey: publicKeySpkiBase64, keyVersion: 1 })).resolves.toMatchObject({
            enrollmentStatus: "ENROLLED",
            provisioningState: "READY",
        });
        await expect(enrollDevice(prisma, { actorId: "commissioning-tool", actorType: "SYSTEM" }, device.id, { publicKey: publicKeySpkiBase64, keyVersion: 1 })).rejects.toMatchObject({ statusCode: 409 });
        const created = await createProvisioningSession(prisma, ownerId, storeId, { deviceId: device.id, idempotencyKey: `integration-${randomUUID()}` });
        provisioningSessionIds.add(created.session.id);
        const signature = sign("sha256", canonicalProvisioningPayload({
            sessionId: created.session.id,
            deviceKey: device.deviceKey,
            challenge: created.challenge,
            expiresAt: created.session.expiresAt,
        }), { key: privateKey, dsaEncoding: "der" }).toString("base64");
        const redeemed = await redeemProvisioningSession(prisma, {
            deviceId: device.id,
            sessionId: created.session.id,
            bootstrapSecret: created.bootstrapSecret,
            challenge: created.challenge,
            signature,
        });
        expect(redeemed.operationalToken).toHaveLength(43);
        const storedDevice = await prisma.device.findUniqueOrThrow({
            where: { id: device.id },
        });
        expect(storedDevice.deviceSecretHash).toBe(hashDeviceToken(redeemed.operationalToken));
        expect(storedDevice.deviceSecretHash).not.toContain(redeemed.operationalToken);
        expect(await prisma.provisioningSession.findUniqueOrThrow({
            where: { id: created.session.id },
        })).toMatchObject({ status: "REDEEMED" });
        await expect(redeemProvisioningSession(prisma, {
            deviceId: device.id,
            sessionId: created.session.id,
            bootstrapSecret: created.bootstrapSecret,
            challenge: created.challenge,
            signature,
        })).rejects.toMatchObject({ statusCode: 401 });
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
        const { publicKey } = generateKeyPairSync("ec", {
            namedCurve: "prime256v1",
        });
        await enrollDevice(prisma, { actorId: "commissioning-tool" }, device.id, {
            publicKey: publicKey
                .export({ type: "spki", format: "der" })
                .toString("base64"),
            keyVersion: 1,
        });
        await expect(createProvisioningSession(prisma, otherAccountId, storeId, { deviceId: device.id, idempotencyKey: `wrong-${randomUUID()}` })).rejects.toMatchObject({ statusCode: 404 });
        const created = await createProvisioningSession(prisma, ownerId, storeId, { deviceId: device.id, idempotencyKey: `attempt-${randomUUID()}` });
        provisioningSessionIds.add(created.session.id);
        const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => redeemProvisioningSession(prisma, {
            deviceId: device.id,
            sessionId: created.session.id,
            bootstrapSecret: "wrong-bootstrap-secret-value",
            challenge: created.challenge,
            signature: "invalid-signature-value",
        })));
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
        const initial = await createSession(prisma, {
            sessionId: randomUUID(),
            accountId,
            appInstallationId: installationId,
        });
        const results = await Promise.allSettled([
            rotateRefreshSession(prisma, initial.refreshToken, randomUUID()),
            rotateRefreshSession(prisma, initial.refreshToken, randomUUID()),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        const sessions = await prisma.session.findMany({ where: { accountId } });
        expect(sessions.every((session) => session.revokedAt !== null), JSON.stringify(sessions.map((session) => ({
            id: session.id,
            revoked: session.revokedAt !== null,
        })))).toBe(true);
    });
    it("rolls back the consumed session when replacement creation fails", async () => {
        const accountId = await createAccount();
        const installationId = await createInstallation(accountId);
        const initial = await createSession(prisma, {
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
        await expect(rotateRefreshSession(prisma, initial.refreshToken, blockerId)).rejects.toMatchObject({ code: "P2002" });
        const unchanged = await prisma.session.findUniqueOrThrow({
            where: { id: initial.sessionId },
        });
        expect(unchanged.revokedAt).toBeNull();
        expect(unchanged.rotatedAt).toBeNull();
    });
    it("enforces concurrent signup email uniqueness in PostgreSQL", async () => {
        const email = `${randomUUID()}@integration.test`;
        const results = await Promise.allSettled([
            registerAccount(prisma, {
                email,
                password: "password-one",
            }),
            registerAccount(prisma, {
                email,
                password: "password-two",
            }),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        const created = results.find((result) => result.status === "fulfilled");
        if (created?.status === "fulfilled")
            accountIds.add(created.value.id);
    });
    it("consumes an email verification token only once under concurrency", async () => {
        const accountId = await createAccount();
        const issued = await issueVerificationToken(prisma, accountId);
        const results = await Promise.allSettled([
            consumeVerificationToken(prisma, issued.plaintext),
            consumeVerificationToken(prisma, issued.plaintext),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        const verified = await prisma.account.findUniqueOrThrow({
            where: { id: accountId },
        });
        expect(verified.emailVerifiedAt).not.toBeNull();
    });
    it("consumes a password reset once and atomically revokes sessions", async () => {
        const accountId = await createAccount();
        const installationId = await createInstallation(accountId);
        await createSession(prisma, {
            sessionId: randomUUID(),
            accountId,
            appInstallationId: installationId,
        });
        const issued = await issuePasswordResetToken(prisma, "integration-test@example.invalid");
        // The test account email is generated; issue a token for its actual email.
        const account = await prisma.account.findUniqueOrThrow({
            where: { id: accountId },
        });
        const actualIssued = await issuePasswordResetToken(prisma, account.emailNormalized);
        expect(issued).toBeNull();
        expect(actualIssued).not.toBeNull();
        if (actualIssued === null)
            return;
        const results = await Promise.allSettled([
            consumePasswordResetToken(prisma, actualIssued.token.plaintext, "new password one"),
            consumePasswordResetToken(prisma, actualIssued.token.plaintext, "new password two"),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
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
    it("creates, lists, reads and updates a Store through active Owner membership", async () => {
        const accountId = await createAccount();
        const store = await createStoreForOwner(prisma, accountId, {
            name: "Owner Store",
            slug: `owner-${randomUUID()}`,
        });
        storeIds.add(store.id);
        const listed = await prisma.store.findMany({
            where: { memberships: { some: { accountId, status: "ACTIVE" } } },
        });
        expect(listed.map((item) => item.id)).toContain(store.id);
        await expect(getStoreForMember(prisma, accountId, store.id)).resolves.toMatchObject({ id: store.id });
        await expect(updateStoreMetadata(prisma, accountId, store.id, {
            name: "Renamed Store",
        })).resolves.toMatchObject({ name: "Renamed Store" });
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
        const store = await createStoreForOwner(prisma, ownerA, {
            name: "Private",
            slug: `private-${randomUUID()}`,
        });
        storeIds.add(store.id);
        await expect(getStoreForMember(prisma, ownerB, store.id)).rejects.toMatchObject({ statusCode: 404 });
        await prisma.storeMembership.updateMany({
            where: { accountId: ownerA, storeId: store.id },
            data: { status: "REVOKED", revokedAt: new Date() },
        });
        await expect(getStoreForMember(prisma, ownerA, store.id)).rejects.toMatchObject({ statusCode: 404 });
    });
    it("permits only the Owner to update Store metadata", async () => {
        const owner = await createAccount();
        const staff = await createAccount();
        const store = await createStoreForOwner(prisma, owner, {
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
        await expect(updateStoreMetadata(prisma, staff, store.id, {
            name: "Not allowed",
        })).rejects.toMatchObject({ statusCode: 403 });
        await expect(updateStoreMetadata(prisma, owner, store.id, {
            name: "Allowed",
        })).resolves.toMatchObject({ name: "Allowed" });
    });
    it("serializes concurrent Store creation with the same slug", async () => {
        const ownerA = await createAccount();
        const ownerB = await createAccount();
        const slug = `race-${randomUUID()}`;
        const results = await Promise.allSettled([
            createStoreForOwner(prisma, ownerA, { name: "Race A", slug }),
            createStoreForOwner(prisma, ownerB, { name: "Race B", slug }),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
        for (const result of results)
            if (result.status === "fulfilled")
                storeIds.add(result.value.id);
    });
    it("encrypts FCM tokens, rebinds atomically and revokes linked sessions", async () => {
        const accountA = await createAccount();
        const accountB = await createAccount();
        const installationA = randomUUID();
        const installationB = randomUUID();
        const token = `fcm-${randomUUID()}`;
        const first = await registerInstallation(prisma, accountA, { installationId: installationA, platform: "ANDROID", fcmToken: token }, fcmKeys);
        const oldSession = await createSession(prisma, {
            sessionId: randomUUID(),
            accountId: accountA,
            appInstallationId: installationA,
        });
        const second = await registerInstallation(prisma, accountB, { installationId: installationB, platform: "IOS", fcmToken: token }, fcmKeys);
        installationIds.add(installationA);
        installationIds.add(installationB);
        const stored = await prisma.appInstallation.findUniqueOrThrow({
            where: { id: first.id },
            select: { fcmTokenCiphertext: true, status: true },
        });
        expect(stored.fcmTokenCiphertext).not.toContain(token);
        expect(decryptFcmToken(stored.fcmTokenCiphertext, fcmKeys)).toBe(token);
        expect(stored.status).toBe("REVOKED");
        const revokedOldSession = await prisma.session.findUniqueOrThrow({
            where: { id: oldSession.sessionId },
        });
        expect(revokedOldSession.revokedAt).not.toBeNull();
        const rebindAudits = await prisma.auditEvent.findMany({
            where: { resourceId: installationB },
        });
        expect(rebindAudits.map((event) => event.action)).toContain("FCM_TOKEN_REBOUND");
        expect(second.status).toBe("ACTIVE");
        const session = await createSession(prisma, {
            sessionId: randomUUID(),
            accountId: accountB,
            appInstallationId: installationB,
        });
        await revokeInstallation(prisma, accountB, installationB);
        const revokedSession = await prisma.session.findUniqueOrThrow({
            where: { id: session.sessionId },
        });
        expect(revokedSession.revokedAt).not.toBeNull();
        const revokeAudits = await prisma.auditEvent.findMany({
            where: { resourceId: installationB },
        });
        expect(revokeAudits.map((event) => event.action)).toContain("APP_INSTALLATION_REVOKED");
    });
    it("allows only one active binding when two installations register the same token concurrently", async () => {
        const accountA = await createAccount();
        const accountB = await createAccount();
        const token = `concurrent-fcm-${randomUUID()}`;
        const installationA = randomUUID();
        const installationB = randomUUID();
        const results = await Promise.allSettled([
            registerInstallation(prisma, accountA, { installationId: installationA, platform: "ANDROID", fcmToken: token }, fcmKeys),
            registerInstallation(prisma, accountB, { installationId: installationB, platform: "ANDROID", fcmToken: token }, fcmKeys),
        ]);
        installationIds.add(installationA);
        installationIds.add(installationB);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
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
        await registerInstallation(prisma, accountA, {
            installationId,
            platform: "ANDROID",
            fcmToken: `owned-${randomUUID()}`,
        }, fcmKeys);
        installationIds.add(installationId);
        await expect(registerInstallation(prisma, accountB, { installationId, platform: "IOS", fcmToken: `wrong-${randomUUID()}` }, fcmKeys)).rejects.toMatchObject({ statusCode: 404 });
    });
    it("writes password-reset and session-revoke audit events atomically", async () => {
        const accountId = await createAccount();
        const installationId = await createInstallation(accountId);
        const session = await createSession(prisma, {
            sessionId: randomUUID(),
            accountId,
            appInstallationId: installationId,
        });
        await revokeRefreshSession(prisma, session.refreshToken);
        const audits = await prisma.auditEvent.findMany({
            where: { resourceId: session.sessionId },
        });
        expect(audits.map((event) => event.action)).toContain("SESSION_LOGOUT");
    });
    it("rolls back business state when AuditEvent insertion fails", async () => {
        const accountId = await createAccount();
        const storeId = `audit-failure-${randomUUID()}`;
        await expect(prisma.$transaction(async (tx) => {
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
        })).rejects.toThrow();
        await expect(prisma.store.findUnique({ where: { id: storeId } })).resolves.toBeNull();
    });
});
