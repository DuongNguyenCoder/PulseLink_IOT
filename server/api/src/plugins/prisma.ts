import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
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
