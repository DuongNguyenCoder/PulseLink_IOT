import { describe, expect, it } from "vitest";
import {
  listNotificationFeed,
  type NotificationFeedDatabase,
} from "./notification-feed.service.js";

const event = {
  id: "event-row-2",
  eventId: "0199aabb-ccdd-7eef-8123-456789abcdee",
  type: "BUTTON_PRESSED" as const,
  status: "PROCESSED" as const,
  occurredAt: new Date("2026-11-21T10:00:00.000Z"),
  receivedAt: new Date("2026-11-21T10:00:01.000Z"),
  createdAt: new Date("2026-11-21T10:00:01.000Z"),
  device: { id: "pl-021122334455", name: "Bàn 2" },
};

function database(events = [event], onFindMany?: (args: unknown) => void): NotificationFeedDatabase {
  return {
    account: { findUnique: async () => ({ status: "ACTIVE", emailVerifiedAt: new Date() }) },
    store: { findUnique: async () => ({ id: "store-1", isActive: true }) },
    storeMembership: {
      findFirst: async () => ({ accountId: "account-1", storeId: "store-1", role: "STAFF", status: "ACTIVE" }),
    },
    device: { create: async () => { throw new Error("unused"); }, findMany: async () => [] },
    auditEvent: { create: async () => ({}) },
    $transaction: async () => { throw new Error("unused"); },
    deviceEvent: { findMany: async (args) => { onFindMany?.(args); return events; } },
  };
}

describe("notification feed", () => {
  it("returns Account-scoped event metadata for STAFF and no secrets", async () => {
    const result = await listNotificationFeed(database(), "account-1", "store-1");
    expect(result.items).toEqual([{
      id: event.id,
      eventId: event.eventId,
      type: "BUTTON_PRESSED",
      status: "PROCESSED",
      occurredAt: event.occurredAt,
      receivedAt: event.receivedAt,
      createdAt: event.createdAt,
      device: event.device,
    }]);
    expect(JSON.stringify(result)).not.toContain("fcm");
  });

  it("uses a cursor and asks the database for a bounded page", async () => {
    const first = await listNotificationFeed(database([event, { ...event, id: "event-row-1", createdAt: new Date("2026-11-21T09:00:00.000Z") }]), "account-1", "store-1", { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const result = await listNotificationFeed(database([event]), "account-1", "store-1", { cursor: first.nextCursor ?? undefined });
    expect(result.items).toHaveLength(1);
  });

  it("returns all store events without querying app installations", async () => {
    let query: { where?: Record<string, unknown> } | undefined;
    const result = await listNotificationFeed(
      database([event], (args) => { query = args as typeof query; }),
      "account-1",
      "store-1",
    );

    expect(result.items[0]).toMatchObject({
      eventId: event.eventId,
      device: event.device,
      status: "PROCESSED",
    });
    expect(query?.where).not.toHaveProperty("notifications");
    expect(query).toMatchObject({ orderBy: [{ receivedAt: "desc" }, { id: "desc" }] });
  });

  it("rejects invalid cursors and inactive membership", async () => {
    await expect(listNotificationFeed(database(), "account-1", "store-1", { cursor: "bad" }))
      .rejects.toMatchObject({ statusCode: 400 });
    const db = database();
    db.storeMembership.findFirst = async () => null;
    await expect(listNotificationFeed(db, "account-1", "store-1"))
      .rejects.toMatchObject({ statusCode: 404 });
  });
});
