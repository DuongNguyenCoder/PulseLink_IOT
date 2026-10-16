import { describe, expect, it } from "vitest";
import { deviceEventBodySchema } from "./device-event.schema.js";
const validEvent = {
    eventId: "0199aabb-ccdd-7eef-8123-456789abcdef",
    type: "BUTTON_PRESSED",
    occurredAt: "2026-10-15T14:00:00.000Z",
    firmwareVersion: "0.1.0",
    rssiDbm: -60,
    payload: { button: "main" },
};
describe("device event request schema", () => {
    it("accepts the documented event", () => {
        expect(deviceEventBodySchema.safeParse(validEvent).success).toBe(true);
    });
    it.each([
        ["invalid UUID", { eventId: "not-a-uuid" }],
        ["unsupported type", { type: "UNKNOWN" }],
        ["invalid timestamp", { occurredAt: "yesterday" }],
        ["firmware version too long", { firmwareVersion: "x".repeat(41) }],
        ["RSSI has the wrong type", { rssiDbm: "-60" }],
        ["RSSI is outside the supported range", { rssiDbm: -201 }],
        ["required field is missing", { type: undefined }],
    ])("%s", (_name, change) => {
        expect(deviceEventBodySchema.safeParse({ ...validEvent, ...change }).success).toBe(false);
    });
    it("rejects unknown request fields and oversized payloads", () => {
        expect(deviceEventBodySchema.safeParse({
            ...validEvent,
            deviceKey: "not-accepted",
        }).success).toBe(false);
        expect(deviceEventBodySchema.safeParse({
            ...validEvent,
            payload: { value: "x".repeat(32 * 1024) },
        }).success).toBe(false);
    });
});
