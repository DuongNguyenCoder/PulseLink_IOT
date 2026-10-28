import type { FastifyPluginAsync } from "fastify";
import type { KeyInput } from "jose";
import { z } from "zod";
import { createAuthenticationHook } from "../auth/auth-hook.js";
import {
  DeviceAuthorizationError,
  createDeviceForOwner,
  listDevicesForOwner,
} from "./device.service.js";

const storeParams = z.object({ storeId: z.string().min(1).max(128) });
const createDeviceBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    firmwareVersion: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export interface DeviceRouteOptions {
  verificationKeys: ReadonlyMap<string, KeyInput>;
}

function accountId(request: { auth?: { accountId: string } }): string {
  if (request.auth === undefined)
    throw new DeviceAuthorizationError("Authentication required", 401);
  return request.auth.accountId;
}

function parseParams(request: { params: unknown }): { storeId: string } {
  const parsed = storeParams.safeParse(request.params);
  if (!parsed.success)
    throw new DeviceAuthorizationError("Invalid request", 400);
  return parsed.data;
}

export const deviceRoutes: FastifyPluginAsync<DeviceRouteOptions> = async (
  app,
  options,
) => {
  app.addHook("preHandler", createAuthenticationHook(options.verificationKeys));

  app.post("/:storeId/devices", async (request, reply) => {
    const params = parseParams(request);
    const body = createDeviceBody.safeParse(request.body);
    if (!body.success)
      throw new DeviceAuthorizationError("Invalid request", 400);
    const device = await createDeviceForOwner(
      app.prisma as never,
      accountId(request),
      params.storeId,
      body.data,
      request.id,
    );
    return reply
      .code(201)
      .send({ data: device, meta: { requestId: request.id } });
  });

  app.get("/:storeId/devices", async (request, reply) => {
    const params = parseParams(request);
    const devices = await listDevicesForOwner(
      app.prisma as never,
      accountId(request),
      params.storeId,
    );
    return reply.send({ data: devices, meta: { requestId: request.id } });
  });
};
