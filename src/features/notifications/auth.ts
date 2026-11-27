import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase/admin";

export interface NotificationAuthResult {
  user: any | null;
  supabase: ReturnType<typeof createServerClient<Database>>;
}

export async function getNotificationAuth(
  request: NextRequest
): Promise<NotificationAuthResult> {
  const authHeader = request.headers.get("Authorization");
  const bearerToken =
    authHeader && authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
    {
      ...(bearerToken
        ? {
            global: {
              headers: {
                Authorization: `Bearer ${bearerToken}`,
              },
            },
          }
        : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );

  let user: any = null;

  if (bearerToken && isSupabaseAdminConfigured()) {
    try {
      const { data: tokenUser } = await supabaseAdmin.auth.getUser(bearerToken);
      user = tokenUser?.user || null;
    } catch {}
  }

  if (!user) {
    try {
      const { data: cookieUser } = await supabase.auth.getUser(bearerToken);
      user = cookieUser?.user || null;
    } catch {}
  }

  return { user, supabase };
}

export async function getNotificationCaller(request: NextRequest) {
  const { user } = await getNotificationAuth(request);
  return user;
}
