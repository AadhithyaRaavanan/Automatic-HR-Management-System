import "server-only";

import { createClient } from "@supabase/supabase-js";
import { Database } from "@/types/database.types";

/**
 * Server-only Supabase Admin Client.
 *
 * PRIVILEGED CLIENT: Uses the SUPABASE_SERVICE_ROLE_KEY to bypass Row Level Security.
 * This module is guarded with `import 'server-only'` to guarantee it can never be bundled
 * or executed in client components or sent to the browser.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  // Only warn in dev/build if variables are absent; runtime will fail if invoked
  if (process.env.NODE_ENV === "production") {
    console.warn("SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is not set");
  }
}

export const supabaseAdmin = createClient<Database>(
  supabaseUrl || "https://placeholder-url.supabase.co",
  supabaseServiceKey || "placeholder-service-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export function getAdminClient() {
  return supabaseAdmin;
}

