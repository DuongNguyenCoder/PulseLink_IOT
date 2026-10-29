import { z } from "zod";
import {
  verifyDeviceEnrollmentProof,
  type DeviceEnrollmentProof,
} from "./provisioning-crypto.js";

const enrollmentRequestInputSchema = z.object({
  deviceId: z.string().min(1).max(128),
  deviceKey: z.string().min(1).max(128),
  proof: z.object({
    publicKeySpkiBase64: z.string().min(32).max(2048),
    keyVersion: z.number().int().min(1).max(1_000_000),
    challenge: z.string().length(43),
    expiresAt: z.number().int().positive(),
    signatureDerBase64: z.string().min(12).max(108),
  }).strict(),
}).strict();

export interface DeviceEnrollmentHttpRequest {
  request: {
    method: "POST";
    path: string;
    body: DeviceEnrollmentProof;
  };
  operatorNotice: string;
}

/** Builds the existing operator API request from a board-produced proof. */
export function buildDeviceEnrollmentRequest(
  input: unknown,
  now = new Date(),
): DeviceEnrollmentHttpRequest {
  const parsed = enrollmentRequestInputSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid device enrollment proof input");
  if (!verifyDeviceEnrollmentProof({
    deviceKey: parsed.data.deviceKey,
    proof: parsed.data.proof,
    now,
  })) throw new Error("Device enrollment proof verification failed");

  return {
    request: {
      method: "POST",
      path: `/v1/operator/devices/${encodeURIComponent(parsed.data.deviceId)}/enrollment`,
      body: parsed.data.proof,
    },
    operatorNotice: "Signature validity binds the supplied Device key and SPKI; the backend checks the route Device record binding. This builder cannot prove physical-board provenance. Use only proof obtained through an approved factory channel.",
  };
}
