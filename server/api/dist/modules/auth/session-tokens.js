import { createHash, randomBytes } from 'node:crypto';
const REFRESH_TOKEN_BYTES = 32;
const TOKEN_FAMILY_BYTES = 16;
export function generateRefreshToken() {
    const plaintext = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    return { plaintext, verifier: hashRefreshToken(plaintext) };
}
export function generateTokenFamilyId() {
    return randomBytes(TOKEN_FAMILY_BYTES).toString('base64url');
}
export function hashRefreshToken(token) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}
