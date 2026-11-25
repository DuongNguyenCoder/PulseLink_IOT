import {
  getNotificationSound,
  isNotificationSoundId,
  NOTIFICATION_SOUNDS,
} from "./notification-sound.catalog.js";

export interface NotificationSoundDatabase {
  account: {
    findUnique(args: unknown): Promise<{ notificationSoundId: string } | null>;
    update(args: unknown): Promise<{ notificationSoundId: string }>;
  };
}

export class NotificationSoundError extends Error {
  readonly statusCode: 400 | 401 | 404;

  constructor(message: string, statusCode: 400 | 401 | 404) {
    super(message);
    this.name = "NotificationSoundError";
    this.statusCode = statusCode;
  }
}

export interface NotificationSoundResponse {
  sounds: Array<{ id: string; name: string; fileName: string }>;
  selectedSoundId: string;
}

function responseFor(soundId: string): NotificationSoundResponse {
  return {
    sounds: NOTIFICATION_SOUNDS.map(({ id, name, fileName }) => ({
      id,
      name,
      fileName,
    })),
    selectedSoundId: getNotificationSound(soundId).id,
  };
}

export async function getNotificationSoundSettings(
  db: NotificationSoundDatabase,
  accountId: string,
): Promise<NotificationSoundResponse> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: { notificationSoundId: true },
  });
  if (account === null)
    throw new NotificationSoundError("Resource not found", 404);
  return responseFor(account.notificationSoundId);
}

export async function updateNotificationSound(
  db: NotificationSoundDatabase,
  accountId: string,
  soundId: string,
): Promise<NotificationSoundResponse> {
  if (!isNotificationSoundId(soundId))
    throw new NotificationSoundError("Unsupported notification sound", 400);
  const account = await db.account.update({
    where: { id: accountId },
    data: { notificationSoundId: soundId },
    select: { notificationSoundId: true },
  });
  return responseFor(account.notificationSoundId);
}
