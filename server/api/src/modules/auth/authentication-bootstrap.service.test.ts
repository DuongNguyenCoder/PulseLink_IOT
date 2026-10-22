import { generateKeyPairSync } from "node:crypto";
import { exportPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import {
  authenticateWithInstallation,
  type AuthenticationBootstrapDatabase,
} from "./authentication-bootstrap.service.js";
import type { FcmKeyMaterial } from "../installations/fcm-crypto.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const fcmKeys: FcmKeyMaterial = {
  activeVersion: 1,
  encryptionKeys: new Map([[1, Buffer.alloc(32, 7)]]),
  fingerprintKey: Buffer.alloc(32, 8),
};

async function signingKey() {
  return { kid: "test-key", privateKeyPem: await exportPKCS8(privateKey) };
}

function database(options: { failInstallation?: boolean } = {}) {
  const calls: string[] = [];
  const installation = {
    id: "installation-1",
    accountId: "account-1",
    platform: "ANDROID" as const,
    status: "ACTIVE" as const,
    lastSeenAt: new Date(),
    revokedAt: null,
    revokeReason: null,
  };
  const transaction = {
    appInstallation: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      update: async () => installation,
      updateMany: async () => ({ count: 0 }),
      create: async () => {
        calls.push("installation.create");
        if (options.failInstallation) throw new Error("transaction failure");
        return installation;
      },
    },
    session: {
      findUnique: async () => null,
      create: async () => {
        calls.push("session.create");
        return {};
      },
      updateMany: async () => ({ count: 0 }),
    },
    auditEvent: { create: async () => ({}) },
  };
  const database: AuthenticationBootstrapDatabase = {
    $transaction: async (callback) => callback(transaction),
  };
  return { database, calls };
}

describe("authentication bootstrap service", () => {
  it("creates installation and session in one transaction", async () => {
    const fake = database();
    const result = await authenticateWithInstallation(
      fake.database,
      { id: "account-1", authVersion: 0 },
      {
        installationId: "installation-1",
        platform: "ANDROID",
        fcmToken: "fcm-token",
      },
      fcmKeys,
      await signingKey(),
      new Date("2026-10-19T12:00:00.000Z"),
    );

    expect(result.accessToken).toContain(".");
    expect(result.session.refreshToken).toHaveLength(43);
    expect(fake.calls).toEqual(["installation.create", "session.create"]);
  });

  it("does not create a session or return credentials when installation persistence fails", async () => {
    const fake = database({ failInstallation: true });

    await expect(
      authenticateWithInstallation(
        fake.database,
        { id: "account-1", authVersion: 0 },
        {
          installationId: "installation-1",
          platform: "ANDROID",
          fcmToken: "fcm-token",
        },
        fcmKeys,
        await signingKey(),
      ),
    ).rejects.toThrow("transaction failure");

    expect(fake.calls).toEqual(["installation.create"]);
  });

  it("creates a tokenless installation and session atomically", async () => {
    const fake = database();
    const result = await authenticateWithInstallation(
      fake.database,
      { id: "account-1", authVersion: 0 },
      { installationId: "installation-1", platform: "ANDROID" },
      undefined,
      await signingKey(),
      new Date("2026-10-19T12:00:00.000Z"),
    );

    expect(result.accessToken).toContain(".");
    expect(fake.calls).toEqual(["installation.create", "session.create"]);
  });
});
