import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { invitationRoutes } from "./invitation.routes.js";
import { mapErrorToApiResponse } from "../../shared/error-contract.js";

function appWithDatabase(): ReturnType<typeof Fastify> {
  const app = Fastify();
  app.decorate("prisma", {
    storeInvitation: {
      findUnique: async () => ({
        id: "invitation-1",
        storeId: "store-1",
        role: "STAFF",
        status: "PENDING",
        expiresAt: new Date("2026-11-15T00:00:00.000Z"),
        createdAt: new Date("2026-11-08T00:00:00.000Z"),
        store: { id: "store-1", name: "Cafe", slug: "cafe" },
      }),
    },
  } as never);
  app.setErrorHandler((error, request, reply) => {
    const mapped = mapErrorToApiResponse(error, request.id);
    return reply.code(mapped.statusCode).send(mapped.response);
  });
  return app;
}

describe("invitation routes", () => {
  it("allows safe public inspection without returning recipient identity or token hash", async () => {
    const app = appWithDatabase();
    await app.register(invitationRoutes, { verificationKeys: new Map() });
    const response = await app.inject({ method: "POST", url: "/invitations/inspect", payload: { token: "A".repeat(43) } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: "invitation-1", status: "PENDING", role: "STAFF", store: { name: "Cafe" } });
    expect(response.json().data).not.toHaveProperty("recipientEmailNormalized");
    await app.close();
  });

  it("rejects Owner management without Account authentication", async () => {
    const app = appWithDatabase();
    await app.register(invitationRoutes, { verificationKeys: new Map() });
    const response = await app.inject({ method: "GET", url: "/stores/store-1/invitations" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
    await app.close();
  });
});
