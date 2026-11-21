import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/auth-hook.js", () => ({
  createAuthenticationHook: () => async (request: { auth?: { accountId: string } }) => {
    request.auth = { accountId: "account-1" };
  },
}));

import { notificationFeedRoutes } from "./notification-feed.routes.js";

const event = {
  id: "event-row-1",
  eventId: "0199aabb-ccdd-7eef-8123-456789abcdef",
  type: "BUTTON_PRESSED" as const,
  occurredAt: new Date("2026-11-21T10:00:00.000Z"),
  receivedAt: new Date("2026-11-21T10:00:01.000Z"),
  createdAt: new Date("2026-11-21T10:00:01.000Z"),
  device: { id: "pl-021122334455", name: "Bàn 1" },
  notifications: [{ status: "SENT" as const }],
};

function build() {
  const app = Fastify({ logger: false });
  app.decorate("prisma", {
    account: { findUnique: async () => ({ status: "ACTIVE", emailVerifiedAt: new Date() }) },
    store: { findUnique: async () => ({ id: "store-1", isActive: true }) },
    storeMembership: { findFirst: async () => ({ accountId: "account-1", storeId: "store-1", role: "STAFF", status: "ACTIVE" }) },
    deviceEvent: { findMany: async () => [event] },
  } as never);
  return app.register(notificationFeedRoutes, { prefix: "/v1/stores", verificationKeys: new Map() }).then(() => app);
}

describe("notification feed route", () => {
  it("returns account-scoped public feed metadata", async () => {
    const app = await build();
    const response = await app.inject({ method: "GET", url: "/v1/stores/store-1/notifications?limit=3" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items[0]).toMatchObject({
      id: event.id, eventId: event.eventId, status: "SENT", device: event.device,
    });
    expect(response.json().data.items[0]).not.toHaveProperty("fcmToken");
    await app.close();
  });

  it("validates limit and cursor at the HTTP boundary", async () => {
    const app = await build();
    expect((await app.inject({ method: "GET", url: "/v1/stores/store-1/notifications?limit=0" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/stores/store-1/notifications?cursor=bad" })).statusCode).toBe(400);
    await app.close();
  });
});
