export class PrismaNotificationJobRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async claim(limit, now, leaseUntil) {
        return this.db.$queryRaw `
      WITH candidates AS (
        SELECT n."id",
               (n."status" = 'PROCESSING'::"NotificationStatus") AS "leaseRecovered"
        FROM "DeviceNotification" n
        WHERE (
          (n."status" = 'PENDING'::"NotificationStatus" AND n."nextAttemptAt" <= ${now})
          OR
          (n."status" = 'PROCESSING'::"NotificationStatus" AND (n."leaseUntil" IS NULL OR n."leaseUntil" <= ${now}))
        )
        AND EXISTS (
          SELECT 1
          FROM "StaffPushToken" active_token
          WHERE active_token."id" = n."pushTokenId"
            AND active_token."isActive" = true
        )
        ORDER BY n."nextAttemptAt" ASC, n."createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ), claimed AS (
        UPDATE "DeviceNotification" n
        SET "status" = 'PROCESSING'::"NotificationStatus",
            "attempts" = n."attempts" + 1,
            "leaseUntil" = ${leaseUntil},
            "updatedAt" = ${now}
        FROM candidates c
        WHERE n."id" = c."id"
        RETURNING n."id" AS "id", n."eventId" AS "eventId", n."pushTokenId" AS "pushTokenId",
                  n."attempts" AS "attempts"
      )
      SELECT c."id" AS "id", c."eventId" AS "eventId", c."pushTokenId" AS "pushTokenId",
             t."token" AS "token", e."type"::text AS "eventType", c."attempts" AS "attempts",
             e."receivedAt" AS "eventReceivedAt",
             candidates."leaseRecovered" AS "leaseRecovered"
      FROM claimed c
      JOIN candidates ON candidates."id" = c."id"
      JOIN "StaffPushToken" t ON t."id" = c."pushTokenId"
      JOIN "DeviceEvent" e ON e."id" = c."eventId"
    `;
    }
    async recordHeartbeat(workerId, now, lastProcessedAt) {
        await this.db.notificationWorkerHeartbeat.upsert({
            where: { workerId },
            create: { workerId, lastHeartbeatAt: now, lastProcessedAt },
            update: {
                lastHeartbeatAt: now,
                ...(lastProcessedAt === undefined ? {} : { lastProcessedAt }),
            },
        });
    }
    async getQueueSnapshot(now) {
        const [counts, oldest, retry, expired, workers] = await Promise.all([
            this.db.deviceNotification.groupBy({
                by: ["status"],
                _count: { _all: true },
            }),
            this.db.deviceNotification.findFirst({
                where: { status: "PENDING" },
                orderBy: { createdAt: "asc" },
                select: { createdAt: true },
            }),
            this.db.deviceNotification.count({
                where: {
                    status: { in: ["PENDING", "PROCESSING"] },
                    attempts: { gt: 0 },
                },
            }),
            this.db.deviceNotification.count({
                where: { status: "PROCESSING", leaseUntil: { lte: now } },
            }),
            this.db.notificationWorkerHeartbeat.findMany({
                orderBy: { lastHeartbeatAt: "desc" },
                select: {
                    workerId: true,
                    lastHeartbeatAt: true,
                    lastProcessedAt: true,
                },
            }),
        ]);
        const result = {
            counts: { PENDING: 0, PROCESSING: 0, SENT: 0, FAILED: 0 },
            oldestPendingAt: oldest?.createdAt ?? null,
            retryPendingCount: retry,
            expiredLeaseCount: expired,
            workers,
        };
        for (const row of counts)
            result.counts[row.status] = row._count._all;
        return result;
    }
    async markSent(id, messageId, now) {
        await this.db.deviceNotification.update({
            where: { id },
            data: {
                status: "SENT",
                fcmMessageId: messageId,
                sentAt: now,
                leaseUntil: null,
                lastError: null,
            },
        });
    }
    async markRetry(id, nextAttemptAt, reason) {
        await this.db.deviceNotification.update({
            where: { id },
            data: {
                status: "PENDING",
                nextAttemptAt,
                leaseUntil: null,
                lastError: reason.slice(0, 1000),
            },
        });
    }
    async markFailed(id, reason) {
        await this.db.deviceNotification.update({
            where: { id },
            data: {
                status: "FAILED",
                leaseUntil: null,
                lastError: reason.slice(0, 1000),
            },
        });
    }
    async deactivateToken(pushTokenId, now) {
        await this.db.staffPushToken.update({
            where: { id: pushTokenId },
            data: { isActive: false, lastSeenAt: now },
        });
    }
}
