import { assertCurrentAccountAccess, UnauthenticatedError } from './account-access.js';
import { verifyAccessToken } from './jwt.js';
export class AuthDependencyError extends Error {
    statusCode = 503;
    constructor() {
        super('Authentication dependency unavailable');
        this.name = 'AuthDependencyError';
    }
}
export function createAuthenticationHook(verificationKeys) {
    return async (request) => {
        const authorization = request.headers.authorization;
        if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization)) {
            throw new UnauthenticatedError();
        }
        const token = authorization.replace(/^Bearer\s+/i, '');
        let verified;
        try {
            verified = await verifyAccessToken(token, verificationKeys);
        }
        catch {
            throw new UnauthenticatedError();
        }
        try {
            await assertCurrentAccountAccess(request.server.prisma, verified);
        }
        catch (error) {
            if (error instanceof UnauthenticatedError)
                throw error;
            throw new AuthDependencyError();
        }
        request.auth = verified;
    };
}
