export const DEFAULT_NOTIFICATION_SOUND_ID = "sound_notification_1";
// This is an allowlisted, app-bundled catalog. There is deliberately no
// upload path or user-controlled file URL in this module.
export const NOTIFICATION_SOUNDS = [
    {
        id: "sound_notification_1",
        name: "Chuông 1",
        fileName: "sound_notification_1.mp3",
        androidResourceName: "sound_notification_1",
        iosResourceName: "sound_notification_1.mp3",
    },
    {
        id: "sound_notification_2",
        name: "Chuông 2",
        fileName: "sound_notification_2.mp3",
        androidResourceName: "sound_notification_2",
        iosResourceName: "sound_notification_2.mp3",
    },
    {
        id: "sound_notification_3",
        name: "Chuông 3",
        fileName: "sound_notification_3.mp3",
        androidResourceName: "sound_notification_3",
        iosResourceName: "sound_notification_3.mp3",
    },
];
const notificationSoundsById = new Map(NOTIFICATION_SOUNDS.map((sound) => [sound.id, sound]));
export function getNotificationSound(soundId) {
    return (notificationSoundsById.get(soundId ?? "") ??
        notificationSoundsById.get(DEFAULT_NOTIFICATION_SOUND_ID));
}
export function isNotificationSoundId(value) {
    return notificationSoundsById.has(value);
}
