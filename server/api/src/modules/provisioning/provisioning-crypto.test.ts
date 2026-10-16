import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalProvisioningPayload,
  hashBootstrapValue,
  hashChallenge,
  isSupportedEnrollmentPublicKey,
  verifyEnrollmentSignature,
} from './provisioning-crypto.js';

describe('provisioning crypto contract', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpkiBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const input = {
    sessionId: 'session-1',
    deviceKey: 'device-1',
    challenge: 'challenge-value',
    expiresAt: new Date('2026-10-15T10:00:00.000Z'),
  };

  it('uses stable SHA-256 verifiers without storing plaintext', () => {
    expect(hashBootstrapValue('bootstrap-secret')).toHaveLength(64);
    expect(hashBootstrapValue('bootstrap-secret')).toBe(hashBootstrapValue('bootstrap-secret'));
    expect(hashChallenge('challenge-value')).not.toBe('challenge-value');
  });

  it('accepts only P-256 SPKI enrollment keys', () => {
    expect(isSupportedEnrollmentPublicKey(publicKeySpkiBase64)).toBe(true);
    expect(isSupportedEnrollmentPublicKey(Buffer.from('not-a-key').toString('base64'))).toBe(false);
  });

  it('verifies the canonical DER ECDSA signature and rejects replay/context changes', () => {
    const signature = sign('sha256', canonicalProvisioningPayload(input), { key: privateKey, dsaEncoding: 'der' }).toString('base64');
    expect(verifyEnrollmentSignature({ ...input, publicKeySpkiBase64, signatureDerBase64: signature })).toBe(true);
    expect(verifyEnrollmentSignature({ ...input, deviceKey: 'other-device', publicKeySpkiBase64, signatureDerBase64: signature })).toBe(false);
    expect(verifyEnrollmentSignature({ ...input, challenge: 'other-challenge', publicKeySpkiBase64, signatureDerBase64: signature })).toBe(false);
  });
});
