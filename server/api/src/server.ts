import Fastify from "fastify";
import "dotenv/config";

const app = Fastify({
  logger: true,
});

app.get("/health", async () => {
  return {
    status: "ok",
    service: "ketnoi-api",
    timestamp: new Date().toISOString(),
  };
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
