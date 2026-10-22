import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./password.js";
import { normalizeEmail } from "./email.js";
import { hashRefreshToken } from "./session-tokens.js";
import { writeAuditEvent } from "../../shared/audit.js";
const VERIFICATION_TOKEN_BYTES = 32;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export class AccountAuthError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = "AccountAuthError";
        this.statusCode = statusCode;
    }
}
export async function registerAccount(persistence, input) {
    const emailNormalized = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    try {
        return await persistence.account.create({
            data: { emailNormalized, passwordHash, status: "PENDING" },
        });
    }
    catch (error) {
        if (isPrismaCode(error, "P2002")) {
            throw new AccountAuthError("Account already exists", 409);
        }
        throw error;
    }
}
export async function authenticateAccount(persistence, input) {
    const emailNormalized = normalizeEmail(input.email);
    const account = await persistence.account.findUnique({
        where: { emailNormalized },
    });
    if (account === null ||
        account.status === "DISABLED" ||
        !(await verifyPassword(input.password, account.passwordHash))) {
        throw new AccountAuthError("Invalid credentials", 401);
    }
    return account;
}
export async function issueVerificationToken(persistence, accountId, now = new Date()) {
    const plaintext = randomBytes(VERIFICATION_TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(now.getTime() + VERIFICATION_TOKEN_TTL_MS);
    await persistence.accountToken.create({
        data: {
            accountId,
            purpose: "EMAIL_VERIFICATION",
            tokenHash: hashRefreshToken(plaintext),
            expiresAt,
        },
    });
    return { plaintext, expiresAt };
}
export async function consumeVerificationToken(persistence, plaintext, now = new Date()) {
    return persistence.$transaction(async (transaction) => {
        const token = await transaction.accountToken.findFirst({
            where: {
                tokenHash: hashRefreshToken(plaintext),
                purpose: "EMAIL_VERIFICATION",
                consumedAt: null,
                revokedAt: null,
            },
        });
        if (token === null || token.expiresAt <= now) {
            throw new AccountAuthError("Verification token is invalid", 401);
        }
        const consumed = await transaction.accountToken.updateMany({
            where: { id: token.id, consumedAt: null, revokedAt: null },
            data: { consumedAt: now },
        });
        if (consumed.count !== 1) {
            throw new AccountAuthError("Verification token is invalid", 401);
        }
        return transaction.account.update({
            where: { id: token.accountId },
            data: { emailVerifiedAt: now, status: "ACTIVE" },
        });
    });
}
export async function issuePasswordResetToken(persistence, email, now = new Date()) {
    const emailNormalized = normalizeEmail(email);
    return persistence.$transaction(async (transaction) => {
        const account = await transaction.account.findUnique({
            where: { emailNormalized },
        });
        if (account === null || account.status === "DISABLED")
            return null;
        // Serialize reset-token issuance for one account. PostgreSQL takes a row
        // lock for this update, so concurrent requests cannot both observe the
        // same pending token set before revoking and creating a replacement.
        await transaction.account.update({
            where: { id: account.id },
            data: { updatedAt: now },
        });
        const plaintext = randomBytes(VERIFICATION_TOKEN_BYTES).toString("base64url");
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
        await transaction.accountToken.updateMany({
            where: {
                accountId: account.id,
                purpose: "PASSWORD_RESET",
                consumedAt: null,
                revokedAt: null,
            },
            data: { revokedAt: now },
        });
        await transaction.accountToken.create({
            data: {
                accountId: account.id,
                purpose: "PASSWORD_RESET",
                tokenHash: hashRefreshToken(plaintext),
                expiresAt,
            },
        });
        return { account, token: { plaintext, expiresAt } };
    });
}
export async function cleanupPendingSignup(persistence, accountId, verificationToken, now = new Date()) {
    return persistence.$transaction(async (transaction) => {
        const account = await transaction.account.findUnique({
            where: { id: accountId },
        });
        if (account === null ||
            account.status !== "PENDING" ||
            account.emailVerifiedAt !== null)
            return false;
        const token = await transaction.accountToken.findFirst({
            where: {
                accountId,
                purpose: "EMAIL_VERIFICATION",
                tokenHash: hashRefreshToken(verificationToken),
                consumedAt: null,
                revokedAt: null,
            },
        });
        if (token === null)
            return false;
        await transaction.accountToken.updateMany({
            where: { id: token.id, consumedAt: null, revokedAt: null },
            data: { revokedAt: now },
        });
        await transaction.accountToken.delete({ where: { id: token.id } });
        await transaction.account.delete({ where: { id: accountId } });
        return true;
    });
}
export async function consumePasswordResetToken(persistence, plaintext, newPassword, now = new Date(), requestId) {
    const passwordHash = await hashPassword(newPassword);
    await persistence.$transaction(async (transaction) => {
        const token = await transaction.accountToken.findFirst({
            where: {
                tokenHash: hashRefreshToken(plaintext),
                purpose: "PASSWORD_RESET",
                consumedAt: null,
                revokedAt: null,
            },
        });
        if (token === null || token.expiresAt <= now)
            throw new AccountAuthError("Reset token is invalid", 401);
        const consumed = await transaction.accountToken.updateMany({
            where: { id: token.id, consumedAt: null, revokedAt: null },
            data: { consumedAt: now },
        });
        if (consumed.count !== 1)
            throw new AccountAuthError("Reset token is invalid", 401);
        await transaction.account.update({
            where: { id: token.accountId },
            data: { passwordHash, authVersion: { increment: 1 } },
        });
        await transaction.session.updateMany({
            where: { accountId: token.accountId, revokedAt: null },
            data: { revokedAt: now, revokeReason: "PASSWORD_RESET" },
        });
        await writeAuditEvent(transaction, {
            actorType: "ACCOUNT",
            actorId: token.accountId,
            action: "PASSWORD_RESET_COMPLETED",
            resourceType: "ACCOUNT",
            resourceId: token.accountId,
            requestId,
            metadata: { outcome: "success" },
            occurredAt: now,
        });
    });
}
function isPrismaCode(error, code) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === code);
}
