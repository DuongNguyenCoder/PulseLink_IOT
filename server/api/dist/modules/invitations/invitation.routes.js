import { z } from "zod";
import { createAuthenticationHook } from "../auth/auth-hook.js";
import { acceptInvitation, createInvitation, getInvitation, inspectInvitation, InvitationError, listInvitations, resendInvitation, revokeInvitation } from "./invitation.service.js";
const storeParams = z.object({ storeId: z.string().min(1).max(128) });
const invitationParams = z.object({ storeId: z.string().min(1).max(128), invitationId: z.string().min(1).max(128) });
const statusQuery = z.object({ status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) });
const createBody = z.object({ email: z.string().email().max(254), role: z.literal("STAFF").optional() }).strict();
const tokenBody = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
function currentAccountId(request) {
    if (request.auth === undefined)
        throw new InvitationError("Authentication required", 401);
    return request.auth.accountId;
}
function parse(result) {
    if (!result.success)
        throw new InvitationError("Invalid request", 400);
    return result.data;
}
export const invitationRoutes = async (app, options) => {
    app.post("/invitations/inspect", async (request, reply) => {
        const body = parse(tokenBody.safeParse(request.body));
        const data = await inspectInvitation(app.prisma, body.token);
        return reply.send({ data, meta: { requestId: request.id } });
    });
    app.register(async (protectedApp) => {
        protectedApp.addHook("preHandler", createAuthenticationHook(options.verificationKeys));
        protectedApp.post("/stores/:storeId/invitations", async (request, reply) => {
            const params = parse(storeParams.safeParse(request.params));
            const body = parse(createBody.safeParse(request.body));
            const result = await createInvitation(app.prisma, currentAccountId(request), params.storeId, body, request.id);
            return reply.code(201).send({ data: result, meta: { requestId: request.id } });
        });
        protectedApp.get("/stores/:storeId/invitations", async (request, reply) => {
            const params = parse(storeParams.safeParse(request.params));
            const query = parse(statusQuery.safeParse(request.query));
            const result = await listInvitations(app.prisma, currentAccountId(request), params.storeId, query.status, query.page, query.limit);
            return reply.send({ data: result.items, meta: { requestId: request.id, page: result.page, limit: result.limit, total: result.total } });
        });
        protectedApp.get("/stores/:storeId/invitations/:invitationId", async (request, reply) => {
            const params = parse(invitationParams.safeParse(request.params));
            const invitation = await getInvitation(app.prisma, currentAccountId(request), params.storeId, params.invitationId);
            return reply.send({ data: invitation, meta: { requestId: request.id } });
        });
        protectedApp.post("/stores/:storeId/invitations/:invitationId/revoke", async (request, reply) => {
            const params = parse(invitationParams.safeParse(request.params));
            const data = await revokeInvitation(app.prisma, currentAccountId(request), params.storeId, params.invitationId, request.id);
            return reply.send({ data, meta: { requestId: request.id } });
        });
        protectedApp.post("/stores/:storeId/invitations/:invitationId/resend", async (request, reply) => {
            const params = parse(invitationParams.safeParse(request.params));
            const data = await resendInvitation(app.prisma, currentAccountId(request), params.storeId, params.invitationId, request.id);
            return reply.send({ data, meta: { requestId: request.id } });
        });
        protectedApp.post("/invitations/accept", async (request, reply) => {
            const body = parse(tokenBody.safeParse(request.body));
            const data = await acceptInvitation(app.prisma, currentAccountId(request), body.token, request.id);
            return reply.send({ data, meta: { requestId: request.id } });
        });
    });
};
