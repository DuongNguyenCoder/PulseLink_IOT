import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
const PASSWORD_HASH_VERSION = 1;
const DEFAULT_SCRYPT = {
    cost: 16_384,
    blockSize: 8,
    parallelization: 1,
    keyLength: 32,
};
const SALT_BYTES = 16;
const MAX_SCRYPT_COST = 1 << 20;
const MAX_SCRYPT_BLOCK_SIZE = 32;
const MAX_SCRYPT_PARALLELIZATION = 16;
function deriveKey(password, salt, parameters) {
    return new Promise((resolve, reject) => {
        scryptCallback(password, salt, parameters.keyLength, {
            N: parameters.cost,
            r: parameters.blockSize,
            p: parameters.parallelization,
            maxmem: Math.max(32 * 1024 * 1024, 128 * parameters.cost * parameters.blockSize + 1024),
        }, (error, derivedKey) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(derivedKey);
        });
    });
}
function encode(value) {
    return value.toString('base64url');
}
function decode(value) {
    return Buffer.from(value, 'base64url');
}
function parsePositiveInteger(value, field) {
    if (!/^\d+$/.test(value)) {
        throw new Error(`Invalid scrypt ${field}`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid scrypt ${field}`);
    }
    return parsed;
}
function assertSafeParameters(parameters) {
    if (parameters.cost < 2 ||
        parameters.cost > MAX_SCRYPT_COST ||
        (parameters.cost & (parameters.cost - 1)) !== 0 ||
        parameters.blockSize < 1 ||
        parameters.blockSize > MAX_SCRYPT_BLOCK_SIZE ||
        parameters.parallelization < 1 ||
        parameters.parallelization > MAX_SCRYPT_PARALLELIZATION ||
        parameters.keyLength < 16 ||
        parameters.keyLength > 128) {
        throw new Error('Invalid scrypt parameters');
    }
}
function serializeHash(parameters, salt, derivedKey) {
    return [
        `scrypt-v${PASSWORD_HASH_VERSION}`,
        `n=${parameters.cost}`,
        `r=${parameters.blockSize}`,
        `p=${parameters.parallelization}`,
        `l=${parameters.keyLength}`,
        `s=${encode(salt)}`,
        `h=${encode(derivedKey)}`,
    ].join('$');
}
function parseHash(encodedHash) {
    const [version, ...parts] = encodedHash.split('$');
    if (version !== `scrypt-v${PASSWORD_HASH_VERSION}` || parts.length !== 6) {
        throw new Error('Unsupported password hash format');
    }
    const values = new Map();
    for (const part of parts) {
        const separator = part.indexOf('=');
        if (separator <= 0) {
            throw new Error('Invalid password hash format');
        }
        values.set(part.slice(0, separator), part.slice(separator + 1));
    }
    const parameters = {
        cost: parsePositiveInteger(values.get('n') ?? '', 'cost'),
        blockSize: parsePositiveInteger(values.get('r') ?? '', 'block size'),
        parallelization: parsePositiveInteger(values.get('p') ?? '', 'parallelization'),
        keyLength: parsePositiveInteger(values.get('l') ?? '', 'key length'),
    };
    assertSafeParameters(parameters);
    const salt = decode(values.get('s') ?? '');
    const derivedKey = decode(values.get('h') ?? '');
    if (salt.length < 16 || derivedKey.length !== parameters.keyLength) {
        throw new Error('Invalid password hash material');
    }
    return { parameters, salt, derivedKey };
}
export async function hashPassword(password, parameters = DEFAULT_SCRYPT) {
    if (password.length < 1) {
        throw new Error('Password must not be empty');
    }
    assertSafeParameters(parameters);
    const salt = randomBytes(SALT_BYTES);
    const derivedKey = await deriveKey(password, salt, parameters);
    return serializeHash(parameters, salt, derivedKey);
}
export async function verifyPassword(password, encodedHash) {
    try {
        const { parameters, salt, derivedKey } = parseHash(encodedHash);
        const candidate = await deriveKey(password, salt, parameters);
        return candidate.length === derivedKey.length && timingSafeEqual(candidate, derivedKey);
    }
    catch {
        return false;
    }
}
export function needsPasswordRehash(encodedHash) {
    try {
        const { parameters } = parseHash(encodedHash);
        return (parameters.cost !== DEFAULT_SCRYPT.cost ||
            parameters.blockSize !== DEFAULT_SCRYPT.blockSize ||
            parameters.parallelization !== DEFAULT_SCRYPT.parallelization ||
            parameters.keyLength !== DEFAULT_SCRYPT.keyLength);
    }
    catch {
        return true;
    }
}
