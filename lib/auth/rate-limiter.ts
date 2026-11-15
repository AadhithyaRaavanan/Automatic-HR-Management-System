interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// In-memory fallback cache for fast local testing and offline execution
const fallbackMemoryMap = new Map<string, { attempts: number; lockedUntil: number | null }>();

export function getRateLimitKey(ip: string, email: string): string {
  return `ip_email::${ip}::${email.toLowerCase().trim()}`;
}

export function getEmailRateLimitKey(email: string): string {
  return `email::${email.toLowerCase().trim()}`;
}

/**
 * Check if the given rate limit key has exceeded maximum attempts.
 * Uses Upstash Redis (if configured) or Supabase persistent table public.auth_rate_limits.
 */
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const now = Date.now();

  // 1. Upstash Redis (if configured)
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    try {
      const res = await fetch(`${redisUrl}/get/${encodeURIComponent(`ratelimit:${key}`)}`, {
        headers: { Authorization: `Bearer ${redisToken}` },
      });
      const data = await res.json();
      if (data.result) {
        const parsed = JSON.parse(data.result);
        if (parsed.lockedUntil && now < parsed.lockedUntil) {
          const retryAfter = Math.ceil((parsed.lockedUntil - now) / 1000);
          return { allowed: false, retryAfterSeconds: Math.max(retryAfter, 1) };
        }
      }
      return { allowed: true, retryAfterSeconds: 0 };
    } catch (err) {
      console.error("[RateLimiter] Redis check failed:", err);
    }
  }

  // 2. Supabase DB Shared Store (public.auth_rate_limits)
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV !== "test") {
    try {
      const { getAdminClient } = await import("@/lib/supabase/admin");
      const admin = getAdminClient();
      const { data, error } = await (admin.from("auth_rate_limits") as any)
        .select("attempts, locked_until")
        .eq("key", key)
        .maybeSingle();

      if (!error && data) {
        const row = data as { attempts: number; locked_until: string | null };
        if (row.locked_until) {
          const lockedUntilMs = new Date(row.locked_until).getTime();
          if (now < lockedUntilMs) {
            const retryAfter = Math.ceil((lockedUntilMs - now) / 1000);
            return { allowed: false, retryAfterSeconds: Math.max(retryAfter, 1) };
          }
        }
      }
      return { allowed: true, retryAfterSeconds: 0 };
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(`[RateLimiter] Production rate limit evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      // In offline/test environments, proceed to fallback
    }
  }

  // 3. In-Memory Fallback (Strictly disabled in production)
  if (process.env.NODE_ENV === "production") {
    throw new Error("[RateLimiter] In-memory rate limiting fallback is strictly disabled in production.");
  }

  const mem = fallbackMemoryMap.get(key);
  if (mem && mem.lockedUntil && now < mem.lockedUntil) {
    const retryAfter = Math.ceil((mem.lockedUntil - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfter, 1) };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Record a failed login attempt for a key.
 */
export async function recordFailure(key: string): Promise<void> {
  const now = Date.now();

  // 1. Upstash Redis
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    try {
      const getRes = await fetch(`${redisUrl}/get/${encodeURIComponent(`ratelimit:${key}`)}`, {
        headers: { Authorization: `Bearer ${redisToken}` },
      });
      const getData = await getRes.json();
      let currentAttempts = 0;
      if (getData.result) {
        currentAttempts = JSON.parse(getData.result).attempts || 0;
      }
      const newAttempts = currentAttempts + 1;
      const lockedUntil = newAttempts >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_WINDOW_MS : null;
      const payload = JSON.stringify({ attempts: newAttempts, lockedUntil });

      await fetch(`${redisUrl}/set/${encodeURIComponent(`ratelimit:${key}`)}?ex=900`, {
        method: "POST",
        headers: { Authorization: `Bearer ${redisToken}` },
        body: payload,
      });
      return;
    } catch (err) {
      console.error("[RateLimiter] Redis record failure failed:", err);
    }
  }

  // 2. Supabase DB Shared Store
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV !== "test") {
    try {
      const { getAdminClient } = await import("@/lib/supabase/admin");
      const admin = getAdminClient();
      const { data: existing } = await (admin.from("auth_rate_limits") as any)
        .select("attempts")
        .eq("key", key)
        .maybeSingle();

      const newAttempts = ((existing as any)?.attempts || 0) + 1;
      const lockedUntil = newAttempts >= MAX_FAILED_ATTEMPTS ? new Date(now + LOCKOUT_WINDOW_MS).toISOString() : null;

      await (admin.from("auth_rate_limits") as any).upsert({
        key,
        attempts: newAttempts,
        locked_until: lockedUntil,
        updated_at: new Date(now).toISOString(),
      });
      return;
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(`[RateLimiter] Production rate limit record failure: ${err instanceof Error ? err.message : String(err)}`);
      }
      // In offline/test environments, proceed to fallback
    }
  }

  // 3. In-Memory Fallback (Strictly disabled in production)
  if (process.env.NODE_ENV === "production") {
    throw new Error("[RateLimiter] In-memory rate limiting fallback is strictly disabled in production.");
  }

  const mem = fallbackMemoryMap.get(key) || { attempts: 0, lockedUntil: null };
  const newAttempts = mem.attempts + 1;
  const lockedUntil = newAttempts >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_WINDOW_MS : null;
  fallbackMemoryMap.set(key, { attempts: newAttempts, lockedUntil });
}

/**
 * Reset failed attempts upon successful login.
 */
export async function clearRateLimit(key: string): Promise<void> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (redisUrl && redisToken) {
    try {
      await fetch(`${redisUrl}/del/${encodeURIComponent(`ratelimit:${key}`)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${redisToken}` },
      });
    } catch {}
  }

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NODE_ENV !== "test") {
    try {
      const { getAdminClient } = await import("@/lib/supabase/admin");
      const admin = getAdminClient();
      await admin.from("auth_rate_limits").delete().eq("key", key);
    } catch {}
  }

  fallbackMemoryMap.delete(key);
}
