import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { storeRoutes } from './store.routes.js';
import { mapErrorToApiResponse } from '../../shared/error-contract.js';
describe('store routes', () => {
    it('rejects unauthenticated Store requests before accessing persistence', async () => {
        const app = Fastify();
        app.decorate('prisma', {});
        app.setErrorHandler((error, request, reply) => {
            const mapped = mapErrorToApiResponse(error, request.id);
            return reply.code(mapped.statusCode).send(mapped.response);
        });
        await app.register(storeRoutes, { verificationKeys: new Map() });
        const response = await app.inject({ method: 'GET', url: '/' });
        expect(response.statusCode).toBe(401);
        expect(response.json().error.code).toBe('UNAUTHENTICATED');
        await app.close();
    });
});
