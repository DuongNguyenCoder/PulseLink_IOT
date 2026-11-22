import { authenticateDevice, } from "../provisioning/provisioning.service.js";
export async function getAuthenticatedDeviceStatus(db, token, seenAt = new Date()) {
    const device = await authenticateDevice(db, token);
    // A successful operational status probe is the device heartbeat. Without
    // recording it, provisioning can succeed on the board while the Owner app
    // continues to see the device as PENDING/OFFLINE until a button event.
    const updated = await db.device.update({
        where: { id: device.id },
        data: { status: "ONLINE", lastSeenAt: seenAt },
    });
    return {
        deviceId: updated.id,
        deviceKey: updated.deviceKey,
        status: updated.status,
        provisioningState: updated.provisioningState,
        enrollmentStatus: updated.enrollmentStatus,
    };
}
