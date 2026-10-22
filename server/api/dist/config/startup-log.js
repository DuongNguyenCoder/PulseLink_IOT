export function writeStartupLog(event, fields = {}) {
    process.stderr.write(`${JSON.stringify({ component: "pulselink-api", event, ...fields })}\n`);
}
export function safeStartupError(error) {
    if (typeof error !== "object" || error === null) {
        return { errorType: typeof error };
    }
    const candidate = error;
    return {
        errorType: typeof candidate.name === "string" ? candidate.name : "UnknownError",
        ...(typeof candidate.code === "string"
            ? { errorCode: candidate.code }
            : {}),
    };
}
export function describeRedisEndpoint(redisUrl) {
    const parsed = new URL(redisUrl);
    return {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "rediss:" ? "6380" : "6379"),
    };
}
