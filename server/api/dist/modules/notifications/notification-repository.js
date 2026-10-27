import { decryptFcmToken, } from "../installations/fcm-crypto.js";
export class PrismaNotificationJobRepository {
    db;
    fcmKeys;
    constructor(db, fcmKeys) {
        this.db = db;
        this.fcmKeys = fcmKeys;
    }
    async cancelIneligibleJobs(now) {
        const result = await this.db.$executeRaw `
      UPDATE "DeviceNotification" n
      SET "status" = 'CANCELLED'::"NotificationStatus", "leaseUntil" = NULL,
          "lastError" = 'recipient_no_longer_eligible', "updatedAt" = ${now}
      WHERE n."appInstallationId" IS NOT NULL
        AND n."status" IN ('PENDING'::"NotificationStatus", 'PROCESSING'::"NotificationStatus")
        AND NOT EXISTS (
          SELECT 1 FROM "AppInstallation" ai
          JOIN "Account" a ON a."id" = ai."accountId"
          JOIN "DeviceEvent" e ON e."id" = n."eventId"
          JOIN "Device" d ON d."id" = e."deviceId"
          JOIN "StoreMembership" sm ON sm."accountId" = ai."accountId" AND sm."storeId" = d."storeId"
          WHERE ai."id" = n."appInstallationId"
            AND ai."status" = 'ACTIVE'::"AppInstallationStatus"
            AND ai."fcmTokenCiphertext" IS NOT NULL AND ai."fcmTokenFingerprint" IS NOT NULL
            AND a."status" = 'ACTIVE'::"AccountStatus"
            AND sm."status" = 'ACTIVE'::"MembershipStatus"
            AND sm."role" IN ('OWNER'::"MembershipRole", 'STAFF'::"MembershipRole")
        )`;
        return Number(result);
    }
    async claim(limit, now, leaseUntil) {
        const rows = await this.db.$queryRaw `
      WITH candidates AS (
        SELECT n."id", n."eventId", n."pushTokenId", n."appInstallationId",
               (n."status" = 'PROCESSING'::"NotificationStatus") AS "leaseRecovered"
        FROM "DeviceNotification" n
        WHERE ((n."status" = 'PENDING'::"NotificationStatus" AND n."nextAttemptAt" <= ${now})
          OR (n."status" = 'PROCESSING'::"NotificationStatus" AND (n."leaseUntil" IS NULL OR n."leaseUntil" <= ${now}))
        )
          AND ((n."appInstallationId" IS NULL AND EXISTS (
            SELECT 1 FROM "StaffPushToken" t WHERE t."id" = n."pushTokenId" AND t."isActive" = true))
            OR (n."appInstallationId" IS NOT NULL AND EXISTS (
              SELECT 1 FROM "AppInstallation" ai
              JOIN "Account" a ON a."id" = ai."accountId"
              JOIN "DeviceEvent" e ON e."id" = n."eventId"
              JOIN "Device" d ON d."id" = e."deviceId"
              JOIN "StoreMembership" sm ON sm."accountId" = ai."accountId" AND sm."storeId" = d."storeId"
              WHERE ai."id" = n."appInstallationId" AND ai."status" = 'ACTIVE'::"AppInstallationStatus"
                AND ai."fcmTokenCiphertext" IS NOT NULL AND ai."fcmTokenFingerprint" IS NOT NULL
                AND a."status" = 'ACTIVE'::"AccountStatus" AND sm."status" = 'ACTIVE'::"MembershipStatus"
                AND sm."role" IN ('OWNER'::"MembershipRole", 'STAFF'::"MembershipRole"))))
        ORDER BY n."nextAttemptAt", n."createdAt" FOR UPDATE SKIP LOCKED LIMIT ${limit}
      ), claimed AS (
        UPDATE "DeviceNotification" n
        SET "status" = 'PROCESSING'::"NotificationStatus", "attempts" = n."attempts" + 1,
            "leaseUntil" = ${leaseUntil}, "updatedAt" = ${now}
        FROM candidates c WHERE n."id" = c."id"
        RETURNING n."id", n."eventId", n."pushTokenId", n."appInstallationId", n."attempts"
      )
      SELECT c."id", c."eventId", c."pushTokenId", c."appInstallationId", t."token" AS "legacyToken",
             ai."fcmTokenCiphertext", ai."fcmTokenFingerprint", e."type"::text AS "eventType",
             c."attempts", e."receivedAt" AS "eventReceivedAt", candidates."leaseRecovered"
      FROM claimed c JOIN candidates ON candidates."id" = c."id"
      LEFT JOIN "StaffPushToken" t ON t."id" = c."pushTokenId"
      LEFT JOIN "AppInstallation" ai ON ai."id" = c."appInstallationId"
      JOIN "DeviceEvent" e ON e."id" = c."eventId"`;
        const jobs = [];
        for (const row of rows) {
            if (row.appInstallationId !== null) {
                if (this.fcmKeys === undefined || row.fcmTokenCiphertext === null) {
                    await this.markFailed(row.id, "invalid_fcm_token_material");
                    continue;
                }
                try {
                    jobs.push({
                        id: row.id,
                        eventId: row.eventId,
                        pushTokenId: null,
                        appInstallationId: row.appInstallationId,
                        token: decryptFcmToken(row.fcmTokenCiphertext, this.fcmKeys),
                        tokenFingerprint: row.fcmTokenFingerprint,
                        eventType: row.eventType,
                        attempts: row.attempts,
                        eventReceivedAt: row.eventReceivedAt,
                        leaseRecovered: row.leaseRecovered,
                    });
                }
                catch {
                    await this.markFailed(row.id, "invalid_fcm_token_material");
                }
                continue;
            }
            if (row.legacyToken === null || row.pushTokenId === null) {
                await this.markFailed(row.id, "legacy_token_missing");
                continue;
            }
            jobs.push({
                id: row.id,
                eventId: row.eventId,
                pushTokenId: row.pushTokenId,
                appInstallationId: null,
                token: row.legacyToken,
                tokenFingerprint: null,
                eventType: row.eventType,
                attempts: row.attempts,
                eventReceivedAt: row.eventReceivedAt,
                leaseRecovered: row.leaseRecovered,
            });
        }
        return jobs;
    }
    async revalidate(job) {
        if (job.appInstallationId === null)
            return { eligible: true, token: job.token };
        if (this.fcmKeys === undefined)
            return { eligible: false, reason: "fcm_keys_unavailable" };
        const rows = await this.db.$queryRaw `
      SELECT ai."fcmTokenCiphertext" AS "ciphertext", ai."fcmTokenFingerprint" AS "fingerprint"
      FROM "DeviceNotification" n JOIN "AppInstallation" ai ON ai."id" = n."appInstallationId"
      JOIN "Account" a ON a."id" = ai."accountId" JOIN "DeviceEvent" e ON e."id" = n."eventId"
      JOIN "Device" d ON d."id" = e."deviceId"
      JOIN "StoreMembership" sm ON sm."accountId" = ai."accountId" AND sm."storeId" = d."storeId"
      WHERE n."id" = ${job.id} AND n."status" = 'PROCESSING'::"NotificationStatus"
        AND ai."status" = 'ACTIVE'::"AppInstallationStatus" AND ai."fcmTokenCiphertext" IS NOT NULL
        AND ai."fcmTokenFingerprint" IS NOT NULL AND a."status" = 'ACTIVE'::"AccountStatus"
        AND sm."status" = 'ACTIVE'::"MembershipStatus"
        AND sm."role" IN ('OWNER'::"MembershipRole", 'STAFF'::"MembershipRole")`;
        const row = rows[0];
        if (row === undefined ||
            row.ciphertext === null ||
            row.fingerprint === null)
            return { eligible: false, reason: "recipient_no_longer_eligible" };
        try {
            return {
                eligible: true,
                token: decryptFcmToken(row.ciphertext, this.fcmKeys),
                tokenFingerprint: row.fingerprint,
            };
        }
        catch {
            return { eligible: false, reason: "invalid_fcm_token_material" };
        }
    }
    async cancel(id, reason) {
        await this.db.deviceNotification.updateMany({
            where: { id, status: { in: ["PENDING", "PROCESSING"] } },
            data: {
                status: "CANCELLED",
                leaseUntil: null,
                lastError: reason.slice(0, 1000),
            },
        });
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
            counts: { PENDING: 0, PROCESSING: 0, SENT: 0, FAILED: 0, CANCELLED: 0 },
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
    async invalidateInstallationToken(installationId, fingerprint, now) {
        await this.db.appInstallation.updateMany({
            where: {
                id: installationId,
                status: "ACTIVE",
                ...(fingerprint === null ? {} : { fcmTokenFingerprint: fingerprint }),
            },
            data: {
                status: "INVALID",
                revokedAt: now,
                revokeReason: "FCM_TOKEN_INVALID",
                lastSeenAt: now,
            },
        });
    }
}
