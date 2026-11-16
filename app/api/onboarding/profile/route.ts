import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listCandidateDocs } from "@/lib/onboarding-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
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

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check profiles completion status
    const { data: profile } = await (supabaseAdmin as any)
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    // Fetch onboarding profile data
    const { data: onboardingProfile } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fetch employee data
    const { data: employee } = await (supabaseAdmin.from("employees") as any)
      .select("id, full_name, email, department_id, job_title_id, status")
      .eq("id", user.id)
      .maybeSingle();

    // Fetch uploaded documents
    const documents = await listCandidateDocs(user.id).catch(() => []);

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: employee?.full_name || user.user_metadata?.full_name || "",
      },
      profile: profile || { onboarding_completed: false, tutorial_completed: false },
      onboardingProfile: onboardingProfile || null,
      documents,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load onboarding profile." },
      { status: 500 }
    );
  }
}
