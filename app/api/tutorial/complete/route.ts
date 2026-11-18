import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function getSupabaseClient(request: NextRequest) {
  let response = NextResponse.next();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  return { supabase, response };
}

async function resolveUser(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const { data: tokenUser } = await supabaseAdmin.auth.getUser(token);
    if (tokenUser?.user) return tokenUser.user;
  }
  const { supabase } = getSupabaseClient(request);
  const { data: cookieUser } = await supabase.auth.getUser();
  return cookieUser?.user || null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: prof } = await (supabaseAdmin as any)
      .from("profiles")
      .select("tutorial_completed, tutorial_version, onboarding_completed")
      .eq("id", user.id)
      .maybeSingle();

    const { data: emp } = await (supabaseAdmin as any)
      .from("employees")
      .select("tutorial_completed, onboarding_completed, onboarding_completed_at")
      .eq("id", user.id)
      .maybeSingle();

    const tutorial_completed =
      prof?.tutorial_completed === true || emp?.tutorial_completed === true;
    const tutorial_version = Number(prof?.tutorial_version) || 0;

    const userRole = (user.app_metadata?.user_role || user.user_metadata?.role || "employee").toLowerCase();
    const isExempt = userRole === "admin" || userRole === "hr";

    // Walkthrough gate: only starts when onboarding status is ALLOWED (approved profile + active employee)
    let isAllowed = isExempt;
    if (!isExempt) {
      if (user.app_metadata?.onboarding_approved === true) {
        isAllowed = true;
      } else {
        const { data: onbProf } = await (supabaseAdmin as any)
          .from("onboarding_profiles")
          .select("status")
          .eq("user_id", user.id)
          .maybeSingle();
        isAllowed = onbProf?.status === "approved" && emp?.status === "active";
      }
    }

    return NextResponse.json({
      tutorial_completed,
      tutorial_version,
      onboarding_completed: isAllowed,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch tutorial status." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let targetVersion = 2;
    let isReset = false;
    try {
      const body = await request.json();
      if (typeof body.tutorial_version === "number") {
        targetVersion = body.tutorial_version;
      }
      if (body.reset === true) {
        isReset = true;
      }
    } catch {}

    const completedVal = !isReset;
    const versionVal = isReset ? 0 : targetVersion;

    // 1. Update tutorial_completed on employees
    await (supabaseAdmin as any)
      .from("employees")
      .update({
        tutorial_completed: completedVal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    // 2. Update tutorial_completed on profiles with version fallback
    try {
      await (supabaseAdmin as any).from("profiles").upsert(
        {
          id: user.id,
          user_id: user.id,
          tutorial_completed: completedVal,
          tutorial_version: versionVal,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    } catch {
      try {
        await (supabaseAdmin as any).from("profiles").upsert(
          {
            id: user.id,
            user_id: user.id,
            tutorial_completed: completedVal,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      } catch {}
    }

    return NextResponse.json({
      success: true,
      tutorial_completed: completedVal,
      tutorial_version: versionVal,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update tutorial status." },
      { status: 500 }
    );
  }
}
