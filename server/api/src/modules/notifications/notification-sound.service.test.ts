import { describe, expect, it, vi } from "vitest";
import {
  getNotificationSoundSettings,
  NotificationSoundError,
  updateNotificationSound,
} from "./notification-sound.service.js";

describe("notification sound service", () => {
  it("returns the fixed catalog and account selection", async () => {
    const db = {
      account: {
        findUnique: vi.fn().mockResolvedValue({
          notificationSoundId: "sound_notification_2",
        }),
        update: vi.fn(),
      },
    };

    await expect(
      getNotificationSoundSettings(db, "account-1"),
    ).resolves.toEqual({
      selectedSoundId: "sound_notification_2",
      sounds: [
        {
          id: "sound_notification_1",
          name: "Chuông 1",
          fileName: "sound_notification_1.mp3",
        },
        {
          id: "sound_notification_2",
          name: "Chuông 2",
          fileName: "sound_notification_2.mp3",
        },
        {
          id: "sound_notification_3",
          name: "Chuông 3",
          fileName: "sound_notification_3.mp3",
        },
      ],
    });
  });

  it("rejects sound IDs outside the built-in catalog", async () => {
    const db = { account: { findUnique: vi.fn(), update: vi.fn() } };
    await expect(
      updateNotificationSound(db, "account-1", "uploaded.mp3"),
    ).rejects.toBeInstanceOf(NotificationSoundError);
    expect(db.account.update).not.toHaveBeenCalled();
  });

  it("persists a valid built-in sound for the authenticated account", async () => {
    const db = {
      account: {
        findUnique: vi.fn(),
        update: vi
          .fn()
          .mockResolvedValue({ notificationSoundId: "sound_notification_3" }),
      },
    };
    await expect(
      updateNotificationSound(db, "account-1", "sound_notification_3"),
    ).resolves.toMatchObject({ selectedSoundId: "sound_notification_3" });
    expect(db.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "account-1" },
        data: { notificationSoundId: "sound_notification_3" },
      }),
    );
  });

  it("fails closed when the authenticated account no longer exists", async () => {
    const db = {
      account: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    await expect(
      getNotificationSoundSettings(db, "missing-account"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
