import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildDeviceEnrollmentRequest } from "./device-enrollment-request.js";
import { canonicalDeviceEnrollmentPayload } from "./provisioning-crypto.js";

describe("operator enrollment request builder", () => {
  it("matches the firmware canonical enrollment bytes from the shared fixture", () => {
    const input = {
      deviceKey: "device-enrollment-vector-1",
      proof: {
        keyVersion: 7,
        publicKeySpkiBase64: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAElpkdK/GT4UC/gwUPAcWSej35A54rMTd8hMvO7CacCtxTxuhw1MzgRaRSIkRDj533W/MniowXUuIfvo0IWwOv7A==",
        challenge: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        expiresAt: 1793200000,
      },
    };
    const fixture = readFileSync(
      resolve(process.cwd(), "../../firmware/esp32/tests/fixtures/device_enrollment_v1.hex"),
      "utf8",
    ).trim();
    expect(canonicalDeviceEnrollmentPayload(input).toString("hex")).toBe(fixture);
  });

  it("builds the existing operator route only from a valid, current board proof", () => {
    const now = new Date("2026-10-28T15:04:40.000Z");
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const proofBody = {
      publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      keyVersion: 2,
      challenge: randomBytes(32).toString("base64url"),
      expiresAt: Math.floor(now.getTime() / 1000) + 120,
    };
    const proof = {
      ...proofBody,
      signatureDerBase64: sign("sha256", canonicalDeviceEnrollmentPayload({
        deviceKey: "device-key-1",
        proof: proofBody,
      }), { key: privateKey, dsaEncoding: "der" }).toString("base64"),
    };

    expect(buildDeviceEnrollmentRequest({ deviceId: "device-1", deviceKey: "device-key-1", proof }, now)).toEqual({
      request: {
        method: "POST",
        path: "/v1/operator/devices/device-1/enrollment",
        body: proof,
      },
      operatorNotice: expect.stringContaining("cannot prove physical-board provenance"),
    });
  });

  it("rejects wrong Device key and expired proof, and safely encodes the route segment", () => {
    const now = new Date("2026-10-28T15:04:40.000Z");
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const proofBody = {
      publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      keyVersion: 1,
      challenge: randomBytes(32).toString("base64url"),
      expiresAt: Math.floor(now.getTime() / 1000) + 30,
    };
    const proof = {
      ...proofBody,
      signatureDerBase64: sign("sha256", canonicalDeviceEnrollmentPayload({
        deviceKey: "device-key-1",
        proof: proofBody,
      }), { key: privateKey, dsaEncoding: "der" }).toString("base64"),
    };
    expect(buildDeviceEnrollmentRequest({ deviceId: "other-device", deviceKey: "device-key-1", proof }, now).request.path).toBe(
      "/v1/operator/devices/other-device/enrollment",
    );
    expect(() => buildDeviceEnrollmentRequest({ deviceId: "device-1", deviceKey: "other-device-key", proof }, now)).toThrow();
    expect(() => buildDeviceEnrollmentRequest({ deviceId: "device-1", deviceKey: "device-key-1", proof: { ...proof, expiresAt: 1 } }, now)).toThrow();
    const pathDeviceId = "device-1/../other";
    const pathProofBody = { ...proofBody };
    const pathProof = {
      ...pathProofBody,
      signatureDerBase64: sign("sha256", canonicalDeviceEnrollmentPayload({
        deviceKey: "device-key-1",
        proof: pathProofBody,
      }), { key: privateKey, dsaEncoding: "der" }).toString("base64"),
    };
    expect(buildDeviceEnrollmentRequest({ deviceId: pathDeviceId, deviceKey: "device-key-1", proof: pathProof }, now).request.path).toBe(
      "/v1/operator/devices/device-1%2F..%2Fother/enrollment",
    );
  });
});
