import Fastify from "fastify";
import { generateKeyPairSync } from "node:crypto";
import { exportPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import { authRoutes } from "./auth.routes.js";
import { mapErrorToApiResponse } from "../../shared/error-contract.js";
import { hashPassword } from "./password.js";

function createFakePrisma() {
  const account = {
    id: "account-1",
    emailNormalized: "owner@example.com",
    passwordHash: "unused",
    status: "PENDING" as const,
    emailVerifiedAt: null,
    authVersion: 0,
  };
  return {
    account: {
      create: async () => account,
      delete: async () => account,
    },
    accountToken: {
      create: async () => ({ id: "token-1" }),
      delete: async () => ({ id: "token-1" }),
    },
  };
}

describe("authentication route contracts", () => {
  it("validates signup input and returns the stable error shape", async () => {
    const app = Fastify({ logger: false });
    app.decorate("prisma", createFakePrisma() as never);
    app.setErrorHandler((error, request, reply) => {
      const mapped = mapErrorToApiResponse(error, request.id);
      return reply.code(mapped.statusCode).send(mapped.response);
    });
    await app.register(authRoutes, {
      emailSender: {
        sendVerification: async () => undefined,
        sendPasswordReset: async () => undefined,
      },
      signingKey: { kid: "unused", privateKeyPem: "unused" },
      passwordResetRateLimiter: { allow: async () => true },
      prefix: "/v1/auth",
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { email: "not-an-email", password: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "BAD_REQUEST", message: "Bad request" },
    });
    await app.close();
  });

  it("returns a stable signup response after persistence and email dispatch", async () => {
    const app = Fastify({ logger: false });
    app.decorate("prisma", createFakePrisma() as never);
    await app.register(authRoutes, {
      emailSender: {
        sendVerification: async () => undefined,
        sendPasswordReset: async () => undefined,
      },
      signingKey: { kid: "unused", privateKeyPem: "unused" },
      passwordResetRateLimiter: { allow: async () => true },
      prefix: "/v1/auth",
    } as never);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "Owner@example.com",
        password: "a sufficiently long password",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: { accountId: "account-1", status: "PENDING" },
    });
    expect(response.json().data).not.toHaveProperty("password");
    await app.close();
  });

  it("bootstraps a new installation and session from one login request", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const account = {
      id: "account-1",
      emailNormalized: "owner@example.com",
      passwordHash: await hashPassword("correct password"),
      status: "ACTIVE" as const,
      emailVerifiedAt: new Date("2026-10-19T12:00:00.000Z"),
      authVersion: 0,
    };
    const installation = {
      id: "installation-1",
      accountId: account.id,
      platform: "ANDROID" as const,
      status: "ACTIVE" as const,
      lastSeenAt: new Date(),
      revokedAt: null,
      revokeReason: null,
    };
    let installationCreated = false;
    let sessionCreated = false;
    const transaction = {
      appInstallation: {
        findUnique: async () => null,
        findFirst: async () => null,
        findMany: async () => [],
        update: async () => installation,
        updateMany: async () => ({ count: 0 }),
        create: async () => {
          installationCreated = true;
          return installation;
        },
      },
      session: {
        findUnique: async () => null,
        create: async () => {
          sessionCreated = true;
          return {};
        },
        updateMany: async () => ({ count: 0 }),
      },
      auditEvent: { create: async () => ({}) },
    };
    const app = Fastify({ logger: false });
    app.decorate("prisma", {
      account: { findUnique: async () => account },
      appInstallation: { findUnique: async () => null },
      $transaction: async (
        callback: (tx: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as never);
    app.setErrorHandler((error, request, reply) => {
      const mapped = mapErrorToApiResponse(error, request.id);
      return reply.code(mapped.statusCode).send(mapped.response);
    });
    await app.register(authRoutes, {
      emailSender: {
        sendVerification: async () => undefined,
        sendPasswordReset: async () => undefined,
      },
      signingKey: {
        kid: "test-key",
        privateKeyPem: await exportPKCS8(privateKey),
      },
      passwordResetRateLimiter: { allow: async () => true },
      loginRateLimiter: { allow: async () => true },
    });

    const response = await app.inject({
      method: "POST",
      url: "/login",
      payload: {
        email: account.emailNormalized,
        password: "correct password",
        appInstallationId: installation.id,
        platform: "ANDROID",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.accessToken).toEqual(expect.any(String));
    expect(response.json().data.refreshToken).toEqual(expect.any(String));
    expect(installationCreated).toBe(true);
    expect(sessionCreated).toBe(true);
    await app.close();
  });
});
