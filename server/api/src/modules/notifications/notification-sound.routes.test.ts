import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.mock("../auth/auth-hook.js", () => ({
  createAuthenticationHook:
    () => async (request: { auth?: { accountId: string } }) => {
      request.auth = { accountId: "account-1" };
    },
}));

import { notificationSoundRoutes } from "./notification-sound.routes.js";

function build() {
  const app = Fastify({ logger: false });
  app.decorate("prisma", {
    account: {
      findUnique: async () => ({ notificationSoundId: "sound_notification_1" }),
      update: async () => ({ notificationSoundId: "sound_notification_2" }),
    },
  } as never);
  return app
    .register(notificationSoundRoutes, {
      prefix: "/v1/account",
      verificationKeys: new Map(),
    })
    .then(() => app);
}

describe("notification sound routes", () => {
  it("lists the fixed catalog without an upload contract", async () => {
    const app = await build();
    const response = await app.inject({
      method: "GET",
      url: "/v1/account/notification-sounds",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.selectedSoundId).toBe("sound_notification_1");
    expect(response.json().data.sounds).toHaveLength(3);
    await app.close();
  });

  it("validates and updates only a catalog sound", async () => {
    const app = await build();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/account/notification-sound",
          payload: { soundId: "user-upload.mp3" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: "/v1/account/notification-sound",
          payload: { soundId: "sound_notification_2" },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });
});
