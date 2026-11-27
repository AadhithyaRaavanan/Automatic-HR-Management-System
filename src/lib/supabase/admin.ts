import "server-only";

import { createClient } from "@supabase/supabase-js";
import { Database } from "@/types/database.types";
import {
  getSupabaseAdminConfigError,
  isSupabaseAdminConfigured,
  readSupabaseAdminEnv,
} from "@/lib/supabase/admin-config";

export { getSupabaseAdminConfigError, isSupabaseAdminConfigured };

/**
 * Server-only Supabase Admin Client.
 *
 * PRIVILEGED CLIENT: Uses the SUPABASE_SERVICE_ROLE_KEY to bypass Row Level Security.
 * This module is guarded with `import 'server-only'` to guarantee it can never be bundled
 * or executed in client components or sent to the browser.
 */

/**
 * In @supabase/supabase-js v2.119.0, PostgrestClient wraps fetch without `omitApiKeyAsBearer: true`,
 * which causes new-format `sb_secret_...` keys to be sent in `Authorization: Bearer sb_secret_...`.
 * Non-JWT secret keys must only be sent in the `apikey` header on PostgREST / Storage routes so the
 * Supabase gateway elevates the request to the Postgres `service_role`.
 *
 * Also fails fast locally when SUPABASE_SERVICE_ROLE_KEY is missing/invalid instead of sending
 * placeholder credentials over the network.
 */
function createServiceRoleFetch(serviceKey?: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const configError = getSupabaseAdminConfigError();
    if (configError) {
      return new Response(
        JSON.stringify({
          code: "SUPABASE_ADMIN_NOT_CONFIGURED",
          message: configError,
          error: configError,
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );

    if (
      serviceKey &&
      serviceKey.startsWith("sb_secret_") &&
      (urlStr.includes("/rest/v1") || urlStr.includes("/storage/v1"))
    ) {
      headers.set("apikey", serviceKey);
      const authVal = headers.get("Authorization");
      if (!authVal || authVal === `Bearer ${serviceKey}`) {
        headers.delete("Authorization");
      }
    }

    return fetch(input, { ...init, headers });
  };
}

function buildAdminClient(url?: string, serviceKey?: string) {
  const effectiveUrl = url || "https://placeholder-url.supabase.co";
  const effectiveKey = serviceKey || "placeholder-service-key";

  return createClient<Database>(effectiveUrl, effectiveKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: createServiceRoleFetch(serviceKey),
    },
  });
}

const initialEnv = readSupabaseAdminEnv();
if (!isSupabaseAdminConfigured() && process.env.NODE_ENV === "production") {
  console.warn("SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is not properly configured");
}

export const supabaseAdmin = buildAdminClient(
  initialEnv.supabaseUrl,
  initialEnv.supabaseServiceKey
);

export function getAdminClient() {
  const { supabaseUrl, supabaseServiceKey } = readSupabaseAdminEnv();
  if (isSupabaseAdminConfigured() && supabaseUrl && supabaseServiceKey) {
    return buildAdminClient(supabaseUrl, supabaseServiceKey);
  }
  return supabaseAdmin;
}
