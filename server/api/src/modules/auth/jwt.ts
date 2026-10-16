import { randomUUID } from 'node:crypto';
import {
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type KeyInput,
  type JWTPayload,
} from 'jose';

export const JWT_ISSUER = 'pulselink-api';
export const JWT_AUDIENCE = 'pulselink-app';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const JWT_ALGORITHM = 'RS256' as const;

export interface SigningKeyMaterial {
  kid: string;
  privateKeyPem: string;
}

export interface VerificationKeyMaterial {
  kid: string;
  publicKeyPem: string;
}

export interface AccessTokenSubject {
  accountId: string;
  authVersion: number;
}

export interface VerifiedAccessToken extends AccessTokenSubject {
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
  kid: string;
}

interface AccessTokenClaims extends JWTPayload {
  authVersion?: unknown;
}

export async function issueAccessToken(
  subject: AccessTokenSubject,
  keyMaterial: SigningKeyMaterial,
  now: Date = new Date(),
): Promise<string> {
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

export async function verifyAccessToken(
  token: string,
  verificationKeys: ReadonlyMap<string, KeyInput>,
  now: Date = new Date(),
): Promise<VerifiedAccessToken> {
  const header = decodeProtectedHeader(token);
  if (header.alg !== JWT_ALGORITHM || typeof header.kid !== 'string') {
    throw new Error('JWT algorithm or key id is invalid');
  }

  const verificationKey = verificationKeys.get(header.kid);
  if (!verificationKey) {
    throw new Error('JWT key id is unknown');
  }

  const { payload } = await jwtVerify<AccessTokenClaims>(token, verificationKey, {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    currentDate: now,
  });

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.jti !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    !Number.isInteger(payload.authVersion) ||
    (payload.authVersion as number) < 0
  ) {
    throw new Error('JWT claims are invalid');
  }

  return {
    accountId: payload.sub,
    authVersion: payload.authVersion as number,
    tokenId: payload.jti,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    kid: header.kid,
  };
}

export async function loadVerificationKey(
  keyMaterial: VerificationKeyMaterial,
): Promise<KeyInput> {
  if (!keyMaterial.kid || !keyMaterial.publicKeyPem) {
    throw new Error('JWT verification key material is incomplete');
  }
  return importSPKI(keyMaterial.publicKeyPem, JWT_ALGORITHM);
}

function decodeProtectedHeader(token: string): { alg?: unknown; kid?: unknown } {
  const encodedHeader = token.split('.')[0];
  if (!encodedHeader) {
    throw new Error('JWT header is missing');
  }

  try {
    const decoded = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null) {
      throw new Error('JWT header is invalid');
    }
    return decoded as { alg?: unknown; kid?: unknown };
  } catch {
    throw new Error('JWT header is invalid');
  }
}
