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
  NEXT_PUBLIC_DEMO_MODE: z.enum(["true", "false"]).optional().default("false"),
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

function validateEnv(): { client: ClientEnv; server: ServerEnv } {
  const isProduction = process.env.NODE_ENV === "production";

  // Parse Client Env
  const rawClient = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || (isProduction ? undefined : "http://127.0.0.1:54321"),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || (isProduction ? undefined : "dummy-anon-key"),
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE as any,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  };

  const clientParsed = clientEnvSchema.safeParse(rawClient);
  if (!clientParsed.success) {
    const errorMsg = `[Env Config Error] Invalid Client Environment: ${JSON.stringify(
      clientParsed.error.flatten().fieldErrors,
      null,
      2
    )}`;
    if (isProduction) {
      throw new Error(errorMsg);
    } else {
      console.warn(errorMsg);
    }
  }

  // Parse Server Env (only evaluate fully on server side)
  const isServer = typeof window === "undefined";
  const rawServer = {
    NODE_ENV: process.env.NODE_ENV || "development",
    DATABASE_URL: process.env.DATABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || (isProduction ? undefined : "dummy-service-role-key"),
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || "RemoteHR <onboarding@remotehr.io>",
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    SENTRY_DSN: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL,
    COMPANY_NAME: process.env.COMPANY_NAME || "RemoteHR",
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || "support@remotehr.io",
    PRIVACY_POLICY_URL: process.env.PRIVACY_POLICY_URL || "/privacy",
    TERMS_OF_SERVICE_URL: process.env.TERMS_OF_SERVICE_URL || "/terms",
  };

  const serverParsed = serverEnvSchema.safeParse(rawServer);
  if (!serverParsed.success && isServer) {
    const errorMsg = `[Env Config Error] Invalid Server Environment: ${JSON.stringify(
      serverParsed.error.flatten().fieldErrors,
      null,
      2
    )}`;
    if (isProduction) {
      throw new Error(errorMsg);
    } else {
      console.warn(errorMsg);
    }
  }

  return {
    client: clientParsed.success ? clientParsed.data : (rawClient as any),
    server: serverParsed.success ? serverParsed.data : (rawServer as any),
  };
}

const { client: clientEnv, server: serverEnv } = validateEnv();

export { clientEnv, serverEnv };
export default { client: clientEnv, server: serverEnv };
