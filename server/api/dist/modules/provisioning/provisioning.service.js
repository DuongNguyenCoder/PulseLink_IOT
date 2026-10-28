import { Prisma } from "../../generated/prisma/client.js";
import { writeAuditEvent } from "../../shared/audit.js";
import { generateBootstrapValue, generateChallenge, generateOperationalToken, hashBootstrapValue, hashChallenge, hashDeviceToken, isSupportedEnrollmentPublicKey, verifyEnrollmentSignature, } from "./provisioning-crypto.js";
export class ProvisioningError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = "ProvisioningError";
        this.statusCode = statusCode;
    }
}
function isUniqueViolation(error) {
    return (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002");
}
function safeSession(record) {
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
export async function requireOwner(db, accountId, storeId) {
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
export async function enrollDevice(db, actor, deviceId, input, requestId, now = new Date()) {
    if (!isSupportedEnrollmentPublicKey(input.publicKey)) {
        throw new ProvisioningError("Unsupported enrollment public key", 400);
    }
    try {
        return await db.$transaction(async (tx) => {
            const device = await tx.device.findUnique({ where: { id: deviceId } });
            if (device === null)
                throw new ProvisioningError("Resource not found", 404);
            if (device.status === "DISABLED" ||
                device.enrollmentStatus !== "UNENROLLED" ||
                device.provisioningState === "REVOKED") {
                throw new ProvisioningError("Device is already enrolled", 409);
            }
            const updated = await tx.device.update({
                where: { id: deviceId },
                data: {
                    enrollmentPublicKey: input.publicKey,
                    enrollmentKeyVersion: input.keyVersion,
                    enrollmentStatus: "ENROLLED",
                    provisioningState: "READY",
                    enrolledAt: now,
                    enrollmentRevokedAt: null,
                },
            });
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
                    keyVersion: input.keyVersion,
                    outcome: "success",
                },
                occurredAt: now,
            });
            return updated;
        });
    }
    catch (error) {
        if (error instanceof ProvisioningError)
            throw error;
        if (isUniqueViolation(error))
            throw new ProvisioningError("Device enrollment conflicts with current state", 409);
        throw error;
    }
}
export async function revokeDeviceEnrollment(db, actor, deviceId, requestId, now = new Date()) {
    await db.$transaction(async (tx) => {
        const device = await tx.device.findUnique({ where: { id: deviceId } });
        if (device === null)
            throw new ProvisioningError("Resource not found", 404);
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
export async function createProvisioningSession(db, accountId, storeId, input, requestId, now = new Date()) {
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
            if (device.enrollmentStatus !== "ENROLLED" ||
                device.provisioningState === "REVOKED") {
                throw new ProvisioningError("Device is not available for provisioning", 409);
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
            return session;
        });
        return { session: safeSession(result), bootstrapSecret, challenge };
    }
    catch (error) {
        if (error instanceof ProvisioningError)
            throw error;
        if (isUniqueViolation(error))
            throw new ProvisioningError("Provisioning session conflicts with current state", 409);
        throw error;
    }
}
export async function listProvisioningSessions(db, accountId, storeId) {
    await requireOwner(db, accountId, storeId);
    const sessions = await db.provisioningSession.findMany({
        where: { actorAccountId: accountId, storeId },
        orderBy: { createdAt: "desc" },
    });
    return sessions.map(safeSession);
}
export async function getProvisioningSession(db, accountId, storeId, sessionId) {
    await requireOwner(db, accountId, storeId);
    const session = await db.provisioningSession.findUnique({
        where: { id: sessionId },
    });
    if (session === null ||
        session.storeId !== storeId ||
        session.actorAccountId !== accountId) {
        throw new ProvisioningError("Resource not found", 404);
    }
    return safeSession(session);
}
export async function cancelProvisioningSession(db, accountId, storeId, sessionId, requestId, now = new Date()) {
    await requireOwner(db, accountId, storeId);
    await db.$transaction(async (tx) => {
        const session = await tx.provisioningSession.findUnique({
            where: { id: sessionId },
        });
        if (session === null ||
            session.storeId !== storeId ||
            session.actorAccountId !== accountId) {
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
async function recordFailedAttempt(db, sessionId, now) {
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
        if (update.count !== 1)
            return;
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
export async function redeemProvisioningSession(db, input, requestId, now = new Date()) {
    const session = await db.provisioningSession.findUnique({
        where: { id: input.sessionId },
    });
    const device = await db.device.findUnique({ where: { id: input.deviceId } });
    if (session === null ||
        session.deviceId !== input.deviceId ||
        session.storeId !== device?.storeId ||
        session.status !== "ACTIVE" ||
        device === null) {
        throw new ProvisioningError("Invalid provisioning credentials", 401);
    }
    const validSecret = hashBootstrapValue(input.bootstrapSecret) === session.bootstrapVerifier;
    const validChallenge = hashChallenge(input.challenge) === session.challengeHash;
    const validSignature = device.enrollmentPublicKey !== null &&
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
            throw new ProvisioningError("Provisioning session is no longer active", 409);
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
            throw new ProvisioningError("Device is not available for provisioning", 409);
        }
        const updatedDevice = await tx.device.findUnique({
            where: { id: input.deviceId },
        });
        if (updatedDevice === null) {
            throw new ProvisioningError("Device is not available for provisioning", 409);
        }
        await writeAuditEvent(tx, {
            actorType: "DEVICE",
            actorId: updatedDevice.id,
            action: device.provisioningState === "PROVISIONED"
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
export async function authenticateDevice(db, token) {
    const verifier = hashDeviceToken(token);
    const device = await db.device.findFirst({
        where: { deviceSecretHash: verifier },
    });
    if (device === null ||
        device.status === "DISABLED" ||
        device.enrollmentStatus !== "ENROLLED" ||
        device.provisioningState !== "PROVISIONED") {
        throw new ProvisioningError("Device authentication failed", 401);
    }
    return device;
}
