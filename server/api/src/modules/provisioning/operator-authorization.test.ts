import { describe, expect, it } from "vitest";
import {
  createOperatorEnrollmentAuthorizer,
  requireOperatorPermission,
  type OperatorGrantDatabase,
} from "./operator-authorization.js";

function database(grant: unknown): OperatorGrantDatabase {
  return {
    operatorGrant: {
      findFirst: async (args: unknown) => {
        if (grant === null) return null;
        const input = args as {
          where?: {
            accountId?: string;
            storeId?: string;
            status?: string;
            permissions?: { has?: string };
          };
        };
        const candidate = grant as {
          accountId: string;
          storeId: string;
          status: string;
          permissions: string[];
        };
        const where = input.where;
        if (
          candidate.accountId !== where?.accountId ||
          candidate.storeId !== where.storeId ||
          candidate.status !== where.status ||
          !candidate.permissions.includes(where.permissions?.has ?? "")
        ) return null;
        return grant as never;
      },
    },
    device: {
      findUnique: async () => ({ id: "device-1", storeId: "store-1" }),
    },
  };
}

describe("operator authorization", () => {
  it("requires an active Store-scoped grant with the requested permission", async () => {
    await expect(
      requireOperatorPermission(
        database(null),
        "account-1",
        "store-1",
        "DEVICES_WRITE",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      requireOperatorPermission(
        database({
          accountId: "account-1",
          storeId: "store-2",
          status: "ACTIVE",
          permissions: ["DEVICES_WRITE"],
        }),
        "account-1",
        "store-1",
        "DEVICES_WRITE",
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows the exact active Store-scoped permission", async () => {
    await expect(
      requireOperatorPermission(
        database({
          accountId: "account-1",
          storeId: "store-1",
          status: "ACTIVE",
          permissions: ["DEVICES_READ", "DEVICES_WRITE"],
        }),
        "account-1",
        "store-1",
        "DEVICES_WRITE",
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects an operator request without an authenticated session", async () => {
    const authorize = createOperatorEnrollmentAuthorizer(database(null), new Map());
    await expect(
      authorize({ headers: {}, params: { deviceId: "device-1" } } as never),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
