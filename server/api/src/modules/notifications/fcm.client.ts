import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

export interface FcmMessage {
  token: string;
  data: Record<string, string>;
}

export interface FcmSender {
  send(message: FcmMessage): Promise<string>;
}

export class InvalidFcmTokenError extends Error {
  constructor() {
    super("FCM registration token is invalid");
    this.name = "InvalidFcmTokenError";
  }
}

export class TransientFcmError extends Error {
  constructor(message = "FCM is temporarily unavailable") {
    super(message);
    this.name = "TransientFcmError";
  }
}

export class PermanentFcmError extends Error {
  constructor(message = "FCM rejected the message") {
    super(message);
    this.name = "PermanentFcmError";
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function classifyFcmError(error: unknown): Error {
  const code = errorCode(error);
  if (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  ) {
    return new InvalidFcmTokenError();
  }
  if (
    code === "messaging/internal-error" ||
    code === "messaging/server-unavailable" ||
    code === "messaging/quota-exceeded" ||
    code === "messaging/too-many-requests"
  ) {
    return new TransientFcmError();
  }
  return new PermanentFcmError();
}

export class FirebaseAdminSender implements FcmSender {
  constructor(private readonly messaging: Messaging) {}

  async send(message: FcmMessage): Promise<string> {
    try {
      return await this.messaging.send({
        token: message.token,
        data: message.data,
      });
    } catch (error: unknown) {
      throw classifyFcmError(error);
    }
  }
}

export interface FirebaseEnvironment {
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}

export function createFirebaseSender(
  environment: FirebaseEnvironment = process.env,
): FcmSender {
  const projectId = environment.FCM_PROJECT_ID;
  const clientEmail = environment.FCM_CLIENT_EMAIL;
  const privateKey = environment.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("FCM credentials are not configured");
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  return new FirebaseAdminSender(getMessaging(app));
}
