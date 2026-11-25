export const DEFAULT_NOTIFICATION_SOUND_ID = "sound_notification_1" as const;

export interface NotificationSoundDefinition {
  id: string;
  name: string;
  fileName: string;
  androidResourceName: string;
  androidChannelId: string;
  iosResourceName: string;
}

// This is an allowlisted, app-bundled catalog. There is deliberately no
// upload path or user-controlled file URL in this module.
export const NOTIFICATION_SOUNDS: readonly NotificationSoundDefinition[] = [
  {
    id: "sound_notification_1",
    name: "Chuông 1",
    fileName: "sound_notification_1.mp3",
    androidResourceName: "sound_notification_1",
    androidChannelId: "pulselink_service_calls_sound_notification_1",
    iosResourceName: "sound_notification_1.mp3",
  },
  {
    id: "sound_notification_2",
    name: "Chuông 2",
    fileName: "sound_notification_2.mp3",
    androidResourceName: "sound_notification_2",
    androidChannelId: "pulselink_service_calls_sound_notification_2",
    iosResourceName: "sound_notification_2.mp3",
  },
  {
    id: "sound_notification_3",
    name: "Chuông 3",
    fileName: "sound_notification_3.mp3",
    androidResourceName: "sound_notification_3",
    androidChannelId: "pulselink_service_calls_sound_notification_3",
    iosResourceName: "sound_notification_3.mp3",
  },
] as const;

const notificationSoundsById = new Map(
  NOTIFICATION_SOUNDS.map((sound) => [sound.id, sound]),
);

export function getNotificationSound(
  soundId: string | null | undefined,
): NotificationSoundDefinition {
  return (
    notificationSoundsById.get(soundId ?? "") ??
    notificationSoundsById.get(DEFAULT_NOTIFICATION_SOUND_ID)!
  );
}

export function isNotificationSoundId(value: string): boolean {
  return notificationSoundsById.has(value);
}
