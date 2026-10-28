import { authenticateDevice, } from "../provisioning/provisioning.service.js";
export async function getAuthenticatedDeviceStatus(db, token) {
    const device = await authenticateDevice(db, token);
    return {
        deviceId: device.id,
        deviceKey: device.deviceKey,
        status: device.status,
        provisioningState: device.provisioningState,
        enrollmentStatus: device.enrollmentStatus,
    };
}
