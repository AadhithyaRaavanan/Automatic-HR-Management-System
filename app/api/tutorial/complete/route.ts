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
    const onboarding_completed =
      prof?.onboarding_completed === true ||
      emp?.onboarding_completed === true ||
      Boolean(emp?.onboarding_completed_at);

    return NextResponse.json({
      tutorial_completed,
      tutorial_version,
      onboarding_completed,
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
    try {
      const body = await request.json();
      if (typeof body.tutorial_version === "number") {
        targetVersion = body.tutorial_version;
      }
    } catch {}

    // 1. Mark tutorial_completed on employees
    await (supabaseAdmin as any)
      .from("employees")
      .update({
        tutorial_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    // 2. Mark tutorial_completed on profiles with version fallback
    try {
      await (supabaseAdmin as any).from("profiles").upsert(
        {
          id: user.id,
          user_id: user.id,
          tutorial_completed: true,
          tutorial_version: targetVersion,
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
            tutorial_completed: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      } catch {}
    }

    return NextResponse.json({ success: true, tutorial_completed: true, tutorial_version: targetVersion });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update tutorial status." },
      { status: 500 }
    );
  }
}
