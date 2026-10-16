import type { FastifyPluginAsync } from 'fastify';
import type { KeyInput } from 'jose';
import { z } from 'zod';
import { createAuthenticationHook } from '../auth/auth-hook.js';
import { InstallationError, listInstallations, registerInstallation, revokeInstallation } from './installation.service.js';
import type { FcmKeyMaterial } from './fcm-crypto.js';

const registrationBody = z.object({
  installationId: z.string().min(1).max(128),
  platform: z.enum(['ANDROID', 'IOS', 'WEB']),
  fcmToken: z.string().min(1).max(4096),
});
const installationParams = z.object({ installationId: z.string().min(1).max(128) });

export interface InstallationRouteOptions {
  verificationKeys: ReadonlyMap<string, KeyInput>;
  fcmKeys: FcmKeyMaterial;
}

function accountId(request: { auth?: { accountId: string } }): string {
  if (request.auth === undefined) throw new InstallationError('Authentication required', 401);
  return request.auth.accountId;
}

function responseValue(value: { id: string; platform: string; status: string; lastSeenAt: Date | null; revokedAt: Date | null; revokeReason: string | null }) {
  return { id: value.id, platform: value.platform, status: value.status, lastSeenAt: value.lastSeenAt, revokedAt: value.revokedAt, revokeReason: value.revokeReason };
}

export const installationRoutes: FastifyPluginAsync<InstallationRouteOptions> = async (app, options) => {
  app.addHook('preHandler', createAuthenticationHook(options.verificationKeys));

  app.post('/', async (request, reply) => {
    const parsed = registrationBody.safeParse(request.body);
    if (!parsed.success) throw new InstallationError('Invalid request', 400);
    const installation = await registerInstallation(app.prisma, accountId(request), parsed.data, options.fcmKeys, new Date(), request.id);
    return reply.code(201).send({ data: responseValue(installation), meta: { requestId: request.id } });
  });

  app.get('/', async (request, reply) => {
    const installations = await listInstallations(app.prisma, accountId(request));
    return reply.send({ data: installations.map(responseValue), meta: { requestId: request.id } });
  });

  app.delete('/:installationId', async (request, reply) => {
    const parsed = installationParams.safeParse(request.params);
    if (!parsed.success) throw new InstallationError('Invalid request', 400);
    await revokeInstallation(app.prisma, accountId(request), parsed.data.installationId, new Date(), request.id);
    return reply.send({ data: { revoked: true }, meta: { requestId: request.id } });
  });
};
