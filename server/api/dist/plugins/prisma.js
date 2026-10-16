import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
export function createPrismaClient() {
    const adapter = new PrismaPg({
        connectionString: env.DATABASE_URL,
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
