import { getNotificationSound, isNotificationSoundId, NOTIFICATION_SOUNDS, } from "./notification-sound.catalog.js";
export class NotificationSoundError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.name = "NotificationSoundError";
        this.statusCode = statusCode;
    }
}
function responseFor(soundId) {
    return {
        sounds: NOTIFICATION_SOUNDS.map(({ id, name, fileName }) => ({
            id,
            name,
            fileName,
        })),
        selectedSoundId: getNotificationSound(soundId).id,
    };
}
export async function getNotificationSoundSettings(db, accountId) {
    const account = await db.account.findUnique({
        where: { id: accountId },
        select: { notificationSoundId: true },
    });
    if (account === null)
        throw new NotificationSoundError("Resource not found", 404);
    return responseFor(account.notificationSoundId);
}
export async function updateNotificationSound(db, accountId, soundId) {
    if (!isNotificationSoundId(soundId))
        throw new NotificationSoundError("Unsupported notification sound", 400);
    const account = await db.account.update({
        where: { id: accountId },
        data: { notificationSoundId: soundId },
        select: { notificationSoundId: true },
    });
    return responseFor(account.notificationSoundId);
}
