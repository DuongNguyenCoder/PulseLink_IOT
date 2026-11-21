import type { DeviceDatabase } from "../devices/device.service.js";

export type NotificationFeedStatus =
  | "RECEIVED"
  | "PROCESSED"
  | "FAILED";

export interface NotificationFeedItem {
  id: string;
  eventId: string;
  type: "BUTTON_PRESSED";
  status: NotificationFeedStatus;
  occurredAt: Date;
  receivedAt: Date;
  // Kept as an API compatibility alias for receivedAt. DeviceEvent has no
  // createdAt column; receivedAt is the server-authoritative feed timestamp.
  createdAt: Date;
  device: { id: string; name: string };
}

export interface NotificationFeedPage {
  items: NotificationFeedItem[];
  nextCursor: string | null;
}

interface NotificationFeedEventRecord {
  id: string;
  eventId: string;
  type: "BUTTON_PRESSED";
  occurredAt: Date;
  receivedAt: Date;
  status: NotificationFeedStatus;
  device: { id: string; name: string };
}

export interface NotificationFeedDatabase extends DeviceDatabase {
  deviceEvent: {
    findMany(args: unknown): Promise<NotificationFeedEventRecord[]>;
  };
}

export class NotificationFeedAuthorizationError extends Error {
  readonly statusCode: 400 | 401 | 403 | 404;

  constructor(message: string, statusCode: 400 | 401 | 403 | 404) {
    super(message);
    this.name = "NotificationFeedAuthorizationError";
    this.statusCode = statusCode;
  }
}

export interface NotificationFeedOptions {
  limit?: number;
  cursor?: string;
}

function encodeCursor(receivedAt: Date, id: string): string {
  return Buffer.from(`${receivedAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { receivedAt: Date; id: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new NotificationFeedAuthorizationError("Invalid cursor", 400);
  }
  const separator = decoded.indexOf("|");
  const receivedAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (separator <= 0 || id.length === 0 || Number.isNaN(receivedAt.getTime())) {
    throw new NotificationFeedAuthorizationError("Invalid cursor", 400);
  }
  return { receivedAt, id };
}

async function requireNotificationReader(
  db: NotificationFeedDatabase,
  accountId: string,
  storeId: string,
): Promise<void> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { status: true, emailVerifiedAt: true },
  });
  if (account === null || account.status === "DISABLED")
    throw new NotificationFeedAuthorizationError("Authentication required", 401);
  if (account.status !== "ACTIVE" || account.emailVerifiedAt === null)
    throw new NotificationFeedAuthorizationError("Email verification required", 403);
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: { id: true, isActive: true },
  });
  if (store === null || !store.isActive)
    throw new NotificationFeedAuthorizationError("Resource not found", 404);
  const membership = await db.storeMembership.findFirst({
    where: { accountId, storeId, status: "ACTIVE", role: { in: ["OWNER", "STAFF"] } },
    select: { accountId: true, storeId: true, role: true, status: true },
  });
  if (membership === null)
    throw new NotificationFeedAuthorizationError("Resource not found", 404);
}

export async function listNotificationFeed(
  db: NotificationFeedDatabase,
  accountId: string,
  storeId: string,
  options: NotificationFeedOptions = {},
): Promise<NotificationFeedPage> {
  await requireNotificationReader(db, accountId, storeId);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  const events = await db.deviceEvent.findMany({
    where: {
      device: { storeId },
      ...(cursor === undefined
        ? {}
        : {
            OR: [
              { receivedAt: { lt: cursor.receivedAt } },
              { receivedAt: cursor.receivedAt, id: { lt: cursor.id } },
            ],
          }),
    },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      eventId: true,
      type: true,
      status: true,
      occurredAt: true,
      receivedAt: true,
      device: { select: { id: true, name: true } },
    },
  });
  const hasMore = events.length > limit;
  const page = (hasMore ? events.slice(0, limit) : events).map((event) => ({
    id: event.id,
    eventId: event.eventId,
    type: event.type,
    status: event.status,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    createdAt: event.receivedAt,
    device: event.device,
  }));
  return {
    items: page,
    nextCursor: hasMore && page.length > 0
      ? encodeCursor(page[page.length - 1].receivedAt, page[page.length - 1].id)
      : null,
  };
}
