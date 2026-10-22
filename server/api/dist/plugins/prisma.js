import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { safeStartupError, writeStartupLog } from "../config/startup-log.js";
const raw = process.env.DB_SSL_CA ?? "";
const ca = raw.replace(/\\n/g, "\n").trim();
export function createPrismaClient() {
    const adapter = new PrismaPg({
        connectionString: env.DATABASE_URL,
        ssl: {
            ca: ca || undefined,
            rejectUnauthorized: true,
        },
    });
    return new PrismaClient({ adapter });
}
export async function registerPrisma(app) {
    const prisma = createPrismaClient();
    writeStartupLog("postgres.connect.start");
    try {
        await prisma.$connect();
    }
    catch (error) {
        writeStartupLog("postgres.connect.failure", safeStartupError(error));
        throw error;
    }
    writeStartupLog("postgres.connect.success");
    app.decorate("prisma", prisma);
    app.addHook("onClose", async () => {
        await prisma.$disconnect();
    });
}
