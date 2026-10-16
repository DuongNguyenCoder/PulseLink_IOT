import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

console.info("Worker runtime config", {
  nodeEnv: env.NODE_ENV,
  databaseUrlPresent: Boolean(env.DATABASE_URL),
  databaseUrlProtocol: (() => {
    try {
      return new URL(env.DATABASE_URL).protocol;
    } catch {
      return "invalid-url";
    }
  })(),
});

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
