import { createAuthenticationHook } from "../auth/auth-hook.js";
import { ProvisioningError } from "./provisioning.service.js";
export async function requireOperatorPermission(db, accountId, storeId, permission) {
    const grant = await db.operatorGrant.findFirst({
        where: {
            accountId,
            storeId,
            status: "ACTIVE",
            permissions: { has: permission },
        },
        select: { accountId: true, storeId: true, status: true, permissions: true },
    });
    if (grant === null)
        throw new ProvisioningError("Access denied", 403);
}
export function createOperatorEnrollmentAuthorizer(db, verificationKeys) {
    const authenticate = createAuthenticationHook(verificationKeys);
    return async (request) => {
        await authenticate(request, undefined);
        const deviceId = request.params.deviceId;
        if (typeof deviceId !== "string" || request.auth === undefined) {
            throw new ProvisioningError("Resource not found", 404);
        }
        const device = await db.device.findUnique({
            where: { id: deviceId },
            select: { id: true, storeId: true },
        });
        if (device === null)
            throw new ProvisioningError("Resource not found", 404);
        await requireOperatorPermission(db, request.auth.accountId, device.storeId, "DEVICES_WRITE");
        return { actorId: request.auth.accountId, actorType: "ACCOUNT" };
    };
}
