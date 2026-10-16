import { randomUUID } from 'node:crypto';
import { importPKCS8, importSPKI, jwtVerify, SignJWT, } from 'jose';
export const JWT_ISSUER = 'pulselink-api';
export const JWT_AUDIENCE = 'pulselink-app';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const JWT_ALGORITHM = 'RS256';
export async function issueAccessToken(subject, keyMaterial, now = new Date()) {
    if (!keyMaterial.kid || !keyMaterial.privateKeyPem) {
        throw new Error('JWT signing key material is incomplete');
    }
    if (!subject.accountId || !Number.isInteger(subject.authVersion) || subject.authVersion < 0) {
        throw new Error('JWT subject is invalid');
    }
    const privateKey = await importPKCS8(keyMaterial.privateKeyPem, JWT_ALGORITHM);
    const issuedAt = Math.floor(now.getTime() / 1000);
    return new SignJWT({ authVersion: subject.authVersion })
        .setProtectedHeader({ alg: JWT_ALGORITHM, kid: keyMaterial.kid, typ: 'JWT' })
        .setSubject(subject.accountId)
        .setIssuer(JWT_ISSUER)
        .setAudience(JWT_AUDIENCE)
        .setJti(randomUUID())
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
        .sign(privateKey);
}
export async function verifyAccessToken(token, verificationKeys, now = new Date()) {
    const header = decodeProtectedHeader(token);
    if (header.alg !== JWT_ALGORITHM || typeof header.kid !== 'string') {
        throw new Error('JWT algorithm or key id is invalid');
    }
    const verificationKey = verificationKeys.get(header.kid);
    if (!verificationKey) {
        throw new Error('JWT key id is unknown');
    }
    const { payload } = await jwtVerify(token, verificationKey, {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        currentDate: now,
    });
    if (typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string' ||
        typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' ||
        !Number.isInteger(payload.authVersion) ||
        payload.authVersion < 0) {
        throw new Error('JWT claims are invalid');
    }
    return {
        accountId: payload.sub,
        authVersion: payload.authVersion,
        tokenId: payload.jti,
        issuedAt: payload.iat,
        expiresAt: payload.exp,
        kid: header.kid,
    };
}
export async function loadVerificationKey(keyMaterial) {
    if (!keyMaterial.kid || !keyMaterial.publicKeyPem) {
        throw new Error('JWT verification key material is incomplete');
    }
    return importSPKI(keyMaterial.publicKeyPem, JWT_ALGORITHM);
}
function decodeProtectedHeader(token) {
    const encodedHeader = token.split('.')[0];
    if (!encodedHeader) {
        throw new Error('JWT header is missing');
    }
    try {
        const decoded = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
        if (typeof decoded !== 'object' || decoded === null) {
            throw new Error('JWT header is invalid');
        }
        return decoded;
    }
    catch {
        throw new Error('JWT header is invalid');
    }
}
