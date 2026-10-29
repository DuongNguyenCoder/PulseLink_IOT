import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalDeviceClaimPayload,
  hashChallenge,
  hashDeviceToken,
  type DeviceClaimProof,
} from "./provisioning-crypto.js";
import {
  completeDeviceClaim,
  createDeviceClaimSession,
  type DeviceClaimDatabase,
  type DeviceClaimSessionRecord,
  type ClaimedDeviceRecord,
} from "./device-claim.service.js";

function harness(now: Date, storeId = "store-1") {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeySpkiBase64 = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const challenge = randomBytes(32).toString("base64url");
  const session: DeviceClaimSessionRecord = {
    id: "claim-session-1", deviceId: "pl-0123456789ab", storeId,
    actorAccountId: "owner-1", name: "Front button", challengeHash: hashChallenge(challenge),
    expiresAt: new Date(Math.floor((now.getTime() + 120_000) / 1000) * 1000), consumedAt: null,
  };
  let device: ClaimedDeviceRecord | null = null;
  let createdDeviceCredential: { deviceKey: string; deviceSecretHash: string } | null = null;
  const db: DeviceClaimDatabase = {
    account: { findUnique: async () => ({ id: "owner-1", status: "ACTIVE", emailVerifiedAt: now }) },
    storeMembership: { findFirst: async (args) => {
      const where = (args as { where: { accountId: string; storeId: string; role: string; status: string } }).where;
      return where.accountId === "owner-1" && where.storeId === storeId && where.role === "OWNER" && where.status === "ACTIVE"
        ? { accountId: "owner-1", storeId, role: "OWNER", status: "ACTIVE" } : null;
    } },
    device: {
      findUnique: async () => device,
      create: async (args) => {
        if (device) throw Object.assign(new Error("unique"), { code: "P2002" });
        const data = (args as { data: Partial<ClaimedDeviceRecord> & { id: string } }).data;
        const credentialData = args as { data: { deviceKey: string; deviceSecretHash: string } };
        createdDeviceCredential = credentialData.data;
        device = { ...data, deviceKey: "server-generated", storeId, status: "PENDING", provisioningState: "READY",
          enrollmentStatus: "ENROLLED", enrollmentPublicKey: publicKeySpkiBase64, enrollmentKeyVersion: 1,
          type: "CALL_BUTTON", firmwareVersion: null, lastSeenAt: null, createdAt: now, updatedAt: now } as ClaimedDeviceRecord;
        return device;
      },
    },
    deviceClaimSession: {
      create: async (args) => ({ ...session, ...(args as { data: Partial<DeviceClaimSessionRecord> }).data }),
      findUnique: async () => session,
      updateMany: async () => { if (session.consumedAt) return { count: 0 }; session.consumedAt = now; return { count: 1 }; },
    },
    auditEvent: { create: async () => ({}) },
    $transaction: async (callback) => callback(db),
  };
  const proofBody = {
    publicKeySpkiBase64, keyVersion: 1, challenge,
    expiresAt: Math.floor(session.expiresAt.getTime() / 1000),
  };
  const signatureDerBase64 = sign("sha256", canonicalDeviceClaimPayload({
    deviceId: session.deviceId, storeId, claimSessionId: session.id, proof: proofBody,
  }), { key: keys.privateKey, dsaEncoding: "der" }).toString("base64");
  const proof: DeviceClaimProof = { ...proofBody, signatureDerBase64 };
  return { db, session, challenge, proof, getDevice: () => device, getCreatedCredential: () => createdDeviceCredential };
}

describe("Owner Device claim lifecycle", () => {
  it("creates a short-lived owner-bound challenge and completes with Device proof", async () => {
    const now = new Date("2026-10-29T03:00:00.000Z");
    const h = harness(now);
    const created = await createDeviceClaimSession(h.db, "owner-1", "store-1", h.session.deviceId, "Front button", now);
    expect(created.challenge).toHaveLength(43);
    const claimed = await completeDeviceClaim(h.db, "owner-1", "store-1", h.session.id, h.challenge, h.proof, "req-1", now);
    expect(claimed).toMatchObject({ id: h.session.deviceId, storeId: "store-1", enrollmentStatus: "ENROLLED", status: "PENDING" });
    const issuedCredential = h.getCreatedCredential();
    expect(issuedCredential).not.toBeNull();
    expect(issuedCredential?.deviceSecretHash).toBe(hashDeviceToken(issuedCredential!.deviceKey));
  });

  it("rejects wrong Store proof, expired challenge, and unauthorized Owner", async () => {
    const now = new Date("2026-10-29T03:00:00.000Z");
    const h = harness(now);
    await expect(completeDeviceClaim(h.db, "owner-1", "store-other", h.session.id, h.challenge, h.proof, undefined, now))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(completeDeviceClaim(h.db, "owner-1", "store-1", h.session.id, h.challenge, { ...h.proof, signatureDerBase64: Buffer.from("tampered").toString("base64") }, undefined, now))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(completeDeviceClaim(h.db, "owner-1", "store-1", h.session.id, h.challenge, h.proof, undefined, new Date(h.session.expiresAt.getTime() + 1)))
      .rejects.toMatchObject({ statusCode: 401 });
    await expect(completeDeviceClaim(h.db, "other-owner", "store-1", h.session.id, h.challenge, h.proof, undefined, now))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it("makes same-session retry idempotent without creating another Device", async () => {
    const now = new Date("2026-10-29T03:00:00.000Z");
    const h = harness(now);
    const first = await completeDeviceClaim(h.db, "owner-1", "store-1", h.session.id, h.challenge, h.proof, undefined, now);
    const retry = await completeDeviceClaim(h.db, "owner-1", "store-1", h.session.id, h.challenge, h.proof, undefined, now);
    expect(retry.id).toBe(first.id);
    expect(h.getDevice()?.id).toBe(first.id);
    await expect(completeDeviceClaim(h.db, "owner-1", "store-1", h.session.id, h.challenge,
      { ...h.proof, signatureDerBase64: Buffer.from("invalid").toString("base64") }, undefined, now))
      .rejects.toMatchObject({ statusCode: 401 });
    const repeatedStart = await createDeviceClaimSession(h.db, "owner-1", "store-1", h.session.deviceId, "Renamed", now);
    expect(repeatedStart).toMatchObject({ alreadyClaimed: true, device: { id: first.id, storeId: "store-1" } });
  });
});
