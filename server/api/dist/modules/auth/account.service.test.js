import { describe, expect, it } from 'vitest';
import { authenticateAccount, consumeVerificationToken, issueVerificationToken, registerAccount, } from './account.service.js';
const account = {
    id: 'account-1',
    emailNormalized: 'owner@example.com',
    passwordHash: '',
    status: 'PENDING',
    emailVerifiedAt: null,
    authVersion: 0,
};
function persistence() {
    const state = { value: { ...account }, token: null, consumed: 0 };
    const db = {
        account: {
            create: async ({ data }) => ({ ...state.value, ...data, id: 'account-new' }),
            findUnique: async () => state.value,
            update: async ({ data }) => (state.value = { ...state.value, ...data }),
        },
        accountToken: {
            create: async ({ data }) => {
                state.token = { id: 'token-1', accountId: data.accountId, expiresAt: data.expiresAt, consumedAt: null, revokedAt: null };
                return state.token;
            },
            findFirst: async () => state.token,
            updateMany: async () => {
                state.consumed += 1;
                if (state.token)
                    state.token.consumedAt = new Date();
                return { count: 1 };
            },
        },
        $transaction: async (callback) => callback(db),
    };
    return { value: state.value, token: state.token, consumed: state.consumed, db };
}
describe('account authentication service', () => {
    it('normalizes and hashes registration credentials', async () => {
        const fake = persistence();
        const created = await registerAccount(fake.db, { email: ' Owner@Example.com ', password: 'a sufficiently long password' });
        expect(created.emailNormalized).toBe('owner@example.com');
        expect(created.passwordHash).toMatch(/^scrypt-v1\$/);
    });
    it('authenticates the original password and rejects an incorrect password', async () => {
        const fake = persistence();
        fake.db.account.findUnique = async () => ({
            ...account,
            passwordHash: await registerAccount(fake.db, { email: account.emailNormalized, password: 'correct password' }).then((value) => value.passwordHash),
        });
        await expect(authenticateAccount(fake.db, { email: account.emailNormalized, password: 'correct password' })).resolves.toBeTruthy();
        await expect(authenticateAccount(fake.db, { email: account.emailNormalized, password: 'wrong password' })).rejects.toMatchObject({ statusCode: 401 });
    });
    it('issues and consumes a single-use verification token', async () => {
        const fake = persistence();
        const issued = await issueVerificationToken(fake.db, account.id, new Date('2026-01-01T00:00:00.000Z'));
        const verified = await consumeVerificationToken(fake.db, issued.plaintext, new Date('2026-01-01T01:00:00.000Z'));
        expect(verified.status).toBe('ACTIVE');
        expect(verified.emailVerifiedAt).toEqual(new Date('2026-01-01T01:00:00.000Z'));
    });
});
