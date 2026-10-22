export function writeStartupLog(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  process.stderr.write(
    `${JSON.stringify({ component: "pulselink-api", event, ...fields })}\n`,
  );
}

export function safeStartupError(error: unknown): {
  errorType: string;
  errorCode?: string;
} {
  if (typeof error !== "object" || error === null) {
    return { errorType: typeof error };
  }

  const candidate = error as { name?: unknown; code?: unknown };
  return {
    errorType:
      typeof candidate.name === "string" ? candidate.name : "UnknownError",
    ...(typeof candidate.code === "string"
      ? { errorCode: candidate.code }
      : {}),
  };
}

export function describeRedisEndpoint(redisUrl: string): {
  protocol: string;
  hostname: string;
  port: string;
} {
  const parsed = new URL(redisUrl);
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === "rediss:" ? "6380" : "6379"),
  };
}
