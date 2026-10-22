import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

const raw = process.env.DB_SSL_CA ?? "";
const ca = raw.replace(/\\n/g, "\n").trim();

export function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    ssl: {
      ca: ca || undefined,
      rejectUnauthorized: true,
    },
  });
  return new PrismaClient({ adapter });
}

export async function registerPrisma(app: FastifyInstance): Promise<void> {
  const prisma = createPrismaClient();

  await prisma.$connect();
  app.decorate("prisma", prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
}
