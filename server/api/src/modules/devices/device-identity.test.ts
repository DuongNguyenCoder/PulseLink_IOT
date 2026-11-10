import { describe, expect, it } from "vitest";
import { deviceIdFromMac, isMacDerivedDeviceId, normalizeMacAddress } from "./device-identity.js";

describe("MAC-derived Device identity", () => {
  it("normalizes MAC input without changing byte order", () => {
    expect(normalizeMacAddress("02:11:22:33:44:55")).toBe("021122334455");
    expect(normalizeMacAddress("02-11-22-33-44-55")).toBe("021122334455");
    expect(deviceIdFromMac("02:11:22:33:44:55")).toBe("pl-021122334455");
  });

  it("rejects malformed MAC values and non-canonical Device IDs", () => {
    expect(() => normalizeMacAddress("02:11:22:33:44")).toThrow();
    expect(() => normalizeMacAddress("02:11:22:33:44:5g")).toThrow();
    expect(isMacDerivedDeviceId("pl-021122334455")).toBe(true);
    expect(isMacDerivedDeviceId("PL-021122334455")).toBe(false);
    expect(isMacDerivedDeviceId("pl-02112233445")).toBe(false);
    expect(isMacDerivedDeviceId("cuid-device-id")).toBe(false);
  });
});
