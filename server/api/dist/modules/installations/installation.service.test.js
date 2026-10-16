import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerInstallation, revokeInstallation } from './installation.service.js';
const keys = { activeVersion: 1, encryptionKeys: new Map([[1, randomBytes(32)]]), fingerprintKey: randomBytes(32) };
const record = { id: 'i1', accountId: 'a1', platform: 'ANDROID', status: 'ACTIVE', lastSeenAt: null, revokedAt: null, revokeReason: null };
function fakeDatabase() {
    return {
        appInstallation: {
            findUnique: async () => null,
            findFirst: async () => null,
            findMany: async () => [record],
            update: async () => record,
            updateMany: async () => ({ count: 0 }),
            create: async () => record,
        },
        session: { updateMany: async () => ({ count: 1 }) },
        auditEvent: { create: async () => ({}) },
        $transaction: async (callback) => callback(fakeDatabase()),
    };
}
describe('installation service', () => {
    it('does not return or persist plaintext token through the public record', async () => {
        const installation = await registerInstallation(fakeDatabase(), 'a1', { installationId: 'i1', platform: 'ANDROID', fcmToken: 'secret-token' }, keys);
        expect(installation).not.toHaveProperty('fcmToken');
        expect(installation).not.toHaveProperty('fcmTokenCiphertext');
    });
    it('revokes installation and linked sessions in one transaction', async () => {
        let transactionCalled = false;
        const db = fakeDatabase();
        db.appInstallation.findUnique = async () => record;
        db.$transaction = async (callback) => {
            transactionCalled = true;
            return callback(db);
        };
        await revokeInstallation(db, 'a1', 'i1');
        expect(transactionCalled).toBe(true);
    });
});
