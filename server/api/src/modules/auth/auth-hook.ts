import type { FastifyReply, FastifyRequest } from 'fastify';
import type { KeyInput } from 'jose';
import { assertCurrentAccountAccess, UnauthenticatedError } from './account-access.js';
import { verifyAccessToken, type VerifiedAccessToken } from './jwt.js';

export class AuthDependencyError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Authentication dependency unavailable');
    this.name = 'AuthDependencyError';
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: VerifiedAccessToken;
  }
}

export function createAuthenticationHook(
  verificationKeys: ReadonlyMap<string, KeyInput>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request): Promise<void> => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer\s+\S+$/i.test(authorization)) {
      throw new UnauthenticatedError();
    }

    const token = authorization.replace(/^Bearer\s+/i, '');
    let verified: VerifiedAccessToken;
    try {
      verified = await verifyAccessToken(token, verificationKeys);
    } catch {
      throw new UnauthenticatedError();
    }

    try {
      await assertCurrentAccountAccess(request.server.prisma, verified);
    } catch (error: unknown) {
      if (error instanceof UnauthenticatedError) throw error;
      throw new AuthDependencyError();
    }

    request.auth = verified;
  };
}
