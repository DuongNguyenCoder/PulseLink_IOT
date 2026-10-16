import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { importSPKI } from 'jose';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_AUDIENCE,
  JWT_ISSUER,
  issueAccessToken,
  loadVerificationKey,
  verifyAccessToken,
} from './jwt.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('RS256 access tokens', () => {
  it('issues and verifies the approved claims and key id', async () => {
    const issuedAt = new Date('2026-10-13T12:00:00.000Z');
    const token = await issueAccessToken(
      { accountId: 'account-1', authVersion: 3 },
      { kid: 'key-2026-10', privateKeyPem },
      issuedAt,
    );
    const verificationKey = await loadVerificationKey({ kid: 'key-2026-10', publicKeyPem });
    const verified = await verifyAccessToken(
      token,
      new Map([['key-2026-10', verificationKey]]),
      issuedAt,
    );

    expect(verified).toMatchObject({
      accountId: 'account-1',
      authVersion: 3,
      kid: 'key-2026-10',
      issuedAt: Math.floor(issuedAt.getTime() / 1000),
      expiresAt: Math.floor(issuedAt.getTime() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
    });
    expect(JWT_ISSUER).toBe('pulselink-api');
    expect(JWT_AUDIENCE).toBe('pulselink-app');
  });

  it('rejects an unknown key id and an expired token', async () => {
    const issuedAt = new Date('2026-10-13T12:00:00.000Z');
    const token = await issueAccessToken(
      { accountId: 'account-1', authVersion: 0 },
      { kid: 'key-2026-10', privateKeyPem },
      issuedAt,
    );
    const verificationKey = await importSPKI(publicKeyPem, 'RS256');

    await expect(verifyAccessToken(token, new Map(), issuedAt)).rejects.toThrow();
    await expect(
      verifyAccessToken(token, new Map([['key-2026-10', verificationKey]]), new Date('2026-10-13T12:16:00.000Z')),
    ).rejects.toThrow();
  });
});
