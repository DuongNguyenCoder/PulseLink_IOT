import { performance } from "node:perf_hooks";
import { z } from "zod";
import { AccountAuthError, consumeVerificationToken, } from "./account.service.js";
import { getSafeErrorLogFields } from "../../shared/logging.js";
const tokenSchema = z.string().min(32).max(512);
const verificationCookie = "__Host-pulselink-email-verification";
const cookieMaxAgeSeconds = 15 * 60;
export function registerVerificationFormParser(app) {
    app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 }, (_request, body, done) => done(null, body));
}
function page(title, message, action) {
    const button = action === undefined
        ? ""
        : `<form method="post" action="/verify-email/complete"><button type="submit">${action}</button></form>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Cache-Control" content="no-store"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p>${button}</main></body></html>`;
}
function responseHeaders(reply) {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function readCookie(header, name) {
    for (const item of header?.split(";") ?? []) {
        const separator = item.indexOf("=");
        if (separator < 0)
            continue;
        const key = item.slice(0, separator).trim();
        if (key === name) {
            try {
                return decodeURIComponent(item.slice(separator + 1).trim());
            }
            catch {
                return null;
            }
        }
    }
    return null;
}
function clearCookie(reply) {
    reply.header("Set-Cookie", `${verificationCookie}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`);
}
export const emailVerificationRoutes = async (app) => {
    app.get("/verify-email", async (request, reply) => {
        const receivedAt = performance.now();
        request.log.info("email_verification.request.received");
        const query = request.query;
        const parsed = tokenSchema.safeParse(query.token);
        responseHeaders(reply);
        if (!parsed.success) {
            request.log.info({
                durationMs: Math.round(performance.now() - receivedAt),
                outcome: "invalid",
            }, "email_verification.failed");
            return reply
                .code(400)
                .type("text/html; charset=utf-8")
                .send(page("Verification link unavailable", "This verification link is missing or invalid. Request a new account verification email."));
        }
        reply.header("Set-Cookie", `${verificationCookie}=${encodeURIComponent(parsed.data)}; Max-Age=${cookieMaxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`);
        request.log.info({
            durationMs: Math.round(performance.now() - receivedAt),
            outcome: "success",
            tokenPurpose: "EMAIL_VERIFICATION",
        }, "email_verification.link_generation.completed");
        return reply
            .type("text/html; charset=utf-8")
            .send(page("Verify your PulseLink email", "Your verification link is ready. Continue only if you initiated this request.", "Verify email"));
    });
    app.post("/verify-email/complete", async (request, reply) => {
        const startedAt = performance.now();
        responseHeaders(reply);
        const token = readCookie(request.headers.cookie, verificationCookie);
        if (token === null || !tokenSchema.safeParse(token).success) {
            request.log.info({
                durationMs: Math.round(performance.now() - startedAt),
                outcome: "invalid",
                tokenPurpose: "EMAIL_VERIFICATION",
            }, "email_verification.failed");
            clearCookie(reply);
            return reply
                .code(400)
                .type("text/html; charset=utf-8")
                .send(page("Verification link unavailable", "This verification link is missing or invalid. Request a new account verification email."));
        }
        request.log.info("email_verification.token_validation.started");
        try {
            await consumeVerificationToken(app.prisma, token);
            request.log.info({
                durationMs: Math.round(performance.now() - startedAt),
                outcome: "success",
                tokenPurpose: "EMAIL_VERIFICATION",
            }, "email_verification.completed");
            clearCookie(reply);
            return reply
                .type("text/html; charset=utf-8")
                .send(page("Email verified", "Your PulseLink account is verified. You can close this page and sign in in the app."));
        }
        catch (error) {
            request.log.info({
                durationMs: Math.round(performance.now() - startedAt),
                outcome: error instanceof AccountAuthError ? "invalid" : "failure",
                tokenPurpose: "EMAIL_VERIFICATION",
            }, "email_verification.failed");
            request.log.error(getSafeErrorLogFields(error), "Email verification request failed");
            clearCookie(reply);
            const status = error instanceof AccountAuthError ? 400 : 503;
            return reply
                .code(status)
                .type("text/html; charset=utf-8")
                .send(page("Verification unsuccessful", error instanceof AccountAuthError
                ? "This verification link is invalid, expired, or has already been used."
                : "Verification is temporarily unavailable. Please try again later."));
        }
    });
};
