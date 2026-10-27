import Fastify from "fastify";
import { env } from "./config/env.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import type { HealthRouteOptions } from "./modules/health/health.routes.js";
import {
  authRoutes,
  type AuthRouteOptions,
} from "./modules/auth/auth.routes.js";
import {
  storeRoutes,
  type StoreRouteOptions,
} from "./modules/stores/store.routes.js";
import {
  installationRoutes,
  type InstallationRouteOptions,
} from "./modules/installations/installation.routes.js";
import {
  provisioningRoutes,
  type ProvisioningRouteOptions,
} from "./modules/provisioning/provisioning.routes.js";
import { deviceEventRoutes } from "./modules/device-events/device-event.routes.js";
import {
  emailVerificationRoutes,
  registerVerificationFormParser,
} from "./modules/auth/email-verification.routes.js";
import { registerPrisma } from "./plugins/prisma.js";
import { mapErrorToApiResponse } from "./shared/error-contract.js";
import { getSafeErrorLogFields, REDACTED_LOG_PATHS } from "./shared/logging.js";

export interface BuildAppOptions {
  health: HealthRouteOptions;
  auth: AuthRouteOptions;
  stores: StoreRouteOptions;
  installations: InstallationRouteOptions;
  provisioning: ProvisioningRouteOptions;
  notificationRecipientMode?: "legacy" | "account";
  close?: () => Promise<void>;
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [...REDACTED_LOG_PATHS],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 1024 * 1024,
    requestTimeout: 15_000,
  });

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    request.log.error(getSafeErrorLogFields(error), "Unhandled request error");
    const mapped = mapErrorToApiResponse(error, request.id);
    return reply.code(mapped.statusCode).send(mapped.response);
  });

  try {
    await registerPrisma(app);
  } catch (error: unknown) {
    app.log.error(getSafeErrorLogFields(error), "Failed to initialize Prisma");
    throw error;
  }
  registerVerificationFormParser(app);
  await app.register(healthRoutes, { ...options.health, prefix: "/health" });
  await app.register(authRoutes, { ...options.auth, prefix: "/v1/auth" });
  await app.register(emailVerificationRoutes);
  await app.register(storeRoutes, {
    ...options.stores,
    prefix: "/v1/stores",
  });
  await app.register(installationRoutes, {
    ...options.installations,
    prefix: "/v1/installations",
  });
  await app.register(provisioningRoutes, {
    ...options.provisioning,
    prefix: "/v1",
  });
  await app.register(deviceEventRoutes, {
    prefix: "/v1",
    recipientMode:
      options.notificationRecipientMode ?? env.NOTIFICATION_RECIPIENT_MODE,
  });
  app.addHook("onClose", async () => {
    await options.close?.();
  });

  return app;
}
