import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalProvisioningPayload,
  canonicalDeviceEnrollmentPayload,
  canonicalDeviceClaimPayload,
  hashBootstrapValue,
  hashChallenge,
  isSupportedEnrollmentPublicKey,
  verifyEnrollmentSignature,
  verifyDeviceEnrollmentProof,
  verifyDeviceClaimProof,
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

  it('verifies a short-lived device-bound enrollment proof and rejects mutation or expiry', () => {
    const now = new Date('2026-10-28T10:00:00.000Z');
    const proofBody = {
      publicKeySpkiBase64,
      keyVersion: 3,
      challenge: randomBytes(32).toString('base64url'),
      expiresAt: Math.floor(now.getTime() / 1000) + 120,
    };
    const proof = {
      ...proofBody,
      signatureDerBase64: sign(
        'sha256',
        canonicalDeviceEnrollmentPayload({ deviceKey: 'device-enrollment-1', proof: proofBody }),
        { key: privateKey, dsaEncoding: 'der' },
      ).toString('base64'),
    };

    expect(verifyDeviceEnrollmentProof({ deviceKey: 'device-enrollment-1', proof, now })).toBe(true);
    expect(verifyDeviceEnrollmentProof({ deviceKey: 'other-device', proof, now })).toBe(false);
    expect(verifyDeviceEnrollmentProof({
      deviceKey: 'device-enrollment-1',
      proof: { ...proof, challenge: randomBytes(32).toString('base64url') },
      now,
    })).toBe(false);
    expect(verifyDeviceEnrollmentProof({
      deviceKey: 'device-enrollment-1',
      proof: { ...proof, expiresAt: Math.floor(now.getTime() / 1000) - 1 },
      now,
    })).toBe(false);
    expect(verifyDeviceEnrollmentProof({
      deviceKey: 'device-enrollment-1',
      proof: { ...proof, signatureDerBase64: Buffer.from('tampered').toString('base64') },
      now,
    })).toBe(false);
  });

  it('binds first-claim proof to Device, Store, challenge, session and expiry', () => {
    const now = new Date('2026-10-29T03:00:00.000Z');
    const proofBody = {
      publicKeySpkiBase64,
      keyVersion: 1,
      challenge: randomBytes(32).toString('base64url'),
      expiresAt: Math.floor(now.getTime() / 1000) + 120,
    };
    const signatureDerBase64 = sign('sha256', canonicalDeviceClaimPayload({
      deviceId: 'pl-0123456789ab', storeId: 'store-1', claimSessionId: 'claim-1', proof: proofBody,
    }), { key: privateKey, dsaEncoding: 'der' }).toString('base64');
    const proof = { ...proofBody, signatureDerBase64 };
    const context = { deviceId: 'pl-0123456789ab', storeId: 'store-1', claimSessionId: 'claim-1', proof, now };
    expect(verifyDeviceClaimProof(context)).toBe(true);
    expect(verifyDeviceClaimProof({ ...context, deviceId: 'pl-0123456789ac' })).toBe(false);
    expect(verifyDeviceClaimProof({ ...context, storeId: 'store-2' })).toBe(false);
    expect(verifyDeviceClaimProof({ ...context, claimSessionId: 'other' })).toBe(false);
    expect(verifyDeviceClaimProof({ ...context, proof: { ...proof, expiresAt: proof.expiresAt + 1 } })).toBe(false);
  });

  it('matches the C and Android shared first-claim transcript fixture byte-for-byte', () => {
    const payload = canonicalDeviceClaimPayload({
      deviceId: 'pl-0123456789ab',
      storeId: 'store-vector-1',
      claimSessionId: 'claim-vector-1',
      proof: {
        keyVersion: 1,
        publicKeySpkiBase64: 'c3BraS1wdWJsaWMta2V5',
        challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        expiresAt: 2_000_000_000,
      },
    });
    const fixture = readFileSync(resolve(process.cwd(), '../../firmware/esp32/tests/fixtures/device_claim_v1.hex'), 'utf8').trim();
    expect(payload.toString('hex')).toBe(fixture);
  });
});
