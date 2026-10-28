import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
export const PROVISIONING_SIGNATURE_ALGORITHM = 'ECDSA_P256_SHA256_DER';
export function generateBootstrapValue() {
    return randomBytes(32).toString('base64url');
}
export function generateChallenge() {
    return randomBytes(32).toString('base64url');
}
export function hashBootstrapValue(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function hashChallenge(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function canonicalProvisioningPayload(input) {
    return Buffer.from([
        'pulselink-provisioning-v1',
        input.sessionId,
        input.deviceKey,
        input.challenge,
        String(Math.floor(input.expiresAt.getTime() / 1000)),
    ].join('\n'), 'utf8');
}
export function verifyEnrollmentSignature(input) {
    try {
        const publicKey = createPublicKey({
            key: Buffer.from(input.publicKeySpkiBase64, 'base64'),
            format: 'der',
            type: 'spki',
        });
        return verify('sha256', canonicalProvisioningPayload(input), { key: publicKey, dsaEncoding: 'der' }, Buffer.from(input.signatureDerBase64, 'base64'));
    }
    catch {
        return false;
    }
}
export function isSupportedEnrollmentPublicKey(publicKeySpkiBase64) {
    try {
        const publicKey = createPublicKey({
            key: Buffer.from(publicKeySpkiBase64, 'base64'),
            format: 'der',
            type: 'spki',
        });
        return Buffer.from(publicKeySpkiBase64, 'base64').toString('base64') === publicKeySpkiBase64
            && publicKey.asymmetricKeyType === 'ec'
            && publicKey.asymmetricKeyDetails?.namedCurve === 'prime256v1';
    }
    catch {
        return false;
    }
}
export function canonicalDeviceEnrollmentPayload(input) {
    return Buffer.from([
        'pulselink-device-enrollment-v1',
        input.deviceKey,
        String(input.proof.keyVersion),
        input.proof.publicKeySpkiBase64,
        input.proof.challenge,
        String(input.proof.expiresAt),
    ].join('\n'), 'utf8');
}
export function verifyDeviceEnrollmentProof(input) {
    try {
        const { proof } = input;
        const challengeBytes = Buffer.from(proof.challenge, 'base64url');
        const signature = Buffer.from(proof.signatureDerBase64, 'base64');
        const expiresAt = new Date(proof.expiresAt * 1000);
        const now = input.now ?? new Date();
        if (!Number.isSafeInteger(proof.keyVersion) || proof.keyVersion < 1 ||
            !Number.isSafeInteger(proof.expiresAt) ||
            challengeBytes.length !== 32 || challengeBytes.toString('base64url') !== proof.challenge ||
            signature.length < 8 || signature.length > 80 ||
            signature.toString('base64') !== proof.signatureDerBase64 ||
            !Number.isFinite(expiresAt.getTime()) ||
            expiresAt.getTime() <= now.getTime() ||
            expiresAt.getTime() > now.getTime() + 5 * 60_000 ||
            !isSupportedEnrollmentPublicKey(proof.publicKeySpkiBase64))
            return false;
        const publicKey = createPublicKey({
            key: Buffer.from(proof.publicKeySpkiBase64, 'base64'),
            format: 'der',
            type: 'spki',
        });
        return verify('sha256', canonicalDeviceEnrollmentPayload({ deviceKey: input.deviceKey, proof }), { key: publicKey, dsaEncoding: 'der' }, signature);
    }
    catch {
        return false;
    }
}
export function hashDeviceToken(token) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}
export function generateOperationalToken() {
    return randomBytes(32).toString('base64url');
}
