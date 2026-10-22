import { env } from "./config/env.js";
import { createRuntimeOptions } from "./config/runtime.js";
import { buildApp } from "./app.js";
import { getSafeErrorLogFields } from "./shared/logging.js";

async function main(): Promise<void> {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let runtimeClose: (() => Promise<void>) | undefined;

  try {
    const runtimeOptions = await createRuntimeOptions();
    runtimeClose = runtimeOptions.close;
    app = await buildApp(runtimeOptions);

    const shutdown = async (signal: string): Promise<void> => {
      app?.log.info({ signal }, "Shutting down PulseLink API");
      try {
        await app?.close();
        process.exitCode = 0;
      } catch (error: unknown) {
        app?.log.error(
          getSafeErrorLogFields(error),
          "Error during graceful shutdown",
        );
        process.exitCode = 1;
      }
    };

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (error: unknown) {
    if (app) {
      app.log.error(
        getSafeErrorLogFields(error),
        "Failed to start PulseLink API",
      );
      await app.close();
    } else {
      await runtimeClose?.();
    }
    process.exitCode = 1;
  }
}

void main();
