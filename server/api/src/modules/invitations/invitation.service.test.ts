import { describe, expect, it, vi } from "vitest";
import { acceptInvitation, createInvitation, inspectInvitation, type InvitationDatabase, type InvitationRecord } from "./invitation.service.js";

const now = new Date("2026-11-08T00:00:00.000Z");

function record(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: "invitation-1",
    storeId: "store-1",
    inviterAccountId: "owner-1",
    recipientEmailNormalized: "staff@example.com",
    tokenHash: "a".repeat(64),
    status: "PENDING",
    role: "STAFF",
    expiresAt: new Date("2026-11-15T00:00:00.000Z"),
    acceptedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    store: { id: "store-1", name: "Cafe", slug: "cafe" },
    inviter: { id: "owner-1", emailNormalized: "owner@example.com" },
    ...overrides,
  };
}

function database(overrides: Partial<InvitationDatabase> = {}): InvitationDatabase {
  const invitation = record();
  const db: InvitationDatabase = {
    account: {
      findUnique: vi.fn(async () => ({ id: "staff-1", emailNormalized: "staff@example.com", status: "ACTIVE" as const })),
    },
    store: {
      findUnique: vi.fn(async () => ({ id: "store-1", name: "Cafe", slug: "cafe", isActive: true })),
    },
    storeMembership: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn()
        .mockResolvedValueOnce({ id: "owner-membership", accountId: "owner-1", storeId: "store-1", role: "OWNER" as const, status: "ACTIVE" as const })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "owner-membership", accountId: "owner-1", storeId: "store-1", role: "OWNER" as const, status: "ACTIVE" as const })
        .mockResolvedValue(null),
      create: vi.fn(async () => ({ id: "membership-1", accountId: "staff-1", storeId: "store-1", role: "STAFF" as const, status: "ACTIVE" as const })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    storeInvitation: {
      create: vi.fn(async () => invitation),
      findUnique: vi.fn(async () => invitation),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [invitation]),
      count: vi.fn(async () => 1),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => record({ status: "REVOKED", revokedAt: now })),
    },
    auditEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (callback) => callback(db)),
    ...overrides,
  };
  return db;
}

describe("Store invitation service", () => {
  it("creates a STAFF invitation with a one-time token and never returns its hash", async () => {
    const db = database();
    const result = await createInvitation(db, "owner-1", "store-1", { email: " Staff@Example.com " }, "request-1", now);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.invitation).not.toHaveProperty("tokenHash");
    expect(result.invitation.recipientEmailNormalized).toBe("staff@example.com");
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "STORE_INVITATION_CREATED" }) }));
    const createArgs = vi.mocked(db.storeInvitation.create).mock.calls[0]?.[0] as { data: { tokenHash: string; role: string } };
    expect(createArgs.data.tokenHash).not.toBe(result.token);
    expect(createArgs.data.role).toBe("STAFF");
  });

  it("rejects an active member and a duplicate pending invitation", async () => {
    const memberDb = database({
      account: { findUnique: vi.fn(async () => ({ id: "staff-1", emailNormalized: "staff@example.com", status: "ACTIVE" as const })) },
      storeMembership: { ...database().storeMembership, findFirst: vi.fn()
        .mockResolvedValueOnce({ id: "owner-membership", accountId: "owner-1", storeId: "store-1", role: "OWNER" as const, status: "ACTIVE" as const })
        .mockResolvedValueOnce({ id: "m", accountId: "staff-1", storeId: "store-1", role: "STAFF" as const, status: "ACTIVE" as const }) },
    });
    await expect(createInvitation(memberDb, "owner-1", "store-1", { email: "staff@example.com" })).rejects.toMatchObject({ statusCode: 409 });

    const pendingDb = database({ storeInvitation: { ...database().storeInvitation, findFirst: vi.fn(async () => ({ id: "existing" })) } });
    await expect(createInvitation(pendingDb, "owner-1", "store-1", { email: "staff@example.com" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("inspects a valid invitation without exposing recipient email or token hash", async () => {
    const db = database();
    const token = "A".repeat(43);
    const result = await inspectInvitation(db, token, now);
    expect(result).toMatchObject({ id: "invitation-1", status: "PENDING", role: "STAFF", store: { name: "Cafe" } });
    expect(result).not.toHaveProperty("recipientEmailNormalized");
    expect(result).not.toHaveProperty("tokenHash");
  });

  it("accepts only the intended account and activates membership atomically", async () => {
    const db = database();
    const token = "A".repeat(43);
    const result = await acceptInvitation(db, "staff-1", token, "request-1", now);
    expect(result.membership).toMatchObject({ accountId: "staff-1", storeId: "store-1", role: "STAFF", status: "ACTIVE" });
    expect(result.invitation).not.toHaveProperty("tokenHash");
    expect(db.storeInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACCEPTED" }) }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "STORE_INVITATION_ACCEPTED" }) }));
  });

  it("rejects a wrong recipient without changing invitation state", async () => {
    const db = database({ account: { findUnique: vi.fn(async () => ({ id: "other", emailNormalized: "other@example.com", status: "ACTIVE" as const })) } });
    await expect(acceptInvitation(db, "other", "A".repeat(43), undefined, now)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.storeInvitation.updateMany).not.toHaveBeenCalled();
  });

  it("rejects expired, revoked and invalid invitations", async () => {
    await expect(inspectInvitation(database({ storeInvitation: { ...database().storeInvitation, findUnique: vi.fn(async () => null) } }), "A".repeat(43), now)).rejects.toMatchObject({ statusCode: 404 });
    const expired = database({ storeInvitation: { ...database().storeInvitation, findUnique: vi.fn(async () => record({ expiresAt: new Date("2026-11-07T00:00:00.000Z") })) } });
    await expect(acceptInvitation(expired, "staff-1", "A".repeat(43), undefined, now)).rejects.toMatchObject({ statusCode: 409 });
    const revoked = database({ storeInvitation: { ...database().storeInvitation, findUnique: vi.fn(async () => record({ status: "REVOKED" })) } });
    await expect(acceptInvitation(revoked, "staff-1", "A".repeat(43), undefined, now)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("recognizes repeated acceptance after the membership is already active", async () => {
    const db = database({
      storeInvitation: { ...database().storeInvitation, findUnique: vi.fn(async () => record({ status: "ACCEPTED", acceptedAt: now })) },
      storeMembership: { ...database().storeMembership, findUnique: vi.fn(async () => ({ id: "membership-1", accountId: "staff-1", storeId: "store-1", role: "STAFF" as const, status: "ACTIVE" as const })) },
    });
    const result = await acceptInvitation(db, "staff-1", "A".repeat(43), undefined, now);
    expect(result.membership.status).toBe("ACTIVE");
    expect(db.storeMembership.create).not.toHaveBeenCalled();
  });
});
