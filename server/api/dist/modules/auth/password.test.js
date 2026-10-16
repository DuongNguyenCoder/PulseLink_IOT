import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './email.js';
import { hashPassword, needsPasswordRehash, verifyPassword } from './password.js';
describe('email normalization', () => {
    it('normalizes surrounding whitespace and casing consistently', () => {
        expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
    });
    it('rejects malformed or oversized input', () => {
        expect(() => normalizeEmail('not-an-email')).toThrow();
        expect(() => normalizeEmail(`${'a'.repeat(253)}@x`)).toThrow();
    });
});
describe('scrypt password hashes', () => {
    it('stores parameters and verifies only the original password', async () => {
        const encodedHash = await hashPassword('correct horse battery staple');
        expect(encodedHash).toMatch(/^scrypt-v1\$n=16384\$r=8\$p=1\$l=32\$/);
        expect(encodedHash).not.toContain('correct horse');
        await expect(verifyPassword('correct horse battery staple', encodedHash)).resolves.toBe(true);
        await expect(verifyPassword('wrong password', encodedHash)).resolves.toBe(false);
        expect(needsPasswordRehash(encodedHash)).toBe(false);
    });
    it('fails closed for malformed or unsupported hashes', async () => {
        await expect(verifyPassword('anything', 'not-a-password-hash')).resolves.toBe(false);
        expect(needsPasswordRehash('not-a-password-hash')).toBe(true);
    });
});
