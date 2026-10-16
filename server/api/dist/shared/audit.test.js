import { describe, expect, it } from 'vitest';
import { sanitizeAuditMetadata, writeAuditEvent } from './audit.js';
describe('audit metadata', () => {
    it('keeps only allowlisted non-sensitive fields', () => {
        expect(sanitizeAuditMetadata({ status: 'ACTIVE', accountId: 'a1', password: 'secret', token: 'secret', arbitrary: 'drop' })).toEqual({ status: 'ACTIVE', accountId: 'a1' });
    });
    it('propagates audit persistence failures', async () => {
        const database = { auditEvent: { create: async () => { throw new Error('audit unavailable'); } } };
        await expect(writeAuditEvent(database, { actorType: 'ACCOUNT', actorId: 'a1', action: 'TEST', resourceType: 'TEST', resourceId: 'r1' })).rejects.toThrow('audit unavailable');
    });
});
