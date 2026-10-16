import { z } from 'zod';
import { createAuthenticationHook } from '../auth/auth-hook.js';
import { cancelProvisioningSession, createProvisioningSession, enrollDevice, getProvisioningSession, listProvisioningSessions, redeemProvisioningSession, revokeDeviceEnrollment, ProvisioningError, } from './provisioning.service.js';
const storeParams = z.object({ storeId: z.string().min(1).max(128) });
const sessionParams = z.object({ storeId: z.string().min(1).max(128), sessionId: z.string().min(1).max(128) });
const deviceParams = z.object({ deviceId: z.string().min(1).max(128) });
const deviceSessionParams = z.object({ deviceId: z.string().min(1).max(128), sessionId: z.string().min(1).max(128) });
const createSessionBody = z.object({
    deviceId: z.string().min(1).max(128),
    idempotencyKey: z.string().min(16).max(128),
});
const enrollmentBody = z.object({
    publicKey: z.string().min(32).max(2048).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    keyVersion: z.number().int().min(1).max(1_000_000),
});
const redeemBody = z.object({
    bootstrapSecret: z.string().min(32).max(256),
    challenge: z.string().min(32).max(256),
    signature: z.string().min(32).max(1024),
});
function accountId(request) {
    if (request.auth === undefined)
        throw new ProvisioningError('Authentication required', 401);
    return request.auth.accountId;
}
function parseOrThrow(result) {
    if (!result.success)
        throw new ProvisioningError('Invalid request', 400);
    return result.data;
}
export const provisioningRoutes = async (app, options) => {
    app.post('/operator/devices/:deviceId/enrollment', async (request, reply) => {
        const params = parseOrThrow(deviceParams.safeParse(request.params));
        const body = parseOrThrow(enrollmentBody.safeParse(request.body));
        const actor = await options.enrollmentAuthorizer(request);
        const device = await enrollDevice(app.prisma, actor, params.deviceId, body, request.id);
        return reply.code(201).send({
            data: {
                deviceId: device.id,
                storeId: device.storeId,
                enrollmentStatus: device.enrollmentStatus,
                provisioningState: device.provisioningState,
                enrollmentKeyVersion: device.enrollmentKeyVersion,
            },
            meta: { requestId: request.id },
        });
    });
    app.post('/operator/devices/:deviceId/enrollment/revoke', async (request, reply) => {
        const params = parseOrThrow(deviceParams.safeParse(request.params));
        const actor = await options.enrollmentAuthorizer(request);
        await revokeDeviceEnrollment(app.prisma, actor, params.deviceId, request.id);
        return reply.send({ data: { revoked: true }, meta: { requestId: request.id } });
    });
    app.register(async (protectedApp) => {
        protectedApp.addHook('preHandler', createAuthenticationHook(options.verificationKeys));
        protectedApp.post('/stores/:storeId/provisioning-sessions', async (request, reply) => {
            const params = parseOrThrow(storeParams.safeParse(request.params));
            const body = parseOrThrow(createSessionBody.safeParse(request.body));
            const result = await createProvisioningSession(app.prisma, accountId(request), params.storeId, body, request.id);
            return reply.code(201).send({
                data: {
                    session: result.session,
                    bootstrapSecret: result.bootstrapSecret,
                    challenge: result.challenge,
                },
                meta: { requestId: request.id },
            });
        });
        protectedApp.get('/stores/:storeId/provisioning-sessions', async (request, reply) => {
            const params = parseOrThrow(storeParams.safeParse(request.params));
            const sessions = await listProvisioningSessions(app.prisma, accountId(request), params.storeId);
            return reply.send({ data: sessions, meta: { requestId: request.id } });
        });
        protectedApp.get('/stores/:storeId/provisioning-sessions/:sessionId', async (request, reply) => {
            const params = parseOrThrow(sessionParams.safeParse(request.params));
            const session = await getProvisioningSession(app.prisma, accountId(request), params.storeId, params.sessionId);
            return reply.send({ data: session, meta: { requestId: request.id } });
        });
        protectedApp.post('/stores/:storeId/provisioning-sessions/:sessionId/cancel', async (request, reply) => {
            const params = parseOrThrow(sessionParams.safeParse(request.params));
            await cancelProvisioningSession(app.prisma, accountId(request), params.storeId, params.sessionId, request.id);
            return reply.send({ data: { revoked: true }, meta: { requestId: request.id } });
        });
    });
    app.post('/devices/:deviceId/provisioning-sessions/:sessionId/redeem', async (request, reply) => {
        const params = parseOrThrow(deviceSessionParams.safeParse(request.params));
        const body = parseOrThrow(redeemBody.safeParse(request.body));
        const result = await redeemProvisioningSession(app.prisma, { ...params, ...body }, request.id);
        return reply.send({
            data: { deviceId: result.deviceId, sessionId: result.sessionId, operationalToken: result.operationalToken },
            meta: { requestId: request.id },
        });
    });
};
