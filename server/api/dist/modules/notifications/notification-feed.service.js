export class NotificationFeedAuthorizationError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = "NotificationFeedAuthorizationError";
        this.statusCode = statusCode;
    }
}
function encodeCursor(createdAt, id) {
    return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}
function decodeCursor(cursor) {
    let decoded;
    try {
        decoded = Buffer.from(cursor, "base64url").toString("utf8");
    }
    catch {
        throw new NotificationFeedAuthorizationError("Invalid cursor", 400);
    }
    const separator = decoded.indexOf("|");
    const createdAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (separator <= 0 || id.length === 0 || Number.isNaN(createdAt.getTime())) {
        throw new NotificationFeedAuthorizationError("Invalid cursor", 400);
    }
    return { createdAt, id };
}
async function requireNotificationReader(db, accountId, storeId) {
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
export async function listNotificationFeed(db, accountId, storeId, options = {}) {
    await requireNotificationReader(db, accountId, storeId);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const cursor = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
    const events = await db.deviceEvent.findMany({
        where: {
            device: { storeId },
            notifications: {
                some: {
                    appInstallation: { accountId },
                },
            },
            ...(cursor === undefined
                ? {}
                : {
                    OR: [
                        { createdAt: { lt: cursor.createdAt } },
                        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                    ],
                }),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
            id: true,
            eventId: true,
            type: true,
            occurredAt: true,
            receivedAt: true,
            createdAt: true,
            device: { select: { id: true, name: true } },
            notifications: {
                where: { appInstallation: { accountId } },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { status: true },
            },
        },
    });
    const hasMore = events.length > limit;
    const page = (hasMore ? events.slice(0, limit) : events).map((event) => ({
        id: event.id,
        eventId: event.eventId,
        type: event.type,
        status: event.notifications[0]?.status ?? "CANCELLED",
        occurredAt: event.occurredAt,
        receivedAt: event.receivedAt,
        createdAt: event.createdAt,
        device: event.device,
    }));
    return {
        items: page,
        nextCursor: hasMore && page.length > 0
            ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
            : null,
    };
}
