import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface FcmKeyMaterial {
  activeVersion: number;
  encryptionKeys: ReadonlyMap<number, Buffer>;
  fingerprintKey: Buffer;
}

function assertKey(key: Buffer, name: string): void {
  if (key.length !== KEY_BYTES) throw new Error(`${name} must be 32 bytes`);
}

function encode(value: Buffer): string {
  return value.toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export function encryptFcmToken(token: string, material: FcmKeyMaterial): string {
  const key = material.encryptionKeys.get(material.activeVersion);
  if (key === undefined) throw new Error('Active FCM encryption key is unavailable');
  assertKey(key, 'FCM encryption key');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `${material.activeVersion}.${encode(iv)}.${encode(ciphertext)}.${encode(cipher.getAuthTag())}`;
}

export function decryptFcmToken(envelope: string, material: FcmKeyMaterial): string {
  const [versionText, ivText, ciphertextText, tagText] = envelope.split('.');
  const version = Number(versionText);
  const key = material.encryptionKeys.get(version);
  if (!Number.isSafeInteger(version) || key === undefined || ivText === undefined || ciphertextText === undefined || tagText === undefined) {
    throw new Error('FCM ciphertext cannot be decrypted');
  }
  assertKey(key, 'FCM encryption key');
  try {
    const decipher = createDecipheriv(ALGORITHM, key, decode(ivText));
    decipher.setAuthTag(decode(tagText));
    return Buffer.concat([decipher.update(decode(ciphertextText)), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('FCM ciphertext cannot be decrypted');
  }
}

export function fingerprintFcmToken(token: string, material: FcmKeyMaterial): string {
  assertKey(material.fingerprintKey, 'FCM fingerprint key');
  return createHmac('sha256', material.fingerprintKey).update(token, 'utf8').digest('hex');
}
