import { createHmac } from "node:crypto";
const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
local allowed = 0
if current <= tonumber(ARGV[2]) then
  allowed = 1
end
return { allowed, ttl }
`;
function validatePositiveInteger(name, value) {
    if (!Number.isInteger(value) || value <= 0)
        throw new Error(`${name} must be positive`);
}
export function createRateLimitKey(namespace, secret, input) {
    if (namespace.length === 0 || namespace.length > 64)
        throw new Error("Rate-limit namespace is invalid");
    if (input.key.length === 0 || input.key.length > 512)
        throw new Error("Rate-limit identifier is invalid");
    if (input.source.length === 0 || input.source.length > 256)
        throw new Error("Rate-limit source is invalid");
    const digest = createHmac("sha256", secret)
        .update(`${input.source}\0${input.key}`)
        .digest("hex");
    return `${namespace}:login:${digest}`;
}
export class RedisRateLimiter {
    client;
    namespace;
    keySecret;
    windowMs;
    maxAttempts;
    constructor(client, namespace, keySecret, windowMs, maxAttempts) {
        this.client = client;
        this.namespace = namespace;
        this.keySecret = keySecret;
        this.windowMs = windowMs;
        this.maxAttempts = maxAttempts;
        validatePositiveInteger("Rate-limit window", windowMs);
        validatePositiveInteger("Rate-limit maximum", maxAttempts);
    }
    async allow(input) {
        const key = createRateLimitKey(this.namespace, this.keySecret, input);
        const result = await this.client.eval(RATE_LIMIT_SCRIPT, {
            keys: [key],
            arguments: [String(this.windowMs), String(this.maxAttempts)],
        });
        if (!Array.isArray(result) || result.length < 1) {
            throw new Error("Unexpected Redis rate-limit response");
        }
        const allowed = result[0];
        if (allowed !== 0 && allowed !== 1 && allowed !== "0" && allowed !== "1") {
            throw new Error("Unexpected Redis rate-limit decision");
        }
        return allowed === 1 || allowed === "1";
    }
}
export { RATE_LIMIT_SCRIPT };
