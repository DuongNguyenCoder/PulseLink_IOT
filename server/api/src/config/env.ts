import "dotenv/config";
import { z } from "zod";
import { writeStartupLog } from "./startup-log.js";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  HEALTH_DIAGNOSTICS_TOKEN: z.string().min(32).optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_KEY_ID: z.string().min(1).optional(),
  JWT_SIGNING_KEY_PEM: z.string().min(1).optional(),
  JWT_VERIFICATION_KEY_PEM: z.string().min(1).optional(),
  FCM_ENCRYPTION_KEY_B64: z.string().min(1).optional(),
  FCM_FINGERPRINT_KEY_B64: z.string().min(1).optional(),
  FCM_KEY_VERSION: z.coerce.number().int().positive().optional(),
  OPERATOR_ENROLLMENT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_TIMEOUT_MS: z.coerce.number().int().positive().default(250),
  LOGIN_RATE_LIMIT_BACKEND: z.enum(["in-memory", "redis"]).default("in-memory"),
  REDIS_URL: z.string().url().optional(),
  REDIS_KEY_NAMESPACE: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9:_-]+$/)
    .default("pulselink"),
  LOGIN_RATE_LIMIT_KEY_SECRET: z.string().min(32).optional(),
  EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USERNAME: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM_EMAIL: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().min(1).max(120).default("PulseLink"),
  SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  EMAIL_VERIFICATION_URL_TEMPLATE: z
    .string()
    .url()
    .includes("{token}")
    .optional(),
  PASSWORD_RESET_URL_TEMPLATE: z.string().url().includes("{token}").optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Only report variable names/issues; never print the values of environment variables.
  const details = parsed.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  writeStartupLog("configuration.invalid", { details });
  throw new Error(
    `Invalid environment configuration: ${JSON.stringify(details)}`,
  );
}

export const env = parsed.data;
export type AppEnv = typeof env;
