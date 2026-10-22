import { importPKCS8, importSPKI, type KeyInput } from "jose";
import type { BuildAppOptions } from "../app.js";
import { env } from "./env.js";
import {
  SmtpEmailSender,
  unavailableEmailSender,
} from "../modules/auth/email-sender.js";
import {
  InMemoryRateLimiter,
  withRateLimiterTimeout,
} from "../modules/auth/in-memory-rate-limiter.js";
import { createClient } from "redis";
import { RedisRateLimiter } from "../modules/auth/redis-rate-limiter.js";
import { type FcmKeyMaterial } from "../modules/installations/fcm-crypto.js";

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "")
    throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function decodeKey(name: string, value: string | undefined): Buffer {
  const encoded = required(name, value);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, "base64");
  } catch {
    throw new Error(`Invalid base64 configuration: ${name}`);
  }
  if (decoded.length !== 32)
    throw new Error(`Configuration ${name} must decode to 32 bytes`);
  return decoded;
}

async function loadJwtKeys(): Promise<{
  signingKey: { kid: string; privateKeyPem: string };
  verificationKeys: ReadonlyMap<string, KeyInput>;
}> {
  const kid = required("JWT_KEY_ID", env.JWT_KEY_ID);
  const privateKeyPem = required(
    "JWT_SIGNING_KEY_PEM",
    env.JWT_SIGNING_KEY_PEM,
  ).replaceAll("\\n", "\n");
  const publicKeyPem = required(
    "JWT_VERIFICATION_KEY_PEM",
    env.JWT_VERIFICATION_KEY_PEM,
  ).replaceAll("\\n", "\n");
  await importPKCS8(privateKeyPem, "RS256");
  const verificationKey = await importSPKI(publicKeyPem, "RS256");
  return {
    signingKey: { kid, privateKeyPem },
    verificationKeys: new Map([[kid, verificationKey]]),
  };
}

function loadFcmKeys(): FcmKeyMaterial {
  const activeVersion = env.FCM_KEY_VERSION;
  if (activeVersion === undefined)
    throw new Error("Missing required configuration: FCM_KEY_VERSION");
  return {
    activeVersion,
    encryptionKeys: new Map([
      [
        activeVersion,
        decodeKey("FCM_ENCRYPTION_KEY_B64", env.FCM_ENCRYPTION_KEY_B64),
      ],
    ]),
    fingerprintKey: decodeKey(
      "FCM_FINGERPRINT_KEY_B64",
      env.FCM_FINGERPRINT_KEY_B64,
    ),
  };
}

async function withStartupTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Rate-limit backend startup timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function createLoginRateLimiter(): Promise<{
  limiter: ReturnType<typeof withRateLimiterTimeout>;
  close: () => Promise<void>;
}> {
  if (env.LOGIN_RATE_LIMIT_BACKEND !== "redis") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "Production requires LOGIN_RATE_LIMIT_BACKEND=redis for distributed login protection",
      );
    }
    const limiter = withRateLimiterTimeout(
      new InMemoryRateLimiter(
        env.LOGIN_RATE_LIMIT_WINDOW_MS,
        env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      ),
      env.LOGIN_RATE_LIMIT_TIMEOUT_MS,
    );
    return { limiter, close: async () => undefined };
  }

  const redisUrl = required("REDIS_URL", env.REDIS_URL);
  const keySecret = required(
    "LOGIN_RATE_LIMIT_KEY_SECRET",
    env.LOGIN_RATE_LIMIT_KEY_SECRET,
  );
  if (env.NODE_ENV === "production" && !redisUrl.startsWith("redis://")) {
    throw new Error("Production Redis rate limiting requires a redis:// URL");
  }

  const client = createClient({
    url: redisUrl,
    socket: { connectTimeout: env.LOGIN_RATE_LIMIT_TIMEOUT_MS },
  });
  client.on("error", () => undefined);
  try {
    await withStartupTimeout(client.connect(), env.LOGIN_RATE_LIMIT_TIMEOUT_MS);
    await withStartupTimeout(client.ping(), env.LOGIN_RATE_LIMIT_TIMEOUT_MS);
  } catch (error) {
    if (client.isOpen) await client.quit().catch(() => undefined);
    throw new Error("Redis rate-limit backend is unavailable", {
      cause: error,
    });
  }

  const limiter = withRateLimiterTimeout(
    new RedisRateLimiter(
      client,
      `${env.REDIS_KEY_NAMESPACE}:${env.NODE_ENV}`,
      keySecret,
      env.LOGIN_RATE_LIMIT_WINDOW_MS,
      env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    ),
    env.LOGIN_RATE_LIMIT_TIMEOUT_MS,
  );
  return {
    limiter,
    close: async () => {
      if (client.isOpen) await client.quit();
    },
  };
}

function validateProductionRateLimiterConfiguration(): void {
  if (env.NODE_ENV !== "production") return;
  if (env.LOGIN_RATE_LIMIT_BACKEND !== "redis") {
    throw new Error(
      "Production requires LOGIN_RATE_LIMIT_BACKEND=redis for distributed login protection",
    );
  }
  const redisUrl = required("REDIS_URL", env.REDIS_URL);
  required("LOGIN_RATE_LIMIT_KEY_SECRET", env.LOGIN_RATE_LIMIT_KEY_SECRET);
  if (!redisUrl.startsWith("redis://")) {
    throw new Error("Production Redis rate limiting requires a redis:// URL");
  }
}

function createEmailSender() {
  const values = [
    env.SMTP_HOST,
    env.SMTP_FROM_EMAIL,
    env.EMAIL_VERIFICATION_URL_TEMPLATE,
    env.PASSWORD_RESET_URL_TEMPLATE,
  ];
  const configured = values.every((value) => value !== undefined);
  if (!configured) {
    if (env.NODE_ENV === "production")
      throw new Error("SMTP email provider configuration is incomplete");
    return unavailableEmailSender;
  }
  if (env.SMTP_USERNAME !== undefined && env.SMTP_PASSWORD === undefined) {
    throw new Error("SMTP_PASSWORD is required with SMTP_USERNAME");
  }
  if (env.NODE_ENV === "production") {
    for (const template of [
      env.EMAIL_VERIFICATION_URL_TEMPLATE,
      env.PASSWORD_RESET_URL_TEMPLATE,
    ]) {
      if (!template?.startsWith("https://"))
        throw new Error("Production email links must use HTTPS");
    }
  }
  return new SmtpEmailSender({
    host: env.SMTP_HOST as string,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    username: env.SMTP_USERNAME,
    password: env.SMTP_PASSWORD,
    fromEmail: env.SMTP_FROM_EMAIL as string,
    fromName: env.SMTP_FROM_NAME,
    verificationUrlTemplate: env.EMAIL_VERIFICATION_URL_TEMPLATE as string,
    passwordResetUrlTemplate: env.PASSWORD_RESET_URL_TEMPLATE as string,
    timeoutMs: env.SMTP_TIMEOUT_MS,
  });
}

export async function createRuntimeOptions(): Promise<BuildAppOptions> {
  const healthDiagnosticsToken = env.HEALTH_DIAGNOSTICS_TOKEN;
  validateProductionRateLimiterConfiguration();
  if (env.NODE_ENV === "production") {
    required("HEALTH_DIAGNOSTICS_TOKEN", healthDiagnosticsToken);
  }
  if (env.OPERATOR_ENROLLMENT_ENABLED) {
    throw new Error(
      "Operator enrollment is enabled but no authorizer implementation is configured",
    );
  }
  const jwt = await loadJwtKeys();
  const fcmKeys = loadFcmKeys();
  const { limiter: loginRateLimiter, close: closeLoginRateLimiter } =
    await createLoginRateLimiter();
  const emailSender = createEmailSender();
  const passwordResetRateLimiter = withRateLimiterTimeout(
    new InMemoryRateLimiter(
      env.LOGIN_RATE_LIMIT_WINDOW_MS,
      env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    ),
    env.LOGIN_RATE_LIMIT_TIMEOUT_MS,
  );

  return {
    health: { diagnosticsToken: healthDiagnosticsToken },
    auth: {
      emailSender,
      signingKey: jwt.signingKey,
      passwordResetRateLimiter,
      loginRateLimiter,
      fcmKeys,
    },
    close: closeLoginRateLimiter,
    stores: { verificationKeys: jwt.verificationKeys },
    installations: { verificationKeys: jwt.verificationKeys, fcmKeys },
    provisioning: {
      verificationKeys: jwt.verificationKeys,
    },
  };
}
