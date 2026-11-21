import { z } from "zod";
import { createAuthenticationHook } from "../auth/auth-hook.js";
import { listNotificationFeed, NotificationFeedAuthorizationError, } from "./notification-feed.service.js";
const paramsSchema = z.object({ storeId: z.string().trim().min(1).max(128) });
const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().trim().min(1).max(512).optional(),
});
export const notificationFeedRoutes = async (app, options) => {
    app.addHook("preHandler", createAuthenticationHook(options.verificationKeys));
    app.get("/:storeId/notifications", async (request, reply) => {
        const params = paramsSchema.safeParse(request.params);
        const query = querySchema.safeParse(request.query);
        if (!params.success || !query.success)
            throw new NotificationFeedAuthorizationError("Invalid request", 400);
        const accountId = request.auth?.accountId;
        if (accountId === undefined)
            throw new NotificationFeedAuthorizationError("Authentication required", 401);
        const feed = await listNotificationFeed(app.prisma, accountId, params.data.storeId, query.data);
        return reply.send({ data: feed, meta: { requestId: request.id } });
    });
};
