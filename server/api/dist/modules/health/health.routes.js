import { timingSafeEqual } from "node:crypto";
import { getSafeErrorLogFields } from "../../shared/logging.js";
import { PrismaNotificationJobRepository } from "../notifications/notification-repository.js";
function hasDiagnosticsAccess(request, expected) {
    if (expected === undefined)
        return true;
    const provided = request.headers["x-health-diagnostics-token"];
    if (typeof provided !== "string")
        return false;
    const actualBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    return (actualBuffer.length === expectedBuffer.length &&
        timingSafeEqual(actualBuffer, expectedBuffer));
}
export const healthRoutes = async (app, options) => {
    // Liveness: process is running. This endpoint intentionally does not query the database.
    app.get("/live", async () => ({
        status: "ok",
        service: "pulselink-api",
        timestamp: new Date().toISOString(),
    }));
    // Readiness: the process can reach PostgreSQL.
    app.get("/ready", async (request, reply) => {
        try {
            await app.prisma.$queryRaw `SELECT 1`;
            return {
                status: "ok",
                service: "pulselink-api",
                dependencies: { database: "ok" },
                timestamp: new Date().toISOString(),
            };
        }
        catch (error) {
            request.log.error(getSafeErrorLogFields(error), "Readiness check failed");
            return reply.code(503).send({
                status: "error",
                service: "pulselink-api",
                dependencies: { database: "unavailable" },
                timestamp: new Date().toISOString(),
            });
        }
    });
    app.get("/notifications", async (request, reply) => {
        if (!hasDiagnosticsAccess(request, options.diagnosticsToken)) {
            return reply.code(401).send({
                status: "error",
                service: "pulselink-api",
                error: "Unauthorized",
            });
        }
        try {
            const now = new Date();
            const snapshot = await new PrismaNotificationJobRepository(app.prisma).getQueueSnapshot(now);
            return {
                status: "ok",
                service: "pulselink-api",
                queue: {
                    ...snapshot.counts,
                    retryPending: snapshot.retryPendingCount,
                    expiredLeases: snapshot.expiredLeaseCount,
                    oldestPendingAgeSeconds: snapshot.oldestPendingAt === null
                        ? null
                        : Math.max(0, Math.floor((now.getTime() - snapshot.oldestPendingAt.getTime()) / 1000)),
                },
                workers: snapshot.workers.map((worker) => ({
                    workerId: worker.workerId,
                    lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
                    lastProcessedAt: worker.lastProcessedAt?.toISOString() ?? null,
                    heartbeatAgeSeconds: Math.max(0, Math.floor((now.getTime() - worker.lastHeartbeatAt.getTime()) / 1000)),
                })),
                timestamp: now.toISOString(),
            };
        }
        catch (error) {
            request.log.error(getSafeErrorLogFields(error), "Notification queue health check failed");
            return reply.code(503).send({
                status: "error",
                service: "pulselink-api",
                dependencies: { database: "unavailable" },
                timestamp: new Date().toISOString(),
            });
        }
    });
};
