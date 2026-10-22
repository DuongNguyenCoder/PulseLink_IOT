import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AccountAuthError, authenticateAccount, consumePasswordResetToken, consumeVerificationToken, cleanupPendingSignup, issuePasswordResetToken, issueVerificationToken, registerAccount, } from "./account.service.js";
import { issueAccessToken } from "./jwt.js";
import { createSession, revokeRefreshSession, rotateRefreshSession, } from "./session.service.js";
import { normalizeEmail } from "./email.js";
import { authenticateWithInstallation, } from "./authentication-bootstrap.service.js";
import { EmailDeliveryError } from "./email-sender.js";
import { getSafeErrorLogFields } from "../../shared/logging.js";
const credentialsSchema = z.object({
    email: z.string().min(3).max(254),
    password: z.string().min(8).max(256),
});
const verifySchema = z.object({ token: z.string().min(32).max(512) });
const loginSchema = credentialsSchema
    .extend({
    appInstallationId: z.string().min(1).max(128),
    platform: z.enum(["ANDROID", "IOS", "WEB"]).optional(),
    fcmToken: z.string().min(1).max(4096).optional(),
})
    .superRefine((value, context) => {
    if (value.fcmToken !== undefined && value.platform === undefined) {
        context.addIssue({
            code: "custom",
            path: ["platform"],
            message: "Platform is required with fcmToken",
        });
    }
});
const refreshSchema = z.object({ refreshToken: z.string().min(32).max(512) });
const resetRequestSchema = z.object({ email: z.string().min(3).max(254) });
const resetConsumeSchema = z.object({
    token: z.string().min(32).max(512),
    newPassword: z.string().min(8).max(256),
});
export const authRoutes = async (app, options) => {
    app.post("/signup", async (request, reply) => {
        const parsed = credentialsSchema.safeParse(request.body);
        if (!parsed.success)
            throw new AccountAuthError("Invalid request", 400);
        const account = await registerAccount(app.prisma, parsed.data);
        const verification = await issueVerificationToken(app.prisma, account.id);
        try {
            await options.emailSender.sendVerification({
                email: account.emailNormalized,
                token: verification.plaintext,
                expiresAt: verification.expiresAt,
            });
        }
        catch (error) {
            request.log.error(getSafeErrorLogFields(error), "Verification email delivery failed");
            if (error instanceof EmailDeliveryError &&
                error.deliveryOutcome === "not-sent") {
                try {
                    await cleanupPendingSignup(app.prisma, account.id, verification.plaintext);
                }
                catch (cleanupError) {
                    request.log.error(getSafeErrorLogFields(cleanupError), "Pending signup cleanup failed");
                }
            }
            throw error;
        }
        return reply.code(201).send({
            data: { accountId: account.id, status: account.status },
            meta: { requestId: request.id },
        });
    });
    app.post("/verify-email", async (request, reply) => {
        const parsed = verifySchema.safeParse(request.body);
        if (!parsed.success)
            throw new AccountAuthError("Invalid request", 401);
        await consumeVerificationToken(app.prisma, parsed.data.token);
        return reply.send({
            data: { verified: true },
            meta: { requestId: request.id },
        });
    });
    app.post("/password-reset/request", async (request, reply) => {
        const parsed = resetRequestSchema.safeParse(request.body);
        if (!parsed.success)
            throw new AccountAuthError("Invalid request", 400);
        const allowed = await options.passwordResetRateLimiter.allow({
            key: parsed.data.email,
            source: request.ip,
        });
        if (!allowed)
            throw new AccountAuthError("Too many requests", 429);
        const issued = await issuePasswordResetToken(app.prisma, parsed.data.email);
        if (issued) {
            try {
                await options.emailSender.sendPasswordReset({
                    email: issued.account.emailNormalized,
                    token: issued.token.plaintext,
                    expiresAt: issued.token.expiresAt,
                });
            }
            catch (error) {
                request.log.error(getSafeErrorLogFields(error), "Password reset email delivery failed");
            }
        }
        return reply
            .code(202)
            .send({ data: { accepted: true }, meta: { requestId: request.id } });
    });
    app.post("/password-reset/consume", async (request, reply) => {
        const parsed = resetConsumeSchema.safeParse(request.body);
        if (!parsed.success)
            throw new AccountAuthError("Invalid request", 400);
        await consumePasswordResetToken(app.prisma, parsed.data.token, parsed.data.newPassword, new Date(), request.id);
        return reply.send({
            data: { reset: true },
            meta: { requestId: request.id },
        });
    });
    app.post("/login", async (request, reply) => {
        const parsed = loginSchema.safeParse(request.body);
        if (!parsed.success)
            throw new AccountAuthError("Invalid credentials", 401);
        const loginAllowed = await options.loginRateLimiter.allow({
            key: normalizeEmail(parsed.data.email),
            source: request.ip,
        });
        if (!loginAllowed)
            throw new AccountAuthError("Too many requests", 429);
        const account = await authenticateAccount(app.prisma, parsed.data);
        if (account.emailVerifiedAt === null) {
            throw new AccountAuthError("Email verification required", 403);
        }
        const installation = await app.prisma.appInstallation.findUnique({
            where: { id: parsed.data.appInstallationId },
            select: { id: true, accountId: true, status: true },
        });
        if (installation !== null && installation.accountId !== account.id) {
            throw new AccountAuthError("Invalid credentials", 401);
        }
        if (parsed.data.fcmToken === undefined &&
            installation !== null &&
            installation.status !== "ACTIVE") {
            throw new AccountAuthError("Installation registration requires platform and FCM token", 400);
        }
        if (parsed.data.fcmToken !== undefined ||
            parsed.data.platform !== undefined) {
            if (parsed.data.platform === undefined) {
                throw new AccountAuthError("Installation registration is unavailable", 503);
            }
            if (parsed.data.fcmToken !== undefined && options.fcmKeys === undefined) {
                throw new AccountAuthError("Installation registration is unavailable", 503);
            }
            const bootstrapped = await authenticateWithInstallation(app.prisma, { id: account.id, authVersion: account.authVersion }, {
                installationId: parsed.data.appInstallationId,
                platform: parsed.data.platform,
                ...(parsed.data.fcmToken === undefined
                    ? {}
                    : { fcmToken: parsed.data.fcmToken }),
            }, options.fcmKeys, options.signingKey, new Date(), request.id);
            return reply.send({
                data: {
                    accessToken: bootstrapped.accessToken,
                    refreshToken: bootstrapped.session.refreshToken,
                    expiresIn: 900,
                },
                meta: { requestId: request.id },
            });
        }
        if (installation === null || installation.status !== "ACTIVE") {
            throw new AccountAuthError("Installation registration requires platform and FCM token", 400);
        }
        const accessToken = await issueAccessToken({ accountId: account.id, authVersion: account.authVersion }, options.signingKey);
        const session = await createSession(app.prisma, {
            sessionId: randomUUID(),
            accountId: account.id,
            appInstallationId: installation.id,
        });
        return reply.send({
            data: { accessToken, refreshToken: session.refreshToken, expiresIn: 900 },
            meta: { requestId: request.id },
        });
    });
    app.post("/refresh", async (request, reply) => {
        const parsed = refreshSchema.safeParse(request.body);
        if (!parsed.success)
            throw new AccountAuthError("Invalid refresh token", 401);
        const session = await rotateRefreshSession(app.prisma, parsed.data.refreshToken, randomUUID(), new Date(), request.id);
        const current = await app.prisma.session.findUnique({
            where: { id: session.sessionId },
            select: { accountId: true },
        });
        if (current === null)
            throw new AccountAuthError("Invalid refresh token", 401);
        const account = await app.prisma.account.findUnique({
            where: { id: current.accountId },
            select: { authVersion: true, status: true },
        });
        if (account === null || account.status === "DISABLED")
            throw new AccountAuthError("Invalid refresh token", 401);
        const accessToken = await issueAccessToken({ accountId: current.accountId, authVersion: account.authVersion }, options.signingKey);
        return reply.send({
            data: { accessToken, refreshToken: session.refreshToken, expiresIn: 900 },
            meta: { requestId: request.id },
        });
    });
    app.post("/logout", async (request, reply) => {
        const parsed = refreshSchema.safeParse(request.body);
        if (!parsed.success)
            throw new AccountAuthError("Invalid refresh token", 401);
        await revokeRefreshSession(app.prisma, parsed.data.refreshToken, new Date(), request.id);
        return reply.send({
            data: { revoked: true },
            meta: { requestId: request.id },
        });
    });
};
