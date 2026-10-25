import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  emailVerificationRoutes,
  registerVerificationFormParser,
} from "./email-verification.routes.js";

const token = "verification-token-012345678901234567890123456789";

function createApp(options: { tokenFound: boolean } = { tokenFound: true }) {
  let accountUpdated = false;
  const account = {
    id: "account-1",
    emailNormalized: "owner@example.com",
    passwordHash: "unused",
    status: "ACTIVE" as const,
    emailVerifiedAt: new Date(),
    authVersion: 0,
  };
  const transaction = {
    accountToken: {
      findFirst: async () =>
        options.tokenFound
          ? {
              id: "token-1",
              accountId: account.id,
              expiresAt: new Date(Date.now() + 60_000),
              consumedAt: null,
              revokedAt: null,
            }
          : null,
      updateMany: async () => ({ count: 1 }),
    },
    account: {
      update: async () => {
        accountUpdated = true;
        return account;
      },
    },
  };
  const app = Fastify({ logger: false });
  app.decorate("prisma", {
    $transaction: async (callback: (value: typeof transaction) => unknown) =>
      callback(transaction),
  } as never);
  return { app, accountUpdated: () => accountUpdated };
}

describe("email verification web flow", () => {
  it("registers GET /verify-email and does not consume on link open", async () => {
    const { app } = createApp();
    registerVerificationFormParser(app);
    await app.register(emailVerificationRoutes);

    const response = await app.inject({
      method: "GET",
      url: `/verify-email?token=${token}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["set-cookie"]?.toString()).toContain("HttpOnly");
    expect(response.body).not.toContain(token);
    expect(response.body).toContain("Verify email");
    await app.close();
  });

  it("consumes only after the confirmation POST", async () => {
    const { app, accountUpdated } = createApp();
    registerVerificationFormParser(app);
    await app.register(emailVerificationRoutes);

    const link = await app.inject({
      method: "GET",
      url: `/verify-email?token=${token}`,
    });
    const cookie = link.headers["set-cookie"]?.toString().split(";")[0];
    const response = await app.inject({
      method: "POST",
      url: "/verify-email/complete",
      headers: {
        cookie: cookie ?? "",
        "content-type": "application/x-www-form-urlencoded",
      },
      payload: "",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Email verified");
    expect(response.body).not.toContain(token);
    expect(accountUpdated()).toBe(true);
    await app.close();
  });

  it("does not consume a missing or invalid cookie", async () => {
    const { app, accountUpdated } = createApp({ tokenFound: false });
    registerVerificationFormParser(app);
    await app.register(emailVerificationRoutes);

    const response = await app.inject({
      method: "POST",
      url: "/verify-email/complete",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("Verification link unavailable");
    expect(accountUpdated()).toBe(false);
    await app.close();
  });
});
