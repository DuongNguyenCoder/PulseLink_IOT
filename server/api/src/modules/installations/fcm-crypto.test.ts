import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptFcmToken, encryptFcmToken, fingerprintFcmToken, type FcmKeyMaterial } from './fcm-crypto.js';

const keys: FcmKeyMaterial = {
  activeVersion: 1,
  encryptionKeys: new Map([[1, randomBytes(32)], [2, randomBytes(32)]]),
  fingerprintKey: randomBytes(32),
};

describe('FCM token cryptography', () => {
  it('encrypts and decrypts with authenticated encryption', () => {
    const ciphertext = encryptFcmToken('fcm-token', keys);
    expect(ciphertext).not.toContain('fcm-token');
    expect(decryptFcmToken(ciphertext, keys)).toBe('fcm-token');
  });

  it('detects ciphertext tampering and wrong key versions', () => {
    const ciphertext = encryptFcmToken('fcm-token', keys);
    const parts = ciphertext.split('.');
    parts[2] = `${parts[2].slice(0, -1)}${parts[2].endsWith('A') ? 'B' : 'A'}`;
    expect(() => decryptFcmToken(parts.join('.'), keys)).toThrow();
    expect(() => decryptFcmToken(ciphertext, { ...keys, encryptionKeys: new Map([[1, randomBytes(32)]]) })).toThrow();
  });

  it('produces a stable keyed fingerprint without using ciphertext', () => {
    expect(fingerprintFcmToken('same-token', keys)).toBe(fingerprintFcmToken('same-token', keys));
    expect(fingerprintFcmToken('same-token', keys)).not.toBe(fingerprintFcmToken('other-token', keys));
  });
});
