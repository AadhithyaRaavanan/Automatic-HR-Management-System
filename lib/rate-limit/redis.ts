import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitType =
  | "login_ip"
  | "login_email"
  | "forgot_password"
  | "verify_otp"
  | "admin"
  | "punch";

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
  upstashWindow: `${number} m` | `${number} h` | `${number} s`;
}

export const RATE_LIMIT_CONFIGS: Record<RateLimitType, RateLimitConfig> = {
  login_ip: { limit: 5, windowMs: 15 * 60 * 1000, upstashWindow: "15 m" },
  login_email: { limit: 5, windowMs: 15 * 60 * 1000, upstashWindow: "15 m" },
  forgot_password: { limit: 3, windowMs: 60 * 60 * 1000, upstashWindow: "1 h" },
  verify_otp: { limit: 5, windowMs: 15 * 60 * 1000, upstashWindow: "15 m" },
  admin: { limit: 60, windowMs: 60 * 1000, upstashWindow: "1 m" },
  punch: { limit: 10, windowMs: 60 * 1000, upstashWindow: "1 m" },
};

export interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in ms
  retryAfterSeconds: number;
}

// In-Memory Sliding Window Store for local dev, test, and Redis fallback
const memorySlidingStore = new Map<string, number[]>();

export function clearMemoryRateLimitStore(): void {
  memorySlidingStore.clear();
}

/**
 * Check rate limit using either Upstash Redis (if configured) or an accurate
 * in-memory sliding window algorithm.
 */
export async function checkRateLimitDistributed(
  type: RateLimitType,
  identifier: string
): Promise<RateLimitCheckResult> {
  const config = RATE_LIMIT_CONFIGS[type];
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // In production, strictly require Upstash Redis without in-memory fallback
  if (process.env.NODE_ENV === "production") {
    if (!redisUrl || !redisToken) {
      throw new Error("[RateLimiter] Production rate limiting strictly requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. In-memory fallback is disabled in production.");
    }
  }

  // 1. Try Upstash Redis if configured
  if (redisUrl && redisToken && process.env.NODE_ENV !== "test") {
    try {
      const redis = new Redis({
        url: redisUrl,
        token: redisToken,
      });

      const ratelimit = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(config.limit, config.upstashWindow),
        prefix: `@remotehr/${type}`,
      });

      const { success, limit, remaining, reset } = await ratelimit.limit(identifier);
      const retryAfterSeconds = success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000));

      return {
        allowed: success,
        limit,
        remaining,
        reset,
        retryAfterSeconds,
      };
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        console.error(`[RateLimiter] Upstash Redis failure in production:`, err);
        throw new Error(`[RateLimiter] Production rate limiter unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
      console.error(`[RateLimiter] Upstash Redis request failed, falling back to memory:`, err);
    }
  }

  // 2. Sliding Window In-Memory Implementation
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const cacheKey = `${type}:${identifier}`;

  let timestamps = memorySlidingStore.get(cacheKey) || [];
  // Evict timestamps outside the active sliding window
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= config.limit) {
    const oldest = timestamps[0];
    const resetTime = oldest + config.windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - now) / 1000));

    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      reset: resetTime,
      retryAfterSeconds,
    };
  }

  // Record this attempt
  timestamps.push(now);
  memorySlidingStore.set(cacheKey, timestamps);

  const remaining = Math.max(0, config.limit - timestamps.length);
  const reset = now + config.windowMs;

  return {
    allowed: true,
    limit: config.limit,
    remaining,
    reset,
    retryAfterSeconds: 0,
  };
}

/**
 * Returns standard HTTP rate-limiting headers.
 */
export function getRateLimitHeaders(result: RateLimitCheckResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
  };

  if (!result.allowed) {
    headers["Retry-After"] = String(result.retryAfterSeconds);
  }

  return headers;
}
