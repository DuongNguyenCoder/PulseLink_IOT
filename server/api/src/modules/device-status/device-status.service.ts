import {
  authenticateDevice,
  type ProvisioningDatabase,
} from "../provisioning/provisioning.service.js";

export interface AuthenticatedDeviceStatus {
  deviceId: string;
  deviceKey: string;
  status: "PENDING" | "ONLINE" | "OFFLINE" | "DISABLED";
  provisioningState:
    | "UNREGISTERED"
    | "READY"
    | "PROVISIONED"
    | "NEEDS_RECONNECTION"
    | "REVOKED";
  enrollmentStatus: "UNENROLLED" | "ENROLLED" | "REVOKED";
}

export async function getAuthenticatedDeviceStatus(
  db: ProvisioningDatabase,
  token: string,
): Promise<AuthenticatedDeviceStatus> {
  const device = await authenticateDevice(db, token);
  return {
    deviceId: device.id,
    deviceKey: device.deviceKey,
    status: device.status,
    provisioningState: device.provisioningState,
    enrollmentStatus: device.enrollmentStatus,
  };
}

