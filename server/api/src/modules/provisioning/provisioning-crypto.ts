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
    return Buffer.from(publicKeySpkiBase64, 'base64').toString('base64') === publicKeySpkiBase64
      && publicKey.asymmetricKeyType === 'ec'
      && publicKey.asymmetricKeyDetails?.namedCurve === 'prime256v1';
  } catch {
    return false;
  }
}

export interface DeviceEnrollmentProof {
  publicKeySpkiBase64: string;
  keyVersion: number;
  challenge: string;
  expiresAt: number;
  signatureDerBase64: string;
}

export function canonicalDeviceEnrollmentPayload(input: {
  deviceKey: string;
  proof: Omit<DeviceEnrollmentProof, 'signatureDerBase64'>;
}): Buffer {
  return Buffer.from([
    'pulselink-device-enrollment-v1',
    input.deviceKey,
    String(input.proof.keyVersion),
    input.proof.publicKeySpkiBase64,
    input.proof.challenge,
    String(input.proof.expiresAt),
  ].join('\n'), 'utf8');
}

export function verifyDeviceEnrollmentProof(input: {
  deviceKey: string;
  proof: DeviceEnrollmentProof;
  now?: Date;
}): boolean {
  try {
    const { proof } = input;
    const challengeBytes = Buffer.from(proof.challenge, 'base64url');
    const signature = Buffer.from(proof.signatureDerBase64, 'base64');
    const expiresAt = new Date(proof.expiresAt * 1000);
    const now = input.now ?? new Date();
    if (
      !Number.isSafeInteger(proof.keyVersion) || proof.keyVersion < 1 ||
      !Number.isSafeInteger(proof.expiresAt) ||
      challengeBytes.length !== 32 || challengeBytes.toString('base64url') !== proof.challenge ||
      signature.length < 8 || signature.length > 80 ||
      signature.toString('base64') !== proof.signatureDerBase64 ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= now.getTime() ||
      expiresAt.getTime() > now.getTime() + 5 * 60_000 ||
      !isSupportedEnrollmentPublicKey(proof.publicKeySpkiBase64)
    ) return false;

    const publicKey = createPublicKey({
      key: Buffer.from(proof.publicKeySpkiBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return verify(
      'sha256',
      canonicalDeviceEnrollmentPayload({ deviceKey: input.deviceKey, proof }),
      { key: publicKey, dsaEncoding: 'der' },
      signature,
    );
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
