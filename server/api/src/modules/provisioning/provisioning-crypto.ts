import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';

export const PROVISIONING_SIGNATURE_ALGORITHM = 'ECDSA_P256_SHA256_DER';

export function generateBootstrapValue(): string {
  return randomBytes(32).toString('base64url');
}

export function generateChallenge(): string {
  return randomBytes(32).toString('base64url');
}

export function hashBootstrapValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashChallenge(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalProvisioningPayload(input: {
  sessionId: string;
  deviceKey: string;
  challenge: string;
  expiresAt: Date;
}): Buffer {
  return Buffer.from([
    'pulselink-provisioning-v1',
    input.sessionId,
    input.deviceKey,
    input.challenge,
    String(Math.floor(input.expiresAt.getTime() / 1000)),
  ].join('\n'), 'utf8');
}

export function verifyEnrollmentSignature(input: {
  publicKeySpkiBase64: string;
  signatureDerBase64: string;
  sessionId: string;
  deviceKey: string;
  challenge: string;
  expiresAt: Date;
}): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(input.publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(
      'sha256',
      canonicalProvisioningPayload(input),
      { key: publicKey, dsaEncoding: 'der' },
      Buffer.from(input.signatureDerBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

export function isSupportedEnrollmentPublicKey(publicKeySpkiBase64: string): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return publicKey.asymmetricKeyType === 'ec'
      && publicKey.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateOperationalToken(): string {
  return randomBytes(32).toString('base64url');
}
