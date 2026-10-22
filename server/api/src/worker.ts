import Fastify from "fastify";
import { createFirebaseSender } from "./modules/notifications/fcm.client.js";
import { PrismaNotificationJobRepository } from "./modules/notifications/notification-repository.js";
import { NotificationWorker } from "./modules/notifications/notification-worker.js";
import { createPrismaClient } from "./plugins/prisma.js";
import { getSafeErrorLogFields } from "./shared/logging.js";

async function main(): Promise<void> {
  const prisma = createPrismaClient();

  const loggerHost = Fastify({
    logger: true,
  });

  let ready = false;
  let shuttingDown = false;

  let worker: NotificationWorker | undefined;
  let workerRunPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;

  loggerHost.get("/health/live", async () => ({
    status: "ok",
    service: "notification-worker",
  }));

  loggerHost.get("/health/ready", async (_request, reply) => {
    if (!ready || shuttingDown) {
      return reply.code(503).send({
        status: "not_ready",
        service: "notification-worker",
      });
    }

    try {
      await prisma.$queryRaw`SELECT 1`;

      return {
        status: "ready",
        service: "notification-worker",
        database: "connected",
      };
    } catch {
      return reply.code(503).send({
        status: "not_ready",
        service: "notification-worker",
        database: "disconnected",
      });
    }
  });

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      shuttingDown = true;
      ready = false;

      // Ask the worker to stop processing.
      worker?.stop();

      // Wait for the worker loop to finish before disconnecting Prisma.
      if (workerRunPromise) {
        try {
          await workerRunPromise;
        } catch {
          // Preserve the original worker error, if any.
        }
      }

      try {
        await loggerHost.close();
      } finally {
        await prisma.$disconnect();
      }
    })();

    return shutdownPromise;
  };

  const handleSignal = (signal: string): void => {
    loggerHost.log.info({ signal }, "Notification worker shutting down");

    void shutdown().catch((error: unknown) => {
      loggerHost.log.error(
        getSafeErrorLogFields(error),
        "Worker shutdown failed",
      );
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));

  try {
    await prisma.$connect();

    await loggerHost.listen({
      host: "0.0.0.0",
      port: Number(process.env.PORT ?? 3000),
    });

    const sender = createFirebaseSender();

    worker = new NotificationWorker(
      new PrismaNotificationJobRepository(prisma),
      sender,
      { logger: loggerHost.log },
    );

    // Start the worker loop independently of the HTTP server.
    workerRunPromise = worker.run();

    ready = true;

    await workerRunPromise;
  } catch (error: unknown) {
    loggerHost.log.error(
      getSafeErrorLogFields(error),
      "Notification worker stopped",
    );
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
