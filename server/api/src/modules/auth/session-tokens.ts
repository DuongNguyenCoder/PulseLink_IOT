import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_BYTES = 32;
const TOKEN_FAMILY_BYTES = 16;

export interface OpaqueRefreshToken {
  plaintext: string;
  verifier: string;
}

export function generateRefreshToken(): OpaqueRefreshToken {
  const plaintext = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  return { plaintext, verifier: hashRefreshToken(plaintext) };
}

export function generateTokenFamilyId(): string {
  return randomBytes(TOKEN_FAMILY_BYTES).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
