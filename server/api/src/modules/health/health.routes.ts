import type { FastifyPluginAsync } from "fastify";
import { getSafeErrorLogFields } from "../../shared/logging.js";
import { PrismaNotificationJobRepository } from "../notifications/notification-repository.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness: process is running. This endpoint intentionally does not query the database.
  app.get("/live", async () => ({
    status: "ok",
    service: "pulselink-api",
    timestamp: new Date().toISOString(),
  }));

  // Readiness: the process can reach PostgreSQL.
  app.get("/ready", async (request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        service: "pulselink-api",
        dependencies: { database: "ok" },
        timestamp: new Date().toISOString(),
      };
    } catch (error: unknown) {
      request.log.error(getSafeErrorLogFields(error), "Readiness check failed");
      request.log.error(
        {
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          errorCode:
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : undefined,
          message: error instanceof Error ? error.message : String(error),
          meta:
            typeof error === "object" && error !== null && "meta" in error
              ? error.meta
              : undefined,
        },
        "Readiness check failed",
      );
      return reply.code(503).send({
        status: "error",
        service: "pulselink-api",
        dependencies: { database: "unavailable" },
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get("/notifications", async (request, reply) => {
    try {
      const now = new Date();
      const snapshot = await new PrismaNotificationJobRepository(
        app.prisma,
      ).getQueueSnapshot(now);
      return {
        status: "ok",
        service: "pulselink-api",
        queue: {
          ...snapshot.counts,
          retryPending: snapshot.retryPendingCount,
          expiredLeases: snapshot.expiredLeaseCount,
          oldestPendingAgeSeconds:
            snapshot.oldestPendingAt === null
              ? null
              : Math.max(
                  0,
                  Math.floor(
                    (now.getTime() - snapshot.oldestPendingAt.getTime()) / 1000,
                  ),
                ),
        },
        workers: snapshot.workers.map((worker) => ({
          workerId: worker.workerId,
          lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
          lastProcessedAt: worker.lastProcessedAt?.toISOString() ?? null,
          heartbeatAgeSeconds: Math.max(
            0,
            Math.floor(
              (now.getTime() - worker.lastHeartbeatAt.getTime()) / 1000,
            ),
          ),
        })),
        timestamp: now.toISOString(),
      };
    } catch (error: unknown) {
      request.log.error(
        getSafeErrorLogFields(error),
        "Notification queue health check failed",
      );
      return reply.code(503).send({
        status: "error",
        service: "pulselink-api",
        dependencies: { database: "unavailable" },
        timestamp: new Date().toISOString(),
      });
    }
  });
};
