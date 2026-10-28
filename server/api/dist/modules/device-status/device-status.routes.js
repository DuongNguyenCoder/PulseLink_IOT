import { getAuthenticatedDeviceStatus, } from "./device-status.service.js";
import { ProvisioningError } from "../provisioning/provisioning.service.js";
function deviceToken(request) {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" ||
        !/^Bearer\s+\S+$/i.test(authorization)) {
        throw new ProvisioningError("Device authentication failed", 401);
    }
    return authorization.replace(/^Bearer\s+/i, "");
}
export const deviceStatusRoutes = async (app) => {
    app.get("/device-status", async (request, reply) => {
        const status = await getAuthenticatedDeviceStatus(app.prisma, deviceToken(request));
        return reply.send({ data: status, meta: { requestId: request.id } });
    });
};
