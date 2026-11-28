import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { resolveOnboardingCaller } from "@/features/auth/tenant-context";

export interface NotificationAuthResult {
  user: any | null;
  supabase: ReturnType<typeof createServerClient<Database>>;
  organizationId: string | null;
  errorResponse?: NextResponse;
}

function createAnonFallbackClient(request: NextRequest) {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll() {},
      },
    }
  );
}

export async function getNotificationAuth(
  request: NextRequest
): Promise<NotificationAuthResult> {
  const resolved = await resolveOnboardingCaller(request);

  if ("response" in resolved) {
    const supabase = createAnonFallbackClient(request);
    if (resolved.response.status === 401) {
      return { user: null, supabase, organizationId: null };
    }
    return {
      user: null,
      supabase,
      organizationId: null,
      errorResponse: resolved.response,
    };
  }

  return {
    user: resolved.user,
    supabase: resolved.supabase,
    organizationId: resolved.context.organizationId || null,
  };
}

export async function getNotificationCaller(request: NextRequest) {
  const { user } = await getNotificationAuth(request);
  return user;
}
