import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
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
    await prisma.$connect();
    app.decorate("prisma", prisma);
    app.addHook("onClose", async () => {
        await prisma.$disconnect();
    });
}
