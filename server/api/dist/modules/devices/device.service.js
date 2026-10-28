import { Prisma } from "../../generated/prisma/client.js";
import { generateOperationalToken, hashDeviceToken, } from "../provisioning/provisioning-crypto.js";
import { writeAuditEvent } from "../../shared/audit.js";
export class DeviceAuthorizationError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = "DeviceAuthorizationError";
        this.statusCode = statusCode;
    }
}
async function requireOwner(db, accountId, storeId) {
    const account = await db.account.findUnique({
        where: { id: accountId },
        select: { status: true, emailVerifiedAt: true },
    });
    if (account === null || account.status === "DISABLED")
        throw new DeviceAuthorizationError("Authentication required", 401);
    if (account.status !== "ACTIVE" || account.emailVerifiedAt === null) {
        throw new DeviceAuthorizationError("Email verification required", 403);
    }
    const store = await db.store.findUnique({
        where: { id: storeId },
        select: { id: true, isActive: true },
    });
    if (store === null || !store.isActive)
        throw new DeviceAuthorizationError("Resource not found", 404);
    const membership = await db.storeMembership.findFirst({
        where: { accountId, storeId, role: "OWNER", status: "ACTIVE" },
        select: { accountId: true, storeId: true, role: true, status: true },
    });
    if (membership === null)
        throw new DeviceAuthorizationError("Resource not found", 404);
}
export async function createDeviceForOwner(db, accountId, storeId, input, requestId) {
    await requireOwner(db, accountId, storeId);
    try {
        return await db.$transaction(async (tx) => {
            await requireOwner(tx, accountId, storeId);
            const deviceKey = generateOperationalToken();
            const device = await tx.device.create({
                data: {
                    deviceKey,
                    deviceSecretHash: hashDeviceToken(generateOperationalToken()),
                    name: input.name,
                    type: "CALL_BUTTON",
                    status: "PENDING",
                    provisioningState: "UNREGISTERED",
                    enrollmentStatus: "UNENROLLED",
                    firmwareVersion: input.firmwareVersion,
                    storeId,
                },
            });
            await writeAuditEvent(tx, {
                actorType: "ACCOUNT",
                actorId: accountId,
                action: "DEVICE_REGISTERED",
                resourceType: "DEVICE",
                resourceId: device.id,
                storeId,
                requestId,
                metadata: { accountId, deviceId: device.id, outcome: "success" },
            });
            return device;
        });
    }
    catch (error) {
        if (error instanceof DeviceAuthorizationError)
            throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            throw new DeviceAuthorizationError("Device identity conflicts with current state", 409);
        }
        throw error;
    }
}
export async function listDevicesForOwner(db, accountId, storeId) {
    await requireOwner(db, accountId, storeId);
    return db.device.findMany({
        where: { storeId },
        orderBy: { createdAt: "asc" },
        select: {
            id: true,
            deviceKey: true,
            name: true,
            type: true,
            status: true,
            provisioningState: true,
            enrollmentStatus: true,
            firmwareVersion: true,
            lastSeenAt: true,
            storeId: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}
