const MAC_HEX = /^[0-9a-fA-F]{12}$/;
const MAC_DERIVED_DEVICE_ID = /^pl-[0-9a-f]{12}$/;
/** Normalize the six-byte ESP32 Wi-Fi MAC representation without changing byte order. */
export function normalizeMacAddress(value) {
    const compact = value.trim().replace(/[:-]/g, "");
    if (!MAC_HEX.test(compact))
        throw new Error("Invalid MAC address");
    return compact.toLowerCase();
}
/** Must match firmware device_provisioning_build_device_id() exactly. */
export function deviceIdFromMac(value) {
    return `pl-${normalizeMacAddress(value)}`;
}
export function isMacDerivedDeviceId(value) {
    return MAC_DERIVED_DEVICE_ID.test(value);
}
export function assertMacDerivedDeviceId(value) {
    if (!isMacDerivedDeviceId(value))
        throw new Error("Invalid MAC-derived Device ID");
    return value;
}
