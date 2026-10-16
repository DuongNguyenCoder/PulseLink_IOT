import { z } from 'zod';
import { createAuthenticationHook } from '../auth/auth-hook.js';
import { StoreAuthorizationError, createStoreForOwner, getStoreForMember, listActiveStores, updateStoreMetadata } from './store.service.js';
const storeIdParams = z.object({ storeId: z.string().min(1).max(128) });
const createStoreBody = z.object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    timezone: z.string().trim().min(1).max(60).optional(),
});
const updateStoreBody = createStoreBody.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
function currentAccountId(request) {
    if (request.auth === undefined)
        throw new StoreAuthorizationError('Authentication required', 401);
    return request.auth.accountId;
}
export const storeRoutes = async (app, options) => {
    app.addHook('preHandler', createAuthenticationHook(options.verificationKeys));
    app.post('/', async (request, reply) => {
        const parsed = createStoreBody.safeParse(request.body);
        if (!parsed.success)
            throw new StoreAuthorizationError('Invalid request', 400);
        const store = await createStoreForOwner(app.prisma, currentAccountId(request), parsed.data, request.id);
        return reply.code(201).send({ data: store, meta: { requestId: request.id } });
    });
    app.get('/', async (request, reply) => {
        const stores = await listActiveStores(app.prisma, currentAccountId(request));
        return reply.send({ data: stores, meta: { requestId: request.id } });
    });
    app.get('/:storeId', async (request, reply) => {
        const params = storeIdParams.safeParse(request.params);
        if (!params.success)
            throw new StoreAuthorizationError('Invalid request', 400);
        const store = await getStoreForMember(app.prisma, currentAccountId(request), params.data.storeId);
        return reply.send({ data: store, meta: { requestId: request.id } });
    });
    app.patch('/:storeId', async (request, reply) => {
        const params = storeIdParams.safeParse(request.params);
        const body = updateStoreBody.safeParse(request.body);
        if (!params.success || !body.success)
            throw new StoreAuthorizationError('Invalid request', 400);
        const store = await updateStoreMetadata(app.prisma, currentAccountId(request), params.data.storeId, body.data, request.id);
        return reply.send({ data: store, meta: { requestId: request.id } });
    });
};
