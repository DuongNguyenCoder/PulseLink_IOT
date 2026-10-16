import { describe, expect, it } from 'vitest';
import { createStoreForOwner, getStoreForMember, updateStoreMetadata } from './store.service.js';
function storeRecord(overrides = {}) {
    return {
        id: 'store-1', name: 'Cafe', slug: 'cafe', timezone: 'Asia/Ho_Chi_Minh', isActive: true,
        createdAt: new Date(), updatedAt: new Date(), ...overrides,
    };
}
function fakeDatabase(overrides = {}) {
    const store = storeRecord();
    return {
        account: { findUnique: async () => ({ status: 'ACTIVE', emailVerifiedAt: new Date() }) },
        store: {
            create: async () => store,
            findMany: async () => [store],
            findUnique: async () => store,
            update: async () => store,
        },
        storeMembership: {
            findFirst: async () => ({ id: 'membership-1', accountId: 'account-1', storeId: store.id, role: 'OWNER', status: 'ACTIVE' }),
            create: async () => ({ id: 'membership-1', accountId: 'account-1', storeId: store.id, role: 'OWNER', status: 'ACTIVE' }),
        },
        auditEvent: { create: async () => ({}) },
        $transaction: async (callback) => callback(fakeDatabase()),
        ...overrides,
    };
}
describe('store service authorization', () => {
    it('creates the Store and Owner membership inside one transaction', async () => {
        let transactionCalled = false;
        const db = fakeDatabase({
            $transaction: async (callback) => {
                transactionCalled = true;
                return callback(fakeDatabase());
            },
        });
        const store = await createStoreForOwner(db, 'account-1', { name: 'Cafe', slug: 'cafe' });
        expect(transactionCalled).toBe(true);
        expect(store.slug).toBe('cafe');
    });
    it('denies a non-member without revealing the Store', async () => {
        const db = fakeDatabase({ storeMembership: { findFirst: async () => null, create: async () => { throw new Error('unused'); } } });
        await expect(getStoreForMember(db, 'account-2', 'store-1')).rejects.toMatchObject({ statusCode: 404 });
    });
    it('requires an active Owner to update metadata', async () => {
        const db = fakeDatabase({
            storeMembership: { findFirst: async () => ({ id: 'm', accountId: 'account-1', storeId: 'store-1', role: 'STAFF', status: 'ACTIVE' }), create: async () => { throw new Error('unused'); } },
        });
        await expect(updateStoreMetadata(db, 'account-1', 'store-1', { name: 'New name' })).rejects.toMatchObject({ statusCode: 403 });
    });
});
