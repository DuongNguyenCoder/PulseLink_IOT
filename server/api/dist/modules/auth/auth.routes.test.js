import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { authRoutes } from './auth.routes.js';
import { mapErrorToApiResponse } from '../../shared/error-contract.js';
function createFakePrisma() {
    const account = {
        id: 'account-1',
        emailNormalized: 'owner@example.com',
        passwordHash: 'unused',
        status: 'PENDING',
        emailVerifiedAt: null,
        authVersion: 0,
    };
    return {
        account: {
            create: async () => account,
        },
        accountToken: {
            create: async () => ({ id: 'token-1' }),
        },
    };
}
describe('authentication route contracts', () => {
    it('validates signup input and returns the stable error shape', async () => {
        const app = Fastify({ logger: false });
        app.decorate('prisma', createFakePrisma());
        app.setErrorHandler((error, request, reply) => {
            const mapped = mapErrorToApiResponse(error, request.id);
            return reply.code(mapped.statusCode).send(mapped.response);
        });
        await app.register(authRoutes, {
            emailSender: { sendVerification: async () => undefined, sendPasswordReset: async () => undefined },
            signingKey: { kid: 'unused', privateKeyPem: 'unused' },
            passwordResetRateLimiter: { allow: async () => true },
            prefix: '/v1/auth',
        });
        const response = await app.inject({
            method: 'POST',
            url: '/v1/auth/signup',
            payload: { email: 'not-an-email', password: 'short' },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
            error: { code: 'BAD_REQUEST', message: 'Bad request' },
        });
        await app.close();
    });
    it('returns a stable signup response after persistence and email dispatch', async () => {
        const app = Fastify({ logger: false });
        app.decorate('prisma', createFakePrisma());
        await app.register(authRoutes, {
            emailSender: { sendVerification: async () => undefined, sendPasswordReset: async () => undefined },
            signingKey: { kid: 'unused', privateKeyPem: 'unused' },
            passwordResetRateLimiter: { allow: async () => true },
            prefix: '/v1/auth',
        });
        const response = await app.inject({
            method: 'POST',
            url: '/v1/auth/signup',
            payload: { email: 'Owner@example.com', password: 'a sufficiently long password' },
        });
        expect(response.statusCode).toBe(201);
        expect(response.json()).toMatchObject({ data: { accountId: 'account-1', status: 'PENDING' } });
        expect(response.json().data).not.toHaveProperty('password');
        await app.close();
    });
});
