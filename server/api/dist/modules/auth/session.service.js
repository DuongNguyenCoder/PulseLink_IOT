import { generateRefreshToken, generateTokenFamilyId, hashRefreshToken } from './session-tokens.js';
import { writeAuditEvent } from '../../shared/audit.js';
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export class RefreshSessionError extends Error {
    statusCode = 401;
    constructor(message = 'Refresh session is invalid') {
        super(message);
        this.name = 'RefreshSessionError';
    }
}
export async function createSessionInTransaction(transaction, input, now = new Date()) {
    const refreshToken = generateRefreshToken();
    const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_TTL_MS);
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS);
    await transaction.session.create({
        data: {
            id: input.sessionId,
            accountId: input.accountId,
            appInstallationId: input.appInstallationId,
            refreshTokenHash: refreshToken.verifier,
            tokenFamilyId: generateTokenFamilyId(),
            generation: 0,
            idleExpiresAt,
            absoluteExpiresAt,
        },
    });
    return {
        sessionId: input.sessionId,
        refreshToken: refreshToken.plaintext,
        idleExpiresAt,
        absoluteExpiresAt,
    };
}
export async function createSession(database, input, now = new Date()) {
    return database.$transaction((transaction) => createSessionInTransaction(transaction, input, now));
}
export async function rotateRefreshSession(database, refreshToken, replacementSessionId, now = new Date(), requestId) {
    const outcome = await database.$transaction(async (transaction) => {
        const current = await transaction.session.findUnique({
            where: { refreshTokenHash: hashRefreshToken(refreshToken) },
            include: { account: true, installation: true },
        });
        if (current === null) {
            throw new RefreshSessionError();
        }
        if (current.revokedAt !== null || current.rotatedAt !== null) {
            await revokeAllSessions(transaction, current.accountId, now, 'REUSE_DETECTED', requestId, current.id);
            return { reuseDetected: true };
        }
        if (current.account.status === 'DISABLED' ||
            current.installation.status !== 'ACTIVE' ||
            current.idleExpiresAt <= now ||
            current.absoluteExpiresAt <= now) {
            await transaction.session.updateMany({
                where: { id: current.id, revokedAt: null },
                data: { revokedAt: now, revokeReason: 'EXPIRED' },
            });
            throw new RefreshSessionError();
        }
        const replacement = generateRefreshToken();
        const idleExpiresAt = new Date(now.getTime() + SESSION_IDLE_TTL_MS);
        const absoluteExpiresAt = current.absoluteExpiresAt;
        const consumed = await transaction.session.updateMany({
            where: {
                id: current.id,
                refreshTokenHash: current.refreshTokenHash,
                revokedAt: null,
                rotatedAt: null,
            },
            data: { rotatedAt: now, revokedAt: now, revokeReason: 'ROTATED', lastUsedAt: now },
        });
        if (consumed.count !== 1) {
            await revokeAllSessions(transaction, current.accountId, now, 'REUSE_DETECTED', requestId, current.id);
            return { reuseDetected: true };
        }
        await transaction.session.create({
            data: {
                id: replacementSessionId,
                accountId: current.accountId,
                appInstallationId: current.appInstallationId,
                refreshTokenHash: replacement.verifier,
                tokenFamilyId: current.tokenFamilyId,
                generation: current.generation + 1,
                idleExpiresAt,
                absoluteExpiresAt,
            },
        });
        return {
            sessionId: replacementSessionId,
            refreshToken: replacement.plaintext,
            idleExpiresAt,
            absoluteExpiresAt,
        };
    });
    if ('reuseDetected' in outcome) {
        throw new RefreshSessionError();
    }
    return outcome;
}
export async function revokeRefreshSession(database, refreshToken, now = new Date(), requestId) {
    await database.$transaction(async (transaction) => {
        const current = await transaction.session.findUnique({
            where: { refreshTokenHash: hashRefreshToken(refreshToken) },
            include: { account: true, installation: true },
        });
        if (current === null)
            return;
        const revoked = await transaction.session.updateMany({
            where: { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
            data: { revokedAt: now, revokeReason: 'LOGOUT' },
        });
        if (revoked.count === 1) {
            await writeAuditEvent(transaction, {
                actorType: 'ACCOUNT',
                actorId: current.accountId,
                action: 'SESSION_LOGOUT',
                resourceType: 'SESSION',
                resourceId: current.id,
                requestId,
                metadata: { outcome: 'success', sessionId: current.id },
                occurredAt: now,
            });
        }
    });
}
async function revokeAllSessions(transaction, accountId, now, reason, requestId, triggerSessionId) {
    const revoked = await transaction.session.updateMany({
        where: { accountId, revokedAt: null },
        data: { revokedAt: now, revokeReason: reason },
    });
    if (revoked.count > 0) {
        await writeAuditEvent(transaction, {
            actorType: 'ACCOUNT',
            actorId: accountId,
            action: 'SESSION_REUSE_DETECTED',
            resourceType: 'ACCOUNT',
            resourceId: accountId,
            requestId,
            metadata: { outcome: 'sessions_revoked', sessionId: triggerSessionId ?? null, reason },
            occurredAt: now,
        });
    }
}
