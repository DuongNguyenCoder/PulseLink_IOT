import { z } from "zod";
import { createAuthenticationHook } from "../auth/auth-hook.js";
import { DeviceAuthorizationError, createDeviceForOwner, listDevicesForOwner, } from "./device.service.js";
const storeParams = z.object({ storeId: z.string().min(1).max(128) });
const createDeviceBody = z
    .object({
    name: z.string().trim().min(1).max(120),
    firmwareVersion: z.string().trim().min(1).max(40).optional(),
})
    .strict();
function accountId(request) {
    if (request.auth === undefined)
        throw new DeviceAuthorizationError("Authentication required", 401);
    return request.auth.accountId;
}
function parseParams(request) {
    const parsed = storeParams.safeParse(request.params);
    if (!parsed.success)
        throw new DeviceAuthorizationError("Invalid request", 400);
    return parsed.data;
}
export const deviceRoutes = async (app, options) => {
    app.addHook("preHandler", createAuthenticationHook(options.verificationKeys));
    app.post("/:storeId/devices", async (request, reply) => {
        const params = parseParams(request);
        const body = createDeviceBody.safeParse(request.body);
        if (!body.success)
            throw new DeviceAuthorizationError("Invalid request", 400);
        const device = await createDeviceForOwner(app.prisma, accountId(request), params.storeId, body.data, request.id);
        return reply
            .code(201)
            .send({ data: device, meta: { requestId: request.id } });
    });
    app.get("/:storeId/devices", async (request, reply) => {
        const params = parseParams(request);
        const devices = await listDevicesForOwner(app.prisma, accountId(request), params.storeId);
        return reply.send({ data: devices, meta: { requestId: request.id } });
    });
};
