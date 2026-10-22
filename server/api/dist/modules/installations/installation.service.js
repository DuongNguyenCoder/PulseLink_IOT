import { Prisma } from "../../generated/prisma/client.js";
import { encryptFcmToken, fingerprintFcmToken, } from "./fcm-crypto.js";
import { writeAuditEvent } from "../../shared/audit.js";
export class InstallationError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = "InstallationError";
        this.statusCode = statusCode;
    }
}
function isUniqueError(error) {
    return (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002");
}
export async function registerInstallationInTransaction(db, accountId, input, keys, now = new Date(), requestId) {
    const tokenMaterial = input.fcmToken === undefined
        ? undefined
        : {
            fingerprint: fingerprintFcmToken(input.fcmToken, requireFcmKeys(keys)),
            ciphertext: encryptFcmToken(input.fcmToken, requireFcmKeys(keys)),
        };
    const activeFcmKeys = tokenMaterial === undefined ? undefined : requireFcmKeys(keys);
    const tx = db;
    const existing = await tx.appInstallation.findUnique({
        where: { id: input.installationId },
    });
    if (existing !== null && existing.accountId !== accountId) {
        throw new InstallationError("Resource not found", 404);
    }
    if (tokenMaterial !== undefined) {
        const previousBinding = await tx.appInstallation.findFirst({
            where: {
                fcmTokenFingerprint: tokenMaterial.fingerprint,
                status: "ACTIVE",
                ...(existing === null ? {} : { id: { not: existing.id } }),
            },
        });
        if (previousBinding !== null) {
            throw new InstallationError("FCM token is already registered to another installation", 409);
        }
    }
    if (existing === null) {
        const created = await tx.appInstallation.create({
            data: {
                id: input.installationId,
                accountId,
                platform: input.platform,
                ...(tokenMaterial === undefined
                    ? {}
                    : {
                        fcmTokenCiphertext: tokenMaterial.ciphertext,
                        fcmTokenFingerprint: tokenMaterial.fingerprint,
                        fcmTokenKeyVersion: activeFcmKeys?.activeVersion,
                    }),
                status: "ACTIVE",
                lastSeenAt: now,
            },
            select: {
                id: true,
                accountId: true,
                platform: true,
                status: true,
                lastSeenAt: true,
                revokedAt: true,
                revokeReason: true,
            },
        });
        await writeAuditEvent(tx, {
            actorType: "ACCOUNT",
            actorId: accountId,
            action: "APP_INSTALLATION_REGISTERED",
            resourceType: "APP_INSTALLATION",
            resourceId: input.installationId,
            requestId,
            metadata: {
                accountId,
                platform: input.platform,
                outcome: "success",
                tokenKeyVersion: activeFcmKeys?.activeVersion ?? null,
            },
            occurredAt: now,
        });
        return created;
    }
    const updated = await tx.appInstallation.update({
        where: { id: existing.id },
        data: {
            platform: input.platform,
            ...(tokenMaterial === undefined
                ? {}
                : {
                    fcmTokenCiphertext: tokenMaterial.ciphertext,
                    fcmTokenFingerprint: tokenMaterial.fingerprint,
                    fcmTokenKeyVersion: activeFcmKeys?.activeVersion,
                }),
            status: "ACTIVE",
            lastSeenAt: now,
            revokedAt: null,
            revokeReason: null,
        },
        select: {
            id: true,
            accountId: true,
            platform: true,
            status: true,
            lastSeenAt: true,
            revokedAt: true,
            revokeReason: true,
        },
    });
    await writeAuditEvent(tx, {
        actorType: "ACCOUNT",
        actorId: accountId,
        action: "APP_INSTALLATION_UPDATED",
        resourceType: "APP_INSTALLATION",
        resourceId: existing.id,
        requestId,
        metadata: {
            accountId,
            platform: input.platform,
            outcome: "success",
            tokenKeyVersion: activeFcmKeys?.activeVersion ?? null,
        },
        occurredAt: now,
    });
    return updated;
}
export async function registerInstallation(db, accountId, input, keys, now = new Date(), requestId) {
    try {
        return await db.$transaction((tx) => registerInstallationInTransaction(tx, accountId, input, keys, now, requestId));
    }
    catch (error) {
        if (error instanceof InstallationError)
            throw error;
        if (isUniqueError(error)) {
            throw new InstallationError("FCM token registration conflicts with another installation", 409);
        }
        throw error;
    }
}
function requireFcmKeys(keys) {
    if (keys === undefined) {
        throw new InstallationError("Installation token registration is unavailable", 503);
    }
    return keys;
}
export async function listInstallations(db, accountId) {
    return db.appInstallation.findMany({
        where: { accountId },
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            accountId: true,
            platform: true,
            status: true,
            lastSeenAt: true,
            revokedAt: true,
            revokeReason: true,
        },
    });
}
export async function revokeInstallation(db, accountId, installationId, now = new Date(), requestId) {
    await db.$transaction(async (tx) => {
        const installation = await tx.appInstallation.findUnique({
            where: { id: installationId },
        });
        if (installation === null || installation.accountId !== accountId)
            throw new InstallationError("Resource not found", 404);
        await tx.appInstallation.update({
            where: { id: installationId },
            data: { status: "REVOKED", revokedAt: now, revokeReason: "USER_REVOKED" },
        });
        await tx.session.updateMany({
            where: { appInstallationId: installationId, revokedAt: null },
            data: { revokedAt: now, revokeReason: "ADMIN_REVOKED" },
        });
        await writeAuditEvent(tx, {
            actorType: "ACCOUNT",
            actorId: accountId,
            action: "APP_INSTALLATION_REVOKED",
            resourceType: "APP_INSTALLATION",
            resourceId: installationId,
            requestId,
            metadata: { accountId, outcome: "success", reason: "USER_REVOKED" },
            occurredAt: now,
        });
    });
}
