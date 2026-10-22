import { describe, expect, it } from "vitest";
import {
  authenticateAccount,
  consumeVerificationToken,
  issuePasswordResetToken,
  issueVerificationToken,
  registerAccount,
  type AccountRecord,
} from "./account.service.js";

const account: AccountRecord = {
  id: "account-1",
  emailNormalized: "owner@example.com",
  passwordHash: "",
  status: "PENDING",
  emailVerifiedAt: null,
  authVersion: 0,
};

function persistence(): {
  value: AccountRecord;
  token: {
    id: string;
    accountId: string;
    expiresAt: Date;
    consumedAt: Date | null;
    revokedAt: Date | null;
  } | null;
  consumed: number;
  db: any;
} {
  const state = {
    value: { ...account },
    token: null as {
      id: string;
      accountId: string;
      expiresAt: Date;
      consumedAt: Date | null;
      revokedAt: Date | null;
    } | null,
    consumed: 0,
  };
  const db: any = {
    account: {
      create: async ({ data }: any) => ({
        ...state.value,
        ...data,
        id: "account-new",
      }),
      findUnique: async () => state.value,
      update: async ({ data }: any) =>
        (state.value = { ...state.value, ...data }),
    },
    accountToken: {
      create: async ({ data }: any) => {
        state.token = {
          id: "token-1",
          accountId: data.accountId,
          expiresAt: data.expiresAt,
          consumedAt: null,
          revokedAt: null,
        };
        return state.token;
      },
      delete: async () => {
        state.token = null;
        return { id: "token-1" };
      },
      findFirst: async () => state.token,
      updateMany: async () => {
        state.consumed += 1;
        if (state.token) state.token.consumedAt = new Date();
        return { count: 1 };
      },
    },
    $transaction: async (
      callback: (transaction: typeof db) => Promise<unknown>,
    ) => callback(db),
  };
  return {
    value: state.value,
    token: state.token,
    consumed: state.consumed,
    db,
  };
}

describe("account authentication service", () => {
  it("normalizes and hashes registration credentials", async () => {
    const fake = persistence();
    const created = await registerAccount(fake.db, {
      email: " Owner@Example.com ",
      password: "a sufficiently long password",
    });
    expect(created.emailNormalized).toBe("owner@example.com");
    expect(created.passwordHash).toMatch(/^scrypt-v1\$/);
  });

  it("authenticates the original password and rejects an incorrect password", async () => {
    const fake = persistence();
    fake.db.account.findUnique = async () => ({
      ...account,
      passwordHash: await registerAccount(fake.db, {
        email: account.emailNormalized,
        password: "correct password",
      }).then((value) => value.passwordHash),
    });
    await expect(
      authenticateAccount(fake.db, {
        email: account.emailNormalized,
        password: "correct password",
      }),
    ).resolves.toBeTruthy();
    await expect(
      authenticateAccount(fake.db, {
        email: account.emailNormalized,
        password: "wrong password",
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("issues and consumes a single-use verification token", async () => {
    const fake = persistence();
    const issued = await issueVerificationToken(
      fake.db,
      account.id,
      new Date("2026-01-01T00:00:00.000Z"),
    );
    const verified = await consumeVerificationToken(
      fake.db,
      issued.plaintext,
      new Date("2026-01-01T01:00:00.000Z"),
    );
    expect(verified.status).toBe("ACTIVE");
    expect(verified.emailVerifiedAt).toEqual(
      new Date("2026-01-01T01:00:00.000Z"),
    );
  });

  it("revokes pending reset tokens before creating the replacement atomically", async () => {
    const existing = {
      id: "old-reset-token",
      accountId: account.id,
      purpose: "PASSWORD_RESET",
      tokenHash: "old-hash",
      expiresAt: new Date("2026-01-01T00:15:00.000Z"),
      consumedAt: null,
      revokedAt: null,
    };
    let revoked = false;
    let created = false;
    const db: any = {
      account: {
        findUnique: async () => ({ ...account, status: "ACTIVE" }),
        update: async () => ({ ...account, status: "ACTIVE" }),
      },
      accountToken: {
        updateMany: async () => {
          revoked = true;
          existing.revokedAt = new Date("2026-01-01T00:01:00.000Z");
          return { count: 1 };
        },
        create: async () => {
          expect(revoked).toBe(true);
          created = true;
          return { id: "new-reset-token" };
        },
      },
      $transaction: async (callback: (transaction: any) => Promise<unknown>) =>
        callback(db),
    };

    const issued = await issuePasswordResetToken(
      db,
      account.emailNormalized,
      new Date("2026-01-01T00:01:00.000Z"),
    );

    expect(issued?.token.expiresAt).toEqual(
      new Date("2026-01-01T00:16:00.000Z"),
    );
    expect(revoked).toBe(true);
    expect(created).toBe(true);
  });
});
