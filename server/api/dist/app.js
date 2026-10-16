import Fastify from "fastify";
import { env } from "./config/env.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { storeRoutes } from "./modules/stores/store.routes.js";
import { installationRoutes } from "./modules/installations/installation.routes.js";
import { provisioningRoutes } from "./modules/provisioning/provisioning.routes.js";
import { deviceEventRoutes } from "./modules/device-events/device-event.routes.js";
import { registerPrisma } from "./plugins/prisma.js";
import { mapErrorToApiResponse } from "./shared/error-contract.js";
import { getSafeErrorLogFields, REDACTED_LOG_PATHS, } from "./shared/logging.js";
export async function buildApp(options = {}) {
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
    app.setErrorHandler((error, request, reply) => {
        request.log.error(getSafeErrorLogFields(error), "Unhandled request error");
        const mapped = mapErrorToApiResponse(error, request.id);
        return reply.code(mapped.statusCode).send(mapped.response);
    });
    try {
        await registerPrisma(app);
    }
    catch (error) {
        app.log.error(getSafeErrorLogFields(error), "Failed to initialize Prisma");
        throw error;
    }
    await app.register(healthRoutes, { prefix: "/health" });
    if (options.auth) {
        await app.register(authRoutes, { ...options.auth, prefix: "/v1/auth" });
    }
    if (options.stores) {
        await app.register(storeRoutes, { ...options.stores, prefix: "/v1/stores" });
    }
    if (options.installations) {
        await app.register(installationRoutes, { ...options.installations, prefix: "/v1/installations" });
    }
    if (options.provisioning) {
        await app.register(provisioningRoutes, { ...options.provisioning, prefix: "/v1" });
    }
    await app.register(deviceEventRoutes, { prefix: "/v1" });
    return app;
}
