import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { deviceEventRoutes } from "./device-event.routes.js";
import { hashDeviceToken } from "../provisioning/provisioning-crypto.js";
describe("device event route", () => {
    it("requires the device bearer token and accepts a valid event", async () => {
        const app = Fastify();
        const fakePrisma = {
            device: {
                findFirst: async () => ({
                    id: "device-a",
                    deviceKey: "button-a",
                    deviceSecretHash: hashDeviceToken("device-token"),
                    storeId: "store-a",
                    status: "ONLINE",
                    provisioningState: "PROVISIONED",
                    enrollmentStatus: "ENROLLED",
                    enrollmentPublicKey: null,
                    enrollmentKeyVersion: null,
                }),
            },
            $transaction: async (callback) => callback({
                deviceEvent: {
                    create: async () => ({
                        id: "event-row-a",
                        eventId: "0199aabb-ccdd-7eef-8123-456789abcdef",
                        deviceId: "device-a",
                        type: "BUTTON_PRESSED",
                        status: "RECEIVED",
                        occurredAt: new Date("2026-10-15T14:00:00.000Z"),
                        receivedAt: new Date(),
                        firmwareVersion: null,
                        rssiDbm: null,
                        payload: null,
                    }),
                },
                staffPushToken: { findMany: async () => [] },
                deviceNotification: { createMany: async () => ({ count: 0 }) },
            }),
        };
        app.decorate("prisma", fakePrisma);
        await app.register(deviceEventRoutes, { prefix: "/v1" });
        const unauthorized = await app.inject({
            method: "POST",
            url: "/v1/device-events",
            payload: {},
        });
        expect(unauthorized.statusCode).toBe(400);
        const accepted = await app.inject({
            method: "POST",
            url: "/v1/device-events",
            headers: { authorization: "Bearer device-token" },
            payload: {
                eventId: "0199aabb-ccdd-7eef-8123-456789abcdef",
                type: "BUTTON_PRESSED",
                occurredAt: "2026-10-15T14:00:00.000Z",
            },
        });
        expect(accepted.statusCode).toBe(201);
        await app.close();
    });
});
