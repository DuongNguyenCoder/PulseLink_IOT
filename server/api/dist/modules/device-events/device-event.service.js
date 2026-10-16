import { Prisma } from "../../generated/prisma/client.js";
import { authenticateDevice, } from "../provisioning/provisioning.service.js";
export class DeviceEventError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = "DeviceEventError";
        this.statusCode = statusCode;
    }
}
function isEventIdUniqueViolation(error) {
    const candidate = error instanceof Prisma.PrismaClientKnownRequestError ||
        (typeof error === "object" && error !== null)
        ? error
        : null;
    if (candidate?.code !== "P2002") {
        return false;
    }
    const target = candidate.meta?.target;
    if (Array.isArray(target))
        return target.includes("eventId");
    if (typeof target === "string" &&
        (target === "eventId" || target.includes("DeviceEvent_eventId_key")))
        return true;
    return (typeof candidate.message === "string" &&
        candidate.message.includes("DeviceEvent_eventId_key"));
}
function normalizeValue(value) {
    if (Array.isArray(value))
        return value.map(normalizeValue);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, nested]) => [key, normalizeValue(nested)]));
    }
    return value;
}
function eventMeaning(event, deviceId) {
    return JSON.stringify(normalizeValue({
        deviceId,
        eventId: event.eventId.toLowerCase(),
        type: event.type,
        occurredAt: new Date(event.occurredAt).toISOString(),
        firmwareVersion: event.firmwareVersion,
        rssiDbm: event.rssiDbm,
        payload: event.payload,
    }));
}
function storedEventMeaning(event) {
    return JSON.stringify(normalizeValue({
        deviceId: event.deviceId,
        eventId: event.eventId.toLowerCase(),
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
        firmwareVersion: event.firmwareVersion ?? undefined,
        rssiDbm: event.rssiDbm ?? undefined,
        payload: event.payload ?? undefined,
    }));
}
function assertEquivalent(existing, incoming, deviceId) {
    if (existing.deviceId !== deviceId) {
        throw new DeviceEventError("Event idempotency conflict", 409);
    }
    if (storedEventMeaning(existing) !== eventMeaning(incoming, deviceId)) {
        throw new DeviceEventError("Event idempotency conflict", 409);
    }
}
export async function ingestDeviceEvent(db, token, input, receivedAt = new Date()) {
    const device = await authenticateDevice(db, token);
    const createData = {
        eventId: input.eventId.toLowerCase(),
        deviceId: device.id,
        type: input.type,
        status: "RECEIVED",
        occurredAt: new Date(input.occurredAt),
        receivedAt,
        firmwareVersion: input.firmwareVersion,
        rssiDbm: input.rssiDbm,
        payload: input.payload,
    };
    try {
        const event = await db.$transaction(async (transaction) => {
            const created = await transaction.deviceEvent.create({
                data: createData,
            });
            const recipients = await transaction.staffPushToken.findMany({
                where: {
                    isActive: true,
                    staff: { isActive: true, storeId: device.storeId },
                },
                select: { id: true },
            });
            if (recipients.length > 0) {
                await transaction.deviceNotification.createMany({
                    data: recipients.map((recipient) => ({
                        eventId: created.id,
                        pushTokenId: recipient.id,
                    })),
                    skipDuplicates: true,
                });
            }
            return created;
        });
        return { event, duplicate: false };
    }
    catch (error) {
        if (!isEventIdUniqueViolation(error))
            throw error;
        const existing = await db.deviceEvent.findUnique({
            where: { eventId: createData.eventId },
        });
        if (existing === null)
            throw new DeviceEventError("Event persistence could not be verified", 503);
        assertEquivalent(existing, input, device.id);
        return { event: existing, duplicate: true };
    }
}
