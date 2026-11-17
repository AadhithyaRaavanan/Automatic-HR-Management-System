import { z } from "zod";

/**
 * Client Environment Schema (Exposed to Browser via NEXT_PUBLIC_*)
 * Strictly contains non-sensitive configuration values.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  NEXT_PUBLIC_DEMO_MODE: z.enum(["true", "false"]).optional().default("true"),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

/**
 * Server Environment Schema (Backend Only, Never Exposed to Browser)
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required in server runtime"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional().default("RemoteHR <onboarding@remotehr.io>"),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  COMPANY_NAME: z.string().optional().default("RemoteHR"),
  SUPPORT_EMAIL: z.string().email().optional().default("support@remotehr.io"),
  PRIVACY_POLICY_URL: z.string().optional().default("/privacy"),
  TERMS_OF_SERVICE_URL: z.string().optional().default("/terms"),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function validateEnv(customEnv?: Record<string, string | undefined>): { client: ClientEnv; server: ServerEnv } {
  const envSource = customEnv || process.env;
  const isProduction = envSource.NODE_ENV === "production";
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

  // Parse Client Env
  const rawClient = {
    NEXT_PUBLIC_SUPABASE_URL: envSource.NEXT_PUBLIC_SUPABASE_URL || (isProduction ? undefined : "http://127.0.0.1:54321"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: envSource.NEXT_PUBLIC_SUPABASE_ANON_KEY || (isProduction ? undefined : "dummy-anon-key"),
    NEXT_PUBLIC_APP_URL: envSource.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: envSource.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_DEMO_MODE: envSource.NEXT_PUBLIC_DEMO_MODE as any,
    NEXT_PUBLIC_SENTRY_DSN: envSource.NEXT_PUBLIC_SENTRY_DSN,
  };

  const clientParsed = clientEnvSchema.safeParse(rawClient);
  if (!clientParsed.success) {
    const errorMsg = `[Env Config Error] Invalid Client Environment: ${JSON.stringify(
      clientParsed.error.flatten().fieldErrors,
      null,
      2
    )}`;
    if (isProduction && !isBuildPhase) {
      throw new Error(errorMsg);
    } else {
      console.warn(errorMsg);
    }
  }

  // Parse Server Env (only evaluate fully on server side or when explicitly validating)
  const isServer = typeof window === "undefined" || Boolean(customEnv);
  const rawServer = {
    NODE_ENV: envSource.NODE_ENV || "development",
    DATABASE_URL: envSource.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: envSource.SUPABASE_SERVICE_ROLE_KEY || (isProduction ? undefined : "dummy-service-role-key"),
    RESEND_API_KEY: envSource.RESEND_API_KEY,
    RESEND_FROM_EMAIL: envSource.RESEND_FROM_EMAIL || "RemoteHR <onboarding@remotehr.io>",
    TURNSTILE_SECRET_KEY: envSource.TURNSTILE_SECRET_KEY,
    UPSTASH_REDIS_REST_URL: envSource.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: envSource.UPSTASH_REDIS_REST_TOKEN,
    SENTRY_DSN: envSource.SENTRY_DSN || envSource.NEXT_PUBLIC_SENTRY_DSN,
    SLACK_WEBHOOK_URL: envSource.SLACK_WEBHOOK_URL,
    COMPANY_NAME: envSource.COMPANY_NAME || "RemoteHR",
    SUPPORT_EMAIL: envSource.SUPPORT_EMAIL || "support@remotehr.io",
    PRIVACY_POLICY_URL: envSource.PRIVACY_POLICY_URL || "/privacy",
    TERMS_OF_SERVICE_URL: envSource.TERMS_OF_SERVICE_URL || "/terms",
  };

  const serverParsed = serverEnvSchema.safeParse(rawServer);
  if (!serverParsed.success && isServer) {
    const errorMsg = `[Env Config Error] Invalid Server Environment: ${JSON.stringify(
      serverParsed.error.flatten().fieldErrors,
      null,
      2
    )}`;
    if (isProduction && !isBuildPhase && envSource.NEXT_PUBLIC_DEMO_MODE !== "true") {
      throw new Error(errorMsg);
    } else {
      console.warn(errorMsg);
    }
  }

  // Strict production runtime enforcement: must fail startup if any required variable is missing
  // (relaxed if explicitly running in demo mode via NEXT_PUBLIC_DEMO_MODE=true for stakeholder presentations)
  if (isProduction && isServer && !isBuildPhase && envSource.NEXT_PUBLIC_DEMO_MODE !== "true") {
    const missing: string[] = [];
    if (!envSource.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!envSource.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!envSource.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!envSource.NEXT_PUBLIC_APP_URL) missing.push("NEXT_PUBLIC_APP_URL");
    if (!envSource.NEXT_PUBLIC_TURNSTILE_SITE_KEY) missing.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    if (!envSource.UPSTASH_REDIS_REST_URL) missing.push("UPSTASH_REDIS_REST_URL");
    if (!envSource.UPSTASH_REDIS_REST_TOKEN) missing.push("UPSTASH_REDIS_REST_TOKEN");
    if (!envSource.RESEND_API_KEY) missing.push("RESEND_API_KEY");
    if (!envSource.RESEND_FROM_EMAIL) missing.push("RESEND_FROM_EMAIL");
    if (missing.length > 0) {
      throw new Error(`[Env Config Fatal] Missing required production environment variables: ${missing.join(", ")}`);
    }
  }

  return {
    client: clientParsed.success ? clientParsed.data : (rawClient as any),
    server: serverParsed.success ? serverParsed.data : (rawServer as any),
  };
}

const { client: clientEnv, server: serverEnv } = validateEnv();

export { clientEnv, serverEnv };
const env = { client: clientEnv, server: serverEnv };
export default env;
