import "server-only";

export function readSupabaseAdminEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  };
}

export function getSupabaseAdminConfigError(): string | null {
  const { supabaseUrl, supabaseServiceKey, anonKey } = readSupabaseAdminEnv();
  if (!supabaseUrl || supabaseUrl.includes("placeholder") || supabaseUrl.includes("dummy")) {
    return "Server configuration error: NEXT_PUBLIC_SUPABASE_URL is missing or invalid.";
  }
  if (
    !supabaseServiceKey ||
    supabaseServiceKey.includes("placeholder") ||
    supabaseServiceKey.includes("dummy")
  ) {
    return "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is missing. Employee provisioning requires the server-side Supabase service role key.";
  }
  // Never treat a publishable/anon key as a service-role admin key
  if (
    supabaseServiceKey.startsWith("sb_publishable_") ||
    (anonKey && supabaseServiceKey === anonKey)
  ) {
    return "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is configured with a publishable/anon key instead of a service_role secret key.";
  }
  return null;
}

export function isSupabaseAdminConfigured(): boolean {
  return getSupabaseAdminConfigError() === null;
}
