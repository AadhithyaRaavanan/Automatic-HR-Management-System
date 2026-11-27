import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database, EmployeeRole } from "@/types/database.types";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase/admin";

export interface ApprovedUserContext {
  user: any;
  employee?: any;
  role: EmployeeRole;
  userId: string;
  supabase: ReturnType<typeof createServerClient<Database>>;
}

/**
 * Shared API guard enforcing that the caller is fully approved to access workplace APIs.
 *
 * Exemption:
 * - ADMIN and HR roles are exempt and retain full access.
 *
 * Rules:
 * - Pending / un-approved employees receive 403 with code: ONBOARDING_NOT_APPROVED.
 * - Allowed without this guard: /api/onboarding/*, /api/auth/*, /api/tutorial/*, /api/notifications (GET).
 */
export async function requireApprovedUser(
  request: NextRequest
): Promise<ApprovedUserContext | { response: NextResponse }> {
  const authHeader = request.headers.get("authorization");
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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const role = (
    user.app_metadata?.user_role ||
    user.user_metadata?.role ||
    user.user_metadata?.user_role ||
    "employee"
  ).toLowerCase() as EmployeeRole;

  // 1. Super Admin is exempt. HR, Manager, and Employee must be approved.
  if (role === "admin") {
    return { user, role, userId: user.id, supabase };
  }

  // 2. Fast-path: app_metadata.onboarding_approved claim
  if (user.app_metadata?.onboarding_approved === true) {
    return { user, role, userId: user.id, supabase };
  }

  // 3. Fallback: lightweight DB check using supabaseAdmin when configured, else caller SSR client
  try {
    const dbClient: any = isSupabaseAdminConfigured() ? supabaseAdmin : supabase;
    const [onbRes, empRes] = await Promise.all([
      dbClient
        .from("onboarding_profiles")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle(),
      dbClient
        .from("employees")
        .select("status, onboarding_completed")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    const profStatus = (onbRes.data?.status || "").toLowerCase();
    const empStatus = (empRes.data?.status || "").toLowerCase();
    const onbTableMissing = Boolean(
      onbRes.error &&
        (onbRes.error.code === "PGRST205" ||
          onbRes.error.code === "42P01" ||
          /could not find the table|does not exist/i.test(onbRes.error.message || ""))
    );

    if ((profStatus === "approved" || onbTableMissing) && empStatus === "active") {
      // Stamp claim in background so subsequent calls hit fast-path
      if (isSupabaseAdminConfigured()) {
        try {
          await supabaseAdmin.auth.admin.updateUserById(user.id, {
            app_metadata: { onboarding_approved: true },
          });
        } catch {}
      }

      return { user, employee: empRes.data, role, userId: user.id, supabase };
    }
  } catch (err) {
    console.warn("[requireApprovedUser] Error checking approval status:", err);
  }

  // Pending approval or onboarding required
  return {
    response: NextResponse.json(
      {
        error: "Onboarding not approved. Wait until approval.",
        code: "ONBOARDING_NOT_APPROVED",
      },
      { status: 403 }
    ),
  };
}
