import Fastify from "fastify";
import { createFirebaseSender } from "./modules/notifications/fcm.client.js";
import { PrismaNotificationJobRepository } from "./modules/notifications/notification-repository.js";
import { NotificationWorker } from "./modules/notifications/notification-worker.js";
import { createPrismaClient } from "./plugins/prisma.js";
async function main() {
    const prisma = createPrismaClient();
    const sender = createFirebaseSender();
    const loggerHost = Fastify();
    const worker = new NotificationWorker(new PrismaNotificationJobRepository(prisma), sender, { logger: loggerHost.log });
    const shutdown = async () => {
        worker.stop();
        await prisma.$disconnect();
        await loggerHost.close();
    };
    process.once("SIGINT", () => void shutdown());
    process.once("SIGTERM", () => void shutdown());
    await prisma.$connect();
    await worker.run();
}
void main().catch(async (error) => {
    void error;
    process.stderr.write("Notification worker stopped before entering its run loop\n");
    process.exitCode = 1;
});
