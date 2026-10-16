import { Prisma } from '../../generated/prisma/client.js';
import { encryptFcmToken, fingerprintFcmToken } from './fcm-crypto.js';
import { writeAuditEvent } from '../../shared/audit.js';
export class InstallationError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = 'InstallationError';
        this.statusCode = statusCode;
    }
}
function isUniqueError(error) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
export async function registerInstallation(db, accountId, input, keys, now = new Date(), requestId) {
    const fingerprint = fingerprintFcmToken(input.fcmToken, keys);
    const ciphertext = encryptFcmToken(input.fcmToken, keys);
    try {
        return await db.$transaction(async (tx) => {
            const existing = await tx.appInstallation.findUnique({ where: { id: input.installationId } });
            if (existing !== null && existing.accountId !== accountId) {
                throw new InstallationError('Resource not found', 404);
            }
            const previousBinding = await tx.appInstallation.findFirst({
                where: {
                    fcmTokenFingerprint: fingerprint,
                    status: 'ACTIVE',
                    ...(existing === null ? {} : { id: { not: existing.id } }),
                },
            });
            if (previousBinding !== null) {
                await tx.appInstallation.update({
                    where: { id: previousBinding.id },
                    data: { status: 'REVOKED', revokedAt: now, revokeReason: 'TOKEN_REBOUND' },
                });
                await tx.session.updateMany({
                    where: { appInstallationId: previousBinding.id, revokedAt: null },
                    data: { revokedAt: now, revokeReason: 'ADMIN_REVOKED' },
                });
            }
            if (existing === null) {
                const created = await tx.appInstallation.create({
                    data: {
                        id: input.installationId,
                        accountId,
                        platform: input.platform,
                        fcmTokenCiphertext: ciphertext,
                        fcmTokenFingerprint: fingerprint,
                        fcmTokenKeyVersion: keys.activeVersion,
                        status: 'ACTIVE',
                        lastSeenAt: now,
                    },
                    select: { id: true, accountId: true, platform: true, status: true, lastSeenAt: true, revokedAt: true, revokeReason: true },
                });
                await writeAuditEvent(tx, {
                    actorType: 'ACCOUNT', actorId: accountId,
                    action: previousBinding === null ? 'APP_INSTALLATION_REGISTERED' : 'FCM_TOKEN_REBOUND',
                    resourceType: 'APP_INSTALLATION', resourceId: input.installationId, requestId,
                    metadata: {
                        accountId, platform: input.platform, outcome: 'success', tokenKeyVersion: keys.activeVersion,
                        ...(previousBinding === null ? {} : { previousInstallationId: previousBinding.id }),
                    },
                    occurredAt: now,
                });
                return created;
            }
            const updated = await tx.appInstallation.update({
                where: { id: existing.id },
                data: {
                    platform: input.platform,
                    fcmTokenCiphertext: ciphertext,
                    fcmTokenFingerprint: fingerprint,
                    fcmTokenKeyVersion: keys.activeVersion,
                    status: 'ACTIVE',
                    lastSeenAt: now,
                    revokedAt: null,
                    revokeReason: null,
                },
                select: { id: true, accountId: true, platform: true, status: true, lastSeenAt: true, revokedAt: true, revokeReason: true },
            });
            await writeAuditEvent(tx, {
                actorType: 'ACCOUNT', actorId: accountId,
                action: previousBinding === null ? 'APP_INSTALLATION_UPDATED' : 'FCM_TOKEN_REBOUND',
                resourceType: 'APP_INSTALLATION', resourceId: existing.id, requestId,
                metadata: {
                    accountId, platform: input.platform, outcome: 'success', tokenKeyVersion: keys.activeVersion,
                    ...(previousBinding === null ? {} : { previousInstallationId: previousBinding.id }),
                },
                occurredAt: now,
            });
            return updated;
        });
    }
    catch (error) {
        if (error instanceof InstallationError)
            throw error;
        if (isUniqueError(error))
            throw new InstallationError('FCM token registration conflicts with another installation', 409);
        throw error;
    }
}
export async function listInstallations(db, accountId) {
    return db.appInstallation.findMany({
        where: { accountId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, accountId: true, platform: true, status: true, lastSeenAt: true, revokedAt: true, revokeReason: true },
    });
}
export async function revokeInstallation(db, accountId, installationId, now = new Date(), requestId) {
    await db.$transaction(async (tx) => {
        const installation = await tx.appInstallation.findUnique({ where: { id: installationId } });
        if (installation === null || installation.accountId !== accountId)
            throw new InstallationError('Resource not found', 404);
        await tx.appInstallation.update({
            where: { id: installationId },
            data: { status: 'REVOKED', revokedAt: now, revokeReason: 'USER_REVOKED' },
        });
        await tx.session.updateMany({
            where: { appInstallationId: installationId, revokedAt: null },
            data: { revokedAt: now, revokeReason: 'ADMIN_REVOKED' },
        });
        await writeAuditEvent(tx, {
            actorType: 'ACCOUNT', actorId: accountId, action: 'APP_INSTALLATION_REVOKED',
            resourceType: 'APP_INSTALLATION', resourceId: installationId, requestId,
            metadata: { accountId, outcome: 'success', reason: 'USER_REVOKED' },
            occurredAt: now,
        });
    });
}
