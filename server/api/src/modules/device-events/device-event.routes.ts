import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  DeviceEventError,
  ingestDeviceEvent,
  type DeviceEventDatabase,
} from "./device-event.service.js";
import { deviceEventBodySchema } from "./device-event.schema.js";

function deviceToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (
    typeof authorization !== "string" ||
    !/^Bearer\s+\S+$/i.test(authorization)
  ) {
    throw new DeviceEventError("Device authentication failed", 401);
  }
  return authorization.replace(/^Bearer\s+/i, "");
}

export const deviceEventRoutes: FastifyPluginAsync = async (app) => {
  app.post("/device-events", async (request, reply) => {
    const parsed = deviceEventBodySchema.safeParse(request.body);
    if (!parsed.success) throw new DeviceEventError("Invalid request", 400);

    const result = await ingestDeviceEvent(
      app.prisma as unknown as DeviceEventDatabase,
      deviceToken(request),
      parsed.data,
    );

    request.log.info(
      {
        requestId: request.id,
        eventId: result.event.eventId,
        deviceId: result.event.deviceId,
        outcome: result.duplicate ? "already_accepted" : "accepted",
      },
      "Device event ingestion completed",
    );

    return reply.code(result.duplicate ? 200 : 201).send({
      data: {
        eventId: result.event.eventId,
        status: result.duplicate ? "already_accepted" : "accepted",
      },
      meta: { requestId: request.id },
    });
  });
};
