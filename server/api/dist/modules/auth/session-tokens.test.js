import { describe, expect, it } from 'vitest';
import { generateRefreshToken, generateTokenFamilyId, hashRefreshToken, } from './session-tokens.js';
describe('opaque refresh token primitives', () => {
    it('generates high-entropy tokens and stores only a deterministic verifier', () => {
        const first = generateRefreshToken();
        const second = generateRefreshToken();
        expect(first.plaintext).toHaveLength(43);
        expect(first.verifier).toMatch(/^[a-f0-9]{64}$/);
        expect(first.plaintext).not.toBe(first.verifier);
        expect(first.plaintext).not.toBe(second.plaintext);
        expect(hashRefreshToken(first.plaintext)).toBe(first.verifier);
    });
    it('generates independent token families', () => {
        expect(generateTokenFamilyId()).toHaveLength(22);
        expect(generateTokenFamilyId()).not.toBe(generateTokenFamilyId());
    });
});
