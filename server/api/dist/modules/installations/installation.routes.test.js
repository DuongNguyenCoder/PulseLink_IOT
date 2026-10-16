import Fastify from 'fastify';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { mapErrorToApiResponse } from '../../shared/error-contract.js';
import { installationRoutes } from './installation.routes.js';
describe('installation routes', () => {
    it('requires authentication before installation access', async () => {
        const app = Fastify();
        app.decorate('prisma', {});
        app.setErrorHandler((error, request, reply) => {
            const mapped = mapErrorToApiResponse(error, request.id);
            return reply.code(mapped.statusCode).send(mapped.response);
        });
        await app.register(installationRoutes, {
            verificationKeys: new Map(),
            fcmKeys: { activeVersion: 1, encryptionKeys: new Map([[1, randomBytes(32)]]), fingerprintKey: randomBytes(32) },
        });
        const response = await app.inject({ method: 'GET', url: '/' });
        expect(response.statusCode).toBe(401);
        expect(response.json().error.code).toBe('UNAUTHENTICATED');
        await app.close();
    });
});
