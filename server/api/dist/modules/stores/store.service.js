import { Prisma } from '../../generated/prisma/client.js';
import { writeAuditEvent } from '../../shared/audit.js';
export class StoreAuthorizationError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = 'StoreAuthorizationError';
        this.statusCode = statusCode;
    }
}
function isUniqueViolation(error) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
function publicStore(store) {
    return store;
}
async function assertAccountCanManageStore(db, accountId) {
    const account = await db.account.findUnique({
        where: { id: accountId },
        select: { status: true, emailVerifiedAt: true },
    });
    if (account === null || account.status === 'DISABLED') {
        throw new StoreAuthorizationError('Authentication required', 401);
    }
    if (account.status !== 'ACTIVE' || account.emailVerifiedAt === null) {
        throw new StoreAuthorizationError('Email verification required', 403);
    }
}
export async function requireStoreMembership(db, accountId, storeId, role) {
    const membership = await db.storeMembership.findFirst({
        where: { accountId, storeId, status: 'ACTIVE' },
        select: { id: true, accountId: true, storeId: true, role: true, status: true },
    });
    if (membership === null) {
        throw new StoreAuthorizationError('Resource not found', 404);
    }
    if (role !== undefined && membership.role !== role) {
        throw new StoreAuthorizationError('Access denied', 403);
    }
    return membership;
}
export async function createStoreForOwner(db, accountId, input, requestId) {
    await assertAccountCanManageStore(db, accountId);
    try {
        return await db.$transaction(async (tx) => {
            const store = await tx.store.create({ data: input });
            await tx.storeMembership.create({
                data: { accountId, storeId: store.id, role: 'OWNER', status: 'ACTIVE' },
            });
            await writeAuditEvent(tx, {
                actorType: 'ACCOUNT',
                actorId: accountId,
                action: 'STORE_CREATED',
                resourceType: 'STORE',
                resourceId: store.id,
                storeId: store.id,
                requestId,
                metadata: { accountId, role: 'OWNER', outcome: 'success' },
            });
            return publicStore(store);
        });
    }
    catch (error) {
        if (isUniqueViolation(error)) {
            throw new StoreAuthorizationError('Store slug already exists', 409);
        }
        throw error;
    }
}
export async function listActiveStores(db, accountId) {
    await assertAccountCanManageStore(db, accountId);
    return db.store.findMany({
        where: { isActive: true, memberships: { some: { accountId, status: 'ACTIVE' } } },
        orderBy: { createdAt: 'asc' },
    });
}
export async function getStoreForMember(db, accountId, storeId) {
    await assertAccountCanManageStore(db, accountId);
    await requireStoreMembership(db, accountId, storeId);
    const store = await db.store.findUnique({ where: { id: storeId } });
    if (store === null || !store.isActive)
        throw new StoreAuthorizationError('Resource not found', 404);
    return publicStore(store);
}
export async function updateStoreMetadata(db, accountId, storeId, input, requestId) {
    await assertAccountCanManageStore(db, accountId);
    await requireStoreMembership(db, accountId, storeId, 'OWNER');
    try {
        return await db.$transaction(async (tx) => {
            const store = await tx.store.update({ where: { id: storeId }, data: input });
            await writeAuditEvent(tx, {
                actorType: 'ACCOUNT',
                actorId: accountId,
                action: 'STORE_METADATA_UPDATED',
                resourceType: 'STORE',
                resourceId: storeId,
                storeId,
                requestId,
                metadata: { accountId, outcome: 'success' },
            });
            return store;
        });
    }
    catch (error) {
        if (isUniqueViolation(error))
            throw new StoreAuthorizationError('Store slug already exists', 409);
        throw error;
    }
}
