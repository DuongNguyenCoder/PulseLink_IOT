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
  seenAt = new Date(),
): Promise<AuthenticatedDeviceStatus> {
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

