import { Prisma } from '../../generated/prisma/client.js';
import { writeAuditEvent } from '../../shared/audit.js';

export interface StoreDatabase {
  account: {
    findUnique(args: { where: { id: string }; select: { status: true; emailVerifiedAt: true } }): Promise<{ status: 'PENDING' | 'ACTIVE' | 'DISABLED'; emailVerifiedAt: Date | null } | null>;
  };
  store: {
    create(args: { data: { name: string; slug: string; timezone?: string } }): Promise<StoreRecord>;
    findMany(args: unknown): Promise<StoreRecord[]>;
    findUnique(args: unknown): Promise<StoreRecord | null>;
    update(args: unknown): Promise<StoreRecord>;
  };
  storeMembership: {
    findFirst(args: unknown): Promise<MembershipRecord | null>;
    create(args: unknown): Promise<MembershipRecord>;
  };
  auditEvent: {
    create(args: unknown): Promise<unknown>;
  };
  $transaction<T>(callback: (tx: StoreDatabase) => Promise<T>): Promise<T>;
}

export interface StoreRecord {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipRecord {
  id: string;
  accountId: string;
  storeId: string;
  role: 'OWNER' | 'STAFF';
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
}

export class StoreAuthorizationError extends Error {
  readonly statusCode: 400 | 401 | 403 | 404 | 409 | 503;

  constructor(message: string, statusCode: 400 | 401 | 403 | 404 | 409 | 503) {
    super(message);
    this.name = 'StoreAuthorizationError';
    this.statusCode = statusCode;
  }
}

export interface StoreMetadataInput {
  name?: string;
  slug?: string;
  timezone?: string;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function publicStore(store: StoreRecord): StoreRecord {
  return store;
}

async function assertAccountCanManageStore(db: StoreDatabase, accountId: string): Promise<void> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { status: true, emailVerifiedAt: true },
  });
  if (account === null || account.status === 'DISABLED') {
    throw new StoreAuthorizationError('Authentication required', 401);
  }
  if (account.status !== 'ACTIVE' || account.emailVerifiedAt === null) {
    throw new StoreAuthorizationError('Email verification required', 403);
  }
}

export async function requireStoreMembership(
  db: StoreDatabase,
  accountId: string,
  storeId: string,
  role?: 'OWNER',
): Promise<MembershipRecord> {
  const membership = await db.storeMembership.findFirst({
    where: { accountId, storeId, status: 'ACTIVE' },
    select: { id: true, accountId: true, storeId: true, role: true, status: true },
  });
  if (membership === null) {
    throw new StoreAuthorizationError('Resource not found', 404);
  }
  if (role !== undefined && membership.role !== role) {
    throw new StoreAuthorizationError('Access denied', 403);
  }
  return membership;
}

export async function createStoreForOwner(
  db: StoreDatabase,
  accountId: string,
  input: { name: string; slug: string; timezone?: string },
  requestId?: string,
): Promise<StoreRecord> {
  await assertAccountCanManageStore(db, accountId);
  try {
    return await db.$transaction(async (tx) => {
      const store = await tx.store.create({ data: input });
      await tx.storeMembership.create({
        data: { accountId, storeId: store.id, role: 'OWNER', status: 'ACTIVE' },
      });
      await writeAuditEvent(tx, {
        actorType: 'ACCOUNT',
        actorId: accountId,
        action: 'STORE_CREATED',
        resourceType: 'STORE',
        resourceId: store.id,
        storeId: store.id,
        requestId,
        metadata: { accountId, role: 'OWNER', outcome: 'success' },
      });
      return publicStore(store);
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) {
      throw new StoreAuthorizationError('Store slug already exists', 409);
    }
    throw error;
  }
}

export async function listActiveStores(db: StoreDatabase, accountId: string): Promise<StoreRecord[]> {
  await assertAccountCanManageStore(db, accountId);
  return db.store.findMany({
    where: { isActive: true, memberships: { some: { accountId, status: 'ACTIVE' } } },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getStoreForMember(db: StoreDatabase, accountId: string, storeId: string): Promise<StoreRecord> {
  await assertAccountCanManageStore(db, accountId);
  await requireStoreMembership(db, accountId, storeId);
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (store === null || !store.isActive) throw new StoreAuthorizationError('Resource not found', 404);
  return publicStore(store);
}

export async function updateStoreMetadata(
  db: StoreDatabase,
  accountId: string,
  storeId: string,
  input: StoreMetadataInput,
  requestId?: string,
): Promise<StoreRecord> {
  await assertAccountCanManageStore(db, accountId);
  await requireStoreMembership(db, accountId, storeId, 'OWNER');
  try {
    return await db.$transaction(async (tx) => {
      const store = await tx.store.update({ where: { id: storeId }, data: input });
      await writeAuditEvent(tx, {
        actorType: 'ACCOUNT',
        actorId: accountId,
        action: 'STORE_METADATA_UPDATED',
        resourceType: 'STORE',
        resourceId: storeId,
        storeId,
        requestId,
        metadata: { accountId, outcome: 'success' },
      });
      return store;
    });
  } catch (error: unknown) {
    if (isUniqueViolation(error)) throw new StoreAuthorizationError('Store slug already exists', 409);
    throw error;
  }
}
