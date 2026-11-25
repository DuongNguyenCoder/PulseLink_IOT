import type { FastifyPluginAsync } from "fastify";
import type { KeyInput } from "jose";
import { z } from "zod";
import { createAuthenticationHook } from "../auth/auth-hook.js";
import {
  getNotificationSoundSettings,
  NotificationSoundError,
  updateNotificationSound,
} from "./notification-sound.service.js";

const updateBodySchema = z.object({
  soundId: z.string().trim().min(1).max(80),
});

export interface NotificationSoundRouteOptions {
  verificationKeys: ReadonlyMap<string, KeyInput>;
}

function requireAccountId(request: { auth?: { accountId: string } }): string {
  const accountId = request.auth?.accountId;
  if (accountId === undefined)
    throw new NotificationSoundError("Authentication required", 401);
  return accountId;
}

export const notificationSoundRoutes: FastifyPluginAsync<
  NotificationSoundRouteOptions
> = async (app, options) => {
  app.addHook("preHandler", createAuthenticationHook(options.verificationKeys));

  app.get("/notification-sounds", async (request, reply) => {
    const data = await getNotificationSoundSettings(
      app.prisma as never,
      requireAccountId(request),
    );
    return reply.send({ data, meta: { requestId: request.id } });
  });

  app.patch("/notification-sound", async (request, reply) => {
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success)
      throw new NotificationSoundError("Invalid request", 400);
    const data = await updateNotificationSound(
      app.prisma as never,
      requireAccountId(request),
      parsed.data.soundId,
    );
    return reply.send({ data, meta: { requestId: request.id } });
  });
};
