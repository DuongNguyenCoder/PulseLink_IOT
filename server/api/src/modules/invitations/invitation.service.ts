import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { normalizeEmail } from "../auth/email.js";
import { requireStoreMembership, StoreAuthorizationError } from "../stores/store.service.js";
import { writeAuditEvent } from "../../shared/audit.js";

export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type InvitationRole = "STAFF";

export interface InvitationRecord {
  id: string;
  storeId: string;
  inviterAccountId: string;
  recipientEmailNormalized: string;
  tokenHash: string;
  status: InvitationStatus;
  role: InvitationRole;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  inviter?: { id: string; emailNormalized: string };
  store?: { id: string; name: string; slug: string };
}

export interface InvitationDatabase {
  account: {
    findUnique(args: unknown): Promise<{ id: string; emailNormalized: string; status: "PENDING" | "ACTIVE" | "DISABLED" } | null>;
  };
  store: {
    findUnique(args: unknown): Promise<{ id: string; name: string; slug: string; isActive: boolean } | null>;
  };
  storeMembership: {
    findUnique(args: unknown): Promise<{ id: string; accountId: string; storeId: string; role: "OWNER" | "STAFF"; status: "ACTIVE" | "SUSPENDED" | "REVOKED" } | null>;
    findFirst(args: unknown): Promise<{ id: string; accountId: string; storeId: string; role: "OWNER" | "STAFF"; status: "ACTIVE" | "SUSPENDED" | "REVOKED" } | null>;
    create(args: unknown): Promise<{ id: string; accountId: string; storeId: string; role: "OWNER" | "STAFF"; status: "ACTIVE" | "SUSPENDED" | "REVOKED" }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  storeInvitation: {
    create(args: unknown): Promise<InvitationRecord>;
    findUnique(args: unknown): Promise<InvitationRecord | null>;
    findFirst(args: unknown): Promise<InvitationRecord | null>;
    findMany(args: unknown): Promise<InvitationRecord[]>;
    count(args: unknown): Promise<number>;
    updateMany(args: unknown): Promise<{ count: number }>;
    update(args: unknown): Promise<InvitationRecord>;
  };
  auditEvent: { create(args: unknown): Promise<unknown> };
  $transaction<T>(callback: (tx: InvitationDatabase) => Promise<T>): Promise<T>;
}

export class InvitationError extends Error {
  readonly statusCode: 400 | 401 | 403 | 404 | 409;

  constructor(message: string, statusCode: 400 | 401 | 403 | 404 | 409) {
    super(message);
    this.name = "InvitationError";
    this.statusCode = statusCode;
  }
}

const DEFAULT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token, "utf8").digest("hex") };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function publicInvitation(record: InvitationRecord): Omit<InvitationRecord, "tokenHash"> {
  const { tokenHash: _tokenHash, ...safe } = record;
  return safe;
}

function effectiveStatus(record: InvitationRecord, now: Date): InvitationStatus {
  return record.status === "PENDING" && record.expiresAt <= now ? "EXPIRED" : record.status;
}

async function requireOwner(db: InvitationDatabase, accountId: string, storeId: string): Promise<void> {
  const store = await db.store.findUnique({ where: { id: storeId }, select: { id: true, name: true, slug: true, isActive: true } });
  if (store === null || !store.isActive) throw new InvitationError("Resource not found", 404);
  await requireStoreMembership(db as never, accountId, storeId, "OWNER");
}

export async function createInvitation(
  db: InvitationDatabase,
  accountId: string,
  storeId: string,
  input: { email: string; role?: InvitationRole },
  requestId?: string,
  now = new Date(),
): Promise<{ invitation: Omit<InvitationRecord, "tokenHash">; token: string }> {
  await requireOwner(db, accountId, storeId);
  const email = normalizeEmail(input.email);
  if (input.role !== undefined && input.role !== "STAFF") throw new InvitationError("Only STAFF invitations are allowed", 400);

  const existingAccount = await db.account.findUnique({ where: { emailNormalized: email }, select: { id: true, emailNormalized: true, status: true } });
  if (existingAccount !== null) {
    const membership = await db.storeMembership.findFirst({ where: { accountId: existingAccount.id, storeId, status: "ACTIVE" }, select: { id: true, accountId: true, storeId: true, role: true, status: true } });
    if (membership !== null) throw new InvitationError("Account is already a Store member", 409);
  }

  const existingPending = await db.storeInvitation.findFirst({ where: { storeId, recipientEmailNormalized: email, status: "PENDING" }, select: { id: true } });
  if (existingPending !== null) throw new InvitationError("A pending invitation already exists", 409);

  const { token, tokenHash } = newToken();
  try {
    const invitation = await db.$transaction(async (tx) => {
      await requireOwner(tx, accountId, storeId);
      const created = await tx.storeInvitation.create({
        data: {
          storeId,
          inviterAccountId: accountId,
          recipientEmailNormalized: email,
          tokenHash,
          status: "PENDING",
          role: "STAFF",
          expiresAt: new Date(now.getTime() + DEFAULT_EXPIRATION_MS),
        },
        include: { inviter: { select: { id: true, emailNormalized: true } }, store: { select: { id: true, name: true, slug: true } } },
      });
      await writeAuditEvent(tx, {
        actorType: "ACCOUNT", actorId: accountId, action: "STORE_INVITATION_CREATED",
        resourceType: "STORE_INVITATION", resourceId: created.id, storeId, requestId,
        metadata: { role: "STAFF", status: "PENDING", outcome: "success" }, occurredAt: now,
      });
      return created;
    });
    return { invitation: publicInvitation(invitation), token };
  } catch (error: unknown) {
    if (isUniqueViolation(error)) throw new InvitationError("A pending invitation already exists", 409);
    throw error;
  }
}

export async function inspectInvitation(db: InvitationDatabase, token: string, now = new Date()): Promise<{
  id: string; store: { name: string; slug: string }; role: InvitationRole; status: InvitationStatus; expiresAt: Date; createdAt: Date;
}> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new InvitationError("Invalid invitation", 404);
  const invitation = await db.storeInvitation.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true, storeId: true, role: true, status: true, expiresAt: true, createdAt: true, store: { select: { name: true, slug: true } } } });
  if (invitation === null || invitation.store === undefined) throw new InvitationError("Invalid invitation", 404);
  return { id: invitation.id, store: invitation.store, role: invitation.role, status: effectiveStatus(invitation, now), expiresAt: invitation.expiresAt, createdAt: invitation.createdAt };
}

export async function acceptInvitation(
  db: InvitationDatabase,
  accountId: string,
  token: string,
  requestId?: string,
  now = new Date(),
): Promise<{ invitation: Omit<InvitationRecord, "tokenHash">; membership: { id: string; accountId: string; storeId: string; role: "OWNER" | "STAFF"; status: "ACTIVE" | "SUSPENDED" | "REVOKED" } }> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new InvitationError("Invalid invitation", 404);
  const tokenHash = hashToken(token);
  const account = await db.account.findUnique({ where: { id: accountId }, select: { id: true, emailNormalized: true, status: true } });
  if (account === null || account.status !== "ACTIVE") throw new InvitationError("Authentication required", 401);

  return db.$transaction(async (tx) => {
    const invitation = await tx.storeInvitation.findUnique({ where: { tokenHash }, select: { id: true, storeId: true, inviterAccountId: true, recipientEmailNormalized: true, tokenHash: true, status: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true, updatedAt: true, store: { select: { id: true, name: true, slug: true } } } });
    if (invitation === null) throw new InvitationError("Invalid invitation", 404);
    if (invitation.recipientEmailNormalized !== account.emailNormalized) throw new InvitationError("Invitation is not intended for this Account", 403);

    if (invitation.status === "ACCEPTED") {
      const membership = await tx.storeMembership.findUnique({ where: { accountId_storeId: { accountId, storeId: invitation.storeId } }, select: { id: true, accountId: true, storeId: true, role: true, status: true } });
      if (membership?.status === "ACTIVE") return { invitation: publicInvitation(invitation), membership };
      throw new InvitationError("Invitation has already been accepted", 409);
    }
    if (invitation.status === "REVOKED") throw new InvitationError("Invitation has been revoked", 409);
    if (invitation.status === "EXPIRED" || invitation.expiresAt <= now) {
      await tx.storeInvitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "EXPIRED" } });
      throw new InvitationError("Invitation has expired", 409);
    }

    const consumed = await tx.storeInvitation.updateMany({ where: { id: invitation.id, tokenHash, status: "PENDING", expiresAt: { gt: now }, revokedAt: null }, data: { status: "ACCEPTED", acceptedAt: now } });
    if (consumed.count !== 1) throw new InvitationError("Invitation is no longer active", 409);

    const existing = await tx.storeMembership.findUnique({ where: { accountId_storeId: { accountId, storeId: invitation.storeId } }, select: { id: true, accountId: true, storeId: true, role: true, status: true } });
    if (existing?.role === "OWNER") throw new InvitationError("Account is already an Owner of this Store", 409);
    let membership = existing;
    if (membership === null) {
      membership = await tx.storeMembership.create({ data: { accountId, storeId: invitation.storeId, role: "STAFF", status: "ACTIVE" }, select: { id: true, accountId: true, storeId: true, role: true, status: true } });
    } else if (membership.status !== "ACTIVE") {
      await tx.storeMembership.updateMany({ where: { id: membership.id, accountId, storeId: invitation.storeId }, data: { status: "ACTIVE", revokedAt: null } });
      membership = { ...membership, status: "ACTIVE" };
    }
    await writeAuditEvent(tx, {
      actorType: "ACCOUNT", actorId: accountId, action: "STORE_INVITATION_ACCEPTED",
      resourceType: "STORE_INVITATION", resourceId: invitation.id, storeId: invitation.storeId, requestId,
      metadata: { role: "STAFF", status: "ACCEPTED", outcome: "success" }, occurredAt: now,
    });
    return { invitation: publicInvitation({ ...invitation, status: "ACCEPTED", acceptedAt: now }), membership };
  });
}

export async function listInvitations(db: InvitationDatabase, accountId: string, storeId: string, status?: InvitationStatus, page = 1, limit = 50, now = new Date()): Promise<{ items: Array<Omit<InvitationRecord, "tokenHash">>; page: number; limit: number; total: number }> {
  await requireOwner(db, accountId, storeId);
  const where = status === "EXPIRED"
    ? { storeId, OR: [{ status: "EXPIRED" }, { status: "PENDING", expiresAt: { lte: now } }] }
    : status === "PENDING"
      ? { storeId, status, expiresAt: { gt: now } }
      : { storeId, ...(status === undefined ? {} : { status }) };
  const [items, total] = await Promise.all([
    db.storeInvitation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        storeId: true,
        inviterAccountId: true,
        recipientEmailNormalized: true,
        status: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
        updatedAt: true,
        inviter: { select: { id: true, emailNormalized: true } },
      },
    }),
    db.storeInvitation.count({ where }),
  ]);
  return { items: items.map((item) => publicInvitation({ ...item, status: effectiveStatus(item, now) })), page, limit, total };
}

export async function getInvitation(db: InvitationDatabase, accountId: string, storeId: string, invitationId: string): Promise<Omit<InvitationRecord, "tokenHash">> {
  await requireOwner(db, accountId, storeId);
  const invitation = await db.storeInvitation.findUnique({
    where: { id: invitationId },
    select: { id: true, storeId: true, inviterAccountId: true, recipientEmailNormalized: true, status: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true, updatedAt: true, inviter: { select: { id: true, emailNormalized: true } } },
  });
  if (invitation === null || invitation.storeId !== storeId) throw new InvitationError("Resource not found", 404);
  return publicInvitation({ ...invitation, status: effectiveStatus(invitation, new Date()) });
}

export async function revokeInvitation(db: InvitationDatabase, accountId: string, storeId: string, invitationId: string, requestId?: string, now = new Date()): Promise<Omit<InvitationRecord, "tokenHash">> {
  await requireOwner(db, accountId, storeId);
  return db.$transaction(async (tx) => {
    await requireOwner(tx, accountId, storeId);
    const invitation = await tx.storeInvitation.findUnique({ where: { id: invitationId }, select: { id: true, storeId: true, status: true, expiresAt: true, tokenHash: true } });
    if (invitation === null || invitation.storeId !== storeId) throw new InvitationError("Resource not found", 404);
    if (invitation.status !== "PENDING") throw new InvitationError("Invitation cannot be revoked in its current state", 409);
    if (invitation.expiresAt <= now) {
      await tx.storeInvitation.updateMany({ where: { id: invitationId, status: "PENDING" }, data: { status: "EXPIRED" } });
      throw new InvitationError("Invitation has expired", 409);
    }
    const updated = await tx.storeInvitation.update({ where: { id: invitationId }, data: { status: "REVOKED", revokedAt: now }, include: { inviter: { select: { id: true, emailNormalized: true } } } });
    await writeAuditEvent(tx, { actorType: "ACCOUNT", actorId: accountId, action: "STORE_INVITATION_REVOKED", resourceType: "STORE_INVITATION", resourceId: invitationId, storeId, requestId, metadata: { status: "REVOKED", outcome: "success" }, occurredAt: now });
    return publicInvitation(updated);
  });
}

export async function resendInvitation(db: InvitationDatabase, accountId: string, storeId: string, invitationId: string, requestId?: string, now = new Date()): Promise<{ invitation: Omit<InvitationRecord, "tokenHash">; token: string }> {
  await requireOwner(db, accountId, storeId);
  const generated = newToken();
  return db.$transaction(async (tx) => {
    await requireOwner(tx, accountId, storeId);
    const current = await tx.storeInvitation.findUnique({ where: { id: invitationId }, select: { id: true, storeId: true, tokenHash: true, status: true, expiresAt: true } });
    if (current === null || current.storeId !== storeId) throw new InvitationError("Resource not found", 404);
    if (current.status === "ACCEPTED" || current.status === "REVOKED") throw new InvitationError("Invitation cannot be resent in its current state", 409);
    const updated = await tx.storeInvitation.updateMany({ where: { id: invitationId, storeId, tokenHash: current.tokenHash, status: { in: ["PENDING", "EXPIRED"] } }, data: { tokenHash: generated.tokenHash, status: "PENDING", expiresAt: new Date(now.getTime() + DEFAULT_EXPIRATION_MS), acceptedAt: null, revokedAt: null } });
    if (updated.count !== 1) throw new InvitationError("Invitation changed concurrently; retry the request", 409);
    const invitation = await tx.storeInvitation.findUnique({ where: { id: invitationId }, include: { inviter: { select: { id: true, emailNormalized: true } } } });
    if (invitation === null) throw new InvitationError("Invitation could not be reissued", 409);
    await writeAuditEvent(tx, { actorType: "ACCOUNT", actorId: accountId, action: "STORE_INVITATION_RESENT", resourceType: "STORE_INVITATION", resourceId: invitationId, storeId, requestId, metadata: { status: "PENDING", outcome: "success" }, occurredAt: now });
    return { invitation: publicInvitation(invitation), token: generated.token };
  });
}
