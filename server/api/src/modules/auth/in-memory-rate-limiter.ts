export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiterInput {
  key: string;
  source: string;
}

export interface RateLimiter {
  allow(input: RateLimiterInput): Promise<boolean>;
}

/** A limiter failure is deliberately fail-closed at the route boundary. */
export class RateLimiterUnavailableError extends Error {
  readonly statusCode = 503;

  constructor() {
    super("Login protection is temporarily unavailable");
    this.name = "RateLimiterUnavailableError";
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A bounded single-process limiter. It is defense-in-depth only; deployments
 * with multiple API instances need an externally shared limiter as well.
 */
export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly windowMs: number,
    private readonly maxAttempts: number,
  ) {
    if (!Number.isInteger(windowMs) || windowMs <= 0)
      throw new Error("Rate-limit window must be positive");
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0)
      throw new Error("Rate-limit maximum must be positive");
  }

  allow(input: RateLimiterInput): Promise<boolean> {
    return Promise.resolve(this.check(input).allowed);
  }

  check(input: RateLimiterInput): RateLimitDecision {
    const now = Date.now();
    const bucketKey = `${input.source}:${input.key}`;
    const current = this.buckets.get(bucketKey);
    if (current === undefined || current.resetAt <= now) {
      this.buckets.set(bucketKey, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= this.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.resetAt - now) / 1000),
        ),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/**
 * Applies a finite boundary around local or future shared limiter adapters.
 * There is intentionally no fallback when the wrapped limiter fails or times out.
 */
export async function allowWithTimeout(
  limiter: RateLimiter,
  input: RateLimiterInput,
  timeoutMs: number,
): Promise<boolean> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("Rate-limit timeout must be positive");

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      limiter.allow(input),
      new Promise<boolean>((_, reject) => {
        timer = setTimeout(
          () => reject(new RateLimiterUnavailableError()),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof RateLimiterUnavailableError) throw error;
    throw new RateLimiterUnavailableError();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function withRateLimiterTimeout(
  limiter: RateLimiter,
  timeoutMs: number,
): RateLimiter {
  return {
    allow: (input) => allowWithTimeout(limiter, input, timeoutMs),
  };
}
